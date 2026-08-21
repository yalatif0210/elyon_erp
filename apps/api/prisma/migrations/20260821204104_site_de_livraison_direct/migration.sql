-- ===========================================================================
--  SITE DE LIVRAISON : LIEN DIRECT, PLUS DE RATTACHEMENT CLIENT INTERMÉDIAIRE
--
--  ⚠️ `partner_sites` N'AVAIT AUCUNE INTERFACE DE CRÉATION DANS L'APPLICATION
--     QUI TOURNE — ni écran dédié, ni entrée au référentiel générique, ni
--     bouton sur la fiche tiers (qui n'affichait qu'un compteur en lecture
--     seule). Les seules lignes qui existaient venaient du jeu de données
--     initial. Un site créé au référentiel autonome des sites n'apparaissait
--     donc JAMAIS dans le choix du lieu de livraison d'une affaire, pour
--     AUCUN client : `deals.site_id` et `operations.destination_site_id` ne
--     pouvaient désigner qu'un rattachement déjà semé, jamais un site réel.
--
--     `CarrierTariff` référence déjà `sites` directement des deux côtés de
--     son propre trajet (origine et destination) — c'est ce motif que ces
--     deux colonnes suivent maintenant, au lieu de rester l'exception.
--
--     La raison d'être invoquée de `partner_sites` (porter le nom/code que
--     CE client reconnaît, pour les bons de livraison) n'était de toute
--     façon lue nulle part : ni le gabarit de bon de livraison ni son
--     générateur ne consultaient ces colonnes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. CONVERSION DES DONNÉES — AVANT DE TOUCHER AUX CONTRAINTES.
--
--     Un `deals.site_id`/`operations.destination_site_id` qui désignait un
--     rattachement devient le SITE que ce rattachement désignait lui-même.
--     Un rattachement sans site (`partner_sites.site_id IS NULL` — la
--     colonne était facultative « le temps de la reprise ») n'avait de toute
--     façon jamais de lieu réel à perdre : la conversion rend NULL, ce qui
--     est exactement ce que la donnée valait déjà.
-- ---------------------------------------------------------------------------
UPDATE deals d
   SET site_id = ps.site_id
  FROM partner_sites ps
 WHERE d.site_id = ps.id;

UPDATE operations o
   SET destination_site_id = ps.site_id
  FROM partner_sites ps
 WHERE o.destination_site_id = ps.id;

