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
