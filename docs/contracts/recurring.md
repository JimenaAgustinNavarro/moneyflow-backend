# Contrato API — Obligaciones Recurrentes (`MF-023`)

Prefijo HTTP público: `/api/v1/recurring` (autenticado con cookie JWT `HttpOnly`; mutaciones protegidas por `OriginCsrfGuard`).
Patrones TCP internos (`apps/core-service`, módulo `planning`): `PLANNING_PATTERNS.*`.

## Endpoints

| Método y Ruta | Status | Patrón TCP | Descripción |
|---|---|---|---|
| `POST /api/v1/recurring/rules` | `201` | `planning.createRule` | Crea regla y materializa ocurrencias en `[hoy_Lima, hoy_Lima + 60d]`. |
| `GET /api/v1/recurring/rules` | `200` | `planning.listRules` | Lista reglas con filtros opcionales (`includeArchived`, `isActive`, `kind`, `currency`, `frequency`). |
| `GET /api/v1/recurring/rules/:id` | `200` | `planning.getRuleById` | Obtiene detalle de una regla propia. |
| `PATCH /api/v1/recurring/rules/:id` | `200` | `planning.updateRule` | Actualiza regla (`kind` y `currency` inmutables) preservando `PAID`, `SKIPPED` y vencidas. |
| `POST /api/v1/recurring/rules/:id/pause` | `200` | `planning.pauseRule` | Pausa regla (`isActive = false`), idempotente si ya pausada (`409` si archivada). |
| `POST /api/v1/recurring/rules/:id/resume` | `200` | `planning.resumeRule` | Reanuda regla (`isActive = true`) y materializa 60d (`409` si archivada). |
| `POST /api/v1/recurring/rules/:id/archive` | `200` | `planning.archiveRule` | Archiva regla (`isArchived = true, isActive = false`) y elimina `PENDING >= hoy_Lima`. |
| `GET /api/v1/recurring/occurrences` | `200` | `planning.listOccurrences` | Materializa 60d de reglas activas, lista ocurrencias y calcula `totalsByCurrency` (`PEN`, `USD`). |
| `POST /api/v1/recurring/occurrences/:id/pay` | `201` | `planning.payOccurrence` | Pago manual ACID con `Idempotency-Key` obligatorio (1..128 chars). |
| `POST /api/v1/recurring/occurrences/:id/skip` | `200` | `planning.skipOccurrence` | Omite ocurrencia `PENDING -> SKIPPED`. |
| `POST /api/v1/recurring/occurrences/:id/unskip` | `200` | `planning.unskipOccurrence` | Reactiva ocurrencia `SKIPPED -> PENDING`. |

## Reversión Atómica en `VOID`
Al anular (`POST /api/v1/transactions/:id/void`) una transacción vinculada a una ocurrencia `PAID`, `LedgerService.voidTransaction` revierte atómicamente la ocurrencia a `PENDING`, limpia `paid_transaction_id`, `paid_amount`, `paid_at` y registra `last_voided_transaction_id` + `last_voided_at`, devolviendo `revertedRecurringOccurrenceId` en `VoidTransactionResponse`.
