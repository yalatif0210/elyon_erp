-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('DG', 'ASSISTANT_DG', 'IT_ADMIN', 'CCOO', 'SALES_REP', 'LOGISTICS_COORD', 'FINANCE_CFO', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "field_role" AS ENUM ('FIELD_AGENT', 'HSE_CONTROLLER');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('INTERNAL_USER', 'PORTAL_USER', 'FIELD_USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "partner_type" AS ENUM ('CLIENT', 'PROSPECT', 'SUPPLIER', 'CARRIER', 'INSPECTOR');

-- CreateEnum
CREATE TYPE "commercial_segment" AS ENUM ('MARITIME', 'B2B', 'RETAIL');

-- CreateEnum
CREATE TYPE "credit_status" AS ENUM ('ACTIVE', 'WATCH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "unit_of_measure" AS ENUM ('L', 'M3', 'MT', 'BBL');

-- CreateEnum
CREATE TYPE "transport_mode" AS ENUM ('PIPELINE', 'BUNKERING', 'BARGE', 'TRUCK', 'RAIL');

-- CreateEnum
CREATE TYPE "documentary_regime" AS ENUM ('PROFORMA_ONLY', 'PROFORMA_THEN_SIMPLE', 'PROFORMA_THEN_FNE', 'SIMPLE_DIRECT', 'FNE_DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "cost_nature" AS ENUM ('DIRECT', 'INDIRECT');

-- CreateEnum
CREATE TYPE "cost_variability" AS ENUM ('VARIABLE', 'FIXED');

-- CreateEnum
CREATE TYPE "allocation_basis" AS ENUM ('PER_VOLUME', 'PER_OPERATION', 'PER_REVENUE');

-- CreateEnum
CREATE TYPE "fx_rate_type" AS ENUM ('PEG', 'OFFICIAL', 'BANK', 'CONTRACTUAL', 'INTERNAL', 'BUDGET');

-- CreateEnum
CREATE TYPE "price_reference_type" AS ENUM ('PLATTS', 'SIR', 'PUMP', 'SUPPLIER', 'CONTRACTUAL');

-- CreateEnum
CREATE TYPE "vehicle_type" AS ENUM ('TANKER_TRUCK', 'RAIL_WAGON', 'BUNKER_BARGE', 'PIPELINE_SECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "compliance_type" AS ENUM ('CUSTOMS_LICENSE', 'MINISTERIAL_APPROVAL', 'IMPORT_EXPORT_LICENSE', 'INSURANCE', 'TECHNICAL_INSPECTION', 'DRIVER_LICENSE', 'DRIVER_TRAINING', 'HSE_CERTIFICATION', 'VESSEL_CERTIFICATE', 'SAFETY_DATA_SHEET', 'OTHER');

-- CreateEnum
CREATE TYPE "compliance_status" AS ENUM ('VALID', 'EXPIRING', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "derogation_type" AS ENUM ('MARGIN_BELOW_THRESHOLD', 'MARGIN_BELOW_DIRECT_FLOOR', 'HSE_BLOCKING_OVERRIDE', 'TRANSPORT_NON_COMPLIANCE', 'HSE_DELEGATION', 'ULLAGE_ACKNOWLEDGEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "derogation_status" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "hse_control_level" AS ENUM ('RECOMMENDED', 'MANDATORY', 'CONDITIONAL', 'BLOCKING');

-- CreateEnum
CREATE TYPE "hse_risk_level" AS ENUM ('STANDARD', 'REINFORCED', 'CRITICAL');

-- CreateEnum
CREATE TYPE "operation_phase" AS ENUM ('PREPARATION', 'PRE_DEPARTURE', 'LOADING', 'TRANSPORT', 'DELIVERY', 'CLOSING');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('MINISTERIAL_APPROVAL', 'IMPORT_EXPORT_LICENSE', 'SAFETY_DATA_SHEET', 'CUSTOMS_CERTIFICATE', 'INSURANCE_POLICY', 'TECHNICAL_INSPECTION', 'DRIVER_DOCUMENT', 'VESSEL_CERTIFICATE', 'CONTRACT', 'MEASUREMENT_REPORT', 'DELIVERY_NOTE', 'OPERATION_REPORT', 'INVOICE_PDF', 'PROFORMA_PDF', 'TRANSPORT_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'REJECT', 'OVERRIDE', 'DEROGATION_GRANTED', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "decimal_places" SMALLINT NOT NULL DEFAULT 2,
    "is_pivot" BOOLEAN NOT NULL DEFAULT false,
    "is_functional" BOOLEAN NOT NULL DEFAULT false,
    "is_local" BOOLEAN NOT NULL DEFAULT false,
    "is_document_eligible" BOOLEAN NOT NULL DEFAULT true,
    "peg_currency_code" CHAR(3),
    "peg_rate" DECIMAL(18,8),
    "active_from" DATE,
    "active_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL,
    "base_currency_code" CHAR(3) NOT NULL,
    "quote_currency_code" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "rate_type" "fx_rate_type" NOT NULL DEFAULT 'OFFICIAL',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes" VARCHAR(500),
    "entered_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "role" "user_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_enc" VARCHAR(512),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_users" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" VARCHAR(255) NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_enc" VARCHAR(512),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "role" "field_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" VARCHAR(255) NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_enc" VARCHAR(512),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "assigned_device_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "field_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "id" UUID NOT NULL,
    "delegated_role" "field_role" NOT NULL,
    "grantor_id" UUID NOT NULL,
    "delegate_user_id" UUID,
    "delegate_field_user_id" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "type" "partner_type" NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "segment" "commercial_segment",
    "taxpayer_account_number" VARCHAR(32),
    "rccm_number" VARCHAR(48),
    "tax_regime" VARCHAR(64),
    "is_vat_exempt" BOOLEAN NOT NULL DEFAULT false,
    "vat_exemption_reference" VARCHAR(120),
    "documentary_regime" "documentary_regime" NOT NULL DEFAULT 'PROFORMA_THEN_FNE',
    "credit_limit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_limit_currency_code" CHAR(3) NOT NULL DEFAULT 'USD',
    "credit_status" "credit_status" NOT NULL DEFAULT 'ACTIVE',
    "payment_terms_days" SMALLINT NOT NULL DEFAULT 0,
    "supplier_terms_days" SMALLINT NOT NULL DEFAULT 0,
    "billing_currency_code" CHAR(3) NOT NULL DEFAULT 'XOF',
    "is_compliant" BOOLEAN NOT NULL DEFAULT true,
    "compliance_checked_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(2000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_sites" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address_line" VARCHAR(255),
    "city" VARCHAR(120),
    "country_code" CHAR(2) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "access_instructions" VARCHAR(2000),
    "opening_hours" VARCHAR(500),
    "safety_instructions" VARCHAR(2000),
    "default_hse_risk_level" "hse_risk_level" NOT NULL DEFAULT 'STANDARD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_contacts" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "role" VARCHAR(120),
    "email" VARCHAR(255),
    "phone" VARCHAR(40),
    "is_field_visible" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_bank_accounts" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "bank_name" VARCHAR(160) NOT NULL,
    "account_number" VARCHAR(64) NOT NULL,
    "iban" VARCHAR(48),
    "swift_bic" VARCHAR(16),
    "currency_code" CHAR(3) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "reference_density_15" DECIMAL(9,6) NOT NULL,
    "viscosity_cst" DECIMAL(9,3),
    "flash_point_c" DECIMAL(6,2),
    "max_sulphur_pct" DECIMAL(6,4),
    "default_uom" "unit_of_measure" NOT NULL DEFAULT 'L',
    "tax_regime" VARCHAR(64),
    "ui_color_token" VARCHAR(32) NOT NULL,
    "default_price_index_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_indices" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "location" VARCHAR(60) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_indices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_assessments" (
    "id" UUID NOT NULL,
    "price_index_id" UUID NOT NULL,
    "quote_date" DATE NOT NULL,
    "low" DECIMAL(18,4) NOT NULL,
    "high" DECIMAL(18,4) NOT NULL,
    "mean" DECIMAL(18,4) NOT NULL,
    "source_reference" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administered_prices" (
    "id" UUID NOT NULL,
    "reference_type" "price_reference_type" NOT NULL,
    "product_id" UUID NOT NULL,
    "zone" VARCHAR(60),
    "price" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "publication_reference" VARCHAR(200),
    "published_by" VARCHAR(60) NOT NULL,
    "notes" VARCHAR(1000),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administered_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_prices" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "pricing_method" VARCHAR(80) NOT NULL,
    "contract_reference" VARCHAR(120),
    "source_label" VARCHAR(80) NOT NULL,
    "min_volume" DECIMAL(18,6),
    "discount_pct" DECIMAL(9,6),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "validated_by_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_posts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "nature" "cost_nature" NOT NULL,
    "variability" "cost_variability" NOT NULL,
    "cost_pool_id" UUID,
    "allocation_basis" "allocation_basis",
    "is_system_computed" BOOLEAN NOT NULL DEFAULT false,
    "display_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_pools" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "allocation_basis" "allocation_basis" NOT NULL,
    "segments" "commercial_segment"[],
    "currency_code" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absorption_rates" (
    "id" UUID NOT NULL,
    "cost_pool_id" UUID NOT NULL,
    "fiscal_year" SMALLINT NOT NULL,
    "budgeted_amount" DECIMAL(18,4) NOT NULL,
    "budgeted_base" DECIMAL(18,6) NOT NULL,
    "base_uom" "unit_of_measure",
    "rate_per_unit" DECIMAL(18,6) NOT NULL,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absorption_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "margin_thresholds" (
    "id" UUID NOT NULL,
    "segment" "commercial_segment" NOT NULL,
    "product_id" UUID,
    "direct_floor" DECIMAL(18,4),
    "minimum_margin" DECIMAL(18,4),
    "currency_code" CHAR(3) NOT NULL,
    "uom" "unit_of_measure" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "margin_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ullage_tolerances" (
    "id" UUID NOT NULL,
    "segment" "commercial_segment",
    "transport_mode" "transport_mode",
    "product_id" UUID,
    "normal_threshold_pct" DECIMAL(9,6) NOT NULL,
    "alert_threshold_pct" DECIMAL(9,6) NOT NULL,
    "critical_threshold_pct" DECIMAL(9,6) NOT NULL,
    "absolute_franchise" DECIMAL(18,6),
    "franchise_uom" "unit_of_measure",
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ullage_tolerances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "carrier_id" UUID,
    "registration" VARCHAR(40) NOT NULL,
    "type" "vehicle_type" NOT NULL,
    "brand_model" VARCHAR(120),
    "year" SMALLINT,
    "capacity" DECIMAL(18,6) NOT NULL,
    "capacity_uom" "unit_of_measure" NOT NULL,
    "compartment_count" SMALLINT,
    "allowed_product_ids" UUID[],
    "is_compliant" BOOLEAN NOT NULL DEFAULT false,
    "compliance_checked_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "carrier_id" UUID,
    "full_name" VARCHAR(160) NOT NULL,
    "employee_number" VARCHAR(48),
    "id_document_type" VARCHAR(60),
    "id_document_ref" VARCHAR(64),
    "phone" VARCHAR(40),
    "is_compliant" BOOLEAN NOT NULL DEFAULT false,
    "compliance_checked_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_records" (
    "id" UUID NOT NULL,
    "type" "compliance_type" NOT NULL,
    "partner_id" UUID,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "reference" VARCHAR(120) NOT NULL,
    "issuing_body" VARCHAR(160),
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE,
    "status" "compliance_status" NOT NULL DEFAULT 'VALID',
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "document_id" UUID,
    "expiry_alert_sent_at" TIMESTAMPTZ(3),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_checklist_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "applicable_segments" "commercial_segment"[],
    "applicable_transport_modes" "transport_mode"[],
    "applicable_risk_levels" "hse_risk_level"[],
    "version" SMALLINT NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hse_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hse_checklist_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "label" VARCHAR(300) NOT NULL,
    "guidance" VARCHAR(1000),
    "phase" "operation_phase" NOT NULL,
    "level" "hse_control_level" NOT NULL,
    "requires_photo" BOOLEAN NOT NULL DEFAULT false,
    "requires_value" BOOLEAN NOT NULL DEFAULT false,
    "value_label" VARCHAR(120),
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,
    "display_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hse_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "type" "document_type" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "partner_id" UUID,
    "expiry_date" DATE,
    "expiry_alert_sent_at" TIMESTAMPTZ(3),
    "is_client_visible" BOOLEAN NOT NULL DEFAULT false,
    "is_field_visible" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derogations" (
    "id" UUID NOT NULL,
    "type" "derogation_type" NOT NULL,
    "subject_type" VARCHAR(64) NOT NULL,
    "subject_id" VARCHAR(64),
    "subject_label" VARCHAR(255),
    "requested_by_id" UUID,
    "authority_id" UUID NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "status" "derogation_status" NOT NULL DEFAULT 'ACTIVE',
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "requires_monthly_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMPTZ(3),
    "delegation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derogations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "actor_label" VARCHAR(255),
    "action" "audit_action" NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(1000) NOT NULL,
    "value_type" VARCHAR(16) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_rates_base_currency_code_quote_currency_code_effective_f_idx" ON "fx_rates"("base_currency_code", "quote_currency_code", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_currency_code_quote_currency_code_rate_type_e_key" ON "fx_rates"("base_currency_code", "quote_currency_code", "rate_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_users_email_key" ON "portal_users"("email");

-- CreateIndex
CREATE INDEX "portal_users_partner_id_is_active_idx" ON "portal_users"("partner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "field_users_email_key" ON "field_users"("email");

-- CreateIndex
CREATE INDEX "field_users_role_is_active_idx" ON "field_users"("role", "is_active");

-- CreateIndex
CREATE INDEX "delegations_delegated_role_starts_at_ends_at_idx" ON "delegations"("delegated_role", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_type_is_active_idx" ON "partners"("type", "is_active");

-- CreateIndex
CREATE INDEX "partners_type_credit_status_idx" ON "partners"("type", "credit_status");

-- CreateIndex
CREATE INDEX "partners_segment_is_active_idx" ON "partners"("segment", "is_active");

-- CreateIndex
CREATE INDEX "partner_sites_partner_id_is_active_idx" ON "partner_sites"("partner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "partner_sites_partner_id_code_key" ON "partner_sites"("partner_id", "code");

-- CreateIndex
CREATE INDEX "partner_contacts_partner_id_idx" ON "partner_contacts"("partner_id");

-- CreateIndex
CREATE INDEX "partner_bank_accounts_partner_id_is_active_idx" ON "partner_bank_accounts"("partner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "price_indices_code_key" ON "price_indices"("code");

-- CreateIndex
CREATE INDEX "price_assessments_price_index_id_quote_date_idx" ON "price_assessments"("price_index_id", "quote_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "price_assessments_price_index_id_quote_date_key" ON "price_assessments"("price_index_id", "quote_date");

-- CreateIndex
CREATE INDEX "administered_prices_reference_type_product_id_effective_fro_idx" ON "administered_prices"("reference_type", "product_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "administered_prices_reference_type_product_id_zone_effectiv_key" ON "administered_prices"("reference_type", "product_id", "zone", "effective_from");

-- CreateIndex
CREATE INDEX "supplier_prices_supplier_id_product_id_effective_from_idx" ON "supplier_prices"("supplier_id", "product_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "supplier_prices_product_id_validated_at_idx" ON "supplier_prices"("product_id", "validated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_posts_code_key" ON "cost_posts"("code");

-- CreateIndex
CREATE INDEX "cost_posts_nature_variability_idx" ON "cost_posts"("nature", "variability");

-- CreateIndex
CREATE INDEX "cost_posts_is_active_display_order_idx" ON "cost_posts"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "cost_pools_code_key" ON "cost_pools"("code");

-- CreateIndex
CREATE INDEX "absorption_rates_cost_pool_id_fiscal_year_is_current_idx" ON "absorption_rates"("cost_pool_id", "fiscal_year", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "absorption_rates_cost_pool_id_fiscal_year_version_key" ON "absorption_rates"("cost_pool_id", "fiscal_year", "version");

-- CreateIndex
CREATE INDEX "margin_thresholds_segment_effective_from_idx" ON "margin_thresholds"("segment", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "margin_thresholds_segment_product_id_effective_from_key" ON "margin_thresholds"("segment", "product_id", "effective_from");

-- CreateIndex
CREATE INDEX "ullage_tolerances_segment_transport_mode_product_id_idx" ON "ullage_tolerances"("segment", "transport_mode", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_key" ON "vehicles"("registration");

-- CreateIndex
CREATE INDEX "vehicles_carrier_id_is_active_idx" ON "vehicles"("carrier_id", "is_active");

-- CreateIndex
CREATE INDEX "vehicles_is_compliant_is_active_idx" ON "vehicles"("is_compliant", "is_active");

-- CreateIndex
CREATE INDEX "drivers_carrier_id_is_active_idx" ON "drivers"("carrier_id", "is_active");

-- CreateIndex
CREATE INDEX "drivers_is_compliant_is_active_idx" ON "drivers"("is_compliant", "is_active");

-- CreateIndex
CREATE INDEX "compliance_records_type_expiry_date_idx" ON "compliance_records"("type", "expiry_date");

-- CreateIndex
CREATE INDEX "compliance_records_status_is_blocking_idx" ON "compliance_records"("status", "is_blocking");

-- CreateIndex
CREATE INDEX "compliance_records_partner_id_status_idx" ON "compliance_records"("partner_id", "status");

-- CreateIndex
CREATE INDEX "compliance_records_vehicle_id_status_idx" ON "compliance_records"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "compliance_records_driver_id_status_idx" ON "compliance_records"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hse_checklist_templates_code_key" ON "hse_checklist_templates"("code");

-- CreateIndex
CREATE INDEX "hse_checklist_templates_is_active_is_current_idx" ON "hse_checklist_templates"("is_active", "is_current");

-- CreateIndex
CREATE INDEX "hse_checklist_items_template_id_phase_display_order_idx" ON "hse_checklist_items"("template_id", "phase", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "hse_checklist_items_template_id_code_key" ON "hse_checklist_items"("template_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_type_expiry_date_idx" ON "documents"("type", "expiry_date");

-- CreateIndex
CREATE INDEX "documents_partner_id_type_idx" ON "documents"("partner_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "derogations_delegation_id_key" ON "derogations"("delegation_id");

-- CreateIndex
CREATE INDEX "derogations_type_status_granted_at_idx" ON "derogations"("type", "status", "granted_at");

-- CreateIndex
CREATE INDEX "derogations_subject_type_subject_id_idx" ON "derogations"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "derogations_requires_monthly_review_reviewed_at_idx" ON "derogations"("requires_monthly_review", "reviewed_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_scope_year_month_key" ON "number_sequences"("scope", "year", "month");

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_peg_currency_code_fkey" FOREIGN KEY ("peg_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_base_currency_code_fkey" FOREIGN KEY ("base_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_quote_currency_code_fkey" FOREIGN KEY ("quote_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_grantor_id_fkey" FOREIGN KEY ("grantor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegate_user_id_fkey" FOREIGN KEY ("delegate_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegate_field_user_id_fkey" FOREIGN KEY ("delegate_field_user_id") REFERENCES "field_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_credit_limit_currency_code_fkey" FOREIGN KEY ("credit_limit_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_billing_currency_code_fkey" FOREIGN KEY ("billing_currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_sites" ADD CONSTRAINT "partner_sites_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contacts" ADD CONSTRAINT "partner_contacts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_bank_accounts" ADD CONSTRAINT "partner_bank_accounts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_default_price_index_id_fkey" FOREIGN KEY ("default_price_index_id") REFERENCES "price_indices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_indices" ADD CONSTRAINT "price_indices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_assessments" ADD CONSTRAINT "price_assessments_price_index_id_fkey" FOREIGN KEY ("price_index_id") REFERENCES "price_indices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administered_prices" ADD CONSTRAINT "administered_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administered_prices" ADD CONSTRAINT "administered_prices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administered_prices" ADD CONSTRAINT "administered_prices_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_validated_by_id_fkey" FOREIGN KEY ("validated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_posts" ADD CONSTRAINT "cost_posts_cost_pool_id_fkey" FOREIGN KEY ("cost_pool_id") REFERENCES "cost_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_pools" ADD CONSTRAINT "cost_pools_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absorption_rates" ADD CONSTRAINT "absorption_rates_cost_pool_id_fkey" FOREIGN KEY ("cost_pool_id") REFERENCES "cost_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absorption_rates" ADD CONSTRAINT "absorption_rates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_thresholds" ADD CONSTRAINT "margin_thresholds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_thresholds" ADD CONSTRAINT "margin_thresholds_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_thresholds" ADD CONSTRAINT "margin_thresholds_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ullage_tolerances" ADD CONSTRAINT "ullage_tolerances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ullage_tolerances" ADD CONSTRAINT "ullage_tolerances_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hse_checklist_items" ADD CONSTRAINT "hse_checklist_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "hse_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derogations" ADD CONSTRAINT "derogations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derogations" ADD CONSTRAINT "derogations_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derogations" ADD CONSTRAINT "derogations_delegation_id_fkey" FOREIGN KEY ("delegation_id") REFERENCES "delegations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


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
--  relevé faisant autorité, prix indexé arrêté) arrivent au lot 2 avec les
--  entités Deal et Opération.
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
--  C. PRODUITS ET RÉFÉRENCES DE PRIX  (§ 5.3, § 5.5, § 6.2)
-- ---------------------------------------------------------------------------

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_density_range,
  ADD  CONSTRAINT chk_products_density_range
       CHECK (reference_density_15 > 0.4 AND reference_density_15 < 1.2);

ALTER TABLE price_assessments
  DROP CONSTRAINT IF EXISTS chk_price_assessments_range,
  ADD  CONSTRAINT chk_price_assessments_range
       CHECK (low > 0 AND high >= low),

  -- Le « mean of Platts » est la moyenne de la fourchette publiée, pas une
  -- valeur libre : une saisie divergente fausserait tout prix indexé.
  DROP CONSTRAINT IF EXISTS chk_price_assessments_mean,
  ADD  CONSTRAINT chk_price_assessments_mean
       CHECK (abs(mean - round((low + high) / 2, 4)) <= 0.0001);

ALTER TABLE administered_prices
  DROP CONSTRAINT IF EXISTS chk_administered_prices_positive,
  ADD  CONSTRAINT chk_administered_prices_positive
       CHECK (price > 0),

  DROP CONSTRAINT IF EXISTS chk_administered_prices_period,
  ADD  CONSTRAINT chk_administered_prices_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from),

  -- Un prix administré est publié par la DGH (pompe) ou fixé par la SIR.
  -- Aucun autre type de référence n'a sa place dans cette table.
  DROP CONSTRAINT IF EXISTS chk_administered_prices_reference_type,
  ADD  CONSTRAINT chk_administered_prices_reference_type
       CHECK (reference_type::text IN ('PUMP', 'SIR'));

COMMENT ON TABLE administered_prices IS
  'Prix administrés DGH / SIR — RÉFÉRENCE CONSULTABLE au moment de fixer un prix de vente (§ 5.3). Aucune décomposition, aucune dérivation automatique. N''alimente jamais un coût : le coût d''achat provient exclusivement d''un supplier_prices validé.';

ALTER TABLE supplier_prices
  DROP CONSTRAINT IF EXISTS chk_supplier_prices_positive,
  ADD  CONSTRAINT chk_supplier_prices_positive
       CHECK (unit_price >= 0 AND (min_volume IS NULL OR min_volume > 0)),

  DROP CONSTRAINT IF EXISTS chk_supplier_prices_period,
  ADD  CONSTRAINT chk_supplier_prices_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from),

  DROP CONSTRAINT IF EXISTS chk_supplier_prices_discount_range,
  ADD  CONSTRAINT chk_supplier_prices_discount_range
       CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100)),

  -- Un prix fournisseur validé porte son valideur et sa date (§ 6.3).
  DROP CONSTRAINT IF EXISTS chk_supplier_prices_validation_complete,
  ADD  CONSTRAINT chk_supplier_prices_validation_complete
       CHECK (
         (validated_by_id IS NULL AND validated_at IS NULL)
         OR (validated_by_id IS NOT NULL AND validated_at IS NOT NULL)
       );


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

-- --- Cotations publiées ----------------------------------------------------
-- Les cotations font foi dans le calcul d'un prix indexé : une cotation
-- réécrite après coup changerait rétroactivement le prix d'un deal.
-- La correction se fait par insertion, jamais par écrasement.
DROP TRIGGER IF EXISTS trg_price_assessments_no_delete ON price_assessments;
CREATE TRIGGER trg_price_assessments_no_delete
  BEFORE DELETE ON price_assessments
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
  -- Cotations, taux de change, prix administrés et taux d'absorption rendent
  -- reproductibles des pièces déjà émises. On clôt une période, on n'efface pas.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON price_assessments FROM erp_app';
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
