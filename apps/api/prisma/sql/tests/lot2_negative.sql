-- ===========================================================================
--  TESTS NÉGATIFS — LOT 2
--
--  Une contrainte qui s'applique sans mordre ne vaut rien. Ce script tente de
--  VIOLER chaque invariant et vérifie que la base refuse.
--
--  Exécuté dans une transaction annulée : il ne laisse aucune trace.
--  Lancé avec le rôle PROPRIÉTAIRE — donc rien ici ne passe par les
--  privilèges : ce sont bien les règles métier qui bloquent.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION _t(label text, stmt text) RETURNS text AS $f$
BEGIN
  EXECUTE stmt;
  RETURN '*** ACCEPTE — DEFAUT ***  ' || label;
EXCEPTION WHEN others THEN
  RETURN 'refuse OK  |  ' || label;
END; $f$ LANGUAGE plpgsql;

-- Variante pour les cas qui doivent RÉUSSIR.
CREATE OR REPLACE FUNCTION _p(label text, stmt text) RETURNS text AS $f$
BEGIN
  EXECUTE stmt;
  RETURN 'accepte OK |  ' || label;
EXCEPTION WHEN others THEN
  RETURN '*** REFUSE — DEFAUT ***  ' || label || ' :: ' || SQLERRM;
END; $f$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
--  Mise en place : un prix fournisseur validé par le DG, et un deal conforme.
-- ---------------------------------------------------------------------------

INSERT INTO supplier_prices
  (id, supplier_id, product_id, unit_price, currency_code, uom, pricing_method,
   source_label, effective_from, validated_by_id, validated_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   (SELECT id FROM partners WHERE code = 'SUP-SIR'),
   (SELECT id FROM products WHERE code = 'DIESEL'),
   700, 'XOF', 'L', 'Prix administré SIR', 'SIR', CURRENT_DATE,
   (SELECT id FROM users WHERE role = 'DG'), now(), now());

INSERT INTO deals
  (id, reference, client_id, product_id, owner_id, status, segment,
   contracted_volume, uom, transport_mode, delivery_location, currency_code,
   supplier_price_id, unit_purchase_price, unit_sale_price, documentary_regime, updated_at)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'DEAL-TEST-001',
   (SELECT id FROM partners WHERE code = 'CLI-002'),
   (SELECT id FROM products WHERE code = 'DIESEL'),
   (SELECT id FROM users WHERE role = 'SALES_REP'),
   'QUOTED', 'B2B', 3000, 'L', 'TRUCK', 'Dépôt de Bouaké', 'XOF',
   '11111111-1111-1111-1111-111111111111', 700, 780, 'PROFORMA_THEN_FNE', now());

\echo ''
\echo '=== A. PRIX D''ACHAT — jamais libre ==='
SELECT _t('Prix fournisseur valide par le CFO (DG seul)',
  $s$INSERT INTO supplier_prices (id,supplier_id,product_id,unit_price,currency_code,uom,
     pricing_method,source_label,effective_from,validated_by_id,validated_at,updated_at)
     VALUES (gen_random_uuid(),(SELECT id FROM partners WHERE code='SUP-SIR'),
     (SELECT id FROM products WHERE code='MGO'),500,'XOF','L','x','SIR',CURRENT_DATE,
     (SELECT id FROM users WHERE role='FINANCE_CFO'),now(),now())$s$)
UNION ALL SELECT _t('Modification du prix d''une ligne deja validee',
  $s$UPDATE supplier_prices SET unit_price = 650
     WHERE id = '11111111-1111-1111-1111-111111111111'$s$)
UNION ALL SELECT _p('Cloture de periode sur une ligne validee (autorisee)',
  $s$UPDATE supplier_prices SET effective_to = CURRENT_DATE + 30
     WHERE id = '11111111-1111-1111-1111-111111111111'$s$)
