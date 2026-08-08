-- ===========================================================================
--  L'ASSIETTE D'ABSORPTION EST UN VOLUME, PAS UN CHIFFRE D'AFFAIRES
--  Réf. SPECIFICATIONS.md § 14.2, § 14.3
--
--  LA DÉCISION, ET POURQUOI ELLE TIENT
--  -----------------------------------
--  « Charge indirecte unitaire = Budget annuel ÷ Assiette annuelle budgétée »,
--  et le § 14.2 tranche le dénominateur : LE VOLUME BUDGÉTÉ.
--
--  Le volume est la variable que l'entreprise PILOTE. Le prix, non : il suit
--  les publications DGH et le taux de change. Une assiette en chiffre
--  d'affaires ferait donc bouger la charge fixe unitaire à chaque publication
--  de prix — sans qu'aucune charge n'ait changé, sans qu'aucune décision n'ait
--  été prise, et sans que rien ne le signale.
--
--  C'est la spirale d'absorption du § 14.2 sous une autre forme. Le
--  raisonnement y est tenu contre un dénominateur RÉALISÉ ; il vaut tout autant
--  contre un dénominateur en VALEUR : dans les deux cas le taux devient
--  mouvant, la marge calculée bouge, des affaires passent sous le seuil, et
--  personne ne sait pourquoi.
--
--  ⚠️ CE FICHIER FERME UNE PORTE QUE J'AVAIS LAISSÉE OUVERTE.
--
--     L'énumération `allocation_basis` propose PER_REVENUE, et le calcul de
--     marge l'implémentait — en multipliant par le chiffre d'affaires. Aucun
--     pool actif ne l'employait, donc rien ne se voyait ; le premier pool créé
--     depuis l'écran de paramétrage aurait suffi.
--
--     La valeur reste dans l'énumération : des lignes historiques la portent,
--     et une énumération se réduit mal. Elle devient simplement INUTILISABLE
--     sur un pool actif.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION refuse_assiette_en_valeur()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active AND NEW.allocation_basis::text = 'PER_REVENUE' THEN
    RAISE EXCEPTION
      'Le pool « % » ne peut pas s''imputer au prorata du chiffre d''affaires. L''assiette d''absorption est un VOLUME budgété (§ 14.2) : le volume est piloté, le prix ne l''est pas — il suit les publications DGH et le change. Une assiette en valeur ferait bouger la charge fixe unitaire à chaque publication, sans qu''aucune charge n''ait changé. Employer PER_VOLUME, ou PER_OPERATION pour un montant par rotation.',
      NEW.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assiette_en_valeur ON cost_pools;
CREATE TRIGGER trg_assiette_en_valeur
  BEFORE INSERT OR UPDATE ON cost_pools
  FOR EACH ROW EXECUTE FUNCTION refuse_assiette_en_valeur();

-- ---------------------------------------------------------------------------
--  REPRISE — un déclencheur ne juge que les écritures postérieures à sa pose.
--
--  Les pools déjà en base lui échappent. On les désactive plutôt que de les
--  supprimer : leurs taux passés restent lisibles, et un pool supprimé
--  emporterait l'explication d'un coût déjà calculé.
-- ---------------------------------------------------------------------------
UPDATE cost_pools
   SET is_active = false
 WHERE is_active
   AND allocation_basis::text = 'PER_REVENUE';


