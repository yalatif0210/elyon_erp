-- ===========================================================================
--  CE QUI MANQUAIT POUR QUE LES RÉFÉRENTIELS SOIENT ADMINISTRABLES
--  Réf. SPECIFICATIONS.md § 1.1 bis
--
--  Règle de la direction, posée deux fois :
--
--    « Toutes les données dont l'ERP a besoin pour fonctionner doivent être
--      paramétrables via une interface comme via un import Excel. »
--
--  Huit tables n'avaient AUCUN chemin d'écriture — ni écran, ni import, ni
--  API. On ne pouvait y saisir ni un client, ni un prix d'achat : en l'état,
--  l'application n'était pas déployable.
--
--  Les déclarer au registre suffit pour la plupart. Trois demandent d'abord
--  une correction en base, faute de quoi le paramétrage produirait des données
--  incohérentes ou introuvables.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. LE TAUX D'ABSORPTION EST CALCULÉ, PAS SAISI.
--
--  Un CHECK impose déjà `rate_per_unit = budgeted_amount / budgeted_base`. Le
--  faire saisir reviendrait donc à demander à l'exploitant de poser une
--  division à la main, puis à la lui refuser s'il se trompe d'une décimale —
--  et le message ne dirait pas laquelle des trois valeurs est fautive.
--
--  On le DÉRIVE. L'exploitant saisit le budget et l'assiette, qui sont les
--  seules données qu'il connaisse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_absorption_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.budgeted_base IS NULL OR NEW.budgeted_base = 0 THEN
    RAISE EXCEPTION
      'ASSIETTE D''ABSORPTION : l''assiette budgétée ne peut pas être nulle : le taux se calcule en divisant le budget par elle. Indiquez le volume, le nombre d''opérations ou le chiffre d''affaires prévu pour l''exercice.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.rate_per_unit := round(NEW.budgeted_amount / NEW.budgeted_base, 6);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_absorption_rate ON absorption_rates;
CREATE TRIGGER trg_derive_absorption_rate
  BEFORE INSERT OR UPDATE OF budgeted_amount, budgeted_base, rate_per_unit
  ON absorption_rates
  FOR EACH ROW EXECUTE FUNCTION derive_absorption_rate();


-- ---------------------------------------------------------------------------
--  2. LE MONTANT PIVOT D'UNE GARANTIE EST CALCULÉ, PAS SAISI.
--
--  Il déduit l'exposition crédit du client. Le laisser saisir libre permettrait
--  d'ouvrir un plafond en écrivant un nombre — sans qu'aucune banque n'ait rien
--  garanti.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_guarantee_pivot()
RETURNS TRIGGER AS $$
DECLARE
  taux numeric;
BEGIN
  taux := cours_vers_pivot(NEW.currency_code);
  IF taux IS NULL THEN
    RAISE EXCEPTION
      'GARANTIE : aucun cours de change entre % et la devise pivot. Saisissez-le au référentiel avant d''enregistrer la garantie : sans lui, son montant serait compté à l''unité près comme si les deux monnaies se valaient.',
      NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.fx_rate_to_pivot := taux;
  NEW.amount_pivot := round(NEW.amount * taux, 4);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_guarantee_pivot ON guarantees;
CREATE TRIGGER trg_derive_guarantee_pivot
  BEFORE INSERT OR UPDATE OF amount, currency_code ON guarantees
  FOR EACH ROW EXECUTE FUNCTION derive_guarantee_pivot();


-- ---------------------------------------------------------------------------
--  3. UN CHAUFFEUR DOIT ÊTRE IDENTIFIABLE PAR AUTRE CHOSE QUE SON IDENTIFIANT.
--
--  La table n'avait aucune contrainte d'unicité en dehors de la clé primaire.
--  Un import répété aurait donc créé un chauffeur de plus à chaque passage,
--  sans que rien ne s'y oppose — et le référentiel se serait rempli
--  d'homonymes que personne n'aurait su départager.
--
--  L'unicité porte sur le couple TRANSPORTEUR + MATRICULE, et seulement quand
--  le matricule est renseigné : tous les transporteurs n'en attribuent pas.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_driver_matricule;
CREATE UNIQUE INDEX uq_driver_matricule
  ON drivers (carrier_id, employee_number)
  WHERE employee_number IS NOT NULL;


