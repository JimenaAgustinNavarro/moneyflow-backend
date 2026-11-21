-- ============================================================================
-- Migración: 0001_init_extensions.sql
-- Tarjeta:   MF-002
-- Objetivo:  Habilitar extensiones base requeridas por MoneyFlow de forma
--            idempotente y verificar la zona horaria operativa (America/Lima).
-- ============================================================================

-- 1. Extensión criptográfica para generación de UUIDv4 (gen_random_uuid) y hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Verificación de configuración base de sesión/instancia
DO $$
DECLARE
  v_tz text;
  v_has_pgcrypto boolean;
BEGIN
  SELECT current_setting('TIMEZONE') INTO v_tz;
  IF v_tz <> 'America/Lima' THEN
    RAISE EXCEPTION 'Zona horaria inesperada en PostgreSQL: %, se esperaba America/Lima', v_tz;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
  ) INTO v_has_pgcrypto;

  IF NOT v_has_pgcrypto THEN
    RAISE EXCEPTION 'La extensión pgcrypto no quedó instalada correctamente';
  END IF;
END
$$;
