# Registro de Orden de Migraciones SQL — MoneyFlow

Control estricto y auditable de scripts SQL versionados ejecutados sobre `moneyflow_dev` (PostgreSQL).

## Estándar de Migraciones

1. **Ubicación:** `db/migrations/`
2. **Nomenclatura:** Prefijo numérico de **4 dígitos correlativos** seguido de nombre descriptivo en minúsculas `snake_case` (ej. `0001_init_extensions.sql`).
3. **Prohibiciones:** Está terminantemente prohibido usar `prisma db push` o `prisma migrate dev`.
4. **Idempotencia y atomicidad:** Todo script debe ser ejecutable sin efectos secundarios ante reintentos controlados (`IF NOT EXISTS` / bloques transaccionales cuando aplique).
5. **Registro obligatorio:** Ninguna migración se considera aplicada si no figura en la tabla de control con su checksum SHA-256.

---

## Historial de Migraciones Aplicadas

| Orden | Archivo | Tarjeta | Fecha (America/Lima) | Dependencias | Checksum (SHA-256) | Estado |
|---|---|---|---|---|---|---|
| `0001` | `0001_init_extensions.sql` | `MF-002` | `2026-11-21` | Ninguna (inicial) | `AD264B6AD0AD14D8A1BEFCF99379BF9FCD6D75FC9BD376873D5402AC861F0EC3` | Aplicada |
| `0002` | `0002_auth_identity.sql` | `MF-005` | `2026-11-21` | `0001` | `C189582A612BD6FDDD190508FB6681D0E7E0F0F3C039B3047EEF3007F7982082` | Aplicada |
| `0003` | `0003_financial_core.sql` | `MF-011` | `2026-11-22` | `0002` | `079D04D90F4AFF857F7D76F31DDDDEF164B630933D23C7990F30CB3FB992EF2E` | Aplicada |
| `0004` | `0004_seed_system_categories.sql` | `MF-012` | `2026-11-22` | `0003` | `A14DDA2DADEFF92405C8B8E86B614230A612BDE2F9FA6C2ECA9E64C70D8083FA` | Aplicada |

---

## Ficha de Detalle por Migración

### `0001_init_extensions.sql`
- **Motivo:** Habilitar la extensión `pgcrypto` (necesaria para `gen_random_uuid()` y utilidades criptográficas en BD) y validar que la instancia PostgreSQL opera con zona horaria `America/Lima`.
- **Dependencias:** Contenedor `moneyflow-postgres` en estado `healthy` y base de datos `moneyflow_dev` inicializada.
- **Comando de ejecución:**
  ```powershell
  Get-Content db/migrations/0001_init_extensions.sql -Raw | docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -v ON_ERROR_STOP=1
  ```
- **Validación:**
  ```powershell
  docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto'; SHOW TIMEZONE;"
  ```
- **Rollback:**
  ```sql
  -- Solo si ninguna tabla o función posterior depende de pgcrypto:
  DROP EXTENSION IF EXISTS "pgcrypto";
  ```

### `0002_auth_identity.sql`
- **Motivo:** Crear los tipos enum `auth_token_type` y `auth_audit_event`, y las tablas `users`, `user_sessions`, `auth_tokens` y `auth_audit_logs` con sus constraints de normalización, unicidad, integridad referencial e índices de búsqueda.
- **Dependencias:** `0001_init_extensions.sql` aplicada (`pgcrypto` activo y zona horaria `America/Lima`).
- **Comando de ejecución:**
  ```powershell
  Get-Content db/migrations/0002_auth_identity.sql -Raw | docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -v ON_ERROR_STOP=1
  ```
- **Validación:**
  ```powershell
  docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -c "\dt public.*" -c "\dT+ public.*"
  ```
- **Rollback:**
  ```sql
  DROP TABLE IF EXISTS public.auth_audit_logs;
  DROP TABLE IF EXISTS public.auth_tokens;
  DROP TABLE IF EXISTS public.user_sessions;
  DROP TABLE IF EXISTS public.users;
  DROP TYPE IF EXISTS public.auth_audit_event;
  DROP TYPE IF EXISTS public.auth_token_type;
  ```

### `0003_financial_core.sql`
- **Motivo:** Crear los tipos enum (`currency_code`, `fund_type`, `category_kind`, `transaction_type`, `transaction_status`), la función/triggers `set_updated_at_timestamp()`, y las 5 tablas del Núcleo Financiero (`funds`, `categories`, `financial_transactions`, `fund_entries`, `transaction_splits`) con aislamiento compuesto `(id, user_id)` / `(id, user_id, currency)`, índice único parcial anti doble-`VOID`, índice de idempotencia parcial y sin columna mutable de saldo en `funds`.
- **Dependencias:** `0002_auth_identity.sql` aplicada (`public.users` y `public.user_sessions` existentes).
- **Comando de ejecución:**
  ```powershell
  Get-Content db/migrations/0003_financial_core.sql -Raw | docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -v ON_ERROR_STOP=1
  ```
- **Validación:**
  ```powershell
  docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -c "\dt public.*" -c "\dT+ public.*" -c "\d public.funds" -c "\d public.categories" -c "\d public.financial_transactions" -c "\d public.fund_entries" -c "\d public.transaction_splits"
  ```
- **Rollback:**
  ```sql
  DROP TRIGGER IF EXISTS trg_financial_transactions_set_updated_at ON public.financial_transactions;
  DROP TRIGGER IF EXISTS trg_categories_set_updated_at ON public.categories;
  DROP TRIGGER IF EXISTS trg_funds_set_updated_at ON public.funds;
  DROP TRIGGER IF EXISTS trg_user_sessions_set_updated_at ON public.user_sessions;
  DROP TRIGGER IF EXISTS trg_users_set_updated_at ON public.users;
  DROP FUNCTION IF EXISTS public.set_updated_at_timestamp();
  DROP TABLE IF EXISTS public.transaction_splits;
  DROP TABLE IF EXISTS public.fund_entries;
  DROP TABLE IF EXISTS public.financial_transactions;
  DROP TABLE IF EXISTS public.categories;
  DROP TABLE IF EXISTS public.funds;
  DROP TYPE IF EXISTS public.transaction_status;
  DROP TYPE IF EXISTS public.transaction_type;
  DROP TYPE IF EXISTS public.category_kind;
  DROP TYPE IF EXISTS public.fund_type;
  DROP TYPE IF EXISTS public.currency_code;
  ```

### `0004_seed_system_categories.sql`
- **Motivo:** Poblar de forma versionada e idempotente las 14 categorías globales base del sistema (5 `INCOME` y 9 `EXPENSE`) con colores hex `#RRGGBB` sobrios e iconos de Lucide Icons, garantizando `is_system = TRUE`, `user_id = NULL` e `is_archived = FALSE`.
- **Dependencias:** `0003_financial_core.sql` aplicada (tabla `public.categories` y tipo enum `public.category_kind`).
- **Comando de ejecución:**
  ```powershell
  Get-Content db/migrations/0004_seed_system_categories.sql -Raw | docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -v ON_ERROR_STOP=1
  ```
- **Validación:**
  ```powershell
  docker exec -i moneyflow-postgres psql -U postgres -d moneyflow_dev -c "SELECT kind, count(*) FROM public.categories WHERE is_system = TRUE AND is_archived = FALSE GROUP BY kind ORDER BY kind;"
  ```
- **Rollback:**
  ```sql
  DELETE FROM public.categories WHERE is_system = TRUE;
  ```

