-- ===========================================================================
--  APUREMENT AUTOMATIQUE DES AVANCES FOURNISSEURS
--  Réf. SPECIFICATIONS.md § 14.6
--
--  Elyon règle ses fournisseurs AVANT livraison. Le montant sorti reste une
--  IMMOBILISATION DE TRÉSORERIE tant qu'aucune contrepartie n'est constatée.
--
--  Le problème que ce fichier résout : tant que l'apurement est un acte
--  déclaratif — quelqu'un saisit une date — l'indicateur peut être remis à
--  zéro sans qu'un litre soit arrivé. Un indicateur de trésorerie qu'on
--  assainit par saisie ne mesure plus la trésorerie.
--
--  TROIS RÈGLES, arrêtées avec la direction le 3 août 2026 :
--
--    A. Avance SUR MARCHANDISE  → apurée au CHARGEMENT CONSTATÉ de
--       l'opération, AU PRORATA du volume enlevé rapporté au volume commandé.
--
--    B. Avance SANS MARCHANDISE (fret, inspection, douane) → apurée à la
--       CLÔTURE de l'opération : la prestation est alors rendue.
--
--    C. Le prorata est REVU à la baisse ou à la hausse dès qu'un relevé
--       faisant autorité donne le volume réellement chargé.
--
--  Porté par PostgreSQL et non par le service : une écriture directe, un
--  script d'administration ou une refonte de l'API ne peuvent pas l'esquiver.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Reprise des lignes antérieures.
--
--  Avant ce fichier, l'apurement se réduisait à une DATE : les avances soldées
--  portent donc `settled_at` et un montant apuré resté à zéro. La contrainte
--  ci-dessous les refuserait. On les aligne d'abord — une migration doit
--  emporter sa propre réconciliation de données, sinon elle ne passe que sur
--  une base vierge.
--
--  Idempotent : la clause WHERE ne retient que les lignes non conformes.
-- ---------------------------------------------------------------------------
UPDATE supplier_invoices
   SET settled_amount = prepaid_amount
 WHERE settled_at IS NOT NULL
   AND settled_amount < prepaid_amount;

ALTER TABLE supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_supplier_invoice_settled_bounds,
  ADD  CONSTRAINT chk_supplier_invoice_settled_bounds
       CHECK (settled_amount >= 0 AND settled_amount <= prepaid_amount),

  -- Une date d'apurement intégral n'a de sens que si tout est apuré.
  DROP CONSTRAINT IF EXISTS chk_supplier_invoice_settled_complete,
  ADD  CONSTRAINT chk_supplier_invoice_settled_complete
       CHECK (settled_at IS NULL OR settled_amount >= prepaid_amount - 0.01);

COMMENT ON COLUMN supplier_invoices.settled_amount IS
  'Part de l''avance apurée par une contrepartie physiquement constatée. Dérivée par trigger — ne pas saisir à la main.';


-- ---------------------------------------------------------------------------
--  Reliquat d'avance : ce qui pèse encore au besoin en fonds de roulement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION outstanding_advance(invoice_id uuid)
RETURNS numeric AS $$
  SELECT GREATEST(0, si.prepaid_amount - si.settled_amount)
    FROM supplier_invoices si
   WHERE si.id = invoice_id;
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  Apurement au prorata d'un volume constaté.
--
--  Le ratio est BORNÉ À 1 : enlever davantage que le volume commandé n'apure
--  jamais plus que ce qui a été avancé. Un volume commandé absent ou nul fait
--  retomber sur un apurement intégral — à défaut de base de calcul, on ne
--  laisse pas une avance traîner indéfiniment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_advance_settlement(
  p_invoice_id uuid,
  p_ordered_volume numeric,
  p_actual_volume numeric,
  p_settled_on date
) RETURNS void AS $$
DECLARE
  ratio numeric;
  prepaid numeric;
  target numeric;
BEGIN
  SELECT prepaid_amount INTO prepaid FROM supplier_invoices WHERE id = p_invoice_id;
  IF prepaid IS NULL OR prepaid <= 0 THEN
    RETURN; -- rien n'a été avancé : il n'y a rien à apurer
  END IF;

  IF p_ordered_volume IS NULL OR p_ordered_volume <= 0 THEN
    ratio := 1;
  ELSE
    ratio := LEAST(1, GREATEST(0, COALESCE(p_actual_volume, 0) / p_ordered_volume));
  END IF;

  target := ROUND(prepaid * ratio, 4);

  UPDATE supplier_invoices
     SET settled_amount = target,
         -- La date ne se pose qu'à l'apurement INTÉGRAL : un reliquat pèse
         -- encore, et le laisser paraître soldé fausserait le BFR.
         settled_at = CASE
                        WHEN target >= prepaid - 0.01 THEN p_settled_on
                        ELSE NULL
                      END
   WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  A + B. Déclenchement sur le cycle de vie de l'opération.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_advances_on_operation()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
  loaded numeric;
