-- 008_auth_and_realtime.sql
--  1. Il primo (e unico) utente viene confermato in automatico: niente dipendenza da email/link di conferma.
--     È sicuro perché il trigger single_user_lock impedisce qualunque altra registrazione.
--  2. Realtime: l'app riceve subito i dati scritti dal bot Telegram.

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
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
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
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
