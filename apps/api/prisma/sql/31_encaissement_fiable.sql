-- ===========================================================================
--  L'ENCAISSEMENT — SOLDE DÉRIVÉ, COURSE FERMÉE, DOUBLONS REFUSÉS
--  Réf. SPECIFICATIONS.md § 9.1, § 14.6 — issu de l'audit, défauts A7 et A8
--
--  DEUX DÉFAUTS CONSTATÉS, UNE SEULE CAUSE
--  ---------------------------------------
--  `invoices.paid_amount` était une valeur STOCKÉE, tenue à jour par l'application,
--  à côté du journal `payments`. Rien ne liait les deux.
--
--  A7 — Divergence possible. Vérifié en transaction annulée : un UPDATE direct passe
--       `paid_amount` à `total_amount` et le statut à PAID SANS AUCUN encaissement
--       enregistré. Accepté par la base.
--
--  A8 — Course et non-idempotence. La lecture du solde se faisait HORS de la
--       transaction d'écriture, et le solde était écrit en VALEUR ABSOLUE :
--
--         const invoice = await findUniqueOrThrow(...)        // lecture, hors transaction
--         const paid = Number(invoice.paidAmount) + dto.amount
--         await prisma.$transaction([ create(payment), update({ paidAmount: paid }) ])
--
--       Deux règlements concurrents de 600 sur une facture de 1 000 : les deux lisent
--       0, les deux calculent 600, les deux passent le contrôle applicatif, les deux
--       s'écrivent. Résultat : 1 200 au journal, 600 au solde, facture « partiellement
--       payée ». L'en-cours crédit, qui lit `paid_amount_pivot`, est faux d'autant.
--
--  ⚠️ LA CORRECTION NE CONSISTE PAS À VERROUILLER MIEUX DANS L'APPLICATION.
--
--     Un verrou applicatif protège les chemins qui l'empruntent. Il ne protège ni
--     l'import, ni la reprise de données, ni le correctif d'urgence en SQL. Le solde
--     cesse donc d'être TENU pour devenir DÉRIVÉ : la base le recalcule depuis le
--     journal à chaque mouvement.
--
--     La course se referme d'elle-même. Deux règlements concurrents recalculent tous
--     deux la somme du journal ; le second voit 1 200, dépasse le total, et la
--     contrainte `paid_amount <= total_amount` — qui existait déjà — le refuse. Ce
--     n'est plus l'application qui arbitre, c'est le moteur.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Le solde et le statut se dérivent du journal.
--
--  Le cours retenu est celui FIGÉ SUR LA PIÈCE, jamais celui du jour :
--  `total_amount_pivot` a été calculé à la date de facture, et soustraire un
--  règlement converti au cours d'aujourd'hui ferait apparaître un écart de change
--  comme un impayé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcule_solde_facture()
RETURNS TRIGGER AS $$
DECLARE
  cible uuid;
  encaisse numeric;
  f record;
  tol numeric;
BEGIN
  cible := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF cible IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT i.total_amount, i.fx_rate_to_pivot, i.currency_code, i.status::text AS statut
    INTO f
    FROM invoices i WHERE i.id = cible;

  SELECT COALESCE(sum(p.amount), 0) INTO encaisse
    FROM payments p
   WHERE p.invoice_id = cible AND p.direction::text = 'INBOUND';

  -- Tolérance de restitution : en XOF, un solde de 0,0895 n'existe pas. Le client
  -- paie le montant imprimé, et refuser son règlement pour une fraction de franc
  -- bloquerait la pièce des deux côtés.
  tol := tolerance_arrondi(f.currency_code);

  UPDATE invoices i
     SET paid_amount       = encaisse,
         paid_amount_pivot = round(encaisse * i.fx_rate_to_pivot, 4),
         status = CASE
           -- Une pièce annulée ou contestée garde son statut : ce sont des
           -- décisions, pas des états dérivés du règlement.
           WHEN i.status::text IN ('CANCELLED', 'DISPUTED') THEN i.status
           WHEN encaisse + tol >= i.total_amount            THEN 'PAID'::invoice_status
           WHEN encaisse > 0                                THEN 'PARTIALLY_PAID'::invoice_status
           WHEN i.issued_at IS NOT NULL                     THEN 'ISSUED'::invoice_status
           ELSE i.status
         END
   WHERE i.id = cible;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solde_facture ON payments;