UNION ALL SELECT _t('Deal avec prix d''achat libre, sans prix fournisseur',
  $s$INSERT INTO deals (id,reference,client_id,product_id,status,segment,contracted_volume,
     uom,transport_mode,delivery_location,currency_code,unit_purchase_price,documentary_regime,updated_at)
     VALUES (gen_random_uuid(),'DEAL-KO-1',(SELECT id FROM partners WHERE code='CLI-002'),
     (SELECT id FROM products WHERE code='DIESEL'),'DRAFT','B2B',100,'L','TRUCK','X','XOF',
     999,'PROFORMA_THEN_FNE',now())$s$)
UNION ALL SELECT _t('Deal dont le prix d''achat diverge du prix fournisseur',
  $s$UPDATE deals SET unit_purchase_price = 600
     WHERE id = '22222222-2222-2222-2222-222222222222'$s$)
UNION ALL SELECT _t('Deal adosse a un prix fournisseur d''un autre produit',
  $s$INSERT INTO deals (id,reference,client_id,product_id,status,segment,contracted_volume,
     uom,transport_mode,delivery_location,currency_code,supplier_price_id,unit_purchase_price,
     documentary_regime,updated_at)
     VALUES (gen_random_uuid(),'DEAL-KO-2',(SELECT id FROM partners WHERE code='CLI-002'),
     (SELECT id FROM products WHERE code='GASOLINE'),'DRAFT','B2B',100,'L','TRUCK','X','XOF',
     '11111111-1111-1111-1111-111111111111',700,'PROFORMA_THEN_FNE',now())$s$);

\echo ''
\echo '=== B. APPROBATION ==='
SELECT _t('Approbation financiere par le CCOO',
  $s$UPDATE deals SET credit_approved_by_id=(SELECT id FROM users WHERE role='CCOO'),
     credit_approved_at=now() WHERE id='22222222-2222-2222-2222-222222222222'$s$)
UNION ALL SELECT _t('Derogation de marge accordee par le CFO',
  $s$UPDATE deals SET dg_approved_by_id=(SELECT id FROM users WHERE role='FINANCE_CFO'),
     dg_approved_at=now() WHERE id='22222222-2222-2222-2222-222222222222'$s$)
UNION ALL SELECT _p('Approbation financiere par le CFO',
  $s$UPDATE deals SET credit_approved_by_id=(SELECT id FROM users WHERE role='FINANCE_CFO'),
     credit_approved_at=now(), status='APPROVED'
     WHERE id='22222222-2222-2222-2222-222222222222'$s$);

\echo ''
\echo '=== C. MODIFICATION DE PRIX APRES APPROBATION ==='
SELECT _p('Changement du prix de vente (doit passer ET annuler l''approbation)',
  $s$UPDATE deals SET unit_sale_price = 760 WHERE id='22222222-2222-2222-2222-222222222222'$s$);
SELECT CASE WHEN credit_approved_by_id IS NULL AND status::text='PENDING_RISK'
            THEN 'refuse OK  |  Approbation annulee et statut ramene a PENDING_RISK'
            ELSE '*** DEFAUT *** approbation conservee malgre le changement de prix' END
  FROM deals WHERE id='22222222-2222-2222-2222-222222222222';

\echo ''
\echo '=== D. VERROU FINANCIER ==='
SELECT _t('Operation sur un deal non approuve',
  $s$INSERT INTO operations (id,reference,deal_id,phase,sourcing_mode,planned_volume,uom,
     transport_mode,origin_location,destination_location,updated_at)
     VALUES (gen_random_uuid(),'OP-KO-1','22222222-2222-2222-2222-222222222222','PREPARATION',
     'BACK_TO_BACK',3000,'L','TRUCK','Abidjan','Bouake',now())$s$);

-- On rapprouve pour la suite des tests.
UPDATE deals SET credit_approved_by_id=(SELECT id FROM users WHERE role='FINANCE_CFO'),
       credit_approved_at=now(), status='APPROVED'
 WHERE id='22222222-2222-2222-2222-222222222222';

INSERT INTO operations (id,reference,deal_id,phase,sourcing_mode,planned_volume,uom,
  transport_mode,origin_location,destination_location,hse_risk_level,updated_at)
VALUES ('33333333-3333-3333-3333-333333333333','OP-TEST-001',
  '22222222-2222-2222-2222-222222222222','PREPARATION','BACK_TO_BACK',3000,'L','TRUCK',
  'Abidjan','Bouake','STANDARD',now());

