-- ===========================================================================
--  INVARIANTS — LOT 2 : CŒUR COMMERCIAL & EXÉCUTION
--  Réf. SPECIFICATIONS.md § 5.4, § 7, § 9, § 11
--
--  Trois verrous, une chaîne de facturation, et les contrôles anti-détournement.
--  Portés par PostgreSQL : aucun bug applicatif, aucun script d'administration
--  et aucune refonte de l'API ne peut les contourner.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  A. PRIX D'ACHAT — JAMAIS LIBRE
--
--  Le levier le plus simple pour détourner de la valeur est de gonfler un coût
--  d'achat : la marge affichée baisse, l'affaire passe le seuil, et la
--  différence part ailleurs. On ferme ce levier à la source.
-- ---------------------------------------------------------------------------

-- Un prix fournisseur n'est validé que par le DG.
CREATE OR REPLACE FUNCTION enforce_supplier_price_validator()
RETURNS TRIGGER AS $$
DECLARE
  validator_role text;
BEGIN
  IF NEW.validated_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role::text INTO validator_role FROM users WHERE id = NEW.validated_by_id;
  IF validator_role IS DISTINCT FROM 'DG' THEN
    RAISE EXCEPTION
      'La validation d''un prix fournisseur est réservée au DG. Rôle fourni : %.',
      COALESCE(validator_role, 'utilisateur inconnu')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_validator ON supplier_prices;
CREATE TRIGGER trg_supplier_price_validator
  BEFORE INSERT OR UPDATE OF validated_by_id ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_validator();

-- Un prix validé ne se modifie plus : une évolution crée une nouvelle ligne.
-- Sans cela, changer un prix passé réécrirait rétroactivement le coût de
-- toutes les affaires qui s'y adossent.
CREATE OR REPLACE FUNCTION enforce_supplier_price_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.validated_at IS NULL THEN
    RETURN NEW; -- Brouillon non validé : librement modifiable.
  END IF;

  IF NEW.unit_price   IS DISTINCT FROM OLD.unit_price
  OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
  OR NEW.uom          IS DISTINCT FROM OLD.uom
  OR NEW.supplier_id  IS DISTINCT FROM OLD.supplier_id
  OR NEW.product_id   IS DISTINCT FROM OLD.product_id
  OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION
      'Prix fournisseur déjà validé : il ne se modifie pas. Créer une nouvelle ligne datée.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW; -- Clôture de période (effective_to) admise.
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_immutable ON supplier_prices;
CREATE TRIGGER trg_supplier_price_immutable
  BEFORE UPDATE ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_immutable();

-- Le prix d'achat d'un deal provient d'un prix fournisseur validé et en vigueur.
CREATE OR REPLACE FUNCTION enforce_deal_purchase_price_sourced()
RETURNS TRIGGER AS $$
DECLARE
  sp RECORD;
BEGIN
  -- Un brouillon sans prix d'achat n'est pas encore contraint : le commercial
  -- construit son devis avant de savoir à qui il achètera.
  --
  -- ⚠️ MAIS CETTE TOLÉRANCE SE REFERME À L'APPROBATION. Sans cela, une affaire
  --    sans prix d'achat affiche une marge égale au prix de vente entier —
  --    765 FCFA/L au lieu de 55 — et franchit tous les seuils. Le dispositif
  --    anti-détournement suppose le prix d'achat SOURCÉ ; il faut donc aussi
  --    exiger qu'il soit PRÉSENT.
  IF NEW.unit_purchase_price = 0 AND NEW.supplier_price_id IS NULL THEN
    IF NEW.credit_approved_by_id IS NOT NULL OR NEW.dg_approved_by_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Le deal % ne porte aucun prix d''achat : la marge affichée vaut le prix de vente entier. Rattacher un prix fournisseur validé avant toute approbation.',
        NEW.reference
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supplier_price_id IS NULL THEN
    RAISE EXCEPTION
      'Le prix d''achat du deal % doit provenir d''un prix fournisseur validé : il ne se saisit pas librement.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT unit_price, validated_at, effective_from, effective_to, product_id, currency_code
    INTO sp
    FROM supplier_prices WHERE id = NEW.supplier_price_id;

  IF sp IS NULL THEN
    RAISE EXCEPTION 'Prix fournisseur introuvable pour le deal %.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF sp.validated_at IS NULL THEN
    RAISE EXCEPTION
      'Le prix fournisseur adossé au deal % n''est pas validé par le DG.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF sp.product_id <> NEW.product_id THEN
    RAISE EXCEPTION
      'Le prix fournisseur adossé au deal % ne concerne pas le produit vendu.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  -- L'ÉCART AU PRIX VALIDÉ N'EST PLUS INTERDIT ICI (décision du 3 août 2026).
  -- Les conditions du jour ne sont pas celles du barème, et exiger une
  -- nouvelle ligne validée par le DG à chaque variation de cours ferait
  -- attendre le commercial pour chiffrer.
  --
  -- Ce que cet invariant garantit reste entier : le prix est ADOSSÉ à une
  -- ligne fournisseur validée, du bon produit, en vigueur. L'ampleur de
  -- l'écart, elle, relève de la bande de tolérance — voir
  -- `enforce_purchase_price_band` dans 08_bareme_de_couts.sql, qui exige un
  -- motif au-delà et une dérogation du DG pour approuver.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_purchase_price_sourced ON deals;
