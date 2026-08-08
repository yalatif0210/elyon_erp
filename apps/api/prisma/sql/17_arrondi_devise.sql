-- ===========================================================================
--  LES INVARIANTS MONÉTAIRES DOIVENT CONNAÎTRE LA PRÉCISION DE LA DEVISE
--  Réf. SPECIFICATIONS.md § 9.2
--
--  « Le franc CFA n'a pas de subdivision en circulation : tout montant imprimé
--    en FCFA est un entier. »
--
--  ⚠️ DEUX DÉFAUTS QUI SE TENAIENT L'UN L'AUTRE.
--
--     1. L'application n'arrondissait le plan TRANSACTION qu'à quatre
--        décimales, quelle que soit la devise. Un total de 9 447 530,0895 FCFA
--        cohabitait avec un imprimé de 9 447 530. Le client paie l'imprimé : il
--        restait 0,0895 FCFA, la facture n'atteignait JAMAIS « payée », et elle
--        restait indéfiniment dans l'en-cours du client. Dans l'autre sens,
--        l'encaissement du montant imprimé était REFUSÉ.
--
--     2. Les CHECK comparaient au produit EXACT, avec une tolérance de 0,01
--        écrite en dur. Corriger le point 1 les faisait donc échouer : ils
--        interdisaient l'arrondi légal. Et cette tolérance de 0,01 n'a de sens
--        dans AUCUNE des deux directions — en XOF elle ne tolère rien, le plus
--        petit écart réel valant 1 ; sur une devise à deux décimales elle
--        tolère exactement un centime, ce qui est arbitraire.
--
--  LA CORRECTION
--  -------------
--  La tolérance DÉRIVE de la devise de la pièce : une demi-unité de la plus
--  petite subdivision en circulation. En XOF : 0,5. En USD : 0,005. C'est la
--  définition même d'un arrondi correct, et elle vaut pour toute devise qu'on
--  ajoutera.
--
--  ⚠️ LA FONCTION `tolerance_arrondi` ET LA REPRISE DES MONTANTS VIVENT DANS
--     01_business_constraints.sql, qui s'exécute AVANT 05 — lequel réinstalle
--     les CHECK à chaque migration. Les poser ici, après 05, faisait échouer
--     la migration sur la version PRÉCÉDENTE de la contrainte, rejouée entre
--     temps. Ce fichier ne porte donc que ce qui n'existe nulle part ailleurs.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Une pièce assujettie ne peut pas porter un taux NUL.
--
--  `chk_invoices_vat_requires_flag` disait « pas de TVA sans la case ». Il ne
--  disait rien de l'inverse : la case cochée avec un taux à zéro passait, la
--  pièce partait à la DGI, et la TVA collectée n'était pas déclarée. Le
--  contrôle applicatif est doublé ici — aucun chemin d'écriture ne doit
--  pouvoir l'éviter, pas même une reprise de données.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_rate_when_applicable,
  ADD  CONSTRAINT chk_invoices_vat_rate_when_applicable
       CHECK (NOT is_vat_applicable OR vat_rate_pct > 0);


-- ---------------------------------------------------------------------------
--  Un avoir ne dépasse pas la pièce qu'il corrige.
--
--  Tenu ici en plus de l'application : la vue de risque soustrait chaque avoir
--  de l'en-cours, et un avoir démesuré remet le crédit disponible d'un client
--  à zéro. C'est une écriture d'une ligne — elle ne doit passer par aucun
--  chemin.
--
--  Le cumul des avoirs déjà émis est pris en compte : sans cela, deux avoirs
--  de la moitié du montant passeraient chacun le contrôle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_credit_note_ceiling()
RETURNS TRIGGER AS $$
DECLARE
  piece      record;
  deja       numeric;
  corrigeable numeric;
BEGIN
  IF NEW.type::text <> 'CREDIT_NOTE' OR NEW.corrected_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT number, total_amount, currency_code, type::text AS t
    INTO piece FROM invoices WHERE id = NEW.corrected_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pièce corrigée par cet avoir est introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF piece.t = 'CREDIT_NOTE' THEN
    RAISE EXCEPTION
      'La pièce % est elle-même un avoir : un avoir ne se corrige pas par un avoir.',
      piece.number USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO deja
    FROM invoices
   WHERE corrected_invoice_id = NEW.corrected_invoice_id
     AND type::text = 'CREDIT_NOTE'
     AND id <> NEW.id;

  corrigeable := piece.total_amount - deja;

  IF NEW.total_amount > corrigeable + tolerance_arrondi(piece.currency_code) THEN
    RAISE EXCEPTION
      'Avoir de % sur % dont il ne reste que % à corriger. Un avoir qui dépasse la pièce qu''il corrige efface un en-cours qui existe.',
      round(NEW.total_amount, 2), piece.number, round(corrigeable, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_note_ceiling ON invoices;
CREATE TRIGGER trg_credit_note_ceiling
  BEFORE INSERT OR UPDATE OF total_amount, corrected_invoice_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_credit_note_ceiling();


-- ---------------------------------------------------------------------------
--  REPRISE — l'en-cours au pivot n'avait jamais suivi les encaissements.
--
--  `paid_amount_pivot` restait à zéro alors que `v_partner_credit_exposure`
--  calcule `SUM(total_amount_pivot − paid_amount_pivot)` : 15 000 000 FCFA
--  encaissés laissaient 24 776 USD d'en-cours fantôme sur un seul client. La
--  donnée existait, portée par les lignes d'encaissement — elle n'était pas
--  reportée.
--
--  Le cours retenu est celui FIGÉ SUR LA PIÈCE : convertir au cours du jour
--  ferait apparaître un écart de change comme un impayé.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE invoices i
     SET paid_amount_pivot = round(i.paid_amount * i.fx_rate_to_pivot, 4)
   WHERE i.paid_amount > 0
     AND (i.paid_amount_pivot IS NULL OR i.paid_amount_pivot = 0);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : en-cours au pivot rétabli sur % facture(s) encaissée(s).', n;
  END IF;
END $$;
