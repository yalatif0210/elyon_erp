-- ===========================================================================
--  UNE PRÉVISION RESTE DANS LES BORNES DE SON EXERCICE
--  Réf. SPECIFICATIONS.md § 14.3
--
--  LE DÉFAUT
--  ---------
--  Le rattachement à un exercice était assuré — clé étrangère obligatoire, et
--  une révision porte le même rattachement qu'un budget. Mais le MOIS était
--  borné à 1–12 EN DUR, alors que la durée d'un exercice est libre entre un
--  mois et deux ans.
--
--  Deux conséquences, opposées et toutes deux fausses :
--
--    · Exercice de 6 mois → on pouvait budgéter un mois 12, c'est-à-dire six
--      mois APRÈS la clôture. Le volume entrait dans l'assiette d'absorption
--      d'un exercice qui ne le verrait jamais.
--
--    · Exercice de 18 mois → impossible de budgéter au-delà du mois 12. Six
--      mois d'activité absents de la prévision, donc une assiette
--      d'absorption trop petite, donc une charge au litre surévaluée.
--
--  Le premier gonfle l'assiette, le second la rétrécit. Dans les deux cas le
--  coût de revient est faux, et rien ne le dit.
--
--  ⚠️ LE CAS SYMÉTRIQUE EST TRAITÉ AUSSI.
--
--     Borner la saisie ne suffit pas : on peut saisir une prévision correcte,
--     puis RACCOURCIR l'exercice. Les lignes déjà posées se retrouvent alors
--     hors bornes sans qu'aucune écriture n'ait eu lieu sur elles. C'est le
--     genre de dérive qu'on ne découvre qu'à la clôture.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Combien de mois compte réellement un exercice.
--
--  On compte les MOIS CIVILS couverts, bornes incluses. Un exercice du
--  01/01/2026 au 31/12/2026 en compte douze ; du 01/07/2026 au 30/06/2027,
--  douze également.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nb_mois_exercice(p_fiscal_year_id uuid)
RETURNS int AS $$
  SELECT (extract(year FROM f.ends_on)::int * 12 + extract(month FROM f.ends_on)::int)
       - (extract(year FROM f.starts_on)::int * 12 + extract(month FROM f.starts_on)::int)
       + 1
    FROM fiscal_years f
   WHERE f.id = p_fiscal_year_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION nb_mois_exercice(uuid) IS
  'Nombre de mois civils couverts par l''exercice, bornes incluses (§ 14.3). NULL si l''exercice n''existe pas.';

-- ---------------------------------------------------------------------------
--  Le mois CIVIL correspondant à un rang de l'exercice.
--
--  Le rang n'est pas le mois civil : un exercice ouvert en juillet a son mois
--  1 en juillet. Cette fonction fait la traduction — indispensable au plan de
--  trésorerie (§ 14.3), où c'est le calendrier qui compte, pas seulement le
--  montant.
--
--  Rend NULL hors bornes : l'appelant voit l'absence au lieu de recevoir une
--  date plausible située hors de l'exercice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mois_exercice(p_fiscal_year_id uuid, p_rang int)
RETURNS date AS $$
  SELECT CASE
    WHEN p_rang BETWEEN 1 AND nb_mois_exercice(p_fiscal_year_id)
    THEN (date_trunc('month', f.starts_on) + make_interval(months => p_rang - 1))::date
  END
  FROM fiscal_years f
 WHERE f.id = p_fiscal_year_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION mois_exercice(uuid, int) IS
  'Premier jour du mois civil correspondant au rang donné dans l''exercice (§ 14.3). NULL hors bornes.';


-- ---------------------------------------------------------------------------
--  La borne physique passe de 12 à 24.
--
--  Douze était une hypothèse déguisée en contrainte. Vingt-quatre découle de
--  la durée maximale déjà posée sur l'exercice : la contrainte de table dit
--  ce qui est PHYSIQUEMENT possible, le déclencheur ci-dessous dit ce qui est
--  vrai POUR CET EXERCICE-LÀ.
-- ---------------------------------------------------------------------------
ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_mois;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_mois
  CHECK (month_index BETWEEN 1 AND 24);


-- ---------------------------------------------------------------------------
--  Le mois doit tomber DANS l'exercice visé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_prevision_dans_bornes()
RETURNS TRIGGER AS $$
DECLARE
  mois_max int;
  ex record;
  budget_existe boolean;