-- Les colonnes d'APPROBATION sont surveillées au même titre que le prix :
-- la tolérance accordée au brouillon doit se refermer au moment précis où
-- quelqu'un engage l'entreprise, et ce moment est une écriture sur ces
-- colonnes-là, pas sur le prix.
CREATE TRIGGER trg_deal_purchase_price_sourced
  BEFORE INSERT OR UPDATE OF unit_purchase_price, supplier_price_id, product_id,
                             credit_approved_by_id, dg_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_purchase_price_sourced();


-- ---------------------------------------------------------------------------
--  B. TOUTE MODIFICATION DE PRIX ANNULE L'APPROBATION
--
--  Sans cela, un deal approuvé à 45 FCFA de marge peut être ramené à 31 sans
--  repasser devant personne : l'approbation ne vaudrait rien.
--
--  On n'interdit pas la modification — on retire l'approbation, ce qui renvoie
--  l'affaire devant le CFO. La trace reste au journal des transitions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION revoke_approval_on_price_change()
RETURNS TRIGGER AS $$
DECLARE
  economics_changed boolean;
BEGIN
  economics_changed :=
       NEW.unit_sale_price     IS DISTINCT FROM OLD.unit_sale_price
    OR NEW.unit_purchase_price IS DISTINCT FROM OLD.unit_purchase_price
    OR NEW.contracted_volume   IS DISTINCT FROM OLD.contracted_volume
    OR NEW.discount_mode       IS DISTINCT FROM OLD.discount_mode
    OR NEW.discount_value      IS DISTINCT FROM OLD.discount_value
    OR NEW.currency_code       IS DISTINCT FROM OLD.currency_code;

  IF NOT economics_changed THEN
    RETURN NEW;
  END IF;

  -- ⚠️ L'ACCORD DU DG SURVIVAIT À UNE BAISSE DE PRIX.
  --
  --    La condition portait sur `credit_approved_by_id` : rien ne se
  --    déclenchait tant que le CFO n'avait pas approuvé. Or la séquence
  --    normale est SOUMISSION → ACCORD DU DG SUR MARGE BASSE → APPROBATION
  --    CFO. Dans cette fenêtre — celle qui compte — le garde-fou ne s'armait
  --    jamais.
  --
  --    Conséquence démontrée : le DG arbitre sur 28 FCFA/L, le prix baisse de
  --    15, l'affaire s'engage à 13 sans que rien ne signale que la décision
  --    portait sur autre chose. Sur 10 000 000 L : 150 000 000 FCFA.
  --
  --    Un accord porte sur une ÉCONOMIE, pas sur un numéro d'affaire. Que
  --    l'économie change, et l'accord ne porte plus sur rien.
  IF OLD.credit_approved_by_id IS NULL AND OLD.dg_approved_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Une opération déjà engagée interdit la modification : le coût est réel.
  -- « Engagée » = sortie de PREPARATION et pas annulée (§ 22/08/2026,
  -- fusion status/phase) — une opération arrêtée en INCIDENT reste engagée,
  -- le coût y est réel ; seule CANCELLED annule l'engagement économique.
  IF EXISTS (SELECT 1 FROM operations
              WHERE deal_id = NEW.id
                AND phase::text <> 'PREPARATION'
                AND NOT (halted_at IS NOT NULL AND halt_type::text = 'CANCELLED')) THEN
    RAISE EXCEPTION
      'Le deal % a des opérations engagées : ses prix ne peuvent plus changer. Corriger par avoir.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.credit_approved_by_id := NULL;
  NEW.credit_approved_at    := NULL;
  NEW.dg_approved_by_id     := NULL;
  NEW.dg_approved_at        := NULL;
  NEW.status                := 'PENDING_RISK';

  INSERT INTO deal_status_transitions (id, deal_id, from_status, to_status, actor_type, reason)
  VALUES (gen_random_uuid(), NEW.id, OLD.status, 'PENDING_RISK', 'SYSTEM',
          CASE
            WHEN OLD.credit_approved_by_id IS NOT NULL
              THEN 'Approbation annulée : modification des conditions économiques après approbation.'
            ELSE 'Accord du DG annulé : les conditions économiques ont changé depuis son arbitrage.'
          END);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_revoke_approval_on_price_change ON deals;
CREATE TRIGGER trg_deal_revoke_approval_on_price_change
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION revoke_approval_on_price_change();


-- ---------------------------------------------------------------------------
--  C. VERROU FINANCIER  (§ 11.2)
--
--  « Aucune Opération ne peut exister sur un Deal non approuvé. »
--  Un seul point de contrôle verrouille toute l'exécution en amont.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_operation_requires_approval()
RETURNS TRIGGER AS $$
DECLARE
  d RECORD;
