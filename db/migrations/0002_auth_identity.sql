-- ============================================================================
-- Migración: 0002_auth_identity.sql
-- Tarjeta:   MF-005
-- Objetivo:  Crear tipos enum, tablas, constraints e índices para identidad,
--            sesiones con refresh token family, tokens de verificación/reset
--            y auditoría de autenticación en el esquema public.
-- ============================================================================

BEGIN;

-- 1. Tipos ENUM en esquema public (creación idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'auth_token_type'
  ) THEN
    CREATE TYPE public.auth_token_type AS ENUM (
      'EMAIL_VERIFICATION',
      'PASSWORD_RESET'
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
    WHERE n.nspname = 'public' AND t.typname = 'auth_audit_event'
  ) THEN
    CREATE TYPE public.auth_audit_event AS ENUM (
      'REGISTER',
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'SESSION_REVOKED',
      'EMAIL_VERIFIED',
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET_COMPLETED',
      'PASSWORD_CHANGED'
    );
  END IF;
END
$$;

-- 2. Tabla de usuarios
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  preferred_currency VARCHAR(3) NOT NULL DEFAULT 'PEN',
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Lima',
  email_verified_at TIMESTAMPTZ NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_email_normalized_chk CHECK (email = LOWER(BTRIM(email)) AND LENGTH(email) > 0),
  CONSTRAINT users_preferred_currency_chk CHECK (preferred_currency = 'PEN'),
  CONSTRAINT users_timezone_chk CHECK (timezone = 'America/Lima')
);

-- 3. Tabla de sesiones de usuario (rotación de refresh tokens por family_id)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  refresh_token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  replaced_by_session_id UUID NULL REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash),
  CONSTRAINT user_sessions_expires_after_created_chk CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_no_self_replacement_chk CHECK (
    replaced_by_session_id IS NULL OR replaced_by_session_id <> id
  )
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS user_sessions_family_id_idx
  ON public.user_sessions (family_id);

CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
  ON public.user_sessions (expires_at);

-- 4. Tabla de tokens de un solo uso (verificación de correo / reseteo de clave)
CREATE TABLE IF NOT EXISTS public.auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type public.auth_token_type NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_tokens_expires_after_created_chk CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_id_type_idx
  ON public.auth_tokens (user_id, type);

CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx
  ON public.auth_tokens (expires_at);

-- 5. Tabla de auditoría de eventos de autenticación
CREATE TABLE IF NOT EXISTS public.auth_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  event public.auth_audit_event NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  request_id VARCHAR(128) NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS auth_audit_logs_user_id_created_at_idx
  ON public.auth_audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_audit_logs_event_created_at_idx
  ON public.auth_audit_logs (event, created_at DESC);

-- 6. Autoverificación post-DDL
DO $$
DECLARE
  v_missing_tables text[];
  v_missing_types text[];
BEGIN
  SELECT ARRAY(
    SELECT req_table
    FROM unnest(ARRAY['users', 'user_sessions', 'auth_tokens', 'auth_audit_logs']) AS req_table
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = req_table
    )
  ) INTO v_missing_tables;

  IF array_length(v_missing_tables, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan tablas requeridas en public: %', v_missing_tables;
  END IF;

  SELECT ARRAY(
    SELECT req_type
    FROM unnest(ARRAY['auth_token_type', 'auth_audit_event']) AS req_type
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_type pt
      JOIN pg_namespace pn ON pn.oid = pt.typnamespace
      WHERE pn.nspname = 'public' AND pt.typname = req_type
    )
  ) INTO v_missing_types;

  IF array_length(v_missing_types, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan tipos enum requeridos en public: %', v_missing_types;
  END IF;
END
$$;

COMMIT;
