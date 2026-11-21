# AGENTS.md — moneyflow-backend

Guía operativa obligatoria para agentes de desarrollo en `moneyflow-backend` (Backend de finanzas personales MoneyFlow).

## 1. Stack y arquitectura
- **Runtime / Framework:** Node.js LTS + NestJS + TypeScript estricto (`strict: true`).
- **Topología obligatoria:** Workspace NestJS con **2 aplicaciones** comunicadas por TCP interno:
  - `apps/api-gateway`: Punto único de entrada HTTP/REST público (cookies `HttpOnly`, CORS, rate limiting, `ValidationPipe` estricto y propagación de identidad firmada). No contiene lógica de cálculo financiero.
  - `apps/core-service`: Microservicio TCP propietario del dominio (`auth`, `funds`, `ledger`, `categories`, `cards`, `planning`) y único con acceso a PostgreSQL.
- **Base de datos y ORM:** PostgreSQL (`moneyflow_dev`) + **Prisma ORM** como cliente tipado.
  - **Estándar de migraciones:** SQL versionado en `db/migrations/` con registro obligatorio en `db/ORDEN.md`. **Prohibido** usar `prisma db push` o `prisma migrate dev`.
- **Validación HTTP:** `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` global en `api-gateway`.
- **Separación por capas:** `controller / message-pattern` → `service` → `repository / prisma` + `dto` + `mapper`.

## 2. Invariantes técnicas obligatorias
1. **Aislamiento estricto por usuario (`user_id`):**
   - El `user_id` propietario del recurso se obtiene **siempre** del contexto autenticado (`req.user.id` / payload firmado Gateway → Core), jamás del body o query params del cliente.
   - Toda consulta, actualización o anulación debe filtrar explícitamente por `user_id`.
2. **Precisión monetaria y saldos derivados:**
   - Prohibido usar `float`/`double` en PostgreSQL o aritmética con `number` de JavaScript para montos y saldos.
   - Usar `DECIMAL(14, 2)` en PostgreSQL, `Prisma.Decimal` con redondeo `ROUND_HALF_UP` y serializar siempre como `string` exacto en JSON (`"1250.50"`).
   - Los saldos de fondos virtuales se derivan mediante agregación (`SUM`) sobre el ledger (`fund_entries`), nunca por edición directa.
   - Prohibido el borrado físico de operaciones confirmadas o fondos con historial (usar anulación trazable o archivado).
3. **Atomicidad e idempotencia:**
   - Toda operación compuesta (transferencias entre fondos, registro/anulación de movimientos, pagos de obligaciones vinculados al ledger) debe ejecutarse dentro de una **transacción atómica ACID** de PostgreSQL, con `idempotency_key` donde aplique.
   - Las transferencias internas tienen efecto neto cero y nunca computan como ingresos ni egresos.
4. **Zona horaria (`America/Lima`):**
   - Prohibido usar `new Date().setHours(...)`, `getUTCDay()` o `new Date().toISOString().slice(0, 10)` para calcular "hoy" o el mes actual.
   - Separar estrictamente fechas calendario (`DATE` local) de instantes técnicos (`TIMESTAMPTZ` UTC) y validar existencia real en calendario gregoriano (rechazar `2026-02-31` con `400`).
5. **Seguridad y limpieza:**
   - Prohibido almacenar PAN completo, CVV o credenciales bancarias; prohibido devolver contraseñas, hashes, tokens o stack traces en respuestas HTTP.
   - Cero `console.log`, cero `TODO`, cero `as any`, cero `@ts-ignore`. Usar `Logger` de NestJS sin imprimir credenciales ni PII.

## 3. Flujo de trabajo en 2 fases y ahorro de créditos
- **Fase 1 (`/plan`, solo lectura):** Inspeccionar código vigente, presentar Contrato Espejo (`DTO <-> BD <-> Frontend`), Matriz de Efecto Dominó (si aplica) y Pasada Adversarial. Prohibido crear, editar o eliminar archivos o ejecutar `git` de escritura.
- **Fase 2 (`Proceed`):** Ejecutar exclusivamente el plan aprobado. En el Walkthrough, incluir el contenido completo de todo archivo `[NEW]` de código productivo creado para auditoría línea por línea.
- **Transparencia de archivos `[NEW]`:** Todo archivo nuevo debe ser documentado íntegramente en el reporte final para permitir auditoría estricta.
- **Escala de ahorro de modelos:** Priorizar modelos de consumo eficiente (`3.8 Flash Medium`, `Hydrogen Medium`, `Argon Medium`), reservando modelos pesados (`Neon` / `Pro`) exclusivamente para incidentes o refactorizaciones críticas de alta complejidad.
- **Git:** Prohibido ejecutar `git commit`, `git push` o `git reset` sin autorización explícita del usuario.

## 4. Reglas de pruebas y fidelidad de frontera
- Los tests de controladores deben validar el comportamiento real con `ValidationPipe`, guards y filtros activos.
- Todo módulo crítico (auth, fondos/saldos, transferencias, tarjetas, obligaciones, presupuestos) debe incluir pruebas de ciclo de vida y aislamiento entre usuarios distintos (`userA` no puede leer ni modificar recursos de `userB`).
- En pruebas iterativas correr solo el `.spec.ts` tocado (`npx jest ruta/archivo.spec.ts`); al cerrar una tarjeta correr una sola vez la suite completa en modo compacto.

## 5. Quality Gate obligatorio (antes de reportar cierre)
```powershell
npx tsc --noEmit
npm test -- --silent
npm run lint
npm run build
```
