# Contrato HTTP / TCP — Autenticación (MF-006)

Todos los mensajes TCP entre `apps/api-gateway` y `apps/core-service` utilizan `SignedTcpEnvelope<TPayload>` con `context: InternalAuthContext` firmado mediante `INTERNAL_TCP_SECRET` y `userId: null` para rutas públicas.

## 1. Registro de usuario

- **HTTP:** `POST /api/v1/auth/register` (`201 Created`)
- **TCP Pattern:** `auth.register` (`AUTH_PATTERNS.REGISTER`)
- **Request DTO (`RegisterDto`):**
  ```json
  {
    "email": "user@example.com",
    "fullName": "Ana Pérez",
    "password": "Password123"
  }
  ```
  - `email`: normalizado con `trim().toLowerCase()`, máximo `255` caracteres.
  - `fullName`: `1..150` caracteres tras `trim()`.
  - `password`: `8..128` caracteres (y `<= 512` bytes UTF-8), mínimo 1 mayúscula, 1 minúscula y 1 número.
- **Response (`201 Created`):**
  ```json
  {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "Ana Pérez",
      "preferredCurrency": "PEN",
      "timezone": "America/Lima",
      "emailVerifiedAt": null,
      "isActive": true,
      "createdAt": "2026-11-22T04:00:00.000Z"
    },
    "emailVerificationRequired": true,
    "message": "User registered successfully. Please check your email to verify your account."
  }
  ```
- **Errores:**
  - `400 Bad Request`: datos inválidos o campos no permitidos.
  - `409 Conflict`: correo ya registrado (case-insensitive).

## 2. Verificación de correo electrónico

- **HTTP:** `POST /api/v1/auth/verify-email` (`200 OK`)
- **TCP Pattern:** `auth.verifyEmail` (`AUTH_PATTERNS.VERIFY_EMAIL`)
- **Request DTO (`VerifyEmailDto`):**
  ```json
  {
    "token": "<64-hex-chars>"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "verified": true,
    "email": "user@example.com",
    "emailVerifiedAt": "2026-11-22T04:05:00.000Z",
    "message": "Email verified successfully."
  }
  ```
- **Errores:**
  - `400 Bad Request`: token vacío, inexistente, expirado, ya usado, usuario inactivo o correo ya verificado.

## 3. Reenvío de correo de verificación

- **HTTP:** `POST /api/v1/auth/resend-verification` (`200 OK`)
- **TCP Pattern:** `auth.resendVerification` (`AUTH_PATTERNS.RESEND_VERIFICATION`)
- **Request DTO (`ResendVerificationDto`):**
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response (`200 OK` siempre idéntico para evitar enumeración):**
  ```json
  {
    "message": "If an account with that email exists and is pending verification, a new verification link has been sent."
  }
  ```
- **Errores:**
  - `400 Bad Request`: formato de correo inválido, longitud `> 255` o campos no permitidos.