-- ---------------------------------------------------------------------------
--  4. LES PRODUITS AUTORISÉS D'UNE CITERNE DOIVENT ÊTRE OPPOSÉS.
--
--  `vehicles.allowed_product_ids` était administrable — et lu NULLE PART. Le
--  commentaire du schéma promettait pourtant le contraire. L'exploitant
--  restreignait une citerne au gasoil, le système l'affectait à un chargement
--  d'essence sans un mot.
--
--  Une liste VIDE vaut « tous produits » : c'est la convention retenue partout
--  ailleurs (segments, modes de transport), et l'inverse rendrait tout véhicule
--  inaffectable tant que personne n'aurait rempli la liste.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_vehicle_allowed_products()
RETURNS TRIGGER AS $$
DECLARE
  autorises uuid[];
  produit   uuid;
  nom_prod  text;
  immat     text;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;

  SELECT v.allowed_product_ids, v.registration INTO autorises, immat
    FROM vehicles v WHERE v.id = NEW.vehicle_id;

  IF autorises IS NULL OR cardinality(autorises) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT d.product_id INTO produit
    FROM operations o JOIN deals d ON d.id = o.deal_id
   WHERE o.id = NEW.operation_id;

  IF produit IS NULL OR produit = ANY (autorises) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nom_prod FROM products WHERE id = produit;
  RAISE EXCEPTION
    'PRODUIT NON AUTORISÉ : la citerne % n''est pas habilitée à transporter %. Modifiez la liste des produits autorisés au référentiel des véhicules, ou affectez un autre véhicule.',
    immat, COALESCE(nom_prod, 'ce produit')
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_allowed_products ON operation_assignments;
CREATE TRIGGER trg_vehicle_allowed_products
  BEFORE INSERT OR UPDATE OF vehicle_id ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_allowed_products();


-- ---------------------------------------------------------------------------
--  5. LA CAPACITÉ D'UNE CITERNE DOIT ÊTRE OPPOSÉE AU VOLUME PLANIFIÉ.
--
--  `capacity` et `compartment_count` étaient administrables, et jamais
--  confrontés à quoi que ce soit. Une opération de 40 000 L s'affectait à une
--  citerne de 25 000 L sans avertissement — et l'écart se découvrait au dépôt.
--
--  La capacité est en UNITÉ DU VÉHICULE ; on ne compare que si l'opération est
--  dans la même unité. Comparer des litres à des tonnes serait pire que ne rien
--  comparer du tout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_vehicle_capacity()
RETURNS TRIGGER AS $$
DECLARE
  cap    numeric;
  immat  text;
  vol    numeric;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;

  SELECT v.capacity, v.registration INTO cap, immat FROM vehicles v WHERE v.id = NEW.vehicle_id;
  IF cap IS NULL OR cap = 0 THEN RETURN NEW; END IF;

  SELECT o.planned_volume INTO vol FROM operations o WHERE o.id = NEW.operation_id;
  IF vol IS NULL OR vol <= cap THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'CAPACITÉ INSUFFISANTE : la citerne % contient % et l''opération en prévoit %. Affectez un véhicule adapté, ou fractionnez l''opération.',
    immat, round(cap, 0), round(vol, 0)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_capacity ON operation_assignments;
CREATE TRIGGER trg_vehicle_capacity
  BEFORE INSERT OR UPDATE OF vehicle_id ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_capacity();


