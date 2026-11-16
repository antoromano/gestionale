-- 007_cloud_first.sql
-- Passaggio a "cloud-first": Supabase è l'unica fonte di verità, l'app (browser) e il bot Telegram scrivono nelle stesse tabelle.
--
--  1. `extra jsonb`: ogni campo dell'app senza colonna dedicata finisce qui (nessun dato perso, nessun errore di schema)
--  2. `updated_at` con trigger lato server (autorevole): permette la sincronizzazione incrementale
--  3. Colonne mancanti di finanze/compravendita (note, ricorrenze, cestino, ore impiegate)
--  4. ID testuali per le colonne esercizio Body (l'app usa id stabili come 'col-pull-up')
--  5. Un solo utente: dopo la prima registrazione nessuno può più creare account
--  6. Adozione automatica delle righe senza proprietario (scritte dal bot prima del login)
--
-- La migration è idempotente: si può rieseguire senza effetti collaterali.

-- ---------------------------------------------------------------------------
-- 1-2. extra jsonb + updated_at + trigger su tutte le tabelle sincronizzate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'settings', 'clients', 'services_catalog', 'quotes', 'quote_items', 'quote_item_images',
        'quote_extra_services', 'payments', 'todos', 'appointments',
        'brain_memories', 'brain_facts', 'brain_nodes', 'brain_edges',
        'body_exercise_columns', 'body_daily_logs', 'body_workout_entries',
        'finance_transactions', 'trading_items', 'ai_note_queue'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT ''{}''::jsonb', t);
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
        EXECUTE format('CREATE TRIGGER trg_touch_updated_at BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Colonne mancanti: finanze, compravendita
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_start_date date;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_end_date date;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid
    REFERENCES public.finance_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS hours_spent numeric(6,2);
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.ai_note_queue ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_fin_trans_recurring_parent ON public.finance_transactions(recurrence_parent_id)
    WHERE recurrence_parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. ID testuali per le colonne esercizio Body (id stabili dell'app: 'col-pull-up', ...)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    fk text;
    col_type text;
BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'body_exercise_columns' AND column_name = 'id';

    IF col_type = 'uuid' THEN
        SELECT conname INTO fk
        FROM pg_constraint
        WHERE conrelid = 'public.body_workout_entries'::regclass
          AND confrelid = 'public.body_exercise_columns'::regclass
          AND contype = 'f';
        IF fk IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.body_workout_entries DROP CONSTRAINT %I', fk);
        END IF;

        ALTER TABLE public.body_exercise_columns ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE public.body_exercise_columns ALTER COLUMN id TYPE text USING id::text;
        ALTER TABLE public.body_exercise_columns ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
        ALTER TABLE public.body_workout_entries ALTER COLUMN column_id TYPE text USING column_id::text;
        ALTER TABLE public.body_workout_entries
            ADD CONSTRAINT body_workout_entries_column_id_fkey
            FOREIGN KEY (column_id) REFERENCES public.body_exercise_columns(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Un solo utente: dopo il primo account le registrazioni sono chiuse
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.single_user_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users) THEN
        RAISE EXCEPTION 'Registrazioni chiuse: questa app ha un solo utente.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS single_user_lock ON auth.users;
CREATE TRIGGER single_user_lock
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.single_user_lock();

-- ---------------------------------------------------------------------------
-- 6. Adozione delle righe orfane (scritte dal bot Telegram prima che esistesse un utente)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adopt_orphan_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND c.is_nullable = 'YES'
    LOOP
        EXECUTE format('UPDATE public.%I SET user_id = $1 WHERE user_id IS NULL', t) USING NEW.id;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adopt_orphan_rows ON auth.users;
CREATE TRIGGER adopt_orphan_rows
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.adopt_orphan_rows();

REVOKE ALL ON FUNCTION public.single_user_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adopt_orphan_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
