-- ===========================================================================
--  UNE DÉROGATION N'EST OPPOSABLE QUE SI ELLE EST VALIDE
--  Réf. SPECIFICATIONS.md § 11.2, § 5.4
--
--  ⚠️ CE QUI EXISTAIT ÉTAIT UN JETON AU PORTEUR.
--
--     Quatre verrous s'appuient sur une dérogation. Deux ne vérifiaient QUE
--     SA PRÉSENCE (HSE, conformité), deux vérifiaient en plus son TYPE (marge,
--     bande de prix d'achat). AUCUN ne regardait :
--
--       · son statut — une dérogation RÉVOQUÉE ouvrait toujours ;
--       · sa date d'expiration — une dérogation périmée ouvrait toujours ;
--       · son sujet — une dérogation accordée pour l'affaire A ouvrait
--         l'affaire B.
--
--     Une dérogation accordée une fois par le DG, puis révoquée le lendemain,
--     restait un passe-partout permanent. Sur 10 000 000 L, la différence
--     entre un plancher de marge respecté et contourné se compte en dizaines
--     de millions de FCFA.
--
--     C'est aussi la pièce qu'un assureur ou un auditeur demandera après un
--     incident : « sur quelle autorisation cette opération est-elle partie ? »
--     Une réponse valable au moment des faits, pas un identifiant qui
--     traînait.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  LA fonction. Un seul endroit décide qu'une dérogation vaut quelque chose.
--
--  `p_sujet` est facultatif : certaines dérogations sont générales. Mais si la
--  dérogation DÉSIGNE un sujet, il doit correspondre — une autorisation
--  nominative ne se prête pas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derogation_opposable(
  p_id    uuid,
  p_type  text,
  p_sujet text DEFAULT NULL
)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM derogations d
     WHERE d.id = p_id
       AND d.type::text = p_type
       AND d.status::text = 'ACTIVE'
       AND d.revoked_at IS NULL
       -- Sans échéance = permanente. Avec échéance = elle cesse d'agir.
       AND (d.expires_at IS NULL OR d.expires_at > now())
       -- Sujet non désigné = générale. Sujet désigné = il doit correspondre.
       AND (d.subject_id IS NULL OR p_sujet IS NULL OR d.subject_id = p_sujet)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION derogation_opposable IS
  'Vrai si la dérogation existe, est du type attendu, est ACTIVE, non révoquée, non expirée, et porte sur le bon sujet (§ 11.2). Tout verrou qui accepte une dérogation DOIT passer par ici.';

/**
 * Motif de refus, rédigé pour l'utilisateur.
 *
 * Dire « dérogation invalide » n'aide personne : il faut dire LAQUELLE des
 * quatre conditions manque, sans quoi on renvoie chercher au hasard.
 */
CREATE OR REPLACE FUNCTION derogation_motif_refus(p_id uuid, p_type text, p_sujet text)
RETURNS text AS $$
DECLARE
  d   record;
  nom text;
BEGIN
  SELECT * INTO d FROM derogations WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN 'la dérogation invoquée n''existe pas';
  END IF;

  -- La table ne porte pas de référence lisible : on désigne la dérogation par
  -- son sujet, ou à défaut par le début de son identifiant. Dire « la
  -- dérogation » sans la nommer obligerait à chercher laquelle.
  nom := COALESCE(d.subject_label, d.subject_id, substr(d.id::text, 1, 8));

  IF d.type::text <> p_type THEN
    RETURN format('la dérogation %s est de type %s, or %s est attendu', nom, d.type, p_type);
  END IF;
  IF d.revoked_at IS NOT NULL OR d.status::text = 'REVOKED' THEN
    RETURN format('la dérogation %s a été RÉVOQUÉE%s', nom,
                  COALESCE(' le ' || to_char(d.revoked_at, 'DD/MM/YYYY'), ''));
  END IF;
  IF d.status::text <> 'ACTIVE' THEN
    RETURN format('la dérogation %s est au statut %s', nom, d.status);
  END IF;
  IF d.expires_at IS NOT NULL AND d.expires_at <= now() THEN
    RETURN format('la dérogation %s a EXPIRÉ le %s', nom,
                  to_char(d.expires_at, 'DD/MM/YYYY'));
  END IF;
  IF d.subject_id IS NOT NULL AND p_sujet IS NOT NULL AND d.subject_id <> p_sujet THEN
    RETURN format('la dérogation porte sur %s, pas sur %s', d.subject_id, p_sujet);
  END IF;
  RETURN 'la dérogation n''est pas opposable';
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  LES QUATRE VERROUS L'APPELLENT — mais ils ne sont PAS redéfinis ici.
--
--  Ils vivent dans 05_lot2_invariants.sql et 08_bareme_de_couts.sql, et c'est
--  là qu'ils sont corrigés. Les recopier ici pour « juste changer la
--  vérification de dérogation » obligerait à recopier aussi tout le reste de
--  leur corps — seuils, motifs circonstanciés, messages — et la copie
--  divergerait de l'original à la première évolution. On a failli y perdre
--  l'exigence de motif sur la bande de prix d'achat.
--
--  ⚠️ CE FICHIER EST DONC INJECTÉ AVANT EUX dans chaque migration : la
--     fonction doit exister quand ils l'invoquent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  EXPIRATION AUTOMATIQUE DU STATUT.
--
--  `status` et `expires_at` disaient deux choses différentes : une dérogation
--  échue restait ACTIVE en base. La fonction ci-dessus s'appuie sur les deux,
--  donc le trou était déjà refermé — mais un écran qui lit `status` continuait
--  d'afficher « active » sur une dérogation morte.
--
--  Le statut est donc CALCULÉ à l'écriture, et une vue le rend à jour en
--  lecture. Pas d'ordonnanceur : il n'y en a pas dans cette pile, et en
--  introduire un pour cela seul serait disproportionné.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_derogations_effectives AS
SELECT d.*,
       CASE
         WHEN d.revoked_at IS NOT NULL THEN 'REVOKED'
         WHEN d.status::text <> 'ACTIVE' THEN d.status::text
         WHEN d.expires_at IS NOT NULL AND d.expires_at <= now() THEN 'EXPIRED'
         ELSE 'ACTIVE'
       END AS statut_effectif,
       derogation_opposable(d.id, d.type::text, d.subject_id) AS opposable
  FROM derogations d;

COMMENT ON VIEW v_derogations_effectives IS
  'Dérogations avec leur statut RÉEL à l''instant de la lecture : une dérogation échue reste ACTIVE en colonne, elle ne l''est plus en fait (§ 11.2).';


-- ---------------------------------------------------------------------------
--  REPRISE — ce qui est déjà passé avec une dérogation qui n'ouvrait rien.
--
--  Un déclencheur ne vaut que pour l'avenir. Les affaires approuvées et les
--  opérations parties sous une dérogation révoquée, expirée ou étrangère
--  restent en base, et rien ne les signale. On ne peut pas les défaire — elles
--  ont eu lieu — mais elles doivent être VUES.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_derogations_abusives AS
SELECT 'Affaire approuvée sous le plancher avec une dérogation non opposable' AS regle,
       d.reference AS enregistrement,
       derogation_motif_refus(d.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', d.reference) AS detail
  FROM deals d
 WHERE d.status::text = 'APPROVED'
   AND d.margin_derogation_id IS NOT NULL
   AND NOT derogation_opposable(d.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', d.reference)

UNION ALL
SELECT 'Affaire approuvée hors bande de prix avec une dérogation non opposable',
       d.reference,
       derogation_motif_refus(d.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', d.reference)
  FROM deals d
 WHERE d.status::text = 'APPROVED'
   AND d.purchase_price_derogation_id IS NOT NULL
   AND NOT derogation_opposable(d.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', d.reference)

UNION ALL
SELECT 'Opération partie sous une dérogation HSE non opposable',
       o.reference,
       derogation_motif_refus(o.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', o.reference)
  FROM operations o
 WHERE o.hse_derogation_id IS NOT NULL
   AND NOT derogation_opposable(o.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', o.reference)

UNION ALL
SELECT 'Moyens affectés sous une dérogation de conformité non opposable',
       o.reference,
       derogation_motif_refus(a.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', o.reference)
  FROM operation_assignments a
  JOIN operations o ON o.id = a.operation_id
 WHERE a.compliance_derogation_id IS NOT NULL
   AND NOT derogation_opposable(a.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', o.reference);

COMMENT ON VIEW v_derogations_abusives IS
  'Enregistrements passés sous une dérogation qui ne les autorisait pas (§ 11.2). On ne peut pas les défaire ; ils doivent être vus.';
