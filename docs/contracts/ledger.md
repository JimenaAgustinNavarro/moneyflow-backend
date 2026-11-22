# Contrato HTTP / TCP — Ledger / Movimientos (MF-014, MF-015, MF-016)

Todos los endpoints HTTP bajo `/api/v1/transactions` requieren autenticación mediante cookie `HttpOnly` (`mf_access_token` validada por `JwtAuthGuard`) y las operaciones de escritura (`POST`) están protegidas además por `OriginCsrfGuard` global.

El `userId` propietario del recurso se propaga exclusivamente dentro del `InternalAuthContext` firmado en `SignedTcpEnvelope<TPayload>`.

Todo monto monetario se recibe y devuelve como `string` decimal exacto con 2 decimales (`"1250.50"`). Toda operación de escritura se ejecuta dentro de una transacción ACID con bloqueo pesimista `FOR UPDATE` sobre el fondo afectado y soporte de idempotencia mediante `Idempotency-Key`.

---

## 1. Registrar ingreso o egreso (`POST /api/v1/transactions`, `201 Created`)

- **TCP Pattern:** `ledger.recordTransaction` (`LEDGER_PATTERNS.RECORD_TRANSACTION`)
- **Headers opcionales:**
  - `Idempotency-Key`: `string` (`1..128` caracteres tras `trim`). Si se envía vacío o supera `128` caracteres, responde `400 Bad Request`.
- **Body (`RecordTransactionDto`, estricto con `forbidNonWhitelisted: true`):**
  - `type`: `'INCOME' | 'EXPENSE'`
  - `fundId`: UUID válido
  - `amount`: `string` decimal positivo exacto (`/^\d{1,12}(\.\d{1,2})?$/`, `> "0.00"` y `<= "999999999999.99"`)
  - `occurredOn?`: `string` en formato `YYYY-MM-DD` validado en calendario gregoriano estricto (rechaza `"2026-02-31"` con `400`). Default: fecha actual en `America/Lima` (`getLimaToday()`).
  - `description`: `string` (`1..200` caracteres tras `trim`)
  - `notes?`: `string | null` (máx `500` caracteres tras `trim`; vacío se normaliza a `null`)
  - **Regla XOR obligatoria:** debe enviarse `categoryId` **o** `splits`, nunca ambos ni ninguno (`400 Bad Request`):
    - `categoryId?`: UUID válido de una categoría activa cuyo `kind === type`.
    - `splits?`: arreglo de `2..50` ítems (`{ categoryId: UUID, amount: string > 0, note?: string | null <= 200 }`), cuya suma exacta en `Decimal` debe ser igual a `amount`.
- **Response (`201 Created`):**
  ```json
  {
    "transaction": {
      "id": "uuid",
      "type": "EXPENSE",
      "status": "POSTED",
      "amount": "120.00",
      "currency": "PEN",
      "occurredOn": "2026-11-22",
      "recordedAt": "2026-11-22T15:00:00.000Z",
      "description": "Supermercado",
      "notes": null,
      "categoryId": null,
      "relatedTransactionId": null,
      "idempotencyKey": "req-key-001",
      "createdAt": "2026-11-22T15:00:00.000Z",
      "updatedAt": "2026-11-22T15:00:00.000Z",
      "entries": [
        {
          "id": "uuid",
          "fundId": "uuid",
          "signedAmount": "-120.00",
          "currency": "PEN",
          "occurredOn": "2026-11-22",
          "createdAt": "2026-11-22T15:00:00.000Z"
        }
      ],
      "splits": [
        {
          "id": "uuid",
          "categoryId": "uuid",
          "amount": "80.00",
          "note": "Alimentos",
          "createdAt": "2026-11-22T15:00:00.000Z"
        },
        {
          "id": "uuid",
          "categoryId": "uuid",
          "amount": "40.00",
          "note": "Limpieza",
          "createdAt": "2026-11-22T15:00:00.000Z"
        }
      ]
    },
    "fundBalanceAfter": "380.00"
  }
  ```
- **Errores:**
  - `400 Bad Request`: DTO inválido, fecha gregoriana inválida, `categoryId` y `splits` simultáneos o ausentes, `splits < 2` o `> 50`, descuadre decimal en `splits`, categoría con `kind !== type`, o `Idempotency-Key` inválido.
  - `401 Unauthorized`: sesión ausente o inválida.
  - `403 Forbidden`: fallo de `OriginCsrfGuard`.
  - `404 Not Found`: fondo o categoría inexistente o perteneciente a otro usuario.
  - `409 Conflict`: fondo archivado, categoría archivada, saldo insuficiente cuando `allowNegativeBalance = false`, o reutilización de `Idempotency-Key` con parámetros distintos.