CREATE TRIGGER trg_solde_facture
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION recalcule_solde_facture();


-- ---------------------------------------------------------------------------
--  2. Le solde ne s'écrit plus à la main.
--
--  Sans ceci, la dérivation ci-dessus serait une convention : un UPDATE direct
--  continuerait de poser n'importe quel solde, et le prochain encaissement le
--  corrigerait sans que personne ait vu passer l'écart.
--
--  L'écriture reste permise quand elle vient du déclencheur lui-même — reconnu à ce
--  que le solde proposé ÉGALE la somme du journal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_solde_ecrit_a_la_main()
RETURNS TRIGGER AS $$
DECLARE
  journal numeric;
BEGIN
  IF NEW.paid_amount IS NOT DISTINCT FROM OLD.paid_amount THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(p.amount), 0) INTO journal
    FROM payments p
   WHERE p.invoice_id = NEW.id AND p.direction::text = 'INBOUND';

  IF abs(NEW.paid_amount - journal) > tolerance_arrondi(NEW.currency_code) THEN
    RAISE EXCEPTION
      'Le montant encaissé de la facture % ne se saisit pas : il est DÉRIVÉ du journal des règlements, qui totalise %. Enregistrer un encaissement, ou l''annuler : un solde posé à la main ne correspondrait à aucun mouvement bancaire.',
      NEW.number, round(journal, 4)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solde_non_saisissable ON invoices;
CREATE TRIGGER trg_solde_non_saisissable
  BEFORE UPDATE OF paid_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION refuse_solde_ecrit_a_la_main();


-- ---------------------------------------------------------------------------
--  3. Un même mouvement bancaire ne s'enregistre qu'une fois.
--
--  La référence bancaire EST la clé naturelle d'un règlement : c'est le numéro que
--  la banque attribue au virement. Deux lignes portant la même référence sur la même
--  pièce sont le même argent compté deux fois — double clic, rejeu réseau, ou reprise
--  d'un fichier déjà importé.
--
--  Index PARTIEL : la référence reste facultative, parce qu'un règlement en espèces
--  n'en a pas. Son absence n'est donc pas bloquée — elle est signalée plus bas.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uniq_paiement_reference_bancaire;
CREATE UNIQUE INDEX uniq_paiement_reference_bancaire
  ON payments (invoice_id, bank_reference)
  WHERE bank_reference IS NOT NULL AND invoice_id IS NOT NULL;

DROP INDEX IF EXISTS uniq_paiement_reference_fournisseur;
CREATE UNIQUE INDEX uniq_paiement_reference_fournisseur
  ON payments (supplier_invoice_id, bank_reference)
  WHERE bank_reference IS NOT NULL AND supplier_invoice_id IS NOT NULL;


-- ---------------------------------------------------------------------------
--  4. RAPPROCHEMENT — la vue qui manquait.
--
--  `v_cost_reconciliation` rapprochait les coûts. Rien ne rapprochait les
--  RÈGLEMENTS : le solde et son journal pouvaient diverger sans qu'aucun écran ne
--  puisse le montrer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rapprochement_encaissements AS
SELECT i.id                                        AS invoice_id,
       i.number                                    AS piece,
       i.type::text                                AS type,
       i.status::text                              AS statut,
       p.legal_name                                AS client,
       i.total_amount,
       i.currency_code,
       i.paid_amount                               AS solde_porte,
       COALESCE(j.encaisse, 0)                     AS somme_du_journal,
       round(i.paid_amount - COALESCE(j.encaisse, 0), 4) AS ecart,
       COALESCE(j.mouvements, 0)                   AS nb_mouvements,
       COALESCE(j.sans_reference, 0)               AS mouvements_sans_reference,
       round(i.total_amount - COALESCE(j.encaisse, 0), 4) AS reste_du,
       i.due_date,
       CASE WHEN i.due_date IS NOT NULL
                 AND i.due_date < CURRENT_DATE
                 AND COALESCE(j.encaisse, 0) + tolerance_arrondi(i.currency_code) < i.total_amount
            THEN CURRENT_DATE - i.due_date END     AS retard_jours
  FROM invoices i
  JOIN partners p ON p.id = i.partner_id
  LEFT JOIN LATERAL (
    SELECT sum(pa.amount)                                        AS encaisse,
           count(*)                                              AS mouvements,
           count(*) FILTER (WHERE pa.bank_reference IS NULL)      AS sans_reference
      FROM payments pa
     WHERE pa.invoice_id = i.id AND pa.direction::text = 'INBOUND'
  ) j ON true
 WHERE i.type::text <> 'PROFORMA';

