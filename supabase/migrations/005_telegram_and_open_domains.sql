-- 005_telegram_and_open_domains.sql
-- Integrazione Telegram Bot (Multimodal Ingestion, Proattività Scheduled) e 4° Livello di Protezione (Human-in-the-Loop Confirmation) per Macro-Domini Aperti

-- 1. AGGIORNAMENTO VINCOLI BRAIN PER NUOVI MACRO-DOMINI E FONTE TELEGRAM
ALTER TABLE public.brain_memories
    DROP CONSTRAINT IF EXISTS brain_memories_domain_check;

ALTER TABLE public.brain_memories
    ADD CONSTRAINT brain_memories_domain_check
    CHECK (length(trim(domain)) > 0);

ALTER TABLE public.brain_memories
    DROP CONSTRAINT IF EXISTS brain_memories_source_type_check;

ALTER TABLE public.brain_memories
    ADD CONSTRAINT brain_memories_source_type_check
    CHECK (source_type IN ('manual', 'ai_chat', 'client_event', 'todo', 'body_log', 'telegram'));

ALTER TABLE public.brain_nodes
    DROP CONSTRAINT IF EXISTS brain_nodes_node_type_check;

ALTER TABLE public.brain_nodes
    ADD CONSTRAINT brain_nodes_node_type_check
    CHECK (length(trim(node_type)) > 0);

ALTER TABLE public.brain_facts
    DROP CONSTRAINT IF EXISTS brain_facts_category_check;

ALTER TABLE public.brain_facts
    ADD CONSTRAINT brain_facts_category_check
    CHECK (length(trim(category)) > 0);

-- 2. TABELLA PER IL 4° LIVELLO DI PROTEZIONE (HUMAN-IN-THE-LOOP)
CREATE TABLE IF NOT EXISTS public.telegram_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    telegram_chat_id BIGINT NOT NULL,
    action_type TEXT NOT NULL, -- 'ingest_new_domain', 'ingest_fact', 'body_ambiguous', 'client_note'
    domain TEXT NOT NULL DEFAULT 'general',
    proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_tg_pending_chat_status
    ON public.telegram_pending_actions (telegram_chat_id, status);
CREATE INDEX IF NOT EXISTS idx_tg_pending_user_id
    ON public.telegram_pending_actions (user_id);

-- 3. TABELLA DI CONFIGURAZIONE E ISCRITTI BOT TELEGRAM
CREATE TABLE IF NOT EXISTS public.telegram_bot_subscribers (
    chat_id BIGINT PRIMARY KEY,
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT,
    first_name TEXT,
    is_authorized BOOLEAN NOT NULL DEFAULT false,
    daily_brief_enabled BOOLEAN NOT NULL DEFAULT true,
    evening_reminder_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_subscribers_user_id
    ON public.telegram_bot_subscribers (user_id);

-- 4. ROW LEVEL SECURITY (RLS) E POLICIES
ALTER TABLE public.telegram_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own telegram_pending_actions"
    ON public.telegram_pending_actions
    FOR ALL
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own telegram_bot_subscribers"
    ON public.telegram_bot_subscribers
    FOR ALL
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
