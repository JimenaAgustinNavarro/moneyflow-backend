# Protocolo de Auditoría y Calidad — MoneyFlow

Este documento establece el marco normativo de control de cambios, auditoría en dos fases y control de gastos para todos los agentes de desarrollo que intervienen en `moneyflow-backend`.

## 1. Protocolo de Dos Fases

### Fase 1: Planificación y Análisis (`/plan`) — SOLO LECTURA
- **Restricción absoluta:** Prohibido crear, modificar o eliminar archivos en el workspace. Prohibido ejecutar comandos de git de escritura (`git commit`, `git push`, `git reset`, `git checkout -b`).
- **Inspección requerida:**
  - Inspección del estado actual del repositorio (`git status`, `git branch -a`).
  - Presentación del Contrato Espejo (`DTO <-> BD <-> Frontend`).
  - Matriz de Efecto Dominó (análisis de riesgos y dependencias cruzadas).
  - Pasada Adversarial (análisis de casos borde, fallos de concurrencia y validación de tipos).
- **Entrega obligatoria:** Artefacto de Implementation Plan con `RequestFeedback: true` solicitando aprobación explícita.

### Fase 2: Ejecución y Verificación (`Proceed`)
- **Restricción:** Ejecutar estricta y exclusivamente los cambios detallados en el plan aprobado.
- **Transparencia total de archivos `[NEW]`:** Todo archivo de código productivo o configuración creado debe ser expuesto íntegramente en el Walkthrough final para posibilitar auditoría línea por línea.
- **Quality Gate:** Ejecución obligatoria de la suite completa antes de dar por cerrada cualquier tarea:
  ```powershell
  npx tsc --noEmit
  npm test -- --silent
  npm run lint
  npm run build
  ```

## 2. Política de Git y Control de Versiones
- **Prohibición de commits/push automáticos:** El agente tiene **terminantemente prohibido** ejecutar `git commit`, `git push` o `git reset` sin la autorización previa y explícita del usuario en el chat.
- **Rama de trabajo:** Las tareas se preparan siempre sobre la rama `dev`.

## 3. Escala de Modelos y Ahorro de Créditos
Para maximizar la eficiencia y optimizar el consumo de tokens/créditos:
- **Tareas ordinarias y documentación:** Usar modelos rápidos e intermedios (`Gemini 3.8 Flash Medium`, `Hydrogen Medium`, `Argon Medium`).
- **Modelos pesados (`Neon` / `Pro`):** Reservados exclusivamente para excepciones críticas que involucren fallos estructurales de concurrencia ACID, resolución de deadlocks o refactorizaciones multidominio de alta complejidad.

## 4. Invariantes Técnicas de Auditoría
1. **Aislamiento `user_id`:** Obtenido siempre del token JWT firmado, jamás por entrada del usuario.
2. **Precisión monetaria:** `DECIMAL(14,2)` serializado como `string`. Cero aritmética con `number`.
3. **Ledger inmutable:** Los saldos se obtienen mediante `SUM` sobre `fund_entries`. Prohibido el borrado físico de registros confirmados.
4. **Zona horaria:** `America/Lima` estricta, validando existencia real en calendario gregoriano.
5. **Calidad de código:** Cero `console.log`, cero `as any`, cero `@ts-ignore`, cero `TODO`.