BEGIN
  IF OLD.phase = NEW.phase THEN
    RETURN NEW;
  END IF;

  -- ----- A. Avances SUR MARCHANDISE, au chargement constaté ---------------
  IF NEW.phase::text = 'CHARGEMENT' THEN
    -- Volume retenu : celui du relevé CHARGEMENT faisant autorité s'il
    -- existe déjà (§ 25/08/2026, un relevé ne porte plus qu'un bout — voir
    -- schema.prisma), sinon le volume prévu de l'opération. La règle C
    -- corrigera plus tard. L'index unique (operation_id, phase) garantit
    -- qu'il n'y en a jamais plus d'un.
    SELECT m.volume_15 INTO loaded
      FROM measurement_records m
     WHERE m.operation_id = NEW.id AND m.is_authoritative AND m.phase::text = 'CHARGEMENT';
    loaded := COALESCE(loaded, NEW.planned_volume);

    FOR r IN
      SELECT si.id AS invoice_id, po.ordered_volume
        FROM supplier_invoices si
        JOIN purchase_orders po ON po.id = si.purchase_order_id
       WHERE po.operation_id = NEW.id
         AND si.prepaid_amount > 0
         AND si.settled_at IS NULL
    LOOP
      PERFORM apply_advance_settlement(
        r.invoice_id, r.ordered_volume, loaded,
        COALESCE(NEW.actual_loading_date, CURRENT_DATE)
      );
    END LOOP;
  END IF;

  -- ----- B. Avances SANS MARCHANDISE, à la clôture -------------------------
  --
  -- Fret, inspection, douane : aucune réception physique n'existe. Leur
  -- contrepartie est la prestation rendue, donc la fin de la rotation. On les
  -- reconnaît à l'absence de commande d'achat.
  IF NEW.phase::text = 'CLOTURE' THEN
    FOR r IN
      SELECT si.id AS invoice_id
        FROM supplier_invoices si
       WHERE si.deal_id = NEW.deal_id
         AND si.purchase_order_id IS NULL
         AND si.prepaid_amount > 0
         AND si.settled_at IS NULL
    LOOP
      PERFORM apply_advance_settlement(
        r.invoice_id, NULL, NULL, COALESCE(NEW.closed_at::date, CURRENT_DATE)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settle_advances_on_operation ON operations;
CREATE TRIGGER trg_settle_advances_on_operation
  AFTER UPDATE OF phase ON operations
  FOR EACH ROW EXECUTE FUNCTION settle_advances_on_operation();


-- ---------------------------------------------------------------------------
--  C. Révision du prorata au relevé faisant autorité.
--
--  Le volume prévu sert d'estimation au chargement ; le volume mesuré fait
--  foi. Dès qu'il est connu, l'apurement est recalculé — à la hausse comme à
--  la baisse. Sans cela, un enlèvement inférieur au prévu laisserait croire
--  l'avance soldée alors qu'une part reste immobilisée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revise_advances_on_measurement()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
  op RECORD;
BEGIN
  -- § 25/08/2026 — un relevé ne porte plus qu'un bout : seul celui pris à
  -- l'étape CHARGEMENT donne le volume réellement enlevé. Un relevé
  -- DECHARGEMENT authoritatif ne doit rien réviser ici, quand bien même il
  -- vient d'être rapproché.
  IF NOT (NEW.is_authoritative AND NEW.phase::text = 'CHARGEMENT') THEN
    RETURN NEW;
  END IF;

  SELECT id, phase, actual_loading_date INTO op
    FROM operations WHERE id = NEW.operation_id;

  -- Avant le chargement, il n'y a rien à réviser : rien n'a été apuré.
  IF op.phase::text NOT IN
     ('CHARGEMENT', 'POST_CHARGEMENT', 'TRANSPORT', 'PRE_DECHARGEMENT',
      'DECHARGEMENT', 'POST_DECHARGEMENT', 'CLOTURE') THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT si.id AS invoice_id, po.ordered_volume
      FROM supplier_invoices si
      JOIN purchase_orders po ON po.id = si.purchase_order_id
     WHERE po.operation_id = NEW.operation_id
       AND si.prepaid_amount > 0
  LOOP
    PERFORM apply_advance_settlement(
      r.invoice_id, r.ordered_volume, NEW.volume_15,
      COALESCE(op.actual_loading_date, NEW.measurement_date)
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revise_advances_on_measurement ON measurement_records;
CREATE TRIGGER trg_revise_advances_on_measurement
  AFTER INSERT OR UPDATE OF volume_15, is_authoritative ON measurement_records
  FOR EACH ROW EXECUTE FUNCTION revise_advances_on_measurement();


-- ---------------------------------------------------------------------------
--  Vue de pilotage : la trésorerie réellement immobilisée.
--
--  Elle ne montre QUE le reliquat. Une avance partiellement apurée y figure
--  pour ce qui reste, jamais pour son montant d'origine.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_outstanding_advances AS
SELECT
  si.id,
  si.reference,
  p.legal_name                                   AS supplier,
  d.reference                                    AS deal,
  si.currency_code,
  si.prepaid_amount,
  si.settled_amount,
  (si.prepaid_amount - si.settled_amount)        AS outstanding_amount,
  ROUND((si.prepaid_amount - si.settled_amount) * si.fx_rate_to_pivot, 4)
                                                 AS outstanding_pivot,
  si.prepaid_at,
  (CURRENT_DATE - si.prepaid_at)                 AS days_outstanding,
  -- Ce qui apurera cette avance, pour que l'utilisateur sache quoi attendre.
  CASE
    WHEN si.purchase_order_id IS NOT NULL THEN 'Chargement de l''opération'
    WHEN si.deal_id IS NOT NULL           THEN 'Clôture de l''opération'
    ELSE 'Apurement manuel : facture rattachée à aucun dossier'
  END                                            AS settlement_trigger,
  o.reference                                    AS operation,
  o.phase::text                                  AS operation_phase
FROM supplier_invoices si
JOIN partners p          ON p.id = si.supplier_id
LEFT JOIN deals d        ON d.id = si.deal_id
LEFT JOIN purchase_orders po ON po.id = si.purchase_order_id
LEFT JOIN operations o   ON o.id = po.operation_id
WHERE si.prepaid_amount > si.settled_amount + 0.01
ORDER BY si.prepaid_at;

COMMENT ON VIEW v_outstanding_advances IS
  'Trésorerie immobilisée par les prépaiements fournisseurs (§ 14.6) : reliquat seul, jamais le montant d''origine. Chez Elyon ce sont les AVANCES qui pèsent au BFR, pas les dettes.';
