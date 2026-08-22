-- ===========================================================================
--  AGRÉMENTS D'ELYON TRADING ELLE-MÊME
--  Réf. discussion du 22 août 2026
--
--  LE PROBLÈME
--  -----------
--  `ComplianceType` prévoit CUSTOMS_LICENSE, MINISTERIAL_APPROVAL et
--  IMPORT_EXPORT_LICENSE — des agréments qu'ELYON TRADING doit détenir pour
--  opérer, pas ses sous-traitants. Mais `compliance_records` exige
--  (`chk_compliance_single_owner`) EXACTEMENT un porteur parmi tiers, véhicule
--  ou chauffeur : aucune ligne ne pouvait jamais représenter l'entreprise
--  elle-même. Ces trois natures existaient dans l'énumération sans qu'aucune
--  ligne ne puisse jamais les porter pour de bon.
--
--  LA SOLUTION
--  -----------
--  `company_accreditations` (schema.prisma) : mêmes champs de fond que
--  `compliance_records`, sans porteur à choisir puisqu'il n'y en a qu'un
--  possible. Le statut suit le MÊME calcul que le reste de la conformité
--  (`compliance_statut_effectif`, déjà générique) : un agrément douanier ne
--  se renouvelle pas tout seul le jour de son échéance, pas plus qu'un permis
--  de conduire.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION derive_company_accreditation_status()
RETURNS TRIGGER AS $$
DECLARE
  notice_days int;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::int, 60) INTO notice_days
    FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS';
  notice_days := COALESCE(notice_days, 60);

  IF NEW.expiry_date IS NULL THEN
    NEW.status := 'VALID';
  ELSIF NEW.expiry_date < CURRENT_DATE THEN
    NEW.status := 'EXPIRED';
  ELSIF NEW.expiry_date <= CURRENT_DATE + notice_days THEN
    NEW.status := 'EXPIRING';
  ELSE
    NEW.status := 'VALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_accreditation_status ON company_accreditations;
CREATE TRIGGER trg_company_accreditation_status
  BEFORE INSERT OR UPDATE OF expiry_date ON company_accreditations
  FOR EACH ROW EXECUTE FUNCTION derive_company_accreditation_status();

-- ---------------------------------------------------------------------------
--  L'échéancier documentaire couvre désormais aussi l'entreprise.
--
--  ⚠️ MÊMES COLONNES DE SORTIE, TOUJOURS — `ComplianceController.expiryWatch`
--     les lit par nom, jamais par position, mais un ordre ou un type qui
--     changerait casserait ses appelants sans qu'aucune migration ne le
--     signale.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_compliance_expiry_watch AS
SELECT
    cr.id,
    cr.type,
    cr.reference,
    cr.expiry_date,
    (cr.expiry_date - CURRENT_DATE)         AS days_remaining,
    compliance_statut_effectif(cr.status::text, cr.expiry_date)::compliance_status AS status,
    cr.is_blocking,
    cr.expiry_alert_sent_at,
    CASE
        WHEN cr.partner_id IS NOT NULL THEN 'PARTNER'
        WHEN cr.vehicle_id IS NOT NULL THEN 'VEHICLE'
        ELSE 'DRIVER'
    END                                      AS owner_kind,
    COALESCE(p.legal_name, v.registration, d.full_name) AS owner_label,
    COALESCE(cr.partner_id, cr.vehicle_id, cr.driver_id) AS owner_id
  FROM compliance_records cr
  LEFT JOIN partners p ON p.id = cr.partner_id
  LEFT JOIN vehicles v ON v.id = cr.vehicle_id
  LEFT JOIN drivers  d ON d.id = cr.driver_id
 WHERE cr.expiry_date IS NOT NULL
   AND cr.status::text IN ('VALID', 'EXPIRING', 'EXPIRED')

UNION ALL

-- Un agrément d'entreprise engage l'exploitation entière, pas une seule
-- opération : traité comme BLOQUANT par construction, pour qu'il ressorte
-- même quand l'échéancier ne montre que les pièces bloquantes.
SELECT
    ca.id,
    ca.type,
    ca.reference,
    ca.expiry_date,
    (ca.expiry_date - CURRENT_DATE),
    compliance_statut_effectif(ca.status::text, ca.expiry_date)::compliance_status,
    true,
    ca.expiry_alert_sent_at,
    'ENTREPRISE',
    'Elyon Trading',
    NULL
  FROM company_accreditations ca
 WHERE ca.expiry_date IS NOT NULL
   AND ca.status::text IN ('VALID', 'EXPIRING', 'EXPIRED')

 ORDER BY expiry_date;

COMMENT ON VIEW v_compliance_expiry_watch IS
  'Échéancier des pièces légales et de conformité, tiers/moyens ET entreprise — SPECIFICATIONS.md § 6.6.';
