-- ===========================================================================
--  LA PERFORMANCE COMMERCIALE SE LIT SUR UNE PÉRIODE
--  Réf. SPECIFICATIONS.md § 16
--
--  LE DÉFAUT CORRIGÉ
--  -----------------
--  `v_performance_commerciale` agrégeait TOUT, depuis toujours. Un commercial
--  arrivé il y a trois ans écrasait mécaniquement celui arrivé en janvier, et
--  un mauvais trimestre disparaissait dans la moyenne d'une carrière. Une
--  performance sans période ne se compare ni entre personnes, ni dans le temps
--  — c'est-à-dire qu'elle ne sert à rien.
--
--  ⚠️ CHAQUE FAMILLE DE CHIFFRES A SA PROPRE DATE, ET ON NE LES CONFOND PAS.
--
--     · Opportunités OUVERTES — datées de leur OUVERTURE. « Ce qui a été ouvert
--       pendant la période et n'est pas encore tranché. »
--     · Gagnées / perdues — datées de leur CLÔTURE. C'est le moment où le
--       résultat est acquis, pas celui où l'affaire a commencé.
--     · Affaires signées — datées de leur CRÉATION.
--
--     Prendre une seule date pour tout donnerait un tableau faux : une
--     opportunité ouverte en janvier et gagnée en juin appartient au pipeline
--     de janvier ET à la conversion de juin. Les deux sont vrais.
--
--  ⚠️ LE PIPELINE OUVERT EST UN STOCK, PAS UN FLUX.
--
--     Le lire « sur une période » a un sens précis et un seul : ce qui a été
--     OUVERT pendant cette période et reste ouvert aujourd'hui. Une opportunité
--     ouverte l'an dernier et toujours en discussion n'y figure donc pas — elle
--     est dans le pipeline courant, pas dans l'activité de la période. L'écran
--     doit le dire, sinon on cherchera longtemps pourquoi les totaux ne
--     concordent pas avec le pipeline global.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  LA PÉRIODE PAR DÉFAUT
--
--  ⚠️ ELLE SE DÉDUIT, ELLE N'EST PAS ÉCRITE EN DUR.
--
--     L'exercice comptable courant d'abord : c'est le découpage sur lequel
--     l'entreprise raisonne déjà, celui du point mort, du budget et de la
--     prévision. Aligner la performance dessus évite d'avoir à retenir deux
--     calendriers.
--
--     À défaut — tant qu'aucun exercice n'est déclaré — les douze derniers
--     mois glissants. Ce repli est un choix d'AFFICHAGE, pas une règle métier :
--     il ne décide de rien, il propose une fenêtre. Et la période retenue est
--     toujours RENDUE à l'appelant, pour que l'écran l'affiche au lieu de la
--     laisser deviner.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
--  LES CINQ DÉCOUPAGES DEMANDÉS
--
--  Mois · trimestre · semestre · année civile · exercice comptable.
--
--  ⚠️ LE TRIMESTRE ET LE SEMESTRE SONT CIVILS, PAS GLISSANTS.
--
--     « Le trimestre » désigne janvier-mars, avril-juin, et ainsi de suite —
--     pas les trois derniers mois. Un découpage glissant ne se compare pas
--     d'une lecture à l'autre : deux consultations à trois jours d'écart
--     donneraient deux périodes différentes, et l'écart entre les chiffres
--     serait indéchiffrable.
--
--     L'EXERCICE, lui, suit vos bornes déclarées — qui ne sont ni l'année
--     civile ni une constante.
--
--  `p_ancre` désigne le jour DANS la période voulue, pas ses bornes : on
--  demande « le trimestre du 15 mai », le système répond « du 1er avril au
--  30 juin ». C'est ce qui permet de reculer d'un cran sans calculer de tête.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION periode_bornes(
  p_type  text DEFAULT NULL,
  p_ancre date DEFAULT NULL
)
RETURNS TABLE (debut date, fin date, libelle text, en_cours boolean) AS $$
DECLARE
  a date := COALESCE(p_ancre, CURRENT_DATE);
  t text := upper(COALESCE(p_type, ''));
  d date; f date; l text;