-- ===========================================================================
--  L'ASSIETTE SAISIE CONTRE LA PRÉVISION DE VOLUMES
--
--  Le budget de volumes existe désormais comme donnée (§ 14.3) : c'est LUI
--  l'assiette. La saisir une seconde fois dans le taux d'absorption garantit
--  qu'un jour les deux divergeront — on révise la prévision, on oublie le
--  taux, et la charge unitaire reste calée sur un volume que plus personne
--  n'attend.
--
--  On ne l'écrase pas pour autant : le CFO peut vouloir figer une assiette
--  différente de la prévision courante — c'est même le principe du § 14.2, où
--  le budget est FIGÉ pendant que la prévision se révise. L'écart est donc
--  RENDU VISIBLE, pas corrigé d'office.
-- ===========================================================================
-- ⚠️ ICI, ET SEULEMENT ICI, ON LIT LE BUDGET — PAS LA PRÉVISION EN VIGUEUR.
--
--    C'est délibéré, et c'est l'inverse de ce que fait la vue de prévision
--    (§ 14.3), où une révision REMPLACE le budget sur son mois.
--
--    La raison est au § 14.2 : le dénominateur de l'absorption doit rester
--    FIGÉ pendant l'exercice. S'il suivait les révisions, une année sous les
--    prévisions ferait monter la charge au litre — mêmes frais fixes sur moins
--    de litres —, la marge calculée baisserait, davantage d'affaires
--    passeraient sous le seuil, le volume baisserait encore. C'est la spirale
--    d'absorption, et elle s'emballe vite sur une marge de 4 %.
--
--    La comparaison ci-dessous confronte donc l'assiette figée à la prévision
--    BUDGÉTÉE, deux chiffres qui devraient coïncider par construction. L'écart
--    à la prévision RÉVISÉE, lui, est une information de pilotage que porte
--    l'écran de prévision, pas un paramètre de calcul.
CREATE OR REPLACE VIEW v_assiette_absorption AS
WITH prevu AS (
  SELECT f.year                    AS fiscal_year,
         s.segment,
         s.uom,
         sum(s.forecast_volume)    AS volume_prevu
    FROM sales_forecasts s
    JOIN fiscal_years f ON f.id = s.fiscal_year_id
   WHERE s.is_current
     AND s.kind::text = 'BUDGET'
   GROUP BY f.year, s.segment, s.uom
)
SELECT cp.code                                        AS pool,
       cp.label,
       cp.allocation_basis::text                      AS base,
       ar.fiscal_year,
       ar.budgeted_amount,
       ar.budgeted_base                               AS assiette_saisie,
       ar.base_uom::text                              AS assiette_uom,
       ar.rate_per_unit,
       -- Somme des volumes prévus sur les segments que le pool couvre. Un pool
       -- sans segment déclaré les couvre tous — c'est la convention du reste
       -- du système, on ne l'invente pas ici.
       (SELECT sum(p.volume_prevu)
          FROM prevu p
         WHERE p.fiscal_year = ar.fiscal_year
           AND (p.uom::text = ar.base_uom::text OR ar.base_uom IS NULL)
           AND (cardinality(cp.segments) = 0
                OR p.segment = ANY (cp.segments)))    AS volume_prevu,
       CASE
         WHEN cp.allocation_basis::text <> 'PER_VOLUME' THEN NULL
         WHEN (SELECT sum(p.volume_prevu) FROM prevu p
                WHERE p.fiscal_year = ar.fiscal_year
                  AND (p.uom::text = ar.base_uom::text OR ar.base_uom IS NULL)
                  AND (cardinality(cp.segments) = 0
                       OR p.segment = ANY (cp.segments))) IS NULL THEN NULL
         ELSE round(
           abs(ar.budgeted_base
               - (SELECT sum(p.volume_prevu) FROM prevu p
                   WHERE p.fiscal_year = ar.fiscal_year
                     AND (p.uom::text = ar.base_uom::text OR ar.base_uom IS NULL)
                     AND (cardinality(cp.segments) = 0
                          OR p.segment = ANY (cp.segments))))
           / NULLIF(ar.budgeted_base, 0) * 100, 2)
       END                                            AS ecart_pct
  FROM absorption_rates ar
  JOIN cost_pools cp ON cp.id = ar.cost_pool_id
 WHERE ar.is_current
   AND cp.is_active;

COMMENT ON VIEW v_assiette_absorption IS
  'Assiette d''absorption SAISIE comparée à la prévision de volumes du même exercice (§ 14.2, § 14.3). `ecart_pct` nul = pas de prévision saisie, donc rien à comparer — pas un accord.';
