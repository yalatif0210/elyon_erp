-- ===========================================================================
--  LA PERTE DE VOLUME EST STATISTIQUE, ET RIEN D'AUTRE
--  Réf. SPECIFICATIONS.md § 8.3
--
--  Décision de la direction, réaffirmée le 7 août 2026 :
--
--    « Dans notre système ivoirien, je livre ce que j'ai chargé. La perte de
--      volume sert à des fins statistiques en interne et n'intervient pas dans
--      les coûts ni la facturation. »
--
--  C'EST UNE RÈGLE MÉTIER, PAS UNE OMISSION
--  ----------------------------------------
--  Un audit a signalé l'absence de ligne de coût « perte de volume » comme un
--  défaut, en s'appuyant sur une phrase de la spécification qui disait le
--  contraire. La phrase était fausse : elle décrivait un modèle où le vendeur
--  supporte l'écart, ce qui n'est pas le régime pratiqué ici. La spécification
--  a été corrigée.
--
--  Le volume facturé est celui CHARGÉ. L'écart constaté à l'arrivée est un
--  signal — de qualité de transport, de jaugeage, de sûreté — et il alimente
--  les alertes et les statistiques. Il ne se chiffre pas en devise, il ne
--  réduit aucune marge, et il ne modifie aucune facture.
--
--  ⚠️ CE FICHIER FERME LA PORTE PLUTÔT QUE DE LA LAISSER ENTROUVERTE.
--
--     Le poste `PERTE_VOLUME` existait au référentiel, actif, et n'avait
--     jamais reçu une seule ligne. Un poste de coût qui attend sans jamais
--     servir finit par être employé — par quelqu'un qui n'était pas là quand
--     la règle a été posée, et qui le trouvera parfaitement logique.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le poste est DÉSACTIVÉ, et son libellé dit pourquoi.
--
--  Désactivé plutôt que supprimé : le supprimer effacerait la trace qu'il a
--  existé, et rien n'empêcherait de le recréer sous le même nom dans six mois.
-- ---------------------------------------------------------------------------
UPDATE cost_posts
   SET is_active = false,
       label = 'Perte de volume (ullage) : STATISTIQUE, jamais un coût'
 WHERE code = 'PERTE_VOLUME';


-- ---------------------------------------------------------------------------
--  Et aucune ligne ne peut plus y être rattachée.
--
--  La désactivation seule ne suffit pas : rien n'empêche une écriture directe,
--  un import, ou une réactivation faite de bonne foi. Le refus porte le motif
--  métier, de sorte que celui qui bute dessus comprenne la règle plutôt que de
--  chercher comment la contourner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_perte_volume_en_cout()
RETURNS TRIGGER AS $$
DECLARE
  code_poste text;
BEGIN
  SELECT code INTO code_poste FROM cost_posts WHERE id = NEW.cost_post_id;

  IF code_poste = 'PERTE_VOLUME' THEN
    RAISE EXCEPTION
      'PERTE DE VOLUME : l''écart de volume ne se chiffre pas en coût. Le volume facturé est celui CHARGÉ : l''écart constaté à l''arrivée est un signal de qualité et de sûreté, suivi en statistique, et il n''entre ni dans les coûts ni dans la facturation.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refus_perte_volume_operation ON operation_cost_lines;
CREATE TRIGGER trg_refus_perte_volume_operation
  BEFORE INSERT OR UPDATE OF cost_post_id ON operation_cost_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_perte_volume_en_cout();

DROP TRIGGER IF EXISTS trg_refus_perte_volume_deal ON deal_cost_lines;
CREATE TRIGGER trg_refus_perte_volume_deal
  BEFORE INSERT OR UPDATE OF cost_post_id ON deal_cost_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_perte_volume_en_cout();

COMMENT ON FUNCTION refuse_perte_volume_en_cout IS
  'Interdit de chiffrer l''écart de volume en ligne de coût (§ 8.3). « Je livre ce que j''ai chargé » : l''écart est statistique, jamais monétaire.';


-- ---------------------------------------------------------------------------
--  Ce à quoi l'écart SERT : la statistique.
--
--  La règle n'est pas « on ne regarde pas l'écart » — c'est « on ne le
--  facture pas ». Il reste un signal de premier ordre : un transporteur, un
--  itinéraire ou un dépôt qui dérive se voit ici avant de se voir ailleurs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ullage_statistiques AS
SELECT p.legal_name                              AS transporteur,
       pr.code                                   AS produit,
       o.transport_mode::text                    AS mode,
       count(*)                                  AS nb_operations,
       round(avg(m.ullage_variance_pct), 4)      AS ecart_moyen_pct,
       round(max(m.ullage_variance_pct), 4)      AS ecart_max_pct,
       round(stddev_samp(m.ullage_variance_pct), 4) AS dispersion_pct,
       count(*) FILTER (WHERE m.ullage_alert_triggered)    AS alertes,
       count(*) FILTER (WHERE m.ullage_critical_triggered) AS critiques,
       -- Volume perdu cumulé, EN VOLUME et jamais en devise : c'est ce qui
       -- rend deux transporteurs comparables sans introduire un coût qui
       -- n'existe pas.
       round(sum(m.loaded_volume_15 - m.discharged_volume_15), 3) AS volume_perdu_cumule
  FROM measurement_records m
  JOIN operations o ON o.id = m.operation_id
  JOIN deals d ON d.id = o.deal_id
  JOIN products pr ON pr.id = d.product_id
  LEFT JOIN operation_assignments a ON a.operation_id = o.id
  LEFT JOIN partners p ON p.id = a.carrier_id
 WHERE m.is_authoritative
 GROUP BY p.legal_name, pr.code, o.transport_mode;

COMMENT ON VIEW v_ullage_statistiques IS
  'Écarts de volume agrégés par transporteur, produit et mode (§ 8.3). EN VOLUME, jamais en devise : l''écart ne se facture pas, il se surveille.';