\echo ''
\echo '=== E. VERROU HSE ==='
-- L'étape suivante IMMÉDIATE (PRE_CHARGEMENT) : l'ordre strict refuserait
-- aussi un saut plus loin, ce qui ne testerait plus le verrou HSE lui-même.
SELECT _t('Chargement sans validation HSE',
  $s$UPDATE operations SET phase='PRE_CHARGEMENT' WHERE id='33333333-3333-3333-3333-333333333333'$s$)
UNION ALL SELECT _t('Validation HSE par un AGENT (controleur seul)',
  $s$INSERT INTO operation_hse_checks (id,operation_id,template_id,template_version,phase,
     validated_by_field_user_id,validated_at,updated_at)
     VALUES (gen_random_uuid(),'33333333-3333-3333-3333-333333333333',
     (SELECT id FROM hse_checklist_templates LIMIT 1),1,'PREPARATION',
     (SELECT id FROM field_users WHERE role='FIELD_AGENT'),now(),now())$s$)
UNION ALL SELECT _t('Suppleance HSE par le CFO (DG seul)',
  $s$INSERT INTO operation_hse_checks (id,operation_id,template_id,template_version,phase,
     validated_by_user_id,validated_at,updated_at)
     VALUES (gen_random_uuid(),'33333333-3333-3333-3333-333333333333',
     (SELECT id FROM hse_checklist_templates LIMIT 1),1,'CHARGEMENT',
     (SELECT id FROM users WHERE role='FINANCE_CFO'),now(),now())$s$);

\echo ''
\echo '=== F. VERROU DE CONFORMITE ==='
SELECT _t('Affectation du vehicule au controle technique expire',
  $s$INSERT INTO operation_assignments (id,operation_id,vehicle_id,updated_at)
     VALUES (gen_random_uuid(),'33333333-3333-3333-3333-333333333333',
     (SELECT id FROM vehicles WHERE registration='CI-7734-CD'),now())$s$)
UNION ALL SELECT _p('Affectation d''un vehicule conforme',
  $s$INSERT INTO operation_assignments (id,operation_id,vehicle_id,updated_at)
     VALUES (gen_random_uuid(),'33333333-3333-3333-3333-333333333333',
     (SELECT id FROM vehicles WHERE registration='CI-4821-AB'),now())$s$);

\echo ''
\echo '=== G. CHAINE DE FACTURATION ==='
SELECT _t('Brut different de volume x prix',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-1','PROFORMA','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',99999,99999,'XOF',now())$s$)
UNION ALL SELECT _t('Total different de brut moins reduction',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,discount_amount,total_amount,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-2','PROFORMA','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,5000,80000,'XOF',now())$s$)
UNION ALL SELECT _t('TVA sans la case applicable',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,vat_amount,is_vat_applicable,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-3','FNE','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,5000,false,'XOF',now())$s$)
UNION ALL SELECT _t('TVA mal extraite (ajoutee au lieu d''extraite)',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,vat_amount,vat_rate_pct,is_vat_applicable,
     document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-4','FNE','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,14400,18,true,'XOF',now())$s$)
UNION ALL SELECT _p('TVA correctement extraite : 80000 x 18 / 118 = 12203,39',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,vat_amount,vat_rate_pct,is_vat_applicable,
     document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-OK-1','FNE','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,12203.3898,18,true,'XOF',now())$s$)
UNION ALL SELECT _t('Avoir sans facture d''origine',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'AV-KO-1','CREDIT_NOTE','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,'XOF',now())$s$)
UNION ALL SELECT _t('Proforma portant un encaissement',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,paid_amount,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-5','PROFORMA','DRAFT','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,50000,'XOF',now())$s$)
UNION ALL SELECT _t('Facture simple emise sans decision motivee',
  $s$INSERT INTO invoices (id,number,type,status,deal_id,partner_id,billed_volume,uom,unit_price,
     currency_code,gross_amount,total_amount,document_currency_code,updated_at)
     VALUES (gen_random_uuid(),'F-KO-6','SIMPLE','ISSUED','22222222-2222-2222-2222-222222222222',
     (SELECT id FROM partners WHERE code='CLI-002'),100,'L',800,'XOF',80000,80000,'XOF',now())$s$);

