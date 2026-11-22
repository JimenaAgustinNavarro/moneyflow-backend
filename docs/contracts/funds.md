# Contrato HTTP / TCP — Fondos Virtuales (MF-013)

Todos los endpoints HTTP bajo `/api/v1/funds` requieren autenticación mediante cookie `HttpOnly` (`mf_access_token` validada por `JwtAuthGuard`) y las operaciones de escritura (`POST`, `PATCH`, `DELETE`) están protegidas además por `OriginCsrfGuard` global.

El `userId` propietario del recurso se propaga exclusivamente dentro del `InternalAuthContext` firmado en `SignedTcpEnvelope<TPayload>`.

El saldo (`balance`) de cada fondo **nunca** se almacena en una columna mutable: siempre se deriva dinámicamente mediante `SUM(fund_entries.signed_amount)` y se serializa como `string` decimal exacto con 2 decimales (`"0.00"`, `"1250.50"`, `"-40.00"`).

---

## 1. Listar fondos (`GET /api/v1/funds`, `200 OK`)

- **TCP Pattern:** `funds.list` (`FUNDS_PATTERNS.LIST`)
- **Query Params (`ListFundsQueryDto`):**
  - `includeArchived?: boolean` (default `false`; solo acepta `'true'`, `'false'` o booleano)
  - `currency?: 'PEN' | 'USD'`
  - `type?: 'CASH' | 'BANK' | 'WALLET' | 'SAVINGS' | 'OTHER'`
- **Response (`200 OK`):**
  ```json
  {
    "funds": [
      {
        "id": "uuid",
        "name": "Efectivo",
        "type": "CASH",
        "currency": "PEN",
        "color": "#10B981",
        "icon": "wallet",
        "allowNegativeBalance": false,
        "isArchived": false,
        "balance": "1250.50",
        "createdAt": "2026-11-22T12:00:00.000Z",
        "updatedAt": "2026-11-22T12:00:00.000Z"
      }
    ],
    "totalsByCurrency": [
      {
        "currency": "PEN",
        "totalBalance": "1250.50",
        "fundCount": 1
      }
    ]
  }
  ```
- **Notas:** `totalsByCurrency` agrupa estrictamente por moneda (`PEN` primero, luego `USD`) usando `Decimal`, sin mezclar monedas. Si no hay fondos, retorna `[]`.
- **Errores:** `400 Bad Request`, `401 Unauthorized`.

---

## 2. Obtener detalle de fondo (`GET /api/v1/funds/:id`, `200 OK`)

- **TCP Pattern:** `funds.getById` (`FUNDS_PATTERNS.GET_BY_ID`)
- **Params:** `:id` (UUID RFC 4122 validado por `ParseUUIDPipe`)
- **Response (`200 OK`):** `{ fund: { ...FundView, entryCount: number } }`
- **Errores:** `400 Bad Request` (UUID inválido), `401 Unauthorized`, `404 Not Found` (no existe o pertenece a otro usuario).

---

## 3. Crear fondo (`POST /api/v1/funds`, `201 Created`)

- **TCP Pattern:** `funds.create` (`FUNDS_PATTERNS.CREATE`)
- **Body (`CreateFundDto`):**
  - `name` (`string`, `1..100` tras trim)
  - `type` (`'CASH' | 'BANK' | 'WALLET' | 'SAVINGS' | 'OTHER'`)
  - `currency?` (`'PEN' | 'USD'`, default `'PEN'`)
  - `color?` (`string`, formato `#RRGGBB`)
  - `icon?` (`string`, `1..50` tras trim)
  - `allowNegativeBalance?` (`boolean`, default `false`)
  - `initialBalance?` (`string`, decimal exacto no negativo hasta 2 decimales, máx `"999999999999.99"`)
- **Comportamiento ACID de `initialBalance`:**
  - Si `initialBalance` se omite o equivale a `"0.00"`, solo se crea el fondo (`balance = "0.00"`).
  - Si `initialBalance > "0.00"`, dentro de una misma transacción ACID se crea el fondo, una cabecera `financial_transactions` (`type = 'ADJUSTMENT'`, `occurred_on = getLimaToday()`, `description = 'Saldo inicial'`) y su asiento `fund_entries` (`signed_amount = initialBalance`).
- **Response (`201 Created`):** `{ fund: FundView }`
- **Errores:** `400 Bad Request`, `401 Unauthorized`, `403 Forbidden` (CSRF), `409 Conflict` (nombre activo duplicado para el usuario).

---

## 4. Actualizar metadatos de fondo (`PATCH /api/v1/funds/:id`, `200 OK`)

- **TCP Pattern:** `funds.update` (`FUNDS_PATTERNS.UPDATE`)
- **Params:** `:id` (UUID RFC 4122 validado por `ParseUUIDPipe`)
- **Body (`UpdateFundDto`):** al menos un campo entre `name?`, `type?`, `color?` (`string | null`), `icon?` (`string | null`), `allowNegativeBalance?`.
  - `currency` es inmutable tras la creación; enviarlo en el body produce `400 Bad Request` (`forbidNonWhitelisted`).
  - Body vacío `{}` produce `400 Bad Request`.
- **Invariantes:**
  - Bloqueo transaccional `FOR UPDATE` sobre la fila de `funds`.
  - Rechaza con `409 Conflict` si el fondo está archivado o si se intenta cambiar `allowNegativeBalance` de `true` a `false` cuando el saldo derivado actual es `< 0`.
  - Retorna siempre el `balance` real derivado del ledger.
- **Response (`200 OK`):** `{ fund: FundView }`
- **Errores:** `400 Bad Request`, `401 Unauthorized`, `403 Forbidden` (CSRF), `404 Not Found`, `409 Conflict`.

---

## 5. Archivar fondo (`DELETE /api/v1/funds/:id`, `200 OK`)

- **TCP Pattern:** `funds.archive` (`FUNDS_PATTERNS.ARCHIVE`)
- **Params:** `:id` (UUID RFC 4122 validado por `ParseUUIDPipe`)
- **Comportamiento:** Archivado lógico (`is_archived = true`), nunca borrado físico.
- **Invariantes:**
  - Bloqueo transaccional `FOR UPDATE` sobre la fila de `funds`.
  - Solo permite archivar si `is_archived = false` y el saldo derivado actual es `"0.00"`.
- **Response (`200 OK`):** `{ fund: FundView, message: "Fund archived successfully." }`
- **Errores:** `400 Bad Request`, `401 Unauthorized`, `403 Forbidden` (CSRF), `404 Not Found`, `409 Conflict` (ya archivado o saldo distinto de `"0.00"`).