BEGIN
  SELECT reference, status::text AS status, credit_approved_by_id
    INTO d FROM deals WHERE id = NEW.deal_id;

  IF d.credit_approved_by_id IS NULL THEN
    RAISE EXCEPTION
      'VERROU FINANCIER : le deal % est en statut % et n''a pas reçu l''approbation de la Finance : aucune opération ne peut être créée.',
      d.reference, d.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF d.status IN ('CANCELLED', 'CREDIT_BLOCKED', 'REJECTED_BY_CLIENT', 'PENDING_RISK', 'PENDING_DG_APPROVAL') THEN
    RAISE EXCEPTION
      'VERROU FINANCIER : le deal % est en statut % : exécution refusée.', d.reference, d.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operation_requires_approval ON operations;
CREATE TRIGGER trg_operation_requires_approval
  BEFORE INSERT OR UPDATE OF deal_id ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_requires_approval();

-- Qui approuve quoi, vérifié en base et non seulement dans un guard.
CREATE OR REPLACE FUNCTION enforce_deal_approver_roles_lot2()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.credit_approved_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.credit_approved_by_id;
    IF r IS NULL OR r NOT IN ('FINANCE_CFO', 'DG') THEN
      RAISE EXCEPTION
        'L''approbation financière du deal % est réservée au CFO (ou au DG). Rôle fourni : %.',
        NEW.reference, COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.dg_approved_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.dg_approved_by_id;
    IF r IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'La dérogation sur marge du deal % est réservée au DG. Rôle fourni : %.',
        NEW.reference, COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_approver_roles_lot2 ON deals;
CREATE TRIGGER trg_deal_approver_roles_lot2
  BEFORE INSERT OR UPDATE OF credit_approved_by_id, dg_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_approver_roles_lot2();


-- ---------------------------------------------------------------------------
--  D. VERROU HSE  (§ 11.2)
--
--  Pas de chargement sans contrôles bloquants validés. Et surtout :
--  L'AGENT QUI EXÉCUTE NE VALIDE JAMAIS SES PROPRES CONTRÔLES BLOQUANTS.
--  Sans cette séparation, le verrou ne vaut rien.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_hse_separation_of_duties()
RETURNS TRIGGER AS $$
DECLARE
  recorder uuid;
  validator_role text;
BEGIN
  IF NEW.validated_by_field_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role
      FROM field_users WHERE id = NEW.validated_by_field_user_id;

    IF validator_role IS DISTINCT FROM 'HSE_CONTROLLER' THEN
      RAISE EXCEPTION
        'VERROU HSE : la validation est réservée au contrôleur HSE. Rôle fourni : %.',
        COALESCE(validator_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;

    -- Séparation des tâches : celui qui a renseigné un point BLOQUANT ne peut
    -- pas être celui qui valide la checklist.
    SELECT i.recorded_by_field_user_id INTO recorder
      FROM operation_hse_check_items i
     WHERE i.check_id = NEW.id
       AND i.level::text = 'BLOCKING'
       AND i.recorded_by_field_user_id = NEW.validated_by_field_user_id
     LIMIT 1;

    IF recorder IS NOT NULL THEN
      RAISE EXCEPTION
        'VERROU HSE : l''agent qui a renseigné un contrôle bloquant ne peut pas valider la checklist.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Suppléance : seul le DG peut valider en l'absence du contrôleur.
  IF NEW.validated_by_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role FROM users WHERE id = NEW.validated_by_user_id;
    IF validator_role IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'VERROU HSE : la suppléance du contrôleur HSE est réservée au DG. Rôle fourni : %.',
        COALESCE(validator_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_separation_of_duties ON operation_hse_checks;
CREATE TRIGGER trg_hse_separation_of_duties
  BEFORE INSERT OR UPDATE OF validated_by_field_user_id, validated_by_user_id ON operation_hse_checks
  FOR EACH ROW EXECUTE FUNCTION enforce_hse_separation_of_duties();

-- ---------------------------------------------------------------------------
--  UNE SEULE SÉQUENCE D'ÉTAPES, PLUS DE STATUT À PART (22/08/2026)
--
--  `operations.status` (12 valeurs) et `operations.phase`/`OperationPhase`
--  (6 valeurs, réservées aux checklists HSE) étaient deux vocabulaires
--  distincts, sans lien vérifié entre eux : un point de contrôle pouvait
--  s'ouvrir sur une phase sans jamais être confronté au statut réel de
--  l'opération. `phase` devient l'unique champ d'état, étendu à 9 valeurs :
--  PREPARATION, PRE_CHARGEMENT, CHARGEMENT, POST_CHARGEMENT, TRANSPORT,
--  PRE_DECHARGEMENT, DECHARGEMENT, POST_DECHARGEMENT, CLOTURE.
--
--  Deux conséquences, actées par la direction :
--    1. L'ORDRE EST STRICT — une transition ne peut viser que l'étape
--       suivante immédiate. Avant cette date, RIEN ne l'imposait (démontré
--       par `tests/lot2_negative.sql`, qui saute directement de DRAFT à
--       LOADING sans qu'aucun trigger ne s'y oppose).
--    2. CHAQUE ÉTAPE VERROUILLE LA SUIVANTE — pas seulement l'entrée en
--       chargement comme avant. Le verrou HSE se généralise : il porte sur
--       la checklist de l'étape QUITTÉE (`operation_hse_checks` où
--       `phase = OLD.phase`), pas sur un indicateur global de l'opération.
--
--  INCIDENT et CANCELLED ne sont PLUS des valeurs de la séquence : ce sont
--  deux arrêts d'urgence, parallèles (`halted_at`/`halt_type`/`halt_reason`/
--  `halted_by_id`), réservés au DG et au CCOO — `phase` n'est jamais
--  écrasée par un arrêt, l'étape en cours reste visible.
-- ---------------------------------------------------------------------------