BEGIN
  SELECT f.year, f.label, f.starts_on, f.ends_on INTO ex
    FROM fiscal_years f WHERE f.id = NEW.fiscal_year_id;

  mois_max := nb_mois_exercice(NEW.fiscal_year_id);

  IF NEW.month_index > mois_max THEN
    RAISE EXCEPTION
      'Mois % hors de l''exercice % : il court du % au %, soit % mois. Le mois est un RANG dans l''exercice, pas un mois civil : un exercice ouvert en juillet a son mois 1 en juillet.',
      NEW.month_index, ex.year,
      to_char(ex.starts_on, 'DD/MM/YYYY'), to_char(ex.ends_on, 'DD/MM/YYYY'), mois_max
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ ON NE RÉVISE PAS UN BUDGET QUI N'EXISTE PAS.
  --
  --    Le § 14.3 pose la révision comme l'étape 5, après la validation du
  --    budget. Une révision sans budget n'a rien à réviser — et surtout, elle
  --    rend l'écart au budget incalculable, alors que c'est LUI qu'on pilote.
  --
  --    On exige un budget sur L'EXERCICE, pas sur la case exacte : un produit
  --    qui apparaît en cours d'année est légitime, et forcer une ligne de
  --    budget fictive à zéro pour le déclarer serait pire que le mal.
  IF NEW.kind::text = 'REVISION' THEN
    SELECT EXISTS (
      SELECT 1 FROM sales_forecasts s
       WHERE s.fiscal_year_id = NEW.fiscal_year_id
         AND s.kind::text = 'BUDGET'
    ) INTO budget_existe;

    IF NOT budget_existe THEN
      RAISE EXCEPTION
        'Aucun budget de vente n''existe pour l''exercice % : il n''y a rien à réviser. Saisir d''abord le budget, puis ses révisions ; sinon l''écart au budget, qui est ce qu''on pilote, devient incalculable.',
        ex.year
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevision_dans_bornes ON sales_forecasts;
CREATE TRIGGER trg_prevision_dans_bornes
  BEFORE INSERT OR UPDATE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION enforce_prevision_dans_bornes();


-- ---------------------------------------------------------------------------
--  On ne raccourcit pas un exercice sous ses prévisions.
--
--  Sans ceci, la garde ci-dessus se contourne sans y toucher : on saisit douze
--  mois, puis on ramène l'exercice à six. Aucune écriture n'a lieu sur les
--  prévisions, et six d'entre elles se retrouvent hors bornes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_exercice_couvre_previsions()
RETURNS TRIGGER AS $$
DECLARE
  mois_max int;
  mois_utilise int;
BEGIN
  IF NEW.starts_on = OLD.starts_on AND NEW.ends_on = OLD.ends_on THEN
    RETURN NEW;
  END IF;

  SELECT max(s.month_index) INTO mois_utilise
    FROM sales_forecasts s WHERE s.fiscal_year_id = NEW.id;

  IF mois_utilise IS NULL THEN
    RETURN NEW;
  END IF;

  mois_max := (extract(year FROM NEW.ends_on)::int * 12 + extract(month FROM NEW.ends_on)::int)
            - (extract(year FROM NEW.starts_on)::int * 12 + extract(month FROM NEW.starts_on)::int)
            + 1;

  IF mois_utilise > mois_max THEN
    RAISE EXCEPTION
      'Ces bornes ramènent l''exercice % à % mois, alors que des prévisions vont jusqu''au mois %. Retirer d''abord les prévisions concernées : les laisser hors bornes fausserait l''assiette d''absorption sans qu''aucune écriture ne le signale.',
      NEW.year, mois_max, mois_utilise
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exercice_couvre_previsions ON fiscal_years;
CREATE TRIGGER trg_exercice_couvre_previsions
  BEFORE UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION enforce_exercice_couvre_previsions();


-- ---------------------------------------------------------------------------
--  REPRISE — un déclencheur ne juge que ce qui vient après lui.
--
--  Vérifié vide au moment de la pose ; l'instruction reste pour les bases
--  déjà alimentées qui rejoueraient cette migration.
-- ---------------------------------------------------------------------------
DO $reprise$
DECLARE
  hors int;
BEGIN
  SELECT count(*) INTO hors
    FROM sales_forecasts s
   WHERE s.month_index > nb_mois_exercice(s.fiscal_year_id);

  IF hors > 0 THEN
    RAISE WARNING
      '% prévision(s) hors des bornes de leur exercice. Elles restent en base — les supprimer d''office effacerait un travail de budgétisation — et remontent dans v_invariant_breaches jusqu''à traitement.',
      hors;
  END IF;
END
$reprise$;