COMMENT ON VIEW v_rapprochement_encaissements IS
  'Solde porté par la pièce contre somme du journal des règlements (§ 9.1). `ecart` doit rester nul : il est désormais dérivé, et une écriture manuelle est refusée.';


-- ---------------------------------------------------------------------------
--  5. LES CRÉANCES ÉCHUES — le statut OVERDUE n'était jamais posé.
--
--  `invoice_status` porte la valeur OVERDUE depuis l'origine, et AUCUN traitement ne
--  la posait : une facture échue restait ISSUED indéfiniment. Le recouvrement se
--  faisait donc hors de l'outil, ou pas du tout.
--
--  ⚠️ ON DÉRIVE PLUTÔT QUE DE STOCKER, ET C'EST DÉLIBÉRÉ.
--
--     Stocker OVERDUE exigerait un traitement quotidien : sans lui, le statut serait
--     juste le jour de son calcul et faux le lendemain. La conformité des moyens a
--     déjà tranché la même question de la même façon (`compliance_statut_effectif`) —
--     un statut qui dépend de la DATE DU JOUR se calcule à la lecture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION statut_creance_effectif(
  p_statut text, p_due_date date, p_reste numeric, p_tolerance numeric DEFAULT 0.005)
RETURNS text AS $$
  SELECT CASE
    WHEN p_statut IN ('CANCELLED', 'DISPUTED', 'PAID', 'DRAFT') THEN p_statut
    WHEN p_due_date IS NOT NULL
     AND p_due_date < CURRENT_DATE
     AND p_reste > p_tolerance                                  THEN 'OVERDUE'
    ELSE p_statut
  END;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW v_creances_echues AS
SELECT r.invoice_id,
       r.piece,
       r.client,
       r.total_amount,
       r.currency_code,
       r.somme_du_journal                          AS encaisse,
       r.reste_du,
       r.due_date,
       r.retard_jours,
       -- Tranches d'ancienneté : une balance âgée se lit par paliers, pas facture
       -- par facture.
       CASE
         WHEN r.retard_jours IS NULL   THEN 'à échoir'
         WHEN r.retard_jours <= 30     THEN '1 à 30 jours'
         WHEN r.retard_jours <= 60     THEN '31 à 60 jours'
         WHEN r.retard_jours <= 90     THEN '61 à 90 jours'
         ELSE 'plus de 90 jours'
       END                                         AS tranche
  FROM v_rapprochement_encaissements r
 WHERE r.statut NOT IN ('DRAFT', 'CANCELLED', 'PAID')
   AND r.reste_du > tolerance_arrondi(r.currency_code);

COMMENT ON VIEW v_creances_echues IS
  'Balance âgée des créances clients (§ 13, module 6 — recouvrement). Le retard est DÉRIVÉ de la date du jour : un statut stocké serait juste le jour de son calcul et faux le lendemain.';


-- ---------------------------------------------------------------------------
--  6. REPRISE — aligner les soldes existants sur leur journal.
--
--  La dérivation ne juge que les mouvements postérieurs à sa pose. Les pièces déjà
--  en base gardent le solde que l'application leur avait donné, et rien ne dit s'il
--  correspond au journal.
-- ---------------------------------------------------------------------------
DO $reprise$
DECLARE
  n int;
BEGIN
  WITH journal AS (
    SELECT i.id,
           COALESCE((SELECT sum(p.amount) FROM payments p
                      WHERE p.invoice_id = i.id AND p.direction::text = 'INBOUND'), 0) AS encaisse
      FROM invoices i
     WHERE i.type::text <> 'PROFORMA'
  )
  UPDATE invoices i
     SET paid_amount       = j.encaisse,
         paid_amount_pivot = round(j.encaisse * i.fx_rate_to_pivot, 4)
    FROM journal j
   WHERE j.id = i.id
     AND abs(i.paid_amount - j.encaisse) > tolerance_arrondi(i.currency_code);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : % solde(s) de facture réaligné(s) sur le journal des règlements.', n;
  END IF;
END
$reprise$;