-- Un seul trigger porte les deux règles (l'ordre, puis le verrou de l'étape
-- quittée) : les fondre évite toute dépendance à l'ordre d'exécution entre
-- deux triggers BEFORE distincts (PostgreSQL les enchaînerait par ordre
-- alphabétique de nom — fragile, et sans rapport avec l'ordre logique voulu).
CREATE OR REPLACE FUNCTION enforce_phase_sequence()
RETURNS TRIGGER AS $$
DECLARE
  rang_actuel int;
  rang_cible  int;
  a_verifier  int;
  chk         RECORD;
  pending     int;
BEGIN
  IF OLD.phase = NEW.phase THEN RETURN NEW; END IF;

  IF NEW.halted_at IS NOT NULL OR OLD.halted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'ÉTAPE : l''opération % est à l''arrêt (%) : elle ne progresse plus.',
      NEW.reference, COALESCE(NEW.halt_type::text, OLD.halt_type::text)
      USING ERRCODE = 'check_violation';
  END IF;

  -- 1. L'ORDRE EST STRICT — une transition ne peut viser que l'étape
  --    suivante immédiate. Avant cette date, rien ne l'imposait (démontré
  --    par `tests/lot2_negative.sql`, qui sautait directement de DRAFT à
  --    LOADING sans qu'aucun trigger ne s'y oppose).
  rang_actuel := array_position(enum_range(NULL::operation_phase), OLD.phase);
  rang_cible  := array_position(enum_range(NULL::operation_phase), NEW.phase);

  IF rang_cible IS DISTINCT FROM rang_actuel + 1 THEN
    RAISE EXCEPTION
      'ÉTAPE : l''opération % ne peut pas passer de % à % — l''étape suivante attendue est %.',
      NEW.reference, OLD.phase, NEW.phase,
      (enum_range(NULL::operation_phase))[rang_actuel + 1]
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. CHAQUE ÉTAPE VERROUILLE LA SUIVANTE — le verrou HSE porte sur la
  --    checklist de l'étape QUITTÉE (`operation_hse_checks` où
  --    `phase = OLD.phase`), généralisation par étape de l'ancien verrou
  --    « avant chargement » qui ne portait que sur LOADING.
  --
  --    Rien à vérifier si l'étape quittée ne porte aucun point de contrôle
  --    pour cette opération (son type, son segment) — même résolution que
  --    celle déjà utilisée par `hse.controller.ts` pour ouvrir une checklist.
  SELECT count(*) INTO a_verifier
    FROM resolve_hse_checklist(NEW.id) WHERE phase = OLD.phase::text;
  IF a_verifier = 0 THEN RETURN NEW; END IF;

  SELECT id, validated_at, derogation_id INTO chk
    FROM operation_hse_checks WHERE operation_id = NEW.id AND phase = OLD.phase;

  -- Une dérogation HSE du DG lève le verrou de CETTE étape (§ 11.2) — SI ELLE
  -- EST OPPOSABLE. La seule présence d'un identifiant ne suffit pas : une
  -- dérogation révoquée, expirée, ou accordée pour une autre opération, ne
  -- doit pas ouvrir le verrou.
  IF chk.derogation_id IS NOT NULL THEN
    IF derogation_opposable(chk.derogation_id, 'HSE_BLOCKING_OVERRIDE', NEW.reference) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'VERROU HSE : l''opération % invoque, à l''étape %, une dérogation qui ne l''ouvre pas : %.',
      NEW.reference, OLD.phase,
      derogation_motif_refus(chk.derogation_id, 'HSE_BLOCKING_OVERRIDE', NEW.reference)
      USING ERRCODE = 'check_violation';
  END IF;

  IF chk.id IS NULL OR chk.validated_at IS NULL THEN
    RAISE EXCEPTION
      'VERROU HSE : l''opération % ne peut pas quitter l''étape % : contrôles non validés.',
      NEW.reference, OLD.phase
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO pending
    FROM operation_hse_check_items i
   WHERE i.check_id = chk.id
     AND i.level::text = 'BLOCKING'
     AND i.outcome::text <> 'PASSED';

  IF pending > 0 THEN
    RAISE EXCEPTION
      'VERROU HSE : % contrôle(s) bloquant(s) non satisfait(s) à l''étape % de l''opération %.',
      pending, OLD.phase, NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_phase_sequence ON operations;
