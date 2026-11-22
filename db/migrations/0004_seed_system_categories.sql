-- ============================================================================
-- Migración: 0004_seed_system_categories.sql
-- Tarjeta:   MF-012
-- Objetivo:  Seed SQL versionado e idempotente de categorías globales del
--            sistema (is_system = TRUE, user_id = NULL, is_archived = FALSE)
--            para INCOME (5) y EXPENSE (9) con color hex e icono Lucide.
-- ============================================================================

BEGIN;

INSERT INTO public.categories (name, kind, color, icon, is_system, is_archived)
SELECT v.name, v.kind::public.category_kind, v.color, v.icon, TRUE, FALSE
FROM (VALUES
  -- Categorías base INCOME (5)
  ('Salario', 'INCOME', '#16A34A', 'briefcase'),
  ('Freelance', 'INCOME', '#0D9488', 'laptop'),
  ('Inversiones', 'INCOME', '#2563EB', 'trending-up'),
  ('Regalos', 'INCOME', '#9333EA', 'gift'),
  ('Otros ingresos', 'INCOME', '#4B5563', 'wallet'),
  -- Categorías base EXPENSE (9)
  ('Alimentación', 'EXPENSE', '#EA580C', 'utensils'),
  ('Transporte', 'EXPENSE', '#0284C7', 'car'),
  ('Vivienda', 'EXPENSE', '#4F46E5', 'home'),
  ('Servicios', 'EXPENSE', '#CA8A04', 'zap'),
  ('Salud', 'EXPENSE', '#DC2626', 'heart-pulse'),
  ('Educación', 'EXPENSE', '#059669', 'graduation-cap'),
  ('Entretenimiento', 'EXPENSE', '#D946EF', 'film'),
  ('Compras', 'EXPENSE', '#EC4899', 'shopping-bag'),
  ('Otros gastos', 'EXPENSE', '#6B7280', 'receipt')
) AS v(name, kind, color, icon)
ON CONFLICT (kind, LOWER(BTRIM(name))) WHERE is_system = TRUE AND is_archived = FALSE
DO UPDATE SET
  color = EXCLUDED.color,
  icon = EXCLUDED.icon,
  updated_at = CURRENT_TIMESTAMP;

-- Autoverificación post-seed
DO $$
DECLARE
  v_income_count integer;
  v_expense_count integer;
BEGIN
  SELECT COUNT(*) INTO v_income_count
  FROM public.categories
  WHERE is_system = TRUE AND is_archived = FALSE AND kind = 'INCOME';

  SELECT COUNT(*) INTO v_expense_count
  FROM public.categories
  WHERE is_system = TRUE AND is_archived = FALSE AND kind = 'EXPENSE';

  IF v_income_count < 5 THEN
    RAISE EXCEPTION 'Invariante violada: deben existir al menos 5 categorías activas de sistema para INCOME, se encontraron %', v_income_count;
  END IF;

  IF v_expense_count < 9 THEN
    RAISE EXCEPTION 'Invariante violada: deben existir al menos 9 categorías activas de sistema para EXPENSE, se encontraron %', v_expense_count;
  END IF;
END
$$;

COMMIT;

