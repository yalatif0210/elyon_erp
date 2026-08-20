-- ===========================================================================
--  VERROU DE CLÔTURE : LE RAPPORT ET LE BON DE LIVRAISON AVANT LE STATUT
--  Réf. SPECIFICATIONS.md § 10, § 12.2 — discussion du 17/08
--
--  CE QUI SE PASSAIT
--  ------------------
--  `GeneratedDocumentKind.OPERATION_REPORT` et `DELIVERY_NOTE` existaient
--  dans le schéma, dans la liste blanche de lecture du terrain
--  (`NATURES_VISIBLES_DU_TERRAIN`) et dans les règles de scellement — mais
--  aucun code ne les produisait jamais, et rien n'empêchait une opération de
--  passer CLOSED sans qu'elles existent. Une opération pouvait donc se
--  clôturer sans qu'aucune trace signée de son exécution ni de sa livraison
--  ne soit jamais produite.
--
--  ⚠️ POURQUOI UN TRIGGER, ET NON UNE VÉRIFICATION APPLICATIVE SEULE.
--
--     Le même raisonnement que `enforce_hse_gate_before_loading` (§ 05) :
--     une vérification seulement côté API se contourne par n'importe quel
--     autre appelant (script de reprise, correction manuelle en base). Le
--     verrou de clôture protège une pièce OPPOSABLE — le client tient un
--     bon de livraison qui n'a de valeur que si l'opération qu'il documente
--     est réellement celle qui s'est terminée. Il doit tenir même contre le
--     code applicatif, pas seulement contre l'oubli.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION enforce_closure_documents_sealed()
RETURNS TRIGGER AS $$
DECLARE
  rapport_scelle boolean;
  bon_livraison_scelle boolean;
BEGIN
  IF NEW.status::text <> 'CLOSED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM generated_documents
     WHERE operation_id = NEW.id
       AND kind::text = 'OPERATION_REPORT'
       AND is_sealed
  ) INTO rapport_scelle;

  IF NOT rapport_scelle THEN
    RAISE EXCEPTION
      'CLÔTURE REFUSÉE : l''opération % ne porte aucun rapport d''exécution scellé (signature de l''agent terrain manquante).',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM generated_documents
     WHERE operation_id = NEW.id
       AND kind::text = 'DELIVERY_NOTE'
       AND is_sealed
  ) INTO bon_livraison_scelle;

  IF NOT bon_livraison_scelle THEN
    RAISE EXCEPTION
      'CLÔTURE REFUSÉE : l''opération % ne porte aucun bon de livraison scellé (signature de l''agent terrain et du représentant du client requises toutes les deux).',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_closure_documents_sealed ON operations;
CREATE TRIGGER trg_closure_documents_sealed
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_closure_documents_sealed();
