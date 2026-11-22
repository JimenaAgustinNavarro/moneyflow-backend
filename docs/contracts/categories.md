# Contrato HTTP / TCP — Gestión de Categorías (MF-012)

Todos los mensajes TCP entre `apps/api-gateway` y `apps/core-service` utilizan `SignedTcpEnvelope<TPayload>` con `context: InternalAuthContext` firmado mediante `INTERNAL_TCP_SECRET`.

La identidad del usuario (`user_id`) se extrae **exclusivamente del Access Token JWT verificado** en el Gateway y se propaga en el sobre firmado hacia Core.

---

## Patrones TCP (`CATEGORIES_PATTERNS`)

```ts
export const CATEGORIES_PATTERNS = {
  LIST: 'categories.list',
  CREATE: 'categories.create',
  UPDATE: 'categories.update',
  ARCHIVE: 'categories.archive',
  UNARCHIVE: 'categories.unarchive',
} as const;
```

---

## 1. Listar categorías visibles (`GET /api/v1/categories`, `200 OK`)

- **Autenticación:** Cookie `mf_access_token` (`JwtAuthGuard`).
- **TCP Pattern:** `categories.list` (`CATEGORIES_PATTERNS.LIST`).
- **Query Params (`ListCategoriesQueryDto`):**
  - `kind?`: `'INCOME' | 'EXPENSE'` (opcional).
  - `includeArchived?`: `'true' | 'false'` (opcional, default `false`).
- **Reglas de negocio en Core:**
  - Retorna categorías globales del sistema (`is_system = true`) y categorías propias del usuario autenticado (`user_id = context.userId`).
  - Orden determinista: `is_system DESC, kind ASC, name ASC`.
- **Response (`200 OK`):**
  ```json
  {
    "categories": [
      {
        "id": "11111111-2222-3333-4444-555555555555",
        "userId": null,
        "name": "Alimentación",
        "kind": "EXPENSE",
        "color": "#EA580C",
        "icon": "utensils",
        "isSystem": true,
        "isArchived": false,
        "createdAt": "2026-11-22T08:00:00.000Z",
        "updatedAt": "2026-11-22T08:00:00.000Z"
      }
    ]
  }
  ```
- **Errores:**
  - `400 Bad Request`: `includeArchived` inválido o query params desconocidos (`forbidNonWhitelisted`).
  - `401 Unauthorized`: cookie ausente o JWT inválido.

---

## 2. Crear categoría personalizada (`POST /api/v1/categories`, `201 Created`)

- **Autenticación:** Cookie `mf_access_token` (`JwtAuthGuard`).
- **TCP Pattern:** `categories.create` (`CATEGORIES_PATTERNS.CREATE`).
- **Request Body (`CreateCategoryDto`):**
  ```json
  {
    "name": "Gimnasio",
    "kind": "EXPENSE",
    "color": "#0284C7",
    "icon": "dumbbell"
  }
  ```
  - `name`: string requerido, longitud 1..100 (trim automático).
  - `kind`: `'INCOME' | 'EXPENSE'` requerido.
  - `color`: string opcional, formato hex `/^#[0-9A-Fa-f]{6}$/`, máx 20.
  - `icon`: string opcional, longitud 1..50 (trim automático).
- **Reglas de negocio en Core:**
  - `user_id` se asigna exclusivamente del token JWT firmado; `is_system` se fuerza siempre a `false`.
  - Verifica colisión de nombres case-insensitive (`LOWER(BTRIM(name))`) contra categorías activas del sistema y categorías activas propias.
  - Captura `P2002` de Prisma ante inserciones concurrentes.
- **Response (`201 Created`):**
  ```json
  {
    "category": {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "userId": "11111111-1111-4111-8111-111111111111",
      "name": "Gimnasio",
      "kind": "EXPENSE",
      "color": "#0284C7",
      "icon": "dumbbell",
      "isSystem": false,
      "isArchived": false,
      "createdAt": "2026-11-22T12:00:00.000Z",
      "updatedAt": "2026-11-22T12:00:00.000Z"
    }
  }
  ```
