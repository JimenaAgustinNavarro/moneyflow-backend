-- ============================================================================
-- Migración: 0003_financial_core.sql
-- Tarjeta:   MF-011
-- Objetivo:  Crear enums, tablas, constraints de aislamiento y moneda,
--            índices parciales/compuestos y triggers updated_at para el
--            Núcleo Financiero (funds, categories, financial_transactions,
--            fund_entries, transaction_splits) en el esquema public.
-- ============================================================================

BEGIN;

-- 1. Tipos ENUM en esquema public (creación idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'currency_code'
  ) THEN
    CREATE TYPE public.currency_code AS ENUM ('PEN', 'USD');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'fund_type'
  ) THEN
    CREATE TYPE public.fund_type AS ENUM ('CASH', 'BANK', 'WALLET', 'SAVINGS', 'OTHER');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'category_kind'
  ) THEN
    CREATE TYPE public.category_kind AS ENUM ('INCOME', 'EXPENSE');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'transaction_type'
  ) THEN
    CREATE TYPE public.transaction_type AS ENUM (
      'INCOME',
      'EXPENSE',
      'TRANSFER',
      'ADJUSTMENT',
      'VOID',
      'REFUND'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'transaction_status'
  ) THEN
    CREATE TYPE public.transaction_status AS ENUM ('POSTED', 'VOIDED');
  END IF;
END
$$;

-- 2. Función reutilizable para mantenimiento automático de updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 3. Tabla funds (sin columna balance/current_balance; el saldo se deriva de fund_entries)
CREATE TABLE IF NOT EXISTS public.funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  type public.fund_type NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'PEN',
  color VARCHAR(20) NULL,
  icon VARCHAR(50) NULL,
  allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT funds_name_nonempty_chk CHECK (LENGTH(BTRIM(name)) > 0),
  CONSTRAINT funds_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT funds_id_user_id_currency_key UNIQUE (id, user_id, currency)
);

CREATE UNIQUE INDEX IF NOT EXISTS funds_user_id_active_name_uidx
  ON public.funds (user_id, LOWER(BTRIM(name)))
  WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS funds_user_id_is_archived_idx
  ON public.funds (user_id, is_archived);