BEGIN
  -- Sans type demandé : l'exercice comptable s'il existe, l'année civile sinon.
  -- L'exercice d'abord parce que c'est le découpage sur lequel l'entreprise
  -- raisonne déjà — point mort, budget, prévision. Deux calendriers
  -- concurrents obligeraient à retenir lequel s'applique où.
  IF t = '' THEN
    t := CASE WHEN EXISTS (SELECT 1 FROM fiscal_years WHERE is_current)
              THEN 'EXERCICE' ELSE 'ANNEE_CIVILE' END;
  END IF;

  CASE t
    WHEN 'MOIS' THEN
      d := date_trunc('month', a)::date;
      f := (date_trunc('month', a) + interval '1 month - 1 day')::date;
      -- ⚠️ LE NOM DU MOIS NE VIENT PAS DE LA LOCALE DU SERVEUR.
      --
      --    `to_char(a, 'TMMonth')` rendait « May 2026 » : la base tourne en
      --    en_US, et le libellé aurait changé au premier déploiement configuré
      --    autrement. Un intitulé d'écran ne doit pas dépendre de la langue
      --    d'installation de PostgreSQL.
      l := (ARRAY['janvier','février','mars','avril','mai','juin',
                  'juillet','août','septembre','octobre','novembre','décembre']
           )[extract(month FROM a)::int] || ' ' || extract(year FROM a)::int;

    WHEN 'TRIMESTRE' THEN
      d := date_trunc('quarter', a)::date;
      f := (date_trunc('quarter', a) + interval '3 months - 1 day')::date;
      l := 'T' || extract(quarter FROM a)::int || ' ' || extract(year FROM a)::int;

    WHEN 'SEMESTRE' THEN
      d := (date_trunc('year', a)
            + make_interval(months => CASE WHEN extract(month FROM a) <= 6 THEN 0 ELSE 6 END))::date;
      f := (d + interval '6 months - 1 day')::date;
      l := 'S' || CASE WHEN extract(month FROM a) <= 6 THEN 1 ELSE 2 END
                || ' ' || extract(year FROM a)::int;

    WHEN 'ANNEE_CIVILE' THEN
      d := date_trunc('year', a)::date;
      f := (date_trunc('year', a) + interval '1 year - 1 day')::date;
      l := 'Année ' || extract(year FROM a)::int;

    WHEN 'EXERCICE' THEN
      -- L'exercice qui CONTIENT la date d'ancrage ; à défaut, celui déclaré
      -- courant. Sans aucun exercice, on retombe sur l'année civile plutôt que
      -- de ne rien rendre — un tableau vide ne dirait pas pourquoi.
      SELECT fy.starts_on, fy.ends_on, 'Exercice ' || fy.year::text
        INTO d, f, l
        FROM fiscal_years fy
       WHERE a BETWEEN fy.starts_on AND fy.ends_on
       LIMIT 1;
      IF d IS NULL THEN
        SELECT fy.starts_on, fy.ends_on, 'Exercice ' || fy.year::text
          INTO d, f, l
          FROM fiscal_years fy WHERE fy.is_current LIMIT 1;
      END IF;
      IF d IS NULL THEN
        d := date_trunc('year', a)::date;
        f := (date_trunc('year', a) + interval '1 year - 1 day')::date;
        l := 'Année ' || extract(year FROM a)::int || ' (aucun exercice déclaré)';
      END IF;

    ELSE
      RAISE EXCEPTION
        'Découpage « % » inconnu. Valeurs admises : MOIS, TRIMESTRE, SEMESTRE, ANNEE_CIVILE, EXERCICE.', p_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;

  RETURN QUERY SELECT d, f, l, (f > CURRENT_DATE);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION periode_bornes(text, date) IS
  'Bornes d''un découpage nommé — MOIS, TRIMESTRE, SEMESTRE, ANNEE_CIVILE, EXERCICE — autour d''une date d''ancrage. Trimestres et semestres CIVILS, jamais glissants : un découpage glissant ne se compare pas d''une lecture à l''autre. `en_cours` signale une période non close.';


CREATE OR REPLACE FUNCTION periode_performance_defaut()
RETURNS TABLE (debut date, fin date, origine text) AS $$
  SELECT p.debut, p.fin, p.libelle FROM periode_bornes(NULL, NULL) p;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION periode_performance_defaut() IS
  'Fenêtre de lecture par défaut : l''exercice comptable courant, ou l''année civile tant qu''aucun exercice n''est déclaré.';