- **Errores:**
  - `400 Bad Request`: validación fallida o intento de enviar `userId`/`isSystem`.
  - `401 Unauthorized`: no autenticado.
  - `409 Conflict`: ya existe una categoría activa con el mismo nombre y tipo para el usuario o en el sistema.

---

## 3. Actualizar categoría propia (`PATCH /api/v1/categories/:id`, `200 OK`)

- **Autenticación:** Cookie `mf_access_token` (`JwtAuthGuard`).
- **Parámetro `:id`:** UUID válido (`ParseUUIDPipe`).
- **TCP Pattern:** `categories.update` (`CATEGORIES_PATTERNS.UPDATE`).
- **Request Body (`UpdateCategoryDto`):**
  ```json
  {
    "name": "Gimnasio y Deporte",
    "color": null,
    "icon": "dumbbell"
  }
  ```
  - Requiere al menos un campo (`name`, `color` o `icon`). Body `{}` responde `400 Bad Request`.
  - `kind`, `userId`, `isSystem`, `isArchived` prohibidos (`forbidNonWhitelisted`).
- **Reglas de negocio en Core:**
  - Si la categoría es de sistema (`is_system = true`), responde `403 Forbidden`.
  - Si no existe o pertenece a otro usuario, responde `404 Not Found`.
  - Si está archivada, responde `400 Bad Request` (debe desarchivarse primero).
  - Anti auto-colisión: renombrar la misma categoría a diferentes mayúsculas/espacios excluye su propio `id` y responde `200 OK`.
- **Response (`200 OK`):**
  ```json
  {
    "category": { ... }
  }
  ```
- **Errores:**
  - `400 Bad Request`: UUID inválido, body vacío o categoría archivada.
  - `401 Unauthorized`: no autenticado.
  - `403 Forbidden`: categoría del sistema.
  - `404 Not Found`: inexistente o ajena.
  - `409 Conflict`: colisión de nombre con otra categoría activa.

---

## 4. Archivar categoría propia (`DELETE /api/v1/categories/:id`, `200 OK`)

- **Autenticación:** Cookie `mf_access_token` (`JwtAuthGuard`).
- **Parámetro `:id`:** UUID válido (`ParseUUIDPipe`).
- **TCP Pattern:** `categories.archive` (`CATEGORIES_PATTERNS.ARCHIVE`).
- **Reglas de negocio en Core:**
  - Archivado lógico (`is_archived = true`). Prohibido el borrado físico (`DELETE` en BD).
  - Si es de sistema, responde `403 Forbidden`.
  - Si pertenece a otro usuario o no existe, responde `404 Not Found`.
  - Idempotente: si ya está archivada, responde `200 OK`.
- **Response (`200 OK`):**
  ```json
  {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "isArchived": true,
    "message": "Category archived successfully."
  }
  ```
- **Errores:**
  - `400 Bad Request`: UUID inválido.
  - `401 Unauthorized`: no autenticado.
  - `403 Forbidden`: categoría del sistema.
  - `404 Not Found`: inexistente o ajena.

---

## 5. Desarchivar categoría propia (`POST /api/v1/categories/:id/unarchive`, `200 OK`)

- **Autenticación:** Cookie `mf_access_token` (`JwtAuthGuard`).
- **Parámetro `:id`:** UUID válido (`ParseUUIDPipe`).
- **TCP Pattern:** `categories.unarchive` (`CATEGORIES_PATTERNS.UNARCHIVE`).
- **Reglas de negocio en Core:**
  - Desarchivado lógico (`is_archived = false`).
  - Si ya está activa, responde `200 OK` de forma idempotente.
  - Si reactivar colisiona con otra categoría activa de mismo nombre y tipo, responde `409 Conflict`.
- **Response (`200 OK`):**
  ```json
  {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "isArchived": false,
    "message": "Category unarchived successfully."
  }
  ```
- **Errores:**
  - `400 Bad Request`: UUID inválido.
  - `401 Unauthorized`: no autenticado.
  - `403 Forbidden`: categoría del sistema.
  - `404 Not Found`: inexistente o ajena.
  - `409 Conflict`: colisión de nombre con categoría activa existente.