-- ---------------------------------------------------------------------------
--  2. CONTRAINTES — LES ANCIENNES POINTAIENT VERS partner_sites.
-- ---------------------------------------------------------------------------
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_site_id_fkey";
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operations" DROP CONSTRAINT IF EXISTS "operations_destination_site_id_fkey";
ALTER TABLE "operations"
  ADD CONSTRAINT "operations_destination_site_id_fkey"
  FOREIGN KEY ("destination_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
--  3. DEUX VUES RÉFÉRENCENT partner_sites DIRECTEMENT — À RÉÉCRIRE AVANT DE
--     POUVOIR SUPPRIMER LA TABLE, PAS APRÈS PAR CASCADE.
--
--     `CREATE OR REPLACE VIEW` en gardant EXACTEMENT les mêmes colonnes de
--     sortie : `v_taches`/`v_taches_par_role`, qui dépendent de la première
--     sans jamais nommer `partner_sites` elles-mêmes, n'ont donc besoin
--     d'aucune modification ni d'un DROP CASCADE qui les aurait emportées.
-- ---------------------------------------------------------------------------

-- Le bout DELIVERY lisait le site AU TRAVERS du rattachement ; il le lit
-- directement désormais, symétrique du bout LOADING juste en dessous.
CREATE OR REPLACE VIEW v_exigences_site AS
WITH lieux AS (
  SELECT o.id AS operation_id, o.reference, 'DELIVERY'::text AS bout,
         o.destination_site_id AS site_id
    FROM operations o
   WHERE o.destination_site_id IS NOT NULL
   UNION ALL
  SELECT o.id, o.reference, 'LOADING'::text, o.origin_site_id
    FROM operations o
   WHERE o.origin_site_id IS NOT NULL
)
SELECT l.operation_id,
       l.reference AS operation,
       l.bout,
       s.id AS site_id,
       s.code AS site_code,
       s.name AS site_name,
       t.code AS exigence_code,
       t.label AS exigence,
       r.id AS exigence_id,
       r.detail,
       r.is_blocking,
       t.display_order
  FROM lieux l
  JOIN sites s ON s.id = l.site_id
  JOIN site_requirements r ON r.site_id = s.id AND r.is_active
  JOIN site_requirement_types t ON t.id = r.type_id AND t.is_active;

-- « Sites partagés » comptait les CLIENTS d'un même lieu par le nombre de
-- rattachements distincts qui le désignaient. Le rattachement disparaît :
-- ce sont maintenant les AFFAIRES elles-mêmes qui portent le lien site ↔
-- client, directement — même dénombrement, autre chemin pour y arriver.
CREATE OR REPLACE VIEW v_sites_partages AS
SELECT s.code,
       s.name,
       s.city,
       count(DISTINCT d.client_id) AS nb_clients,
       string_agg(DISTINCT p.legal_name::text, ', '::text ORDER BY p.legal_name::text) AS clients
  FROM sites s
  JOIN deals d ON d.site_id = s.id
  JOIN partners p ON p.id = d.client_id
 GROUP BY s.id, s.code, s.name, s.city
HAVING count(DISTINCT d.client_id) > 1;

-- ---------------------------------------------------------------------------
--  4. UN DÉCLENCHEUR RÉFÉRENCE partner_sites DIRECTEMENT DANS SON CORPS.
--
--     `DROP TABLE` ne s'en serait pas plaint — Postgres ne suit pas les
--     références internes au corps opaque d'une fonction PL/pgSQL comme il
--     suit les vues — mais l'appel aurait échoué à la PREMIÈRE affectation de
--     transporteur suivante, avec une « table partner_sites n'existe pas »
--     sans rapport apparent avec ce qu'on vient de faire. `destination_site_id`
--     pointe déjà le site directement : la jointure de conversion disparaît.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_freight_tariff()
RETURNS TRIGGER AS $$
DECLARE
  op        record;
  t         record;
  attendu   numeric;
  ecart_pct numeric;
  tolerance numeric;
BEGIN
  IF NEW.carrier_id IS NULL OR NEW.freight_cost = 0 THEN
    RETURN NEW;
  END IF;

  SELECT o.transport_mode::text AS mode, o.planned_volume,
         o.origin_site_id, d.product_id, o.destination_site_id
    INTO op
    FROM operations o
    JOIN deals d ON d.id = o.deal_id
   WHERE o.id = NEW.operation_id;

  SELECT * INTO t FROM resolve_carrier_tariff(
    NEW.carrier_id, op.mode, op.product_id,
    op.origin_site_id, op.destination_site_id, CURRENT_DATE);

  -- Aucun tarif négocié pour ce transporteur : on ne bloque pas. Exiger un
  -- tarif avant toute affectation empêcherait de travailler avec un
  -- transporteur d'appoint un jour de rupture — et c'est précisément ce
  -- jour-là qu'il faut pouvoir rouler.
  IF t.tariff_id IS NULL THEN
    NEW.carrier_tariff_id := NULL;
    NEW.tariff_amount := NULL;
    NEW.tariff_tolerance_pct := NULL;
    RETURN NEW;
  END IF;

  -- Le tarif RAMENÉ au montant attendu pour cette opération.
  attendu := CASE WHEN t.basis = 'PER_UNIT'
                  THEN t.amount * COALESCE(op.planned_volume, 0)
                  ELSE t.amount END;

  -- FIGÉS sur l'affectation : un tarif révisé ensuite ne doit pas requalifier
  -- un écart déjà motivé.
  NEW.carrier_tariff_id := t.tariff_id;
  NEW.tariff_amount := attendu;
  NEW.tariff_tolerance_pct := t.tolerance_pct;

  IF attendu = 0 THEN
    RETURN NEW;
  END IF;

  tolerance := COALESCE(t.tolerance_pct, 0);
  ecart_pct := abs(NEW.freight_cost - attendu) / attendu * 100;

  IF ecart_pct <= tolerance THEN
    RETURN NEW;
  END IF;

  IF NEW.freight_variance_reason IS NULL
     OR length(trim(NEW.freight_variance_reason)) < 10 THEN
    RAISE EXCEPTION
      'TARIF TRANSPORT : fret retenu à % contre % au tarif négocié, soit % %% d''écart pour une tolérance de % %%. Un motif circonstancié est exigé : un écart que personne n''explique aujourd''hui, personne ne l''expliquera dans six mois.',
      round(NEW.freight_cost, 2), round(attendu, 2), round(ecart_pct, 2), round(tolerance, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
--  5. `partner_sites` N'A PLUS D'OBJET, ET N'A PLUS DE DÉPENDANT.
--
--     Les exigences (`site_requirements`) restent portées par `sites`,
--     inchangées : elles n'ont jamais appartenu au rattachement, seulement
--     au lieu.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "partner_sites";