-- 4. Tabla categories (globales de sistema con user_id NULL o propias por usuario)
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  kind public.category_kind NOT NULL,
  color VARCHAR(20) NULL,
  icon VARCHAR(50) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT categories_name_nonempty_chk CHECK (LENGTH(BTRIM(name)) > 0),
  CONSTRAINT categories_system_owner_chk CHECK (
    (is_system = TRUE AND user_id IS NULL) OR
    (is_system = FALSE AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_system_kind_name_uidx
  ON public.categories (kind, LOWER(BTRIM(name)))
  WHERE is_system = TRUE AND is_archived = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS categories_user_id_kind_name_uidx
  ON public.categories (user_id, kind, LOWER(BTRIM(name)))
  WHERE is_system = FALSE AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS categories_user_id_kind_is_archived_idx
  ON public.categories (user_id, kind, is_archived);

-- 5. Tabla financial_transactions (cabecera de operaciones financieras)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  type public.transaction_type NOT NULL,
  status public.transaction_status NOT NULL DEFAULT 'POSTED',
  amount DECIMAL(14, 2) NOT NULL,
  currency public.currency_code NOT NULL,
  occurred_on DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description VARCHAR(200) NOT NULL,
  notes VARCHAR(500) NULL,
  category_id UUID NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  related_transaction_id UUID NULL REFERENCES public.financial_transactions(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(128) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT financial_transactions_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT financial_transactions_description_nonempty_chk CHECK (LENGTH(BTRIM(description)) > 0),
  CONSTRAINT financial_transactions_idempotency_key_nonempty_chk CHECK (
    idempotency_key IS NULL OR LENGTH(BTRIM(idempotency_key)) > 0
  ),
  CONSTRAINT financial_transactions_no_self_reference_chk CHECK (
    related_transaction_id IS NULL OR related_transaction_id <> id
  ),
  CONSTRAINT financial_transactions_related_tx_type_chk CHECK (
    (type IN ('VOID', 'REFUND') AND related_transaction_id IS NOT NULL) OR
    (type NOT IN ('VOID', 'REFUND') AND related_transaction_id IS NULL)
  ),
  CONSTRAINT financial_transactions_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT financial_transactions_id_user_id_currency_key UNIQUE (id, user_id, currency),
  CONSTRAINT financial_transactions_related_owner_fk
    FOREIGN KEY (related_transaction_id, user_id)
    REFERENCES public.financial_transactions(id, user_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_user_id_idempotency_key_uidx
  ON public.financial_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS financial_transactions_single_void_per_related_uidx
  ON public.financial_transactions (related_transaction_id)
  WHERE type = 'VOID' AND related_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_transactions_user_id_occurred_on_created_at_idx
  ON public.financial_transactions (user_id, occurred_on DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS financial_transactions_user_id_type_status_idx
  ON public.financial_transactions (user_id, type, status);

CREATE INDEX IF NOT EXISTS financial_transactions_category_id_idx
  ON public.financial_transactions (category_id);

CREATE INDEX IF NOT EXISTS financial_transactions_related_transaction_id_idx
  ON public.financial_transactions (related_transaction_id);

-- 6. Tabla fund_entries (ledger inmutable de asientos con blindaje de propietario y moneda)
CREATE TABLE IF NOT EXISTS public.fund_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL,
  fund_id UUID NOT NULL,
  signed_amount DECIMAL(14, 2) NOT NULL,
  currency public.currency_code NOT NULL,
  occurred_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fund_entries_signed_amount_nonzero_chk CHECK (signed_amount <> 0),
  CONSTRAINT fund_entries_transaction_owner_currency_fk
    FOREIGN KEY (transaction_id, user_id, currency)
    REFERENCES public.financial_transactions(id, user_id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT fund_entries_fund_owner_currency_fk
    FOREIGN KEY (fund_id, user_id, currency)
    REFERENCES public.funds(id, user_id, currency)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS fund_entries_user_id_fund_id_idx
  ON public.fund_entries (user_id, fund_id);

CREATE INDEX IF NOT EXISTS fund_entries_user_id_occurred_on_created_at_idx
  ON public.fund_entries (user_id, occurred_on DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS fund_entries_transaction_id_idx
  ON public.fund_entries (transaction_id);

-- 7. Tabla transaction_splits (desglose por categoría con blindaje de propietario)
CREATE TABLE IF NOT EXISTS public.transaction_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  amount DECIMAL(14, 2) NOT NULL,
  note VARCHAR(200) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transaction_splits_amount_positive_chk CHECK (amount > 0),
  CONSTRAINT transaction_splits_transaction_owner_fk
    FOREIGN KEY (transaction_id, user_id)
    REFERENCES public.financial_transactions(id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS transaction_splits_transaction_id_idx
  ON public.transaction_splits (transaction_id);

CREATE INDEX IF NOT EXISTS transaction_splits_user_id_category_id_idx
  ON public.transaction_splits (user_id, category_id);

-- 8. Triggers idempotentes de updated_at en tablas con updated_at
DO $$
DECLARE
  v_table text;
  v_trigger_name text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users',
    'user_sessions',
    'funds',
    'categories',
    'financial_transactions'
  ]
  LOOP
    v_trigger_name := 'trg_' || v_table || '_set_updated_at';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger tg
      JOIN pg_class cl ON cl.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public'
        AND cl.relname = v_table
        AND tg.tgname = v_trigger_name
        AND NOT tg.tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp()',
        v_trigger_name,
        v_table
      );
    END IF;
  END LOOP;
END
$$;

-- 9. Autoverificación post-DDL
DO $$
DECLARE
  v_missing_tables text[];
  v_missing_types text[];
  v_missing_triggers text[];
  v_has_forbidden_balance boolean;
BEGIN
  SELECT ARRAY(
    SELECT req_table
    FROM unnest(ARRAY[
      'funds',
      'categories',
      'financial_transactions',
      'fund_entries',
      'transaction_splits'
    ]) AS req_table
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = req_table
    )
  ) INTO v_missing_tables;

  IF array_length(v_missing_tables, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan tablas financieras requeridas en public: %', v_missing_tables;
  END IF;

  SELECT ARRAY(
    SELECT req_type
    FROM unnest(ARRAY[
      'currency_code',
      'fund_type',
      'category_kind',
      'transaction_type',
      'transaction_status'
    ]) AS req_type
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_type pt
      JOIN pg_namespace pn ON pn.oid = pt.typnamespace
      WHERE pn.nspname = 'public' AND pt.typname = req_type
    )
  ) INTO v_missing_types;

  IF array_length(v_missing_types, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan tipos enum financieros requeridos en public: %', v_missing_types;
  END IF;

  SELECT ARRAY(
    SELECT req_trigger
    FROM unnest(ARRAY[
      'trg_users_set_updated_at',
      'trg_user_sessions_set_updated_at',
      'trg_funds_set_updated_at',
      'trg_categories_set_updated_at',
      'trg_financial_transactions_set_updated_at'
    ]) AS req_trigger
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger tg
      JOIN pg_class cl ON cl.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public'
        AND tg.tgname = req_trigger
        AND NOT tg.tgisinternal
    )
  ) INTO v_missing_triggers;

  IF array_length(v_missing_triggers, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan triggers updated_at requeridos en public: %', v_missing_triggers;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'funds'
      AND c.column_name IN ('balance', 'current_balance')
  ) INTO v_has_forbidden_balance;

  IF v_has_forbidden_balance THEN
    RAISE EXCEPTION 'Invariante violada: public.funds no debe tener columna balance ni current_balance';
  END IF;
END
$$;

COMMIT;