-- ---------------------------------------------------------------------------
--  LA PERFORMANCE, BORNÉE.
--
--  Une FONCTION et non une vue : une vue ne prend pas d'argument, et filtrer
--  après coup une vue déjà agrégée donnerait des totaux faux — on ne découpe
--  pas une somme après l'avoir faite.
--
--  `p_debut` et `p_fin` nuls valent « période par défaut ».
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION performance_commerciale(
  p_debut  date DEFAULT NULL,
  p_fin    date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_ancre  date DEFAULT NULL
)
RETURNS TABLE (
  owner_id                  uuid,
  commercial                varchar,
  role                      text,
  periode_debut             date,
  periode_fin               date,
  periode_origine           text,
  opportunites_ouvertes     bigint,
  ca_previsionnel           numeric,
  valeur_ponderee           numeric,
  sans_probabilite          bigint,
  actions_en_retard         bigint,
  gagnees                   bigint,
  perdues                   bigint,
  conversion_pct            numeric,
  affaires                  bigint,
  volume                    numeric,
  chiffre_affaires          numeric,
  affaires_approuvees       bigint,
  marge_unitaire_moyenne    numeric,
  affaires_sur_derogation   bigint,
  affaires_dans_la_bande    bigint,
  part_dans_la_bande_pct    numeric,
  ecart_moyen_au_seuil_pct  numeric
) AS $$
DECLARE
  d date; f date; o text;