\echo ''
\echo '=== H. RELEVES ET DOCUMENTS ==='
-- ⚠️ CORRIGÉ (§ 25/08/2026) — un relevé ne porte plus qu'un seul bout
--   (chargement OU livraison) ; l'écart se rapproche entre deux lignes,
--   via paired_measurement_id / paired_loaded_volume_15 sur la ligne qui
--   referme la paire (§ H ci-dessus dans le schéma).
SELECT _p('Releve de chargement authoritatif, seul (pas encore rapproche)',
  $s$INSERT INTO measurement_records (id,reference,operation_id,phase,source,is_authoritative,
     measurement_date,observed_volume,observed_temp_c,vcf,volume_15,uom,measured_density_15,updated_at)
     VALUES ('44444444-4444-4444-4444-444444444441','MR-OK-1',
     '33333333-3333-3333-3333-333333333333','CHARGEMENT','CONTRADICTORY',true,CURRENT_DATE,
     3000,28,1,3000,'L',0.84,now())$s$)
UNION ALL SELECT _t('Ecart d''ullage mal calcule (rapproche a une valeur fausse)',
  $s$INSERT INTO measurement_records (id,reference,operation_id,phase,source,measurement_date,
     observed_volume,observed_temp_c,vcf,volume_15,uom,measured_density_15,
     paired_measurement_id,paired_loaded_volume_15,ullage_variance_pct,updated_at)
     VALUES (gen_random_uuid(),'MR-KO-1','33333333-3333-3333-3333-333333333333','DECHARGEMENT',
     'CONTRADICTORY',CURRENT_DATE,2990,29,1,2990,'L',0.84,
     '44444444-4444-4444-4444-444444444441',3000,99,now())$s$)
UNION ALL SELECT _p('Ecart correctement calcule : (3000-2990)/3000 = 0,333333 %',
  $s$INSERT INTO measurement_records (id,reference,operation_id,phase,source,is_authoritative,
     measurement_date,observed_volume,observed_temp_c,vcf,volume_15,uom,measured_density_15,
     paired_measurement_id,paired_loaded_volume_15,ullage_variance_pct,updated_at)
     VALUES ('44444444-4444-4444-4444-444444444442','MR-OK-2',
     '33333333-3333-3333-3333-333333333333','DECHARGEMENT','CONTRADICTORY',true,CURRENT_DATE,
     2990,29,1,2990,'L',0.84,
     '44444444-4444-4444-4444-444444444441',3000,0.333333,now())$s$)
UNION ALL SELECT _t('Deuxieme releve faisant autorite sur la meme etape (DECHARGEMENT) de la meme operation',
  $s$INSERT INTO measurement_records (id,reference,operation_id,phase,source,is_authoritative,
     measurement_date,observed_volume,observed_temp_c,vcf,volume_15,uom,measured_density_15,updated_at)
     VALUES (gen_random_uuid(),'MR-KO-2b','33333333-3333-3333-3333-333333333333','DECHARGEMENT',
     'SELF_MEASURED',true,CURRENT_DATE,2985,29,1,2985,'L',0.84,now())$s$)
UNION ALL SELECT _t('Acquittement d''ecart par un role non habilite (SALES_REP)',
  $s$UPDATE measurement_records SET ullage_ack_by_id=(SELECT id FROM users WHERE role='SALES_REP'),
     ullage_ack_at=now(), ullage_ack_reason='Motif suffisamment long pour passer'
     WHERE id='44444444-4444-4444-4444-444444444442'$s$)
UNION ALL SELECT _t('Signature sans qualite du signataire',
  $s$INSERT INTO signatures (id,document_id,kind,signatory_name,signatory_capacity)
     VALUES (gen_random_uuid(),
     (SELECT id FROM generated_documents LIMIT 1),'DRIVER','Kouassi','')$s$);

ROLLBACK;