---

## 2. Registrar transferencia entre fondos (`POST /api/v1/transactions/transfers`, `201 Created`)

- **TCP Pattern:** `ledger.recordTransfer` (`LEDGER_PATTERNS.RECORD_TRANSFER`)
- **Headers opcionales:**
  - `Idempotency-Key`: `string` (`1..128` caracteres tras `trim`).
- **Body (`RecordTransferDto`, estricto con `forbidNonWhitelisted: true`):**
  - `sourceFundId`: UUID válido
  - `destinationFundId`: UUID válido (distinto de `sourceFundId`)
  - `amount`: `string` decimal positivo exacto (`/^\d{1,12}(\.\d{1,2})?$/`, `> "0.00"` y `<= "999999999999.99"`)
  - `occurredOn?`: `string` `YYYY-MM-DD` (calendario gregoriano estricto; default `getLimaToday()`)
  - `description`: `string` (`1..200` caracteres tras `trim`)
  - `notes?`: `string | null` (máx `500` caracteres tras `trim`; vacío se normaliza a `null`)
- **Invariantes ACID:**
  - Bloqueo pesimista en orden determinista (`ORDER BY id ASC FOR UPDATE`) sobre ambos fondos para prevenir deadlocks cruzados.
  - Ambos fondos deben pertenecer al usuario, estar activos y compartir la misma moneda.
  - Genera 2 asientos en `fund_entries` (`-amount` en `sourceFundId` y `+amount` en `destinationFundId`, suma neta `"0.00"`). En `entries`, el asiento de salida siempre se devuelve primero (`entries[0]`) y el de entrada segundo (`entries[1]`).
- **Response (`201 Created`):**
  ```json
  {
    "transaction": { "...TransactionDetailView (type: TRANSFER)" },
    "sourceFundBalanceAfter": "350.00",
    "destinationFundBalanceAfter": "350.00"
  }
  ```
- **Errores:** `400 Bad Request` (mismo fondo, monedas distintas, DTO/fecha inválida), `401 Unauthorized`, `403 Forbidden`, `404 Not Found` (fondo inexistente o ajeno), `409 Conflict` (fondo archivado, saldo insuficiente en origen o conflicto de `Idempotency-Key`).

---

## 3. Registrar ajuste manual de saldo (`POST /api/v1/transactions/adjustments`, `201 Created`)

- **TCP Pattern:** `ledger.recordAdjustment` (`LEDGER_PATTERNS.RECORD_ADJUSTMENT`)
- **Headers opcionales:**
  - `Idempotency-Key`: `string` (`1..128` caracteres tras `trim`).
- **Body (`RecordAdjustmentDto`, estricto con `forbidNonWhitelisted: true`):**
  - `fundId`: UUID válido
  - `direction`: `'INCREASE' | 'DECREASE'`
  - `amount`: `string` decimal positivo exacto (`> "0.00"` y `<= "999999999999.99"`)
  - `occurredOn?`: `string` `YYYY-MM-DD` (default `getLimaToday()`)
  - `description`: `string` (`1..200` caracteres tras `trim`)
  - `notes?`: `string | null` (máx `500` caracteres tras `trim`)
- **Response (`201 Created`):**
  ```json
  {
    "transaction": { "...TransactionDetailView (type: ADJUSTMENT)" },
    "fundBalanceAfter": "145.25"
  }
  ```
- **Errores:** `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict` (fondo archivado, saldo insuficiente cuando `direction === 'DECREASE'` y `allowNegativeBalance = false`, o conflicto de `Idempotency-Key`).

---

## 4. Obtener detalle de transacción (`GET /api/v1/transactions/:id`, `200 OK`)

- **TCP Pattern:** `ledger.getById` (`LEDGER_PATTERNS.GET_BY_ID`)
- **Params:** `:id` (UUID validado por `ParseUUIDPipe`)
- **Response (`200 OK`):** `{ transaction: TransactionDetailView }`
- **Errores:** `400 Bad Request` (UUID inválido), `401 Unauthorized`, `404 Not Found` (no existe o pertenece a otro usuario).

---

## 5. Anular transacción (`POST /api/v1/transactions/:id/void`, `201 Created`)

- **TCP Pattern:** `ledger.voidTransaction` (`LEDGER_PATTERNS.VOID_TRANSACTION`)
- **Params:** `:id` (UUID validado por `ParseUUIDPipe`)
- **Headers opcionales:**
  - `Idempotency-Key`: `string` (`1..128` caracteres tras `trim`).
