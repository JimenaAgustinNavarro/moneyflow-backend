-- ============================================================================
-- Migración: 0005_recurring_obligations.sql
-- Tarjeta:   MF-023
-- Objetivo:  Crear enums, tablas, constraints de aislamiento/moneda/estado,
--            índices y triggers updated_at para el módulo de Obligaciones
--            Recurrentes (recurring_rules, recurring_occurrences) en public.
-- ============================================================================

BEGIN;

-- 1. Tipos ENUM en esquema public (creación idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'recurring_frequency'
  ) THEN
    CREATE TYPE public.recurring_frequency AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'recurring_occurrence_status'
  ) THEN
    CREATE TYPE public.recurring_occurrence_status AS ENUM ('PENDING', 'PAID', 'SKIPPED');
  END IF;
END
$$;

-- 2. Tabla public.recurring_rules
CREATE TABLE IF NOT EXISTS public.recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  kind public.category_kind NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency public.currency_code NOT NULL,
  frequency public.recurring_frequency NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  anchor_day SMALLINT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  default_fund_id UUID NULL,
  notes VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recurring_rules_name_nonempty_chk CHECK (LENGTH(BTRIM(name)) > 0),
  CONSTRAINT recurring_rules_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT recurring_rules_anchor_day_chk CHECK (anchor_day BETWEEN 1 AND 31),
  CONSTRAINT recurring_rules_date_range_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT recurring_rules_archived_inactive_chk CHECK (NOT is_archived OR is_active = FALSE),
  CONSTRAINT recurring_rules_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT recurring_rules_id_user_id_currency_key UNIQUE (id, user_id, currency),
  CONSTRAINT recurring_rules_default_fund_owner_currency_fk
    FOREIGN KEY (default_fund_id, user_id, currency)
    REFERENCES public.funds(id, user_id, currency)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS recurring_rules_user_id_archived_active_idx
  ON public.recurring_rules (user_id, is_archived, is_active);

CREATE INDEX IF NOT EXISTS recurring_rules_user_id_category_id_idx
  ON public.recurring_rules (user_id, category_id);

CREATE INDEX IF NOT EXISTS recurring_rules_default_fund_id_idx
  ON public.recurring_rules (default_fund_id)
  WHERE default_fund_id IS NOT NULL;

-- 3. Tabla public.recurring_occurrences
CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  rule_id UUID NOT NULL,
  scheduled_date DATE NOT NULL,
  expected_amount DECIMAL(14, 2) NOT NULL,
  currency public.currency_code NOT NULL,
  status public.recurring_occurrence_status NOT NULL DEFAULT 'PENDING',
  paid_transaction_id UUID NULL,
  paid_amount DECIMAL(14, 2) NULL,
  paid_at TIMESTAMPTZ NULL,
  skipped_at TIMESTAMPTZ NULL,
  last_voided_transaction_id UUID NULL,
  last_voided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recurring_occurrences_expected_amount_positive_chk CHECK (expected_amount > 0),
  CONSTRAINT recurring_occurrences_paid_amount_positive_chk CHECK (paid_amount IS NULL OR paid_amount > 0),
  CONSTRAINT recurring_occurrences_status_fields_chk CHECK (
    (status = 'PENDING' AND paid_transaction_id IS NULL AND paid_amount IS NULL AND paid_at IS NULL AND skipped_at IS NULL) OR
    (status = 'PAID'    AND paid_transaction_id IS NOT NULL AND paid_amount IS NOT NULL AND paid_at IS NOT NULL AND skipped_at IS NULL) OR
    (status = 'SKIPPED' AND paid_transaction_id IS NULL AND paid_amount IS NULL AND paid_at IS NULL AND skipped_at IS NOT NULL)
  ),
  CONSTRAINT recurring_occurrences_rule_scheduled_date_key UNIQUE (rule_id, scheduled_date),
  CONSTRAINT recurring_occurrences_rule_owner_currency_fk
    FOREIGN KEY (rule_id, user_id, currency)
    REFERENCES public.recurring_rules(id, user_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT recurring_occurrences_paid_tx_owner_currency_fk
    FOREIGN KEY (paid_transaction_id, user_id, currency)
    REFERENCES public.financial_transactions(id, user_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT recurring_occurrences_last_voided_tx_owner_fk
    FOREIGN KEY (last_voided_transaction_id, user_id)
    REFERENCES public.financial_transactions(id, user_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS recurring_occurrences_paid_transaction_id_uidx
  ON public.recurring_occurrences (paid_transaction_id)
  WHERE paid_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recurring_occurrences_user_id_scheduled_date_status_idx
  ON public.recurring_occurrences (user_id, scheduled_date ASC, status);

CREATE INDEX IF NOT EXISTS recurring_occurrences_rule_id_status_scheduled_date_idx
  ON public.recurring_occurrences (rule_id, status, scheduled_date ASC);

CREATE INDEX IF NOT EXISTS recurring_occurrences_last_voided_tx_idx
  ON public.recurring_occurrences (last_voided_transaction_id)
  WHERE last_voided_transaction_id IS NOT NULL;

-- 4. Triggers updated_at
DROP TRIGGER IF EXISTS trg_recurring_rules_set_updated_at ON public.recurring_rules;
CREATE TRIGGER trg_recurring_rules_set_updated_at
  BEFORE UPDATE ON public.recurring_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_recurring_occurrences_set_updated_at ON public.recurring_occurrences;
CREATE TRIGGER trg_recurring_occurrences_set_updated_at
  BEFORE UPDATE ON public.recurring_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- 5. Autoverificación post-DDL
DO $$
BEGIN
  IF to_regclass('public.recurring_rules') IS NULL THEN
    RAISE EXCEPTION 'Post-DDL check failed: public.recurring_rules does not exist';
  END IF;

  IF to_regclass('public.recurring_occurrences') IS NULL THEN
    RAISE EXCEPTION 'Post-DDL check failed: public.recurring_occurrences does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'recurring_frequency'
  ) THEN
    RAISE EXCEPTION 'Post-DDL check failed: public.recurring_frequency enum does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'recurring_occurrence_status'
  ) THEN
    RAISE EXCEPTION 'Post-DDL check failed: public.recurring_occurrence_status enum does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_recurring_rules_set_updated_at'
  ) THEN
    RAISE EXCEPTION 'Post-DDL check failed: trg_recurring_rules_set_updated_at trigger does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_recurring_occurrences_set_updated_at'
  ) THEN
    RAISE EXCEPTION 'Post-DDL check failed: trg_recurring_occurrences_set_updated_at trigger does not exist';
  END IF;

  IF to_regclass('public.recurring_occurrences_paid_transaction_id_uidx') IS NULL THEN
    RAISE EXCEPTION 'Post-DDL check failed: recurring_occurrences_paid_transaction_id_uidx index does not exist';
  END IF;
END
$$;

COMMIT;