BEGIN
  -- Trois façons de désigner la période, dans cet ordre de priorité :
  --   1. des bornes explicites — le cas particulier gagne toujours ;
  --   2. un découpage nommé autour d'une date d'ancrage ;
  --   3. rien, donc le découpage par défaut.
  SELECT b.debut, b.fin, b.libelle INTO d, f, o
    FROM periode_bornes(p_type, p_ancre) b;
  IF p_debut IS NOT NULL OR p_fin IS NOT NULL THEN
    d := COALESCE(p_debut, d);
    f := COALESCE(p_fin, f);
    o := 'du ' || to_char(d, 'DD/MM/YYYY') || ' au ' || to_char(f, 'DD/MM/YYYY');
  END IF;

  RETURN QUERY
  WITH
  -- Bande de surveillance, recalculée SUR LA PÉRIODE. On ne réutilise pas
  -- `v_margin_band_by_owner`, qui porte sur l'état courant : mélanger un
  -- indicateur daté et un indicateur instantané dans la même ligne donnerait
  -- un tableau qu'on ne peut pas lire.
  bande AS (
    SELECT dd.pct AS pct
      FROM (SELECT COALESCE(
              (SELECT NULLIF(value, '')::numeric FROM system_settings
                WHERE key = 'MARGIN_BAND_ALERT_PCT'), 15) AS pct) dd
  ),
  pipeline AS (
    SELECT op.owner_id,
           count(*)                                          AS nb,
           sum(op.estimated_volume * op.reference_price)      AS ca,
           sum(CASE WHEN COALESCE(op.probability_override_pct, s.probability_pct) IS NOT NULL
                    THEN op.estimated_volume * op.reference_price
                         * COALESCE(op.probability_override_pct, s.probability_pct) / 100
               END)                                          AS pondere,
           count(*) FILTER (
             WHERE COALESCE(op.probability_override_pct, s.probability_pct) IS NULL
           )                                                 AS sans_proba,
           count(*) FILTER (WHERE op.next_action_due < CURRENT_DATE) AS retard
      FROM crm_opportunities op
      JOIN crm_pipeline_stages s ON s.id = op.stage_id
     WHERE s.outcome::text = 'OPEN'
       AND op.created_at::date BETWEEN d AND f
     GROUP BY op.owner_id
  ),
  issues AS (
    SELECT op.owner_id,
           count(*) FILTER (WHERE s.outcome::text = 'WON')  AS gagnees,
           count(*) FILTER (WHERE s.outcome::text = 'LOST') AS perdues
      FROM crm_opportunities op
      JOIN crm_pipeline_stages s ON s.id = op.stage_id
     WHERE s.outcome::text IN ('WON', 'LOST')
       AND op.closed_at IS NOT NULL
       AND op.closed_at::date BETWEEN d AND f
     GROUP BY op.owner_id
  ),
  affaires AS (
    SELECT dl.owner_id,
           count(*)                                          AS nb,
           sum(dl.contracted_volume)                         AS volume,
           sum(dl.contracted_volume * dl.unit_sale_price)     AS ca,
           round(sum(dl.estimated_full_margin * dl.contracted_volume)
                 / NULLIF(sum(dl.contracted_volume), 0), 4)   AS marge,
           count(*) FILTER (WHERE dl.credit_approved_by_id IS NOT NULL) AS approuvees,
           count(*) FILTER (WHERE dl.margin_derogation_id IS NOT NULL)  AS derog,
           count(*) FILTER (
             WHERE t.minimum_margin IS NOT NULL
               AND dl.estimated_full_margin >= t.minimum_margin
               AND dl.estimated_full_margin <= t.minimum_margin * (1 + b.pct / 100)
           )                                                 AS dans_bande,
           avg(CASE WHEN t.minimum_margin IS NOT NULL AND t.minimum_margin > 0
                     AND dl.estimated_full_margin >= t.minimum_margin
                     AND dl.estimated_full_margin <= t.minimum_margin * (1 + b.pct / 100)
                    THEN (dl.estimated_full_margin - t.minimum_margin)
                         / t.minimum_margin * 100 END)       AS ecart_bande
      FROM deals dl
      CROSS JOIN bande b
      LEFT JOIN LATERAL resolve_margin_threshold(
        dl.segment::text, dl.product_id, dl.currency_code, dl.uom::text, CURRENT_DATE) t ON true
     WHERE dl.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
       AND dl.created_at::date BETWEEN d AND f
     GROUP BY dl.owner_id
  )
  SELECT u.id, u.full_name, u.role::text,
         d, f, o,
         COALESCE(p.nb, 0),
         round(COALESCE(p.ca, 0), 2),
         round(p.pondere, 2),
         COALESCE(p.sans_proba, 0),
         COALESCE(p.retard, 0),
         COALESCE(i.gagnees, 0),
         COALESCE(i.perdues, 0),
         CASE WHEN COALESCE(i.gagnees, 0) + COALESCE(i.perdues, 0) > 0
              THEN round(100.0 * i.gagnees / (i.gagnees + i.perdues), 2) END,
         COALESCE(a.nb, 0),
         COALESCE(a.volume, 0),
         round(COALESCE(a.ca, 0), 2),
         COALESCE(a.approuvees, 0),
         a.marge,
         COALESCE(a.derog, 0),
         COALESCE(a.dans_bande, 0),
         CASE WHEN COALESCE(a.nb, 0) > 0
              THEN round(100.0 * a.dans_bande / a.nb, 2) END,
         round(a.ecart_bande, 2)
    FROM users u
    LEFT JOIN pipeline p ON p.owner_id = u.id
    LEFT JOIN issues   i ON i.owner_id = u.id
    LEFT JOIN affaires a ON a.owner_id = u.id
   WHERE u.role::text IN ('SALES_REP', 'CCOO', 'DG')
     AND u.is_active
     -- Une ligne entièrement vide n'apprend rien : un commercial sans activité
     -- SUR LA PÉRIODE n'a pas à figurer, sinon la moitié du tableau est du
     -- bruit à zéro.
     AND (p.owner_id IS NOT NULL OR i.owner_id IS NOT NULL OR a.owner_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION performance_commerciale(date, date, text, date) IS
  'Performance par commercial SUR UNE PÉRIODE (§ 16). Chaque famille de chiffres est datée de son propre fait : opportunités à l''ouverture, conversion à la clôture, affaires à la création. Bornes nulles = période par défaut, rendue dans le résultat.';


-- ---------------------------------------------------------------------------
--  La vue conserve son nom : elle appelle la fonction sans bornes, donc sur la
--  période par défaut. Ce qui existait continue de fonctionner.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_performance_commerciale CASCADE;
CREATE VIEW v_performance_commerciale AS
  SELECT * FROM performance_commerciale(NULL, NULL, NULL, NULL);

COMMENT ON VIEW v_performance_commerciale IS
  'Performance par commercial sur la période PAR DÉFAUT — exercice courant, ou douze derniers mois. Pour une autre période, appeler performance_commerciale(debut, fin).';
