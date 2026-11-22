# Contrato HTTP / TCP — Autenticación y Sesiones (MF-006 + MF-007)

Todos los mensajes TCP entre `apps/api-gateway` y `apps/core-service` utilizan `SignedTcpEnvelope<TPayload>` con `context: InternalAuthContext` firmado mediante `INTERNAL_TCP_SECRET`.

## Cookies `HttpOnly` (`api-gateway`)

- **`mf_access_token`**: JWT HS256 (`{ sub: userId, sid: sessionId, type: 'access' }`), expiración `15m` (`900` s), `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` en producción o `COOKIE_SECURE=true`.
- **`mf_refresh_token`**: Token opaco aleatorio de 256 bits (`64` chars hex), expiración `7d` (`604800` s), `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, `Secure` en producción o `COOKIE_SECURE=true`.

---

## 1. Registro de usuario (`POST /api/v1/auth/register`, `201 Created`)

- **TCP Pattern:** `auth.register` (`AUTH_PATTERNS.REGISTER`)
- **Rate Limit:** `5` req / `60s`
- **Request:** `{ email, fullName, password }`
- **Response (`201 Created`):** `{ user, emailVerificationRequired: true, message }`
- **Errores:** `400 Bad Request`, `409 Conflict`, `429 Too Many Requests`

## 2. Verificación de correo (`POST /api/v1/auth/verify-email`, `200 OK`)

- **TCP Pattern:** `auth.verifyEmail` (`AUTH_PATTERNS.VERIFY_EMAIL`)
- **Request:** `{ token }`
- **Response (`200 OK`):** `{ verified: true, email, emailVerifiedAt, message }`
- **Errores:** `400 Bad Request`

## 3. Reenvío de verificación (`POST /api/v1/auth/resend-verification`, `200 OK`)

- **TCP Pattern:** `auth.resendVerification` (`AUTH_PATTERNS.RESEND_VERIFICATION`)
- **Rate Limit:** `3` req / `60s`
- **Request:** `{ email }`
- **Response (`200 OK`):** `{ message }` (constante anti-enumeración)
- **Errores:** `400 Bad Request`, `429 Too Many Requests`

## 4. Inicio de sesión (`POST /api/v1/auth/login`, `200 OK`)

- **TCP Pattern:** `auth.login` (`AUTH_PATTERNS.LOGIN`)
- **Rate Limit:** `5` req / `60s`
- **Request (`LoginDto`):** `{ email, password }`
- **Cookies emitidas:** `mf_access_token` + `mf_refresh_token`
- **Response (`200 OK`):** `{ user, message: "Login successful." }`
- **Errores:**
  - `401 Unauthorized`: credenciales inválidas o usuario inactivo (`Invalid email or password`).
  - `403 Forbidden`: `code: "EMAIL_NOT_VERIFIED"` (solo tras verificar contraseña válida) o fallo de `OriginCsrfGuard`.
  - `429 Too Many Requests`: exceso de intentos.

## 5. Rotación de Refresh Token (`POST /api/v1/auth/refresh`, `200 OK`)

- **TCP Pattern:** `auth.refresh` (`AUTH_PATTERNS.REFRESH`)
- **Entrada:** Cookie `mf_refresh_token`
- **Cookies:** En `200` rota ambas cookies; en `401` limpia ambas cookies.
- **Response (`200 OK`):** `{ user, message: "Session refreshed successfully." }`
- **Errores:** `401 Unauthorized` (cookie ausente, expirada, inválida o reutilización detectada con revocación completa de `family_id`), `403 Forbidden` (`OriginCsrfGuard`).

## 6. Cierre de sesión actual (`POST /api/v1/auth/logout`, `200 OK`)

- **TCP Pattern:** `auth.logout` (`AUTH_PATTERNS.LOGOUT`)
- **Entrada:** Cookies `mf_access_token` y/o `mf_refresh_token`
- **Cookies:** Siempre limpia `mf_access_token` y `mf_refresh_token`.
- **Response (`200 OK`):** `{ message: "Logged out successfully." }`

## 7. Listar sesiones activas (`GET /api/v1/auth/sessions`, `200 OK`)

- **Guard:** `JwtAuthGuard` (cookie `mf_access_token`)
- **TCP Pattern:** `auth.listSessions` (`AUTH_PATTERNS.LIST_SESSIONS`)
- **Response (`200 OK`):** `{ sessions: [{ id, ipAddress, userAgent, createdAt, expiresAt, isCurrent }] }`

## 8. Revocar sesión específica (`DELETE /api/v1/auth/sessions/:id`, `200 OK`)

- **Guard:** `JwtAuthGuard` + `OriginCsrfGuard`
- **TCP Pattern:** `auth.revokeSession` (`AUTH_PATTERNS.REVOKE_SESSION`)
- **Cookies:** Limpia cookies si `:id` coincide con el `sid` actual.
- **Response (`200 OK`):** `{ revokedSessionId, currentSessionCleared, message }`
- **Errores:** `400 Bad Request` (UUID inválido), `401 Unauthorized`, `403 Forbidden`, `404 Not Found` (no existe o pertenece a otro usuario).

## 9. Cerrar todas las sesiones (`POST /api/v1/auth/logout-all`, `200 OK`)

- **Guard:** `JwtAuthGuard` + `OriginCsrfGuard`
- **TCP Pattern:** `auth.logoutAll` (`AUTH_PATTERNS.LOGOUT_ALL`)
- **Cookies:** Siempre limpia `mf_access_token` y `mf_refresh_token`.
- **Response (`200 OK`):** `{ revokedCount, message }`
