-- 004_body_module_schema.sql
-- Schema per il modulo "Body": Matrice Diario Allenamenti, Biometria, Sonno, Nutrizione (Kcal & Macro) e Progressioni

-- 1. POOL BASE DEGLI ESERCIZI / COLONNE DELLA MATRICE (body_exercise_columns)
CREATE TABLE IF NOT EXISTS public.body_exercise_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'pull' CHECK (category IN ('pull', 'push', 'legs_ant', 'legs_post', 'core', 'cardio')),
    target_frequency_days INT NOT NULL DEFAULT 3,
    available_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
    position INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_exercise_columns_user_id
    ON public.body_exercise_columns(user_id);

-- 2. RIGA GIORNALIERA: BIOMETRIA, SONNO, KCAL & MACRO, STATO (body_daily_logs)
CREATE TABLE IF NOT EXISTS public.body_daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    sleep_hours NUMERIC(4,2),
    sleep_quality INT CHECK (sleep_quality BETWEEN 1 AND 5),
    body_weight_kg NUMERIC(5,2),
    calories_kcal INT,
    protein_g INT,
    carbs_g INT,
    fat_g INT,
    energy_level INT CHECK (energy_level BETWEEN 1 AND 5),
    is_rest_day BOOLEAN NOT NULL DEFAULT false,
    general_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_body_daily_logs_user_id
    ON public.body_daily_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_body_daily_logs_date
    ON public.body_daily_logs(date DESC);

-- 3. CELLE DI ALLENAMENTO NELLA MATRICE (body_workout_entries)
CREATE TABLE IF NOT EXISTS public.body_workout_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    daily_log_id UUID REFERENCES public.body_daily_logs(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    column_id UUID REFERENCES public.body_exercise_columns(id) ON DELETE CASCADE,
    raw_notation TEXT NOT NULL,
    parsed_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
    rpe NUMERIC(3,1),
    rest_seconds INT,
    feeling TEXT DEFAULT 'buono' CHECK (feeling IN ('ottimo', 'buono', 'normale', 'faticoso', 'dolore_fastidio')),
    detailed_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_workout_entries_user_id
    ON public.body_workout_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_body_workout_entries_daily_log_id
    ON public.body_workout_entries(daily_log_id);
CREATE INDEX IF NOT EXISTS idx_body_workout_entries_column_id
    ON public.body_workout_entries(column_id);
CREATE INDEX IF NOT EXISTS idx_body_workout_entries_date
    ON public.body_workout_entries(date DESC);

-- 4. ROW LEVEL SECURITY (RLS) E POLICIES
ALTER TABLE public.body_exercise_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_workout_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own body_exercise_columns" ON public.body_exercise_columns
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own body_daily_logs" ON public.body_daily_logs
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own body_workout_entries" ON public.body_workout_entries
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