- **Body (`VoidTransactionDto`, estricto con `forbidNonWhitelisted: true`):**
  - `reason?`: `string` (`1..200` caracteres tras `trim`; si se omite, se genera `'Anulación: <original.description>'` truncado a `200` caracteres).
  - `occurredOn?`: `string` `YYYY-MM-DD` (calendario gregoriano estricto; default `getLimaToday()`; debe ser `>= original.occurredOn`).
  - `notes?`: `string | null` (máx `500` caracteres tras `trim`; vacío se normaliza a `null`).
- **Invariantes ACID:**
  - Bloqueo `FOR UPDATE` sobre la transacción original y sobre todos los fondos afectados en orden determinista `ORDER BY id ASC`.
  - No se pueden anular transacciones `VOID`, `REFUND`, ya `VOIDED`, o gastos `EXPENSE` que ya tengan `REFUND` asociados.
  - Marca `original.status = 'VOIDED'` e inserta cabecera `VOID` (`status = 'POSTED'`) más contra-asientos en `fund_entries` invirtiendo el signo original.
  - Rechaza con `409 Conflict` si algún fondo está archivado o si el contra-asiento deja saldo negativo con `allowNegativeBalance = false`.
- **Response (`201 Created`):**
  ```json
  {
    "voidTransaction": {
      "id": "uuid",
      "type": "VOID",
      "status": "POSTED",
      "amount": "120.00",
      "currency": "PEN",
      "occurredOn": "2026-11-22",
      "recordedAt": "2026-11-22T16:00:00.000Z",
      "description": "Anulación: Supermercado",
      "notes": null,
      "categoryId": null,
      "relatedTransactionId": "original-uuid",
      "idempotencyKey": "void-key-001",
      "createdAt": "2026-11-22T16:00:00.000Z",
      "updatedAt": "2026-11-22T16:00:00.000Z",
      "entries": [
        {
          "id": "uuid",
          "fundId": "fund-uuid",
          "signedAmount": "120.00",
          "currency": "PEN",
          "occurredOn": "2026-11-22",
          "createdAt": "2026-11-22T16:00:00.000Z"
        }
      ],
      "splits": []
    },
    "originalTransactionId": "original-uuid",
    "originalStatus": "VOIDED",
    "affectedFundBalances": [
      {
        "fundId": "fund-uuid",
        "balanceAfter": "500.00"
      }
    ]
  }
  ```
- **Errores:** `400 Bad Request` (`occurredOn < original.occurredOn`, intento de anular `VOID`/`REFUND`, DTO/UUID inválido), `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict` (ya `VOIDED`, tiene reembolsos, fondo archivado, sobregiro no permitido o conflicto de `Idempotency-Key`).

---

## 6. Registrar reembolso total o parcial (`POST /api/v1/transactions/:id/refund`, `201 Created`)

- **TCP Pattern:** `ledger.refundTransaction` (`LEDGER_PATTERNS.REFUND_TRANSACTION`)
- **Params:** `:id` (UUID validado por `ParseUUIDPipe`)
- **Headers opcionales:**
  - `Idempotency-Key`: `string` (`1..128` caracteres tras `trim`).
- **Body (`RefundTransactionDto`, estricto con `forbidNonWhitelisted: true`):**
  - `amount`: `string` decimal positivo exacto (`> "0.00"`, `<= "999999999999.99"`).
  - `occurredOn?`: `string` `YYYY-MM-DD` (calendario gregoriano estricto; default `getLimaToday()`; debe ser `>= original.occurredOn`).
  - `description?`: `string` (`1..200` caracteres tras `trim`; default `'Reembolso: <original.description>'` truncado a `200` caracteres).
  - `notes?`: `string | null` (máx `500` caracteres tras `trim`; vacío se normaliza a `null`).
- **Invariantes ACID:**
  - Solo aplica sobre transacciones `EXPENSE` con `status = 'POSTED'` cuyo fondo original siga activo (`!isArchived`).
  - La suma acumulada de `REFUND` `POSTED` vinculados a la misma transacción original no puede superar `original.amount`.
  - Acredita `+amount` en el fondo original mediante un nuevo asiento en `fund_entries`.
- **Response (`201 Created`):**
  ```json
  {
    "refundTransaction": {
      "id": "uuid",
      "type": "REFUND",
      "status": "POSTED",
      "amount": "60.00",
      "currency": "PEN",
      "occurredOn": "2026-11-22",
      "recordedAt": "2026-11-22T16:10:00.000Z",
      "description": "Reembolso: Supermercado",
      "notes": null,
      "categoryId": null,
      "relatedTransactionId": "original-uuid",
      "idempotencyKey": "refund-key-001",
      "createdAt": "2026-11-22T16:10:00.000Z",
      "updatedAt": "2026-11-22T16:10:00.000Z",
      "entries": [
        {
          "id": "uuid",
          "fundId": "fund-uuid",
          "signedAmount": "60.00",
          "currency": "PEN",
          "occurredOn": "2026-11-22",
          "createdAt": "2026-11-22T16:10:00.000Z"
        }
      ],
      "splits": []
    },
    "originalTransactionId": "original-uuid",
    "totalRefundedAfter": "60.00",
    "remainingRefundableAmount": "60.00",
    "fundBalanceAfter": "440.00"
  }
  ```
