-- ===========================================================================
--  L'ASSIETTE D'ABSORPTION EST UN VOLUME BUDGÉTÉ, ET RIEN D'AUTRE
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
--  ⚠️ CE FICHIER NE LAISSE QU'UNE SEULE BASE D'IMPUTATION OUVERTE.
--
--     PER_REVENUE a été fermée en premier — l'assiette en valeur.
--     PER_OPERATION l'est à son tour, et c'est un choix du dirigeant, pas une
--     limite technique : « Pools imputés à l'opération : non ».
--
--     La raison de fond est que l'assiette se DÉRIVE désormais de la prévision
--     de vente (fichier 34), laquelle prévoit des VOLUMES. Rien n'y prévoit un
--     nombre de rotations. Un pool imputé à l'opération n'aurait donc aucun
--     dénominateur à lire, et il faudrait lui en faire saisir un à la main —
--     c'est-à-dire rouvrir la double saisie qu'on vient de supprimer.
--
--     Les deux valeurs restent dans l'énumération : des lignes historiques les
--     portent, et une énumération se réduit mal. Elles deviennent simplement
--     INUTILISABLES sur un pool actif.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION refuse_assiette_en_valeur()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF NEW.allocation_basis::text = 'PER_REVENUE' THEN
    RAISE EXCEPTION
      'Le pool « % » ne peut pas s''imputer au prorata du chiffre d''affaires. L''assiette d''absorption est un VOLUME budgété : le volume est piloté, le prix ne l''est pas, il suit les publications DGH et le change. Une assiette en valeur ferait bouger la charge fixe unitaire à chaque publication, sans qu''aucune charge n''ait changé. Employer PER_VOLUME.',
      NEW.code
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.allocation_basis::text = 'PER_OPERATION' THEN
    RAISE EXCEPTION
      'Le pool « % » ne peut pas s''imputer au nombre d''opérations. L''assiette se dérive de la prévision de vente, qui prévoit des VOLUMES et non des rotations : ce pool n''aurait aucun dénominateur à lire, et lui en faire saisir un rouvrirait la double saisie qu''on a supprimée. Employer PER_VOLUME.',
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
   AND allocation_basis::text IN ('PER_REVENUE', 'PER_OPERATION');

-- ---------------------------------------------------------------------------
--  ⚠️ `v_assiette_absorption` A ÉTÉ SUPPRIMÉE — ELLE N'A PLUS D'OBJET.
--
--     Elle confrontait l'assiette SAISIE à la prévision budgétée, parce que
--     les deux se saisissaient séparément et finiraient par diverger. Le
--     fichier 34 supprime la saisie : l'assiette EST la prévision, et l'écart
--     est nul par construction. Une vue qui affiche toujours zéro n'informe
--     personne — elle rassure, ce qui est pire.
--
--     Ce qu'on veut voir à la place est ailleurs : `v_absorption_reelle`
--     compare la charge au litre selon l'assiette budgétée, révisée et
--     réalisée. C'est l'écart qui reste après qu'on a supprimé celui-ci.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_assiette_absorption;