CREATE TRIGGER trg_phase_sequence
  BEFORE UPDATE OF phase ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_phase_sequence();

-- Vrai si l'opération est bloquée à SA PHASE COURANTE par le verrou HSE —
-- même condition que celle qui refuserait sa prochaine transition, mais en
-- LECTURE : sert à l'AFFICHER (tableau de bord, fiche) sans rien tenter.
-- Toute divergence avec `enforce_phase_sequence` serait deux vérités pour un
-- même verrou : les deux DOIVENT rester synchronisées si l'une évolue.
CREATE OR REPLACE FUNCTION operation_hse_bloquee(p_operation_id uuid)
RETURNS boolean AS $$
DECLARE
  o          RECORD;
  a_verifier int;
  chk        RECORD;
  pending    int;
BEGIN
  SELECT phase, halted_at, reference INTO o FROM operations WHERE id = p_operation_id;
  IF o.halted_at IS NOT NULL THEN RETURN false; END IF;

  SELECT count(*) INTO a_verifier
    FROM resolve_hse_checklist(p_operation_id) WHERE phase = o.phase::text;
  IF a_verifier = 0 THEN RETURN false; END IF;

  SELECT id, validated_at, derogation_id INTO chk
    FROM operation_hse_checks WHERE operation_id = p_operation_id AND phase = o.phase;

  IF chk.derogation_id IS NOT NULL
     AND derogation_opposable(chk.derogation_id, 'HSE_BLOCKING_OVERRIDE', o.reference) THEN
    RETURN false;
  END IF;

  IF chk.id IS NULL OR chk.validated_at IS NULL THEN RETURN true; END IF;

  SELECT count(*) INTO pending
    FROM operation_hse_check_items i
   WHERE i.check_id = chk.id AND i.level::text = 'BLOCKING' AND i.outcome::text <> 'PASSED';

  RETURN pending > 0;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  E. VERROU DE CONFORMITÉ  (§ 6.4, § 11.2)
--
--  Un sous-traitant, véhicule ou chauffeur non conforme ne peut être affecté
--  sans dérogation DU DG. Le statut de conformité est dérivé des pièces à
--  échéance : il ne se saisit pas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_assignment_compliance()
RETURNS TRIGGER AS $$
DECLARE
  offenders text := '';