- **Errores:** `400 Bad Request` (transacción no es `EXPENSE`, `occurredOn < original.occurredOn`, DTO/UUID inválido), `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict` (transacción `VOIDED`, fondo archivado, sobre-reembolso acumulado o conflicto de `Idempotency-Key`).

---

## 7. Listar historial filtrado y paginado (`GET /api/v1/transactions`, `200 OK`)

- **TCP Pattern:** `ledger.listTransactions` (`LEDGER_PATTERNS.LIST_TRANSACTIONS`)
- **Query Params (`ListTransactionsQueryDto`, `forbidNonWhitelisted: true`):**
  - `page?`: entero `>= 1` (default `1`)
  - `limit?`: entero `1..100` (default `20`)
  - `fundId?`: UUID
  - `categoryId?`: UUID (incluye transacciones con `categoryId` en cabecera o en `transaction_splits`)
  - `type?`: `'INCOME' | 'EXPENSE' | 'TRANSFER' | 'ADJUSTMENT' | 'VOID' | 'REFUND'`
  - `status?`: `'POSTED' | 'VOIDED'`
  - `currency?`: `'PEN' | 'USD'`
  - `fromDate?`, `toDate?`: `YYYY-MM-DD` gregoriano estricto (`fromDate <= toDate`)
  - `search?`: `string` (`1..100` caracteres tras `trim`, búsqueda case-insensitive en `description` y `notes`)
- **Response (`200 OK`):**
  ```json
  {
    "items": ["...TransactionDetailView"],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
  ```
- **Errores:** `400 Bad Request` (filtros inválidos o `fromDate > toDate`), `401 Unauthorized`.

---

## 8. Obtener resumen financiero mensual (`GET /api/v1/transactions/summary/monthly`, `200 OK`)

- **TCP Pattern:** `ledger.getMonthlySummary` (`LEDGER_PATTERNS.GET_MONTHLY_SUMMARY`)
- **Nota de enrutamiento:** Declarado antes de `GET /api/v1/transactions/:id`.
- **Query Params (`MonthlySummaryQueryDto`, `forbidNonWhitelisted: true`):**
  - `month?`: `YYYY-MM` (`/^\d{4}-(0[1-9]|1[0-2])$/`; default mes actual en `America/Lima` usando `getLimaCurrentMonth()`)
  - `fundId?`: UUID (si pertenece a otro usuario o no existe, responde `404 Not Found`)
- **Reglas de agregación:**
  - Considera únicamente transacciones con `status = 'POSTED'` y `type IN ('INCOME', 'EXPENSE', 'REFUND')` dentro del rango `[YYYY-MM-01, YYYY-MM-<ultimoDiaMes>]` (respetando años bisiestos). Excluye `TRANSFER`, `ADJUSTMENT`, `VOID` y cualquier transacción `VOIDED`.
  - Agrega por moneda (`PEN` primero, luego `USD`), sin mezclar monedas. Si no hay movimientos en el mes, retorna `currencies: []`.
  - `byCategory` muestra el desglose bruto de `INCOME` y `EXPENSE` `POSTED` (usando `transaction_splits` sin doble conteo cuando existen), mientras `totalRefunds` y `totalExpenseNet` (`totalExpenseGross - totalRefunds`) reflejan el neto tras reembolsos.
- **Response (`200 OK`):**
  ```json
  {
    "month": "2026-11",
    "fromDate": "2026-11-01",
    "toDate": "2026-11-30",
    "fundId": null,
    "currencies": [
      {
        "currency": "PEN",
        "totalIncome": "3000.00",
        "totalExpenseGross": "1200.00",
        "totalRefunds": "100.00",
        "totalExpenseNet": "1100.00",
        "netCashFlow": "1900.00",
        "transactionCount": 8,
        "byCategory": [
          {
            "categoryId": "uuid",
            "categoryName": "Sueldo",
            "kind": "INCOME",
            "color": "#10B981",
            "icon": "wallet",
            "totalAmount": "3000.00",
            "transactionCount": 1
          }
        ]
      }
    ]
  }
  ```
- **Errores:** `400 Bad Request` (`month` o `fundId` inválido), `401 Unauthorized`, `404 Not Found` (`fundId` inexistente o de otro usuario).