-- ---------------------------------------------------------------------------
--  6. LE VOLUME MINIMUM D'UN PRIX FOURNISSEUR DOIT ÊTRE OPPOSÉ.
--
--  `supplier_prices.min_volume` était administrable et lu nulle part : un
--  palier négocié à partir de 20 000 L était proposé pour 500 L, retenu comme
--  prix d'achat, et toute la chaîne de marge se calculait dessus.
--
--  Le contrôle joue à l'APPROBATION, comme les autres verrous économiques :
--  c'est le moment où l'affaire engage l'entreprise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_supplier_price_min_volume()
RETURNS TRIGGER AS $$
DECLARE
  seuil numeric;
BEGIN
  IF NEW.credit_approved_by_id IS NULL OR NEW.supplier_price_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min_volume INTO seuil FROM supplier_prices WHERE id = NEW.supplier_price_id;
  IF seuil IS NULL OR NEW.contracted_volume >= seuil THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'PALIER DE PRIX : le prix fournisseur retenu ne s''applique qu''à partir de %, et l''affaire ne porte que sur %. Retenez le prix correspondant au volume, ou négociez le palier.',
    round(seuil, 0), round(NEW.contracted_volume, 0)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_min_volume ON deals;
CREATE TRIGGER trg_supplier_price_min_volume
  BEFORE INSERT OR UPDATE OF supplier_price_id, contracted_volume, credit_approved_by_id
  ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_min_volume();


-- ===========================================================================
--  UNE LISTE VIDE EST UNE LISTE VIDE, PAS UN NUL
--
--  LE DÉFAUT, ET IL MORDAIT DÉJÀ
--  -----------------------------
--  Toutes les colonnes TABLEAU du modèle expriment la même convention :
--  « vide = tous ». Les vues la lisent partout de la même façon —
--  `cardinality(colonne) = 0`.
--
--  Or `cardinality(NULL)` ne vaut pas zéro : il vaut NULL. La condition entière
--  devient NULL, donc fausse, et l'objet n'est rattaché à RIEN au moment précis
--  où il devait l'être à TOUT. C'est l'inverse exact de ce que le libellé
--  « Vide = tous les segments » promet sous le champ.
--
--  L'écran de paramétrage écrivait NULL sur un champ laissé vide. Constaté sur
--  les quatre pools de charges saisis par la direction : leur assiette révisée
--  ressortait vide, sans qu'aucun message ne l'explique — le genre de silence
--  qu'on met des mois à remarquer.
--
--  La conversion côté serveur écrit désormais un tableau vide. Cette reprise
--  traite ce qui a été écrit avant, et se rejoue sans effet.
--
--  ⚠️ PAS DE `SET NOT NULL` ICI, ET C'EST DÉLIBÉRÉ.
--
--     Prisma modélise les listes comme non nulles côté client mais génère la
--     colonne sans contrainte. Poser NOT NULL creuserait un écart entre le
--     schéma déclaré et la base, que le calcul d'écart de la migration suivante
--     proposerait d'annuler — on gagnerait la contrainte pour la reperdre au
--     prochain changement de schéma, sans que personne ne le voie passer.
--     La garantie est donc tenue au point d'écriture, et les lectures sont
--     rendues insensibles au NUL.
-- ===========================================================================
UPDATE cost_pools              SET segments = '{}'                    WHERE segments IS NULL;
UPDATE operation_types         SET segments = '{}'                    WHERE segments IS NULL;
UPDATE sites                   SET usages = '{}'                      WHERE usages IS NULL;
UPDATE vehicles                SET allowed_product_ids = '{}'         WHERE allowed_product_ids IS NULL;
UPDATE hse_checklist_templates SET applicable_segments = '{}'         WHERE applicable_segments IS NULL;
UPDATE hse_checklist_templates SET applicable_transport_modes = '{}'  WHERE applicable_transport_modes IS NULL;
UPDATE hse_checklist_templates SET applicable_risk_levels = '{}'      WHERE applicable_risk_levels IS NULL;