BEGIN
  -- Dérogation du DG — le rôle a été vérifié à sa création, mais elle doit
  -- ENCORE être valide aujourd'hui : révoquée ou échue, elle n'autorise plus
  -- l'affectation d'un moyen non conforme.
  IF NEW.compliance_derogation_id IS NOT NULL THEN
    IF derogation_opposable(NEW.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', NULL) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'CONFORMITÉ : l''affectation invoque une dérogation qui ne l''autorise pas : %. Les moyens doivent être conformes.',
      derogation_motif_refus(NEW.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', NULL)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(subject_kind || ' ' || subject_label, ', ')
    INTO offenders
    FROM v_transport_compliance
   WHERE NOT is_compliant
     AND subject_id IN (
       COALESCE(NEW.carrier_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(NEW.vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(NEW.driver_id,  '00000000-0000-0000-0000-000000000000'::uuid)
     );

  IF offenders IS NOT NULL AND offenders <> '' THEN
    RAISE EXCEPTION
      'VERROU CONFORMITÉ : moyen(s) non conforme(s) : %. Une dérogation du DG est requise.',
      offenders
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_compliance ON operation_assignments;
CREATE TRIGGER trg_assignment_compliance
  BEFORE INSERT OR UPDATE OF carrier_id, vehicle_id, driver_id, compliance_derogation_id
  ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_assignment_compliance();


-- ---------------------------------------------------------------------------
--  F. CHAÎNE DE FACTURATION  (§ 9)
--
--     Prix TTC × Quantité  =  brut
--   − Réduction            =  TOTAL FACTURE
--     TVA = Total × taux ÷ (100 + taux)   si applicable — extraite, non ajoutée
-- ---------------------------------------------------------------------------

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_positive,
  ADD  CONSTRAINT chk_invoices_positive
       CHECK (billed_volume > 0 AND unit_price >= 0 AND total_amount >= 0
              AND discount_amount >= 0 AND vat_amount >= 0
              AND paid_amount >= 0 AND paid_amount <= total_amount),

  DROP CONSTRAINT IF EXISTS chk_invoices_vat_rate_range,
  ADD  CONSTRAINT chk_invoices_vat_rate_range
       CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100),

  -- La TVA n'existe que si la case est cochée.
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_requires_flag,
  ADD  CONSTRAINT chk_invoices_vat_requires_flag
       CHECK (is_vat_applicable OR vat_amount = 0),

  -- Brut = volume × prix unitaire.
  DROP CONSTRAINT IF EXISTS chk_invoices_gross_derived,
  ADD  CONSTRAINT chk_invoices_gross_derived
       -- La tolérance DÉRIVE de la devise : une demi-unité de la plus petite
       -- subdivision en circulation. Un 0,01 en dur ne tolère RIEN en XOF —
       -- qui n'a pas de centime — et tolère arbitrairement ailleurs.
       CHECK (abs(gross_amount - billed_volume * unit_price)
              <= tolerance_arrondi(currency_code)),

  -- Total = brut − réduction.
  DROP CONSTRAINT IF EXISTS chk_invoices_total_derived,
  ADD  CONSTRAINT chk_invoices_total_derived
       CHECK (abs(total_amount - (gross_amount - discount_amount))
              <= tolerance_arrondi(currency_code)),

  -- TVA EXTRAITE du total : total × taux ÷ (100 + taux).
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_extracted,
  ADD  CONSTRAINT chk_invoices_vat_extracted
       CHECK (
         NOT is_vat_applicable
         OR abs(vat_amount - total_amount * vat_rate_pct / (100 + vat_rate_pct))
            <= tolerance_arrondi(currency_code)
       ),

  -- Un avoir référence la pièce qu'il corrige.
  DROP CONSTRAINT IF EXISTS chk_invoices_credit_note_origin,
  ADD  CONSTRAINT chk_invoices_credit_note_origin
       CHECK (type::text <> 'CREDIT_NOTE' OR corrected_invoice_id IS NOT NULL),

  -- La facture simple est une DÉCISION INTERNE : décideur et motif obligatoires.
  DROP CONSTRAINT IF EXISTS chk_invoices_simple_decision,
  ADD  CONSTRAINT chk_invoices_simple_decision
       CHECK (
         type::text <> 'SIMPLE'
         OR status::text = 'DRAFT'
         OR (simple_invoice_decided_by_id IS NOT NULL
             AND simple_invoice_decided_at IS NOT NULL
             AND simple_invoice_reason IS NOT NULL
             AND length(trim(simple_invoice_reason)) >= 10)
       ),

  -- Une pièce référence une affaire, une demande de cotation, ou les deux
  -- (la proforma approuvée les porte l'une et l'autre après conversion) -
  -- jamais ni l'une ni l'autre (§ discussion 17/08).
  DROP CONSTRAINT IF EXISTS chk_invoices_deal_or_quotation,
  ADD  CONSTRAINT chk_invoices_deal_or_quotation
       CHECK (deal_id IS NOT NULL OR quotation_request_id IS NOT NULL),

  -- Une demande de cotation n'engage rien avant l'affaire : seule une
  -- proforma peut y répondre, jamais une pièce définitive.
  DROP CONSTRAINT IF EXISTS chk_invoices_quotation_requires_proforma,
  ADD  CONSTRAINT chk_invoices_quotation_requires_proforma
       CHECK (quotation_request_id IS NULL OR type::text = 'PROFORMA');

COMMENT ON COLUMN invoices.vat_amount IS
  'TVA EXTRAITE du total (total × taux ÷ (100 + taux)), jamais ajoutée. Affichée pour information. N''entre pas dans le calcul de marge.';

-- Une proforma ne génère ni créance, ni transmission fiscale (§ 9.3).
CREATE OR REPLACE FUNCTION enforce_proforma_has_no_fiscal_effect()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type::text = 'PROFORMA' THEN
    IF NEW.paid_amount <> 0 THEN
      RAISE EXCEPTION
        'Une proforma ne porte pas d''encaissement : elle ne crée aucune créance.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM fne_transmissions WHERE invoice_id = NEW.id) THEN
      RAISE EXCEPTION
        'Une proforma ne se transmet pas au dispositif fiscal.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proforma_no_fiscal_effect ON invoices;
CREATE TRIGGER trg_proforma_no_fiscal_effect
  BEFORE INSERT OR UPDATE OF type, paid_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_proforma_has_no_fiscal_effect();


-- ---------------------------------------------------------------------------
--  G. ÉCART D'ULLAGE  (§ 8)
--
--  Contrôle opérationnel et HSE — plus un verrou de facturation. Un écart
--  au-delà du seuil critique ouvre une non-conformité d'office : le produit
--  est allé quelque part.
-- ---------------------------------------------------------------------------

-- ⚠️ REVU LE 25/08/2026 — un relevé ne porte plus qu'UN SEUL bout (voir
--    schema.prisma, MeasurementRecord). L'écart chargé/livré ne compare
--    donc plus deux COLONNES de la même ligne, mais `volume15` contre
--    `paired_loaded_volume_15` — un SNAPSHOT posé sur le relevé qui referme
--    la paire au moment du rapprochement (jamais recalculé par jointure
--    vivante), ce qui permet de garder cette vérification comme un CHECK
--    intra-ligne plutôt que de la faire dépendre d'un trigger inter-lignes.
ALTER TABLE measurement_records
  DROP CONSTRAINT IF EXISTS chk_measurement_volumes_positive,
  DROP CONSTRAINT IF EXISTS chk_measurement_volume_positive,
  ADD  CONSTRAINT chk_measurement_volume_positive
       CHECK (volume_15 > 0),

  -- L'écart est calculé, pas déclaré — NUL tant que l'autre bout n'est pas
  -- connu, cohérent avec le snapshot sinon.
  DROP CONSTRAINT IF EXISTS chk_measurement_ullage_computed,
  ADD  CONSTRAINT chk_measurement_ullage_computed
       CHECK (
         ullage_variance_pct IS NULL
         OR (
           paired_loaded_volume_15 IS NOT NULL
           AND abs(ullage_variance_pct
                   - round(((paired_loaded_volume_15 - volume_15) / paired_loaded_volume_15) * 100, 6)
                  ) <= 0.000001
         )
       ),

  DROP CONSTRAINT IF EXISTS chk_measurement_ack_complete,
  ADD  CONSTRAINT chk_measurement_ack_complete
       CHECK (
         ullage_ack_at IS NULL
         OR (ullage_ack_by_id IS NOT NULL
             AND ullage_ack_reason IS NOT NULL
             AND length(trim(ullage_ack_reason)) >= 10)
       );

-- Un seul relevé fait autorité PAR ÉTAPE : un CHARGEMENT et un DECHARGEMENT
-- authoritatifs coexistent normalement sur la même opération.
DROP INDEX IF EXISTS uq_measurement_single_authoritative;
CREATE UNIQUE INDEX uq_measurement_single_authoritative
  ON measurement_records (operation_id, phase) WHERE is_authoritative;

-- L'acquittement d'un écart est réservé au CCOO, au CFO et au DG.
CREATE OR REPLACE FUNCTION enforce_ullage_ack_role_lot2()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.ullage_ack_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.ullage_ack_by_id;
    IF r IS NULL OR r NOT IN ('CCOO', 'FINANCE_CFO', 'DG') THEN
      RAISE EXCEPTION
        'L''acquittement d''un écart de volume est réservé au CCOO, au CFO ou au DG. Rôle fourni : %.',
        COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ullage_ack_role_lot2 ON measurement_records;
CREATE TRIGGER trg_ullage_ack_role_lot2
  BEFORE INSERT OR UPDATE OF ullage_ack_by_id ON measurement_records
  FOR EACH ROW EXECUTE FUNCTION enforce_ullage_ack_role_lot2();


-- ---------------------------------------------------------------------------
--  H. DOCUMENTS SCELLÉS  (§ 12.2)
--
--  Une pièce signée et transmise au client ne se modifie plus. La correction
--  produit un NOUVEAU document « annule et remplace ».
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_sealed_document_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_sealed AND (
       NEW.storage_key IS DISTINCT FROM OLD.storage_key
    OR NEW.sha256      IS DISTINCT FROM OLD.sha256
    OR NEW.size_bytes  IS DISTINCT FROM OLD.size_bytes
    OR NEW.is_sealed   IS DISTINCT FROM OLD.is_sealed
  ) THEN
    RAISE EXCEPTION
      'Document scellé : il ne se modifie pas. Émettre une pièce « annule et remplace ».'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_document_immutable ON generated_documents;
CREATE TRIGGER trg_sealed_document_immutable
  BEFORE UPDATE ON generated_documents
  FOR EACH ROW EXECUTE FUNCTION enforce_sealed_document_immutable();

-- Une pièce qui en remplace une autre doit dire pourquoi.
ALTER TABLE generated_documents
  DROP CONSTRAINT IF EXISTS chk_document_supersession_reason,
  ADD  CONSTRAINT chk_document_supersession_reason
       CHECK (
         supersedes_id IS NULL
         OR (supersession_reason IS NOT NULL AND length(trim(supersession_reason)) >= 10)
       );

-- Une signature externe porte toujours la qualité du signataire : sans elle,
-- le document n'est pas opposable.
ALTER TABLE signatures
  DROP CONSTRAINT IF EXISTS chk_signature_capacity,
  ADD  CONSTRAINT chk_signature_capacity
       CHECK (length(trim(signatory_name)) >= 2 AND length(trim(signatory_capacity)) >= 2);


-- ---------------------------------------------------------------------------
--  I. SEUILS DE MARGE — LE VERROU QUI MANQUAIT  (§ 5.4)
--
--  Deux seuils, deux effets radicalement différents :
--
--    PLANCHER DIRECT (10 FCFA/L) — marge après charges DIRECTES et portage.
--      En dessous, l'opération ne couvre pas ses propres coûts augmentés
--      d'un coussin de risque. Deux aléas ordinaires — un ullage au seuil de
--      tolérance, une provision pour litige — effacent la marge. C'est une
--      prise de risque non rémunérée : BLOCAGE DUR, levée par le DG seul.
--
--    SEUIL MINIMUM (30 FCFA/L) — marge après absorption des INDIRECTES.
--      En dessous, l'affaire couvre ses coûts directs et contribue
--      partiellement aux frais fixes. Elle reste bonne à prendre : refuser
--      sur une clé de répartition — qui est une convention — détruirait de la
--      valeur. ACCORD DU DG, pas un refus.
--
--  Entre les deux se trouve la zone d'arbitrage : c'est là qu'une décision
--  humaine a du sens.
--
--  Le contrôle se déclenche À L'APPROBATION : c'est le moment où l'affaire
--  engage l'entreprise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_margin_thresholds()
RETURNS TRIGGER AS $$
DECLARE
  t          RECORD;
  derog_type text;
BEGIN
  -- Tant que l'affaire n'est pas approuvée, elle se travaille librement.
  IF NEW.credit_approved_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La résolution exige la devise ET l'unité du deal : on ne compare jamais
  -- deux grandeurs hétérogènes, et on ne convertit pas en silence — une
  -- conversion implicite rendrait le verrou incompréhensible quand il bloque.
  SELECT direct_floor, minimum_margin, currency_code, uom
    INTO t
    FROM resolve_margin_threshold(NEW.segment::text, NEW.product_id,
                                  NEW.currency_code, NEW.uom::text, CURRENT_DATE);

  IF t IS NULL THEN
    -- ⚠️ DEUX ABSENCES DIFFÉRENTES, DEUX RÉPONSES DIFFÉRENTES.
    --
    --    « Jamais configuré » et « coupé par paramétrage » (is_active = false,
    --    § 1.1 bis) rendaient TOUS DEUX un ensemble vide côté
    --    `resolve_margin_threshold` — le blocage de repli s'appliquait aux
    --    deux indifféremment. Constaté à l'exécution (audit, axe A, S3) :
    --    désactiver l'unique seuil d'un segment bloquait TOUTES ses
    --    approbations au lieu de couper le contrôle, à l'inverse exact de ce
    --    que l'écran de paramétrage promet (« coupe le seuil »).
    --
    --    Un seuil qui EXISTE mais qu'on a désactivé EXPRÈS est une décision ;
    --    l'absence totale de ligne est un oubli. La première ne doit rien
    --    bloquer, la seconde doit continuer à tout bloquer — c'est le
    --    fail-safe d'origine, non remis en cause.
    IF EXISTS (
      SELECT 1
        FROM margin_thresholds m
       WHERE m.segment::text = NEW.segment::text
         AND (m.product_id IS NULL OR m.product_id = NEW.product_id)
         AND m.currency_code = NEW.currency_code
         AND m.uom::text     = NEW.uom::text
         AND m.effective_from <= CURRENT_DATE
         AND (m.effective_to IS NULL OR m.effective_to >= CURRENT_DATE)
         AND NOT m.is_active
    ) THEN
      RETURN NEW; -- Contrôle coupé par paramétrage : pas un oubli, on ne bloque pas.
    END IF;

    RAISE EXCEPTION
      'Aucun seuil de marge configuré pour le segment % en %/%. Le deal % ne peut pas être approuvé tant que ce seuil n''existe pas.',
      NEW.segment, NEW.currency_code, NEW.uom, NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Plancher direct : BLOCAGE DUR -------------------------------------
  IF t.direct_floor IS NOT NULL AND NEW.estimated_direct_margin < t.direct_floor THEN
    IF NEW.margin_derogation_id IS NULL THEN
      RAISE EXCEPTION
        'PLANCHER DIRECT : le deal % dégage % %/% après charges directes et portage, sous le plancher de %. L''opération ne couvre pas ses coûts : blocage. Une dérogation du DG est requise.',
        NEW.reference, round(NEW.estimated_direct_margin, 2), t.currency_code, t.uom,
        round(t.direct_floor, 2)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Le TYPE seul était vérifié : une dérogation du bon type mais révoquée,
    -- expirée, ou accordée pour une autre affaire franchissait le plancher.
    IF NOT derogation_opposable(
             NEW.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', NEW.reference) THEN
      RAISE EXCEPTION
        'PLANCHER DIRECT : le deal % ne peut pas être approuvé sous le plancher : %.',
        NEW.reference,
        derogation_motif_refus(
          NEW.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', NEW.reference)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- --- Seuil minimum : accord du DG, pas un refus ------------------------
  IF t.minimum_margin IS NOT NULL AND NEW.estimated_full_margin < t.minimum_margin THEN
    IF NEW.dg_approved_by_id IS NULL THEN
      RAISE EXCEPTION
        'SEUIL DE MARGE : le deal % dégage % %/% après absorption des charges indirectes, sous le seuil de %. L''accord du DG est requis.',
        NEW.reference, round(NEW.estimated_full_margin, 2), t.currency_code, t.uom,
        round(t.minimum_margin, 2)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_margin_thresholds ON deals;
CREATE TRIGGER trg_deal_margin_thresholds
  BEFORE INSERT OR UPDATE OF credit_approved_by_id, estimated_direct_margin,
                             estimated_full_margin, segment, product_id,
                             margin_derogation_id, dg_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_margin_thresholds();
