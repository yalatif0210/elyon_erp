-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "deal_status" AS ENUM ('DRAFT', 'FEASIBILITY_STUDY', 'QUOTED', 'PENDING_RISK', 'CREDIT_BLOCKED', 'PENDING_DG_APPROVAL', 'APPROVED', 'PROFORMA_SENT', 'CUSTOMER_ACCEPTED', 'REJECTED_BY_CLIENT', 'IN_EXECUTION', 'DELIVERED', 'PARTIALLY_DELIVERED', 'QUALITY_CLAIM', 'INVOICED', 'DISPUTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "operation_status" AS ENUM ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'HSE_BLOCKED', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED', 'INCIDENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sourcing_mode" AS ENUM ('BACK_TO_BACK', 'FROM_STOCK', 'THIRD_PARTY_PRODUCT');

-- CreateEnum
CREATE TYPE "pricing_formula" AS ENUM ('MARITIME_EXEMPT_HT', 'MARITIME_TTC', 'B2B_FULL_COST', 'RETAIL_CESSION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "discount_mode" AS ENUM ('PER_UNIT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'ISSUED', 'CONFIRMED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "measurement_source" AS ENUM ('INDEPENDENT_INSPECTION', 'CONTRADICTORY', 'SELF_MEASURED');

-- CreateEnum
CREATE TYPE "hse_check_outcome" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "hse_event_type" AS ENUM ('INCIDENT', 'ACCIDENT', 'SPILL', 'NEAR_MISS', 'DANGEROUS_OBSERVATION', 'NON_CONFORMITY');

-- CreateEnum
CREATE TYPE "hse_severity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "hse_event_status" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'ACTION_IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "invoice_type" AS ENUM ('PROFORMA', 'SIMPLE', 'FNE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fne_status" AS ENUM ('NOT_APPLICABLE', 'DRAFT', 'TO_VALIDATE', 'PENDING_TRANSMISSION', 'TRANSMITTED', 'ACCEPTED', 'REJECTED', 'TO_CORRECT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "supplier_invoice_status" AS ENUM ('EXPECTED', 'RECEIVED', 'APPROVED', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "guarantee_type" AS ENUM ('LETTER_OF_CREDIT', 'DOWN_PAYMENT', 'BANK_GUARANTEE');

-- CreateEnum
CREATE TYPE "guarantee_status" AS ENUM ('PENDING', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "signatory_kind" AS ENUM ('INTERNAL_USER', 'FIELD_USER', 'PORTAL_USER', 'DRIVER', 'CLIENT_REPRESENTATIVE', 'INSPECTOR', 'OTHER_EXTERNAL');

-- CreateEnum
CREATE TYPE "generated_document_kind" AS ENUM ('PROFORMA', 'INVOICE', 'CREDIT_NOTE', 'DELIVERY_NOTE', 'OPERATION_REPORT', 'TRANSPORT_ORDER', 'MEASUREMENT_REPORT');

-- AlterEnum
BEGIN;
CREATE TYPE "price_reference_type_new" AS ENUM ('SIR', 'PUMP', 'SUPPLIER', 'CONTRACTUAL');
ALTER TABLE "administered_prices" ALTER COLUMN "reference_type" TYPE "price_reference_type_new" USING ("reference_type"::text::"price_reference_type_new");
ALTER TYPE "price_reference_type" RENAME TO "price_reference_type_old";
ALTER TYPE "price_reference_type_new" RENAME TO "price_reference_type";
DROP TYPE "price_reference_type_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "price_assessments" DROP CONSTRAINT "price_assessments_price_index_id_fkey";

-- DropForeignKey
ALTER TABLE "price_indices" DROP CONSTRAINT "price_indices_currency_code_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_default_price_index_id_fkey";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "default_price_index_id";

-- DropTable
DROP TABLE "price_assessments";

-- DropTable
DROP TABLE "price_indices";

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "client_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
    "segment" "commercial_segment" NOT NULL,
    "pricing_formula" "pricing_formula" NOT NULL,
    "payment_terms_days" SMALLINT,
    "currency_code" CHAR(3) NOT NULL,
    "committed_volume" DECIMAL(18,6),
    "volume_uom" "unit_of_measure",
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "owner_id" UUID,
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "contract_id" UUID,
    "client_id" UUID NOT NULL,
    "site_id" UUID,
    "product_id" UUID NOT NULL,
    "owner_id" UUID,
    "status" "deal_status" NOT NULL DEFAULT 'DRAFT',
    "segment" "commercial_segment" NOT NULL,
    "contracted_volume" DECIMAL(18,6) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "incoterm" VARCHAR(8),
    "transport_mode" "transport_mode" NOT NULL,
    "delivery_location" VARCHAR(200) NOT NULL,
    "target_delivery_date" DATE,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fx_rate_id" UUID,
    "fx_rate_date" DATE,
    "unit_sale_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sale_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_purchase_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "purchase_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_direct_charges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_indirect_charges" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_carrying_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_direct_margin" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimated_full_margin" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "realized_direct_margin" DECIMAL(18,4),
    "realized_full_margin" DECIMAL(18,4),
    "sale_amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_approved_by_id" UUID,
    "credit_approved_at" TIMESTAMPTZ(3),
    "credit_exposure_at_approval" DECIMAL(18,4),
    "dg_approved_by_id" UUID,
    "dg_approved_at" TIMESTAMPTZ(3),
    "margin_derogation_id" UUID,
    "accepted_by_portal_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "documentary_regime" "documentary_regime" NOT NULL DEFAULT 'PROFORMA_THEN_FNE',
    "fne_exclusion_reason" VARCHAR(1000),
    "cancellation_reason" VARCHAR(1000),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_pricings" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "formula" "pricing_formula" NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "formula_override_reason" VARCHAR(1000),
    "unit_price" DECIMAL(18,4) NOT NULL,
    "reference_price_id" UUID,
    "discount_mode" "discount_mode",
    "discount_value" DECIMAL(18,4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_pricings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_status_transitions" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_status" "deal_status",
    "to_status" "deal_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "deal_id" UUID NOT NULL,
    "status" "operation_status" NOT NULL DEFAULT 'DRAFT',
    "sourcing_mode" "sourcing_mode" NOT NULL DEFAULT 'BACK_TO_BACK',
    "product_owner_id" UUID,
    "planned_volume" DECIMAL(18,6) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "transport_mode" "transport_mode" NOT NULL,
    "origin_location" VARCHAR(200) NOT NULL,
    "destination_site_id" UUID,
    "destination_location" VARCHAR(200) NOT NULL,
    "planned_loading_date" DATE,
    "actual_loading_date" DATE,
    "actual_discharge_date" DATE,
    "bill_of_lading_date" DATE,
    "hse_risk_level" "hse_risk_level" NOT NULL DEFAULT 'STANDARD',
    "hse_validated_by_id" UUID,
    "hse_validated_at" TIMESTAMPTZ(3),
    "hse_validated_by_user_id" UUID,
    "hse_derogation_id" UUID,
    "field_agent_id" UUID,
    "coordinator_id" UUID,
    "cancellation_reason" VARCHAR(1000),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_status_transitions" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "from_status" "operation_status",
    "to_status" "operation_status" NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(1000),
    "device_timestamp" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_assignments" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "carrier_id" UUID,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "vehicle_identifier" VARCHAR(120),
    "freight_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "compliance_derogation_id" UUID,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "operation_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "ordered_volume" DECIMAL(18,6) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "supplier_price_id" UUID,
    "loading_port" VARCHAR(200),
    "expected_date" DATE,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_hse_checks" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" SMALLINT NOT NULL,
    "phase" "operation_phase" NOT NULL,
    "validated_by_field_user_id" UUID,
    "validated_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "validated_remotely" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operation_hse_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_hse_check_items" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "level" "hse_control_level" NOT NULL,
    "outcome" "hse_check_outcome" NOT NULL DEFAULT 'PENDING',
    "recorded_value" VARCHAR(500),
    "comment" VARCHAR(1000),
    "recorded_by_field_user_id" UUID,
    "recorded_at" TIMESTAMPTZ(3),
    "device_timestamp" TIMESTAMPTZ(3),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operation_hse_check_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_events" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "operation_id" UUID,
    "type" "hse_event_type" NOT NULL,
    "severity" "hse_severity" NOT NULL,
    "status" "hse_event_status" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "location" VARCHAR(200),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "auto_opened" BOOLEAN NOT NULL DEFAULT false,
    "declared_by_field_user_id" UUID,
    "declared_by_user_id" UUID,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closure_evidence" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hse_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_corrective_actions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "is_preventive" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "due_date" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "evidence" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hse_corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_attachments" (
    "id" UUID NOT NULL,
    "client_uuid" UUID NOT NULL,
    "check_item_id" UUID,
    "hse_event_id" UUID,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "caption" VARCHAR(500),
    "captured_at" TIMESTAMPTZ(3),
    "device_timestamp" TIMESTAMPTZ(3),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_records" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(24) NOT NULL,
    "operation_id" UUID NOT NULL,
    "source" "measurement_source" NOT NULL,
    "is_authoritative" BOOLEAN NOT NULL DEFAULT false,
    "inspector_id" UUID,
    "measurement_date" DATE NOT NULL,
    "loaded_volume_15" DECIMAL(18,6) NOT NULL,
    "discharged_volume_15" DECIMAL(18,6) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "observed_volume" DECIMAL(18,6),
    "observed_temp_c" DECIMAL(6,2),
    "measured_density_15" DECIMAL(9,6) NOT NULL,
    "viscosity_cst" DECIMAL(9,3),
    "sulphur_pct" DECIMAL(6,4),
    "water_and_sediment_pct" DECIMAL(6,4),
    "flash_point_c" DECIMAL(6,2),
    "is_off_spec" BOOLEAN NOT NULL DEFAULT false,
    "ullage_variance_pct" DECIMAL(9,6) NOT NULL,
    "tolerance_id" UUID,
    "alert_threshold_pct" DECIMAL(9,6),
    "critical_threshold_pct" DECIMAL(9,6),
    "ullage_alert_triggered" BOOLEAN NOT NULL DEFAULT false,
    "ullage_critical_triggered" BOOLEAN NOT NULL DEFAULT false,
    "ullage_ack_by_id" UUID,
    "ullage_ack_at" TIMESTAMPTZ(3),
    "ullage_ack_reason" VARCHAR(1000),
    "ullage_derogation_id" UUID,
    "hse_event_id" UUID,
    "entered_by_field_user_id" UUID,
    "entered_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "measurement_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_cost_lines" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "cost_post_id" UUID NOT NULL,
    "description" VARCHAR(255),
    "supplier_id" UUID,
    "estimated_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actual_amount" DECIMAL(18,4),
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "is_system_computed" BOOLEAN NOT NULL DEFAULT false,
    "allocation_ratio" DECIMAL(9,6),
    "incurred_at" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "supplier_invoice_id" UUID,

    CONSTRAINT "operation_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "type" "invoice_type" NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "deal_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "measurement_id" UUID,
    "corrected_invoice_id" UUID,
    "source_proforma_id" UUID,
    "billed_volume" DECIMAL(18,6) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "net_amount" DECIMAL(18,4) NOT NULL,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fx_rate_date" DATE,
    "total_amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "document_currency_code" CHAR(3) NOT NULL,
    "document_fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "document_fx_rate_id" UUID,
    "document_net_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "document_tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "document_total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fiscal_country_code" CHAR(2) NOT NULL DEFAULT 'CI',
    "tax_code" VARCHAR(24),
    "tax_rate_pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "is_vat_exempt" BOOLEAN NOT NULL DEFAULT false,
    "vat_exemption_reference" VARCHAR(120),
    "simple_invoice_decided_by_id" UUID,
    "simple_invoice_decided_at" TIMESTAMPTZ(3),
    "simple_invoice_reason" VARCHAR(1000),
    "issue_date" DATE,
    "due_date" DATE,
    "authenticity_token" VARCHAR(64),
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fne_transmissions" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "status" "fne_status" NOT NULL DEFAULT 'DRAFT',
    "fiscal_reference" VARCHAR(64),
    "fiscal_qr_payload" VARCHAR(2000),
    "transmitted_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_code" VARCHAR(64),
    "rejection_reason" VARCHAR(1000),
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fne_transmissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "direction" "payment_direction" NOT NULL,
    "partner_id" UUID NOT NULL,
    "invoice_id" UUID,
    "supplier_invoice_id" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value_date" DATE NOT NULL,
    "bank_reference" VARCHAR(120),
    "notes" VARCHAR(1000),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "status" "supplier_invoice_status" NOT NULL DEFAULT 'EXPECTED',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "prepaid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "prepaid_amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "prepaid_at" DATE,
    "settled_at" DATE,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guarantees" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "partner_id" UUID NOT NULL,
    "deal_id" UUID,
    "type" "guarantee_type" NOT NULL,
    "status" "guarantee_status" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "fx_rate_to_pivot" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount_pivot" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "issuing_bank" VARCHAR(200),
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "kind" "generated_document_kind" NOT NULL,
    "reference" VARCHAR(48) NOT NULL,
    "deal_id" UUID,
    "operation_id" UUID,
    "invoice_id" UUID,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "authenticity_token" VARCHAR(64) NOT NULL,
    "is_sealed" BOOLEAN NOT NULL DEFAULT false,
    "sealed_at" TIMESTAMPTZ(3),
    "supersedes_id" UUID,
    "supersession_reason" VARCHAR(1000),
    "generated_by_id" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "kind" "signatory_kind" NOT NULL,
    "user_id" UUID,
    "field_user_id" UUID,
    "driver_id" UUID,
    "signatory_name" VARCHAR(160) NOT NULL,
    "signatory_capacity" VARCHAR(160) NOT NULL,
    "id_document_ref" VARCHAR(64),
    "signature_storage_key" VARCHAR(512),
    "signature_sha256" CHAR(64),
    "device_timestamp" TIMESTAMPTZ(3),
    "server_timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_reference_key" ON "contracts"("reference");

-- CreateIndex
CREATE INDEX "contracts_client_id_status_idx" ON "contracts"("client_id", "status");

-- CreateIndex
CREATE INDEX "contracts_status_end_date_idx" ON "contracts"("status", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "deals_reference_key" ON "deals"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "deals_margin_derogation_id_key" ON "deals"("margin_derogation_id");

-- CreateIndex
CREATE INDEX "deals_status_created_at_idx" ON "deals"("status", "created_at");

-- CreateIndex
CREATE INDEX "deals_client_id_status_idx" ON "deals"("client_id", "status");

-- CreateIndex
CREATE INDEX "deals_owner_id_status_idx" ON "deals"("owner_id", "status");

-- CreateIndex
CREATE INDEX "deals_segment_status_idx" ON "deals"("segment", "status");

-- CreateIndex
CREATE INDEX "deals_contract_id_idx" ON "deals"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_pricings_deal_id_key" ON "deal_pricings"("deal_id");

-- CreateIndex
CREATE INDEX "deal_pricings_formula_idx" ON "deal_pricings"("formula");

-- CreateIndex
CREATE INDEX "deal_status_transitions_deal_id_created_at_idx" ON "deal_status_transitions"("deal_id", "created_at");

-- CreateIndex
CREATE INDEX "deal_status_transitions_to_status_created_at_idx" ON "deal_status_transitions"("to_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "operations_reference_key" ON "operations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "operations_hse_derogation_id_key" ON "operations"("hse_derogation_id");

-- CreateIndex
CREATE INDEX "operations_deal_id_status_idx" ON "operations"("deal_id", "status");

-- CreateIndex
CREATE INDEX "operations_status_planned_loading_date_idx" ON "operations"("status", "planned_loading_date");

-- CreateIndex
CREATE INDEX "operations_field_agent_id_status_idx" ON "operations"("field_agent_id", "status");

-- CreateIndex
CREATE INDEX "operations_hse_risk_level_status_idx" ON "operations"("hse_risk_level", "status");

-- CreateIndex
CREATE INDEX "operation_status_transitions_operation_id_created_at_idx" ON "operation_status_transitions"("operation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "operation_assignments_operation_id_key" ON "operation_assignments"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_assignments_compliance_derogation_id_key" ON "operation_assignments"("compliance_derogation_id");

-- CreateIndex
CREATE INDEX "operation_assignments_carrier_id_idx" ON "operation_assignments"("carrier_id");

-- CreateIndex
CREATE INDEX "operation_assignments_vehicle_id_idx" ON "operation_assignments"("vehicle_id");

-- CreateIndex
CREATE INDEX "operation_assignments_driver_id_idx" ON "operation_assignments"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_reference_key" ON "purchase_orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_operation_id_key" ON "purchase_orders"("operation_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_status_idx" ON "purchase_orders"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_status_expected_date_idx" ON "purchase_orders"("status", "expected_date");

-- CreateIndex
CREATE INDEX "operation_hse_checks_operation_id_idx" ON "operation_hse_checks"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_hse_checks_operation_id_phase_key" ON "operation_hse_checks"("operation_id", "phase");

-- CreateIndex
CREATE INDEX "operation_hse_check_items_check_id_outcome_idx" ON "operation_hse_check_items"("check_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "operation_hse_check_items_check_id_item_id_key" ON "operation_hse_check_items"("check_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "hse_events_reference_key" ON "hse_events"("reference");

-- CreateIndex
CREATE INDEX "hse_events_status_severity_idx" ON "hse_events"("status", "severity");

-- CreateIndex
CREATE INDEX "hse_events_operation_id_idx" ON "hse_events"("operation_id");

-- CreateIndex
CREATE INDEX "hse_events_type_occurred_at_idx" ON "hse_events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "hse_corrective_actions_event_id_idx" ON "hse_corrective_actions"("event_id");

-- CreateIndex
CREATE INDEX "hse_corrective_actions_due_date_completed_at_idx" ON "hse_corrective_actions"("due_date", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "operation_attachments_client_uuid_key" ON "operation_attachments"("client_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "operation_attachments_storage_key_key" ON "operation_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "operation_attachments_check_item_id_idx" ON "operation_attachments"("check_item_id");

-- CreateIndex
CREATE INDEX "operation_attachments_hse_event_id_idx" ON "operation_attachments"("hse_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_records_reference_key" ON "measurement_records"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_records_ullage_derogation_id_key" ON "measurement_records"("ullage_derogation_id");

-- CreateIndex
CREATE INDEX "measurement_records_operation_id_measurement_date_idx" ON "measurement_records"("operation_id", "measurement_date");

-- CreateIndex
CREATE INDEX "measurement_records_ullage_alert_triggered_ullage_ack_at_idx" ON "measurement_records"("ullage_alert_triggered", "ullage_ack_at");

-- CreateIndex
CREATE INDEX "measurement_records_source_is_authoritative_idx" ON "measurement_records"("source", "is_authoritative");

-- CreateIndex
CREATE INDEX "operation_cost_lines_operation_id_cost_post_id_idx" ON "operation_cost_lines"("operation_id", "cost_post_id");

-- CreateIndex
CREATE INDEX "operation_cost_lines_supplier_id_idx" ON "operation_cost_lines"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_authenticity_token_key" ON "invoices"("authenticity_token");

-- CreateIndex
CREATE INDEX "invoices_deal_id_type_idx" ON "invoices"("deal_id", "type");

-- CreateIndex
CREATE INDEX "invoices_partner_id_status_idx" ON "invoices"("partner_id", "status");

-- CreateIndex
CREATE INDEX "invoices_due_date_status_idx" ON "invoices"("due_date", "status");

-- CreateIndex
CREATE INDEX "invoices_type_status_idx" ON "invoices"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fne_transmissions_invoice_id_key" ON "fne_transmissions"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "fne_transmissions_fiscal_reference_key" ON "fne_transmissions"("fiscal_reference");

-- CreateIndex
CREATE INDEX "fne_transmissions_status_transmitted_at_idx" ON "fne_transmissions"("status", "transmitted_at");

-- CreateIndex
CREATE INDEX "payments_partner_id_value_date_idx" ON "payments"("partner_id", "value_date");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_supplier_invoice_id_idx" ON "payments"("supplier_invoice_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_status_due_date_idx" ON "supplier_invoices"("status", "due_date");

-- CreateIndex
CREATE INDEX "supplier_invoices_supplier_id_status_idx" ON "supplier_invoices"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "supplier_invoices_prepaid_at_settled_at_idx" ON "supplier_invoices"("prepaid_at", "settled_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplier_id_reference_key" ON "supplier_invoices"("supplier_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "guarantees_reference_key" ON "guarantees"("reference");

-- CreateIndex
CREATE INDEX "guarantees_partner_id_status_idx" ON "guarantees"("partner_id", "status");

-- CreateIndex
CREATE INDEX "guarantees_status_expiry_date_idx" ON "guarantees"("status", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_reference_key" ON "generated_documents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_storage_key_key" ON "generated_documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_authenticity_token_key" ON "generated_documents"("authenticity_token");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_supersedes_id_key" ON "generated_documents"("supersedes_id");

-- CreateIndex
CREATE INDEX "generated_documents_kind_generated_at_idx" ON "generated_documents"("kind", "generated_at");

-- CreateIndex
CREATE INDEX "generated_documents_deal_id_idx" ON "generated_documents"("deal_id");

-- CreateIndex
CREATE INDEX "generated_documents_operation_id_idx" ON "generated_documents"("operation_id");

-- CreateIndex
CREATE INDEX "signatures_document_id_idx" ON "signatures"("document_id");

-- CreateIndex
CREATE INDEX "signatures_kind_idx" ON "signatures"("kind");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "partner_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_fx_rate_id_fkey" FOREIGN KEY ("fx_rate_id") REFERENCES "fx_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_credit_approved_by_id_fkey" FOREIGN KEY ("credit_approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_dg_approved_by_id_fkey" FOREIGN KEY ("dg_approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_margin_derogation_id_fkey" FOREIGN KEY ("margin_derogation_id") REFERENCES "derogations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_accepted_by_portal_user_id_fkey" FOREIGN KEY ("accepted_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_pricings" ADD CONSTRAINT "deal_pricings_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_pricings" ADD CONSTRAINT "deal_pricings_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_pricings" ADD CONSTRAINT "deal_pricings_reference_price_id_fkey" FOREIGN KEY ("reference_price_id") REFERENCES "administered_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_status_transitions" ADD CONSTRAINT "deal_status_transitions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_status_transitions" ADD CONSTRAINT "deal_status_transitions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_product_owner_id_fkey" FOREIGN KEY ("product_owner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_destination_site_id_fkey" FOREIGN KEY ("destination_site_id") REFERENCES "partner_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_hse_validated_by_id_fkey" FOREIGN KEY ("hse_validated_by_id") REFERENCES "field_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_hse_validated_by_user_id_fkey" FOREIGN KEY ("hse_validated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_hse_derogation_id_fkey" FOREIGN KEY ("hse_derogation_id") REFERENCES "derogations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_field_agent_id_fkey" FOREIGN KEY ("field_agent_id") REFERENCES "field_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_status_transitions" ADD CONSTRAINT "operation_status_transitions_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_compliance_derogation_id_fkey" FOREIGN KEY ("compliance_derogation_id") REFERENCES "derogations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_assignments" ADD CONSTRAINT "operation_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_price_id_fkey" FOREIGN KEY ("supplier_price_id") REFERENCES "supplier_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_checks" ADD CONSTRAINT "operation_hse_checks_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_checks" ADD CONSTRAINT "operation_hse_checks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "hse_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_checks" ADD CONSTRAINT "operation_hse_checks_validated_by_field_user_id_fkey" FOREIGN KEY ("validated_by_field_user_id") REFERENCES "field_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_checks" ADD CONSTRAINT "operation_hse_checks_validated_by_user_id_fkey" FOREIGN KEY ("validated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_check_items" ADD CONSTRAINT "operation_hse_check_items_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "operation_hse_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_check_items" ADD CONSTRAINT "operation_hse_check_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "hse_checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_hse_check_items" ADD CONSTRAINT "operation_hse_check_items_recorded_by_field_user_id_fkey" FOREIGN KEY ("recorded_by_field_user_id") REFERENCES "field_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_events" ADD CONSTRAINT "hse_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_events" ADD CONSTRAINT "hse_events_declared_by_field_user_id_fkey" FOREIGN KEY ("declared_by_field_user_id") REFERENCES "field_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_events" ADD CONSTRAINT "hse_events_declared_by_user_id_fkey" FOREIGN KEY ("declared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_events" ADD CONSTRAINT "hse_events_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "hse_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_attachments" ADD CONSTRAINT "operation_attachments_check_item_id_fkey" FOREIGN KEY ("check_item_id") REFERENCES "operation_hse_check_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_attachments" ADD CONSTRAINT "operation_attachments_hse_event_id_fkey" FOREIGN KEY ("hse_event_id") REFERENCES "hse_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_tolerance_id_fkey" FOREIGN KEY ("tolerance_id") REFERENCES "ullage_tolerances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_ullage_ack_by_id_fkey" FOREIGN KEY ("ullage_ack_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_ullage_derogation_id_fkey" FOREIGN KEY ("ullage_derogation_id") REFERENCES "derogations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_entered_by_field_user_id_fkey" FOREIGN KEY ("entered_by_field_user_id") REFERENCES "field_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_cost_lines" ADD CONSTRAINT "operation_cost_lines_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_cost_lines" ADD CONSTRAINT "operation_cost_lines_cost_post_id_fkey" FOREIGN KEY ("cost_post_id") REFERENCES "cost_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_cost_lines" ADD CONSTRAINT "operation_cost_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_cost_lines" ADD CONSTRAINT "operation_cost_lines_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_cost_lines" ADD CONSTRAINT "operation_cost_lines_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "measurement_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_corrected_invoice_id_fkey" FOREIGN KEY ("corrected_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_proforma_id_fkey" FOREIGN KEY ("source_proforma_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_currency_code_fkey" FOREIGN KEY ("document_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_fx_rate_id_fkey" FOREIGN KEY ("document_fx_rate_id") REFERENCES "fx_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_simple_invoice_decided_by_id_fkey" FOREIGN KEY ("simple_invoice_decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fne_transmissions" ADD CONSTRAINT "fne_transmissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantees" ADD CONSTRAINT "guarantees_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantees" ADD CONSTRAINT "guarantees_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantees" ADD CONSTRAINT "guarantees_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantees" ADD CONSTRAINT "guarantees_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "generated_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_field_user_id_fkey" FOREIGN KEY ("field_user_id") REFERENCES "field_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- @erp:business-sql-injected
-- ===========================================================================
--  SQL MÉTIER — injecté par scripts/prepare-migrations.mjs
--
--  NE PAS DÉPLACER hors de ce fichier : il doit faire partie de l'historique
--  de migration, faute de quoi Prisma détectera une dérive de schéma et
--  proposera une réinitialisation de la base.
--
--  Source : prisma/sql/ — modifier là-bas, puis regénérer une migration.
-- ===========================================================================


-- ─── 01_business_constraints.sql ─────────────────────────────────

-- ===========================================================================
--  INVARIANTS — LOT 1 : SOCLE & RÉFÉRENTIELS
--  Réf. SPECIFICATIONS.md § 5.4, § 6.4, § 8.3, § 9.2, § 11, § 14.2
--
--  Ce fichier porte les règles au seul endroit qu'aucun bug applicatif,
--  aucun script d'administration et aucune refonte future de l'API ne peut
--  contourner : le moteur PostgreSQL.
--
--  Il est injecté DANS la migration Prisma par scripts/prepare-migrations.mjs.
--  Ne jamais l'appliquer « à côté » : Prisma détecterait une dérive de schéma.
--
--  Les invariants transactionnels (verrou finance, verrou HSE, facture sur
--  relevé faisant autorité) arrivent au lot 2 avec les entités Deal et
--  Opération.
--
--  Idempotent — pas de BEGIN/COMMIT : la migration fournit sa transaction.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  A. RÉFÉRENTIEL MONÉTAIRE  (§ 9.2)
-- ---------------------------------------------------------------------------

ALTER TABLE currencies
  DROP CONSTRAINT IF EXISTS chk_currencies_decimals_range,
  ADD  CONSTRAINT chk_currencies_decimals_range
       CHECK (decimal_places BETWEEN 0 AND 4),

  DROP CONSTRAINT IF EXISTS chk_currencies_peg_consistency,
  ADD  CONSTRAINT chk_currencies_peg_consistency
       CHECK (
         (peg_currency_code IS NULL AND peg_rate IS NULL)
         OR (peg_currency_code IS NOT NULL AND peg_rate IS NOT NULL AND peg_rate > 0)
       ),

  DROP CONSTRAINT IF EXISTS chk_currencies_no_self_peg,
  ADD  CONSTRAINT chk_currencies_no_self_peg
       CHECK (peg_currency_code IS NULL OR peg_currency_code <> code),

  DROP CONSTRAINT IF EXISTS chk_currencies_active_period,
  ADD  CONSTRAINT chk_currencies_active_period
       CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from);

-- Une seule devise pivot, une seule devise fonctionnelle. Deux pivots
-- rendraient le risque et la marge consolidée incomparables.
DROP INDEX IF EXISTS uq_currencies_single_pivot;
CREATE UNIQUE INDEX uq_currencies_single_pivot
  ON currencies ((true)) WHERE is_pivot;

DROP INDEX IF EXISTS uq_currencies_single_functional;
CREATE UNIQUE INDEX uq_currencies_single_functional
  ON currencies ((true)) WHERE is_functional;

COMMENT ON COLUMN currencies.decimal_places IS
  'Décimales de restitution. XOF = 0 : tout montant imprimé en francs CFA est un entier.';

ALTER TABLE fx_rates
  DROP CONSTRAINT IF EXISTS chk_fx_rates_positive,
  ADD  CONSTRAINT chk_fx_rates_positive
       CHECK (rate > 0),

  DROP CONSTRAINT IF EXISTS chk_fx_rates_distinct_currencies,
  ADD  CONSTRAINT chk_fx_rates_distinct_currencies
       CHECK (base_currency_code <> quote_currency_code),

  DROP CONSTRAINT IF EXISTS chk_fx_rates_period_valid,
  ADD  CONSTRAINT chk_fx_rates_period_valid
       CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- Une parité fixe réglementaire (XOF/EUR = 655,957) ne se saisit pas à la main.
CREATE OR REPLACE FUNCTION enforce_pegged_fx_rate()
RETURNS TRIGGER AS $$
DECLARE
  declared_peg      char(3);
  declared_peg_rate numeric;
BEGIN
  SELECT peg_currency_code, peg_rate INTO declared_peg, declared_peg_rate
    FROM currencies WHERE code = NEW.quote_currency_code;

  IF declared_peg IS NOT NULL AND declared_peg = NEW.base_currency_code THEN
    IF NEW.rate_type::text <> 'PEG' THEN
      RAISE EXCEPTION
        'La parité %/% est fixe et réglementaire (% = %). Type PEG obligatoire, reçu %.',
        NEW.base_currency_code, NEW.quote_currency_code,
        NEW.base_currency_code, declared_peg_rate, NEW.rate_type
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.rate <> declared_peg_rate THEN
      RAISE EXCEPTION
        'Taux de parité fixe incorrect pour %/% : attendu %, reçu %.',
        NEW.base_currency_code, NEW.quote_currency_code, declared_peg_rate, NEW.rate
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fx_rates_peg ON fx_rates;
CREATE TRIGGER trg_fx_rates_peg
  BEFORE INSERT OR UPDATE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION enforce_pegged_fx_rate();


-- ---------------------------------------------------------------------------
--  B. TIERS  (§ 6.1)
-- ---------------------------------------------------------------------------

ALTER TABLE partners
  DROP CONSTRAINT IF EXISTS chk_partners_credit_limit_positive,
  ADD  CONSTRAINT chk_partners_credit_limit_positive
       CHECK (credit_limit >= 0),

  -- Une exonération de TVA doit être justifiée par une référence opposable.
  DROP CONSTRAINT IF EXISTS chk_partners_vat_exemption_justified,
  ADD  CONSTRAINT chk_partners_vat_exemption_justified
       CHECK (
         NOT is_vat_exempt
         OR (vat_exemption_reference IS NOT NULL AND length(trim(vat_exemption_reference)) >= 3)
       ),

  -- Un client porte toujours un segment : il détermine la formule de prix
  -- par défaut et la grille de seuils applicable (§ 5.1).
  DROP CONSTRAINT IF EXISTS chk_partners_client_has_segment,
  ADD  CONSTRAINT chk_partners_client_has_segment
       CHECK (type::text <> 'CLIENT' OR segment IS NOT NULL),

  DROP CONSTRAINT IF EXISTS chk_partners_terms_range,
  ADD  CONSTRAINT chk_partners_terms_range
       CHECK (payment_terms_days >= 0 AND supplier_terms_days BETWEEN -365 AND 365);

COMMENT ON COLUMN partners.credit_limit IS
  'Exprimée en devise pivot. Ne jamais y stocker une devise locale : le contrôle crédit ne compare jamais deux devises.';

COMMENT ON COLUMN partners.supplier_terms_days IS
  'Négatif = prépaiement avant livraison. Cas courant chez Elyon (§ 14.6) : aucun flottant fournisseur n''amortit le cycle de trésorerie.';

ALTER TABLE partner_sites
  DROP CONSTRAINT IF EXISTS chk_partner_sites_coordinates,
  ADD  CONSTRAINT chk_partner_sites_coordinates
       CHECK (
         (latitude IS NULL AND longitude IS NULL)
         OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
       );


-- ---------------------------------------------------------------------------
--  C. PRODUITS  (§ 6.2)
-- ---------------------------------------------------------------------------

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_density_range,
  ADD  CONSTRAINT chk_products_density_range
       CHECK (reference_density_15 > 0.4 AND reference_density_15 < 1.2);

-- ---------------------------------------------------------------------------
--  D. POSTES DE COÛTS, ABSORPTION ET SEUILS  (§ 5.4, § 6.5, § 14.2)
-- ---------------------------------------------------------------------------

-- Un poste indirect suppose un regroupement d'absorption ET une assiette ;
-- un poste direct n'en a pas. Sans cela, le coût complet n'est pas calculable.
ALTER TABLE cost_posts
  DROP CONSTRAINT IF EXISTS chk_cost_posts_allocation_coherence,
  ADD  CONSTRAINT chk_cost_posts_allocation_coherence
       CHECK (
         (nature::text = 'DIRECT'   AND cost_pool_id IS NULL     AND allocation_basis IS NULL)
         OR
         (nature::text = 'INDIRECT' AND cost_pool_id IS NOT NULL AND allocation_basis IS NOT NULL)
       );

COMMENT ON COLUMN cost_posts.variability IS
  'Axe INDÉPENDANT de la nature. Une location de dépôt dédiée est directe et fixe ; une commission bancaire proportionnelle est indirecte et variable. Sans cet axe, le point mort (§ 14.5) n''est pas calculable.';

ALTER TABLE absorption_rates
  DROP CONSTRAINT IF EXISTS chk_absorption_positive,
  ADD  CONSTRAINT chk_absorption_positive
       CHECK (budgeted_amount >= 0 AND budgeted_base > 0 AND rate_per_unit >= 0),

  DROP CONSTRAINT IF EXISTS chk_absorption_year_range,
  ADD  CONSTRAINT chk_absorption_year_range
       CHECK (fiscal_year BETWEEN 2000 AND 2200),

  -- Le taux DOIT être le quotient du budget par l'assiette budgétée.
  -- Une saisie libre du taux ouvrirait la porte à un coût complet arbitraire.
  DROP CONSTRAINT IF EXISTS chk_absorption_rate_derived,
  ADD  CONSTRAINT chk_absorption_rate_derived
       CHECK (abs(rate_per_unit - round(budgeted_amount / budgeted_base, 6)) <= 0.000001);

-- Un seul taux courant par regroupement et par exercice.
DROP INDEX IF EXISTS uq_absorption_current_per_pool_year;
CREATE UNIQUE INDEX uq_absorption_current_per_pool_year
  ON absorption_rates (cost_pool_id, fiscal_year) WHERE is_current;

COMMENT ON COLUMN absorption_rates.budgeted_base IS
  'Assiette BUDGÉTÉE, jamais réalisée glissante (§ 14.2) : un dénominateur réalisé déclencherait la spirale d''absorption — moins de volume, charge unitaire plus élevée, davantage d''affaires bloquées, moins de volume encore.';

ALTER TABLE margin_thresholds
  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_non_negative,
  ADD  CONSTRAINT chk_margin_thresholds_non_negative
       CHECK (
         (direct_floor   IS NULL OR direct_floor   >= 0) AND
         (minimum_margin IS NULL OR minimum_margin >= 0)
       ),

  -- Le plancher dur est nécessairement inférieur ou égal au seuil d'alerte :
  -- l'inverse rendrait la zone d'arbitrage du DG inexistante.
  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_ordering,
  ADD  CONSTRAINT chk_margin_thresholds_ordering
       CHECK (
         direct_floor IS NULL OR minimum_margin IS NULL
         OR direct_floor <= minimum_margin
       ),

  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_period,
  ADD  CONSTRAINT chk_margin_thresholds_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from),

  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_not_empty,
  ADD  CONSTRAINT chk_margin_thresholds_not_empty
       CHECK (direct_floor IS NOT NULL OR minimum_margin IS NOT NULL);

ALTER TABLE ullage_tolerances
  DROP CONSTRAINT IF EXISTS chk_ullage_thresholds_non_negative,
  ADD  CONSTRAINT chk_ullage_thresholds_non_negative
       CHECK (
         normal_threshold_pct   >= 0 AND
         alert_threshold_pct    >= 0 AND
         critical_threshold_pct >= 0 AND
         (absolute_franchise IS NULL OR absolute_franchise >= 0)
       ),

  -- Normal ≤ alerte ≤ critique. Un ordre inversé rendrait la grille
  -- silencieusement inopérante.
  DROP CONSTRAINT IF EXISTS chk_ullage_thresholds_ordering,
  ADD  CONSTRAINT chk_ullage_thresholds_ordering
       CHECK (normal_threshold_pct <= alert_threshold_pct
              AND alert_threshold_pct <= critical_threshold_pct),

  DROP CONSTRAINT IF EXISTS chk_ullage_period,
  ADD  CONSTRAINT chk_ullage_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from);

COMMENT ON TABLE ullage_tolerances IS
  'Tolérances CONTRACTUELLES, non physiques (§ 8.3) : les contrats de transport en stipulent la franchise, les polices d''assurance le seuil indemnisable. Les normes ASTM et API définissent comment mesurer, pas combien de perte est acceptable.';


-- ---------------------------------------------------------------------------
--  E. TRANSPORT & CONFORMITÉ  (§ 6.4)
--
--  « Un sous-traitant, véhicule ou chauffeur non conforme ne devra pas être
--    affecté sans dérogation formalisée. » — dérogation réservée au DG.
--  L'interdiction d'affectation est portée au lot 2, avec l'Opération ;
--  ce lot pose la conformité elle-même.
-- ---------------------------------------------------------------------------

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS chk_vehicles_capacity_positive,
  ADD  CONSTRAINT chk_vehicles_capacity_positive
       CHECK (capacity > 0 AND (compartment_count IS NULL OR compartment_count > 0));

ALTER TABLE compliance_records
  -- Une pièce se rattache à EXACTEMENT un porteur.
  DROP CONSTRAINT IF EXISTS chk_compliance_single_owner,
  ADD  CONSTRAINT chk_compliance_single_owner
       CHECK (
         (partner_id IS NOT NULL)::int
       + (vehicle_id IS NOT NULL)::int
       + (driver_id  IS NOT NULL)::int = 1
       ),

  DROP CONSTRAINT IF EXISTS chk_compliance_dates,
  ADD  CONSTRAINT chk_compliance_dates
       CHECK (expiry_date IS NULL OR expiry_date >= issue_date);

-- Le statut d'une pièce se déduit de sa date d'expiration : il ne se saisit
-- pas. Une pièce expirée déclarée valide viderait le verrou de conformité.
CREATE OR REPLACE FUNCTION derive_compliance_status()
RETURNS TRIGGER AS $$
DECLARE
  notice_days int;
BEGIN
  IF NEW.status::text = 'SUSPENDED' THEN
    RETURN NEW; -- Suspension administrative : décision explicite, on la respecte.
  END IF;

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

DROP TRIGGER IF EXISTS trg_compliance_status ON compliance_records;
CREATE TRIGGER trg_compliance_status
  BEFORE INSERT OR UPDATE OF expiry_date, status ON compliance_records
  FOR EACH ROW EXECUTE FUNCTION derive_compliance_status();


-- ---------------------------------------------------------------------------
--  F. SUPPLÉANCE ET REGISTRE DES DÉROGATIONS  (§ 3.4, § 11.4)
-- ---------------------------------------------------------------------------

ALTER TABLE delegations
  -- Un suppléant et un seul : soit interne (le DG, suppléant de droit),
  -- soit un autre agent terrain.
  DROP CONSTRAINT IF EXISTS chk_delegation_single_delegate,
  ADD  CONSTRAINT chk_delegation_single_delegate
       CHECK (
         (delegate_user_id IS NOT NULL)::int
       + (delegate_field_user_id IS NOT NULL)::int = 1
       ),

  -- Une suppléance est temporaire par nature : elle a une fin.
  DROP CONSTRAINT IF EXISTS chk_delegation_period,
  ADD  CONSTRAINT chk_delegation_period
       CHECK (ends_at > starts_at),

  DROP CONSTRAINT IF EXISTS chk_delegation_reason,
  ADD  CONSTRAINT chk_delegation_reason
       CHECK (length(trim(reason)) >= 10);

ALTER TABLE derogations
  DROP CONSTRAINT IF EXISTS chk_derogation_reason,
  ADD  CONSTRAINT chk_derogation_reason
       CHECK (length(trim(reason)) >= 10),

  DROP CONSTRAINT IF EXISTS chk_derogation_period,
  ADD  CONSTRAINT chk_derogation_period
       CHECK (expires_at IS NULL OR expires_at > granted_at);

-- Qui peut déroger à quoi. Vérifié en base, pas seulement dans un guard :
-- c'est la garantie que réclamera un auditeur ou un assureur après incident.
CREATE OR REPLACE FUNCTION enforce_derogation_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority_role text;
BEGIN
  SELECT role::text INTO authority_role FROM users WHERE id = NEW.authority_id;

  IF authority_role IS NULL THEN
    RAISE EXCEPTION 'Autorité de dérogation introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Réservées au DG exclusivement.
  IF NEW.type::text IN ('TRANSPORT_NON_COMPLIANCE', 'MARGIN_BELOW_DIRECT_FLOOR', 'HSE_DELEGATION')
     AND authority_role <> 'DG' THEN
    RAISE EXCEPTION
      'Dérogation de type % réservée au DG (§ 11.2). Rôle fourni : %.',
      NEW.type, authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Marge sous le seuil complet : DG, conformément au § 5.4.
  IF NEW.type::text = 'MARGIN_BELOW_THRESHOLD' AND authority_role <> 'DG' THEN
    RAISE EXCEPTION
      'L''accord sur une marge sous le seuil est réservé au DG. Rôle fourni : %.',
      authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Acquittement d'un écart de volume : CCOO, CFO ou DG (§ 8.3).
  IF NEW.type::text = 'ULLAGE_ACKNOWLEDGEMENT'
     AND authority_role NOT IN ('CCOO', 'FINANCE_CFO', 'DG') THEN
    RAISE EXCEPTION
      'L''acquittement d''un écart de volume est réservé au CCOO, au CFO ou au DG. Rôle fourni : %.',
      authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Le franchissement du plancher direct est exceptionnel : il passe
  -- obligatoirement en revue mensuelle (§ 5.4).
  IF NEW.type::text = 'MARGIN_BELOW_DIRECT_FLOOR' THEN
    NEW.requires_monthly_review := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derogation_authority ON derogations;
CREATE TRIGGER trg_derogation_authority
  BEFORE INSERT OR UPDATE OF authority_id, type ON derogations
  FOR EACH ROW EXECUTE FUNCTION enforce_derogation_authority();


-- ---------------------------------------------------------------------------
--  G. SOCLE
-- ---------------------------------------------------------------------------

ALTER TABLE number_sequences
  -- month = 0 pour une séquence annuelle (OP-2026-000154),
  -- 1 à 12 pour une séquence mensuelle (DEAL-2026-08-001).
  DROP CONSTRAINT IF EXISTS chk_number_sequences_period,
  ADD  CONSTRAINT chk_number_sequences_period
       CHECK (month BETWEEN 0 AND 12 AND year BETWEEN 2000 AND 2200),

  DROP CONSTRAINT IF EXISTS chk_number_sequences_monotonic,
  ADD  CONSTRAINT chk_number_sequences_monotonic
       CHECK (last_value >= 0);

ALTER TABLE system_settings
  DROP CONSTRAINT IF EXISTS chk_system_settings_value_type,
  ADD  CONSTRAINT chk_system_settings_value_type
       CHECK (value_type IN ('string', 'number', 'boolean', 'json'));


-- ─── 02_audit_immutability.sql ───────────────────────────────────

-- ===========================================================================
--  IMMUABILITÉ DES JOURNAUX
--  Réf. SPECIFICATIONS.md § 1.4, § 11.4
--
--  Un journal d'audit modifiable ne vaut rien : le premier réflexe de qui
--  couvre une manipulation de prix, de marge ou de conformité est d'effacer
--  la trace. L'immuabilité est portée par le moteur, en deux couches
--  indépendantes :
--    1. un trigger refusant UPDATE et DELETE, quel que soit le rôle ;
--    2. le retrait des privilèges au rôle applicatif (04_grants.sql).
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION append_only_guard()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Table en ajout seul : % interdit sur % (SPECIFICATIONS.md § 1.4).',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- --- Journal d'audit -------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Registre des dérogations ---------------------------------------------
-- C'est la pièce qu'un auditeur ou un assureur demandera après un incident.
-- Une dérogation ne se supprime pas : elle se révoque ou se clôture, ce qui
-- laisse une trace. Les colonnes de statut restent modifiables.
DROP TRIGGER IF EXISTS trg_derogations_no_delete ON derogations;
CREATE TRIGGER trg_derogations_no_delete
  BEFORE DELETE ON derogations
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_delegations_no_delete ON delegations;
CREATE TRIGGER trg_delegations_no_delete
  BEFORE DELETE ON delegations
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Historiques de prix et de taux ---------------------------------------
-- Même principe : un prix administré ou un taux de change effacé rendrait
-- irreproductible une pièce déjà émise. On clôt une période, on n'efface pas.
DROP TRIGGER IF EXISTS trg_fx_rates_no_delete ON fx_rates;
CREATE TRIGGER trg_fx_rates_no_delete
  BEFORE DELETE ON fx_rates
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_administered_prices_no_delete ON administered_prices;
CREATE TRIGGER trg_administered_prices_no_delete
  BEFORE DELETE ON administered_prices
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Taux d'absorption -----------------------------------------------------
-- Une révision crée une version, elle n'écrase pas la précédente (§ 14.2).
DROP TRIGGER IF EXISTS trg_absorption_rates_no_delete ON absorption_rates;
CREATE TRIGGER trg_absorption_rates_no_delete
  BEFORE DELETE ON absorption_rates
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();


-- ─── 03_views_and_functions.sql ──────────────────────────────────

-- ===========================================================================
--  VUES ET FONCTIONS DE SERVICE — LOT 1
--
--  Les règles de résolution vivent en base, pas en mémoire applicative :
--  deux implémentations de la même règle finissent toujours par diverger.
--
--  ⚠️ La vue d'en-cours crédit v_partner_credit_exposure et la fonction
--     check_credit_capacity reviennent au LOT 2, avec les entités Deal
--     et Invoice dont elles dépendent (§ 9.1 de la v2, à réécrire sur la
--     hiérarchie à trois niveaux).
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Taux de change applicable à une date  (§ 9.2)
--
--  Retourne le taux en vigueur le plus récent à la date demandée, pour un
--  type de taux donné. Toute pièce émise conserve ensuite l'identifiant du
--  taux employé : elle reste reproductible à l'identique des années plus tard.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_fx_rate(char, char, date, text);

CREATE OR REPLACE FUNCTION resolve_fx_rate(
    p_from      char(3),
    p_to        char(3),
    p_on        date,
    p_rate_type text DEFAULT NULL
)
RETURNS TABLE (fx_rate_id uuid, rate numeric, rate_type text) AS $$
BEGIN
    -- Parité identique : taux de 1, aucune conversion.
    IF p_from = p_to THEN
        RETURN QUERY SELECT NULL::uuid, 1::numeric, 'IDENTITY'::text;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT f.id, f.rate, f.rate_type::text
      FROM fx_rates f
     WHERE f.base_currency_code  = p_from
       AND f.quote_currency_code = p_to
       AND f.effective_from     <= p_on
       AND (f.effective_to IS NULL OR f.effective_to >= p_on)
       AND (p_rate_type IS NULL OR f.rate_type::text = p_rate_type)
     -- La parité fixe l'emporte : elle n'est pas révisable.
     ORDER BY (f.rate_type::text = 'PEG') DESC,
              f.effective_from DESC,
              f.created_at DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Prix administré applicable à une date  (§ 5.3)
--
--  Simple lecture de référence, consultée au moment de fixer un prix de vente.
--  Aucune décomposition, aucune dérivation : le prix de vente reste une valeur
--  que le commercial fixe, et le coût d'achat vient d'un supplier_prices validé.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_administered_price(text, uuid, text, date);

CREATE OR REPLACE FUNCTION resolve_administered_price(
    p_reference_type text,
    p_product_id     uuid,
    p_zone           text,
    p_on             date
)
RETURNS TABLE (
    price_id      uuid,
    price         numeric,
    currency_code char(3),
    uom           text,
    published_by  text,
    effective_from date
) AS $$
BEGIN
    -- Chaque colonne est castée explicitement vers le type déclaré :
    -- PostgreSQL refuse un varchar(n) là où le RETURNS TABLE annonce text.
    RETURN QUERY
    SELECT a.id, a.price, a.currency_code, a.uom::text, a.published_by::text, a.effective_from
      FROM administered_prices a
     WHERE a.reference_type::text = p_reference_type
       AND a.product_id = p_product_id
       AND (p_zone IS NULL OR a.zone IS NOT DISTINCT FROM p_zone)
       AND a.effective_from <= p_on
       AND (a.effective_to IS NULL OR a.effective_to >= p_on)
     ORDER BY a.effective_from DESC, a.created_at DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Conformité des moyens de transport  (§ 6.4)
--
--  Un sous-traitant, véhicule ou chauffeur non conforme ne peut être affecté
--  sans dérogation du DG. Cette vue est la source unique de l'état de
--  conformité : elle ne se saisit pas, elle se déduit des pièces à échéance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_transport_compliance AS
WITH blocking AS (
    SELECT
        partner_id, vehicle_id, driver_id,
        COUNT(*) FILTER (WHERE status::text = 'EXPIRED')   AS expired_count,
        COUNT(*) FILTER (WHERE status::text = 'SUSPENDED') AS suspended_count,
        COUNT(*) FILTER (WHERE status::text = 'EXPIRING')  AS expiring_count,
        MIN(expiry_date) FILTER (WHERE status::text IN ('VALID', 'EXPIRING')) AS next_expiry
      FROM compliance_records
     WHERE is_blocking
     GROUP BY partner_id, vehicle_id, driver_id
)
SELECT
    'CARRIER'::text                                   AS subject_kind,
    p.id                                              AS subject_id,
    p.code                                            AS subject_code,
    p.legal_name                                      AS subject_label,
    COALESCE(b.expired_count, 0)                      AS expired_count,
    COALESCE(b.suspended_count, 0)                    AS suspended_count,
    COALESCE(b.expiring_count, 0)                     AS expiring_count,
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0 AS is_compliant
  FROM partners p
  LEFT JOIN blocking b ON b.partner_id = p.id
 WHERE p.type::text IN ('CARRIER', 'SUPPLIER')

UNION ALL

SELECT
    'VEHICLE'::text, v.id, v.registration, COALESCE(v.brand_model, v.registration),
    COALESCE(b.expired_count, 0),
    COALESCE(b.suspended_count, 0),
    COALESCE(b.expiring_count, 0),
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0
  FROM vehicles v
  LEFT JOIN blocking b ON b.vehicle_id = v.id

UNION ALL

SELECT
    'DRIVER'::text, d.id, COALESCE(d.employee_number, d.id::text), d.full_name,
    COALESCE(b.expired_count, 0),
    COALESCE(b.suspended_count, 0),
    COALESCE(b.expiring_count, 0),
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0
  FROM drivers d
  LEFT JOIN blocking b ON b.driver_id = d.id;

COMMENT ON VIEW v_transport_compliance IS
  'État de conformité des tiers, véhicules et chauffeurs — SPECIFICATIONS.md § 6.4. Source unique du verrou de conformité : déduite des pièces à échéance, jamais saisie.';


-- ---------------------------------------------------------------------------
--  Échéancier documentaire  (§ 6.6)
--
--  Alimente le moteur d'alerte avant expiration. Cette seule vue a déjà de la
--  valeur avant tout le reste de l'ERP : agréments, assurances, contrôles
--  techniques et habilitations qui arrivent à échéance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_compliance_expiry_watch AS
SELECT
    cr.id,
    cr.type,
    cr.reference,
    cr.expiry_date,
    (cr.expiry_date - CURRENT_DATE)         AS days_remaining,
    cr.status,
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
 ORDER BY cr.expiry_date;

COMMENT ON VIEW v_compliance_expiry_watch IS
  'Échéancier des pièces légales et de conformité — SPECIFICATIONS.md § 6.6.';


-- ---------------------------------------------------------------------------
--  Seuils applicables à un couple segment / produit  (§ 5.4)
--
--  Le seuil le plus spécifique l'emporte : une ligne portant le produit prime
--  sur une ligne segment seul.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_margin_threshold(text, uuid, date);

CREATE OR REPLACE FUNCTION resolve_margin_threshold(
    p_segment    text,
    p_product_id uuid,
    p_on         date
)
RETURNS TABLE (
    threshold_id   uuid,
    direct_floor   numeric,
    minimum_margin numeric,
    currency_code  char(3),
    uom            text
) AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.direct_floor, m.minimum_margin, m.currency_code, m.uom::text
      FROM margin_thresholds m
     WHERE m.segment::text = p_segment
       AND (m.product_id IS NULL OR m.product_id = p_product_id)
       AND m.effective_from <= p_on
       AND (m.effective_to IS NULL OR m.effective_to >= p_on)
     ORDER BY (m.product_id IS NOT NULL) DESC, m.effective_from DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Tolérance d'ullage applicable  (§ 8.3)
--
--  Résolution du plus spécifique au plus général :
--  (segment, mode, produit) → (segment, mode) → (segment) → défaut global.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_ullage_tolerance(text, text, uuid, date);

CREATE OR REPLACE FUNCTION resolve_ullage_tolerance(
    p_segment        text,
    p_transport_mode text,
    p_product_id     uuid,
    p_on             date
)
RETURNS TABLE (
    tolerance_id    uuid,
    normal_pct      numeric,
    alert_pct       numeric,
    critical_pct    numeric,
    franchise       numeric,
    franchise_uom   text
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.normal_threshold_pct, u.alert_threshold_pct,
           u.critical_threshold_pct, u.absolute_franchise, u.franchise_uom::text
      FROM ullage_tolerances u
     WHERE (u.segment IS NULL        OR u.segment::text = p_segment)
       AND (u.transport_mode IS NULL OR u.transport_mode::text = p_transport_mode)
       AND (u.product_id IS NULL     OR u.product_id = p_product_id)
       AND u.effective_from <= p_on
       AND (u.effective_to IS NULL OR u.effective_to >= p_on)
     ORDER BY (u.product_id IS NOT NULL)::int
            + (u.transport_mode IS NOT NULL)::int
            + (u.segment IS NOT NULL)::int DESC,
              u.effective_from DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ─── 04_grants.sql ───────────────────────────────────────────────

-- ===========================================================================
--  MOINDRE PRIVILÈGE EN BASE
--  Réf. SPECIFICATIONS.md § 1.4
--
--  Deux rôles PostgreSQL, jamais confondus :
--    · erp_migrator — propriétaire du schéma, DDL. Utilisé UNIQUEMENT par
--                     les migrations, jamais par l'application.
--    · erp_app      — DML seul. Aucun DDL. Aucun effacement de journal.
--
--  Conséquence : une injection SQL réussie contre l'application ne permet
--  ni de supprimer une table, ni d'effacer une trace d'audit ou une dérogation.
--
--  Le bloc teste l'existence du rôle : la migration doit pouvoir se rejouer
--  sur la base de travail de Prisma ou sur un poste de développement où
--  erp_app n'existe pas.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    RAISE NOTICE 'Rôle erp_app absent : attribution des privilèges ignorée (base de travail ou poste de développement).';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO erp_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app';

  -- --- Journaux : insertion seule -----------------------------------------
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM erp_app';
  EXECUTE 'GRANT SELECT, INSERT ON audit_logs TO erp_app';

  -- --- Registre des dérogations : pas d'effacement -------------------------
  -- Une dérogation se révoque ou se clôture ; elle ne disparaît jamais.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON derogations FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON delegations FROM erp_app';

  -- --- Historiques opposables : pas d'effacement ---------------------------
  -- Taux de change, prix administrés et taux d'absorption rendent reproductibles
  -- des pièces déjà émises. On clôt une période, on n'efface pas.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON fx_rates FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON administered_prices FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON absorption_rates FROM erp_app';

  -- --- Référentiels administrés : pas de suppression -----------------------
  -- Devises, postes de coûts et grilles de seuils se désactivent (is_active),
  -- ils ne se suppriment pas : l'historique doit rester lisible.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON currencies FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON cost_posts FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON margin_thresholds FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON ullage_tolerances FROM erp_app';

  -- --- Vues et fonctions de service ---------------------------------------
  EXECUTE 'GRANT SELECT ON v_transport_compliance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_compliance_expiry_watch TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_fx_rate(char, char, date, text) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_administered_price(text, uuid, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_margin_threshold(text, uuid, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_ullage_tolerance(text, text, uuid, date) TO erp_app';

  -- --- Aucun DDL -----------------------------------------------------------
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM erp_app';

  -- --- Héritage pour les migrations futures --------------------------------
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app';

  RAISE NOTICE 'Privilèges erp_app appliqués.';
END
$grants$;
