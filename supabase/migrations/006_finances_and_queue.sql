-- 006_finances_and_queue.sql
-- Evoluzione Modulo Finanze & Cash Flow (Entrate/Uscite/Ricorrenze), Compravendita / Flipping Online
-- e Coda Appunti Rapidi (Ingestion Batching: N note -> 1 chiamata IA).
--
-- NOTE DI COMPATIBILITÀ
--  * La vecchia tabella public.expenses NON viene modificata né eliminata: le sue righe vengono
--    copiate in finance_transactions (type = 'expense', stesso id) in modo idempotente (sezione 5).
--  * Il client mappa automaticamente ogni lettura/scrittura "expenses" su finance_transactions
--    con type = 'expense' (vedi src/services/store.js).
--  * La frequenza annuale è 'yearly' in finance_transactions (il client accetta anche l'alias legacy 'annual').

-- ---------------------------------------------------------------------------
-- 1. TRANSAZIONI FINANZIARIE (finance_transactions): Entrate & Uscite unificate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL DEFAULT 'generale',
    amount NUMERIC(12,2) NOT NULL,
    description TEXT NOT NULL,
    payment_method TEXT DEFAULT 'bonifico',
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_frequency TEXT CHECK (recurrence_frequency IN ('monthly', 'yearly', 'weekly')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colonne di supporto richieste dal client (ricorrenze idempotenti, note, cestino/soft-delete)
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_start_date DATE;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID
    REFERENCES public.finance_transactions(id) ON DELETE SET NULL;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_fin_trans_date_type ON public.finance_transactions(date, type);
CREATE INDEX IF NOT EXISTS idx_fin_trans_user_id ON public.finance_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_trans_recurring_parent ON public.finance_transactions(recurrence_parent_id)
    WHERE recurrence_parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. COMPRAVENDITA ONLINE / FLIPPING (trading_items) con Margine Netto e ROI % calcolati dal DB
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trading_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'Vinted', -- Vinted, Subito, eBay, Altro
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    purchase_price NUMERIC(10,2) NOT NULL,
    extra_costs NUMERIC(10,2) NOT NULL DEFAULT 0.00, -- Riparazioni, spedizioni, pezzi di ricambio
    sale_date DATE,
    sale_price NUMERIC(10,2),
    platform_fees NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    net_profit NUMERIC(10,2) GENERATED ALWAYS AS (
        CASE WHEN sale_price IS NOT NULL THEN (sale_price - purchase_price - extra_costs - platform_fees) ELSE NULL END
    ) STORED,
    roi_percent NUMERIC(7,2) GENERATED ALWAYS AS (
        CASE WHEN sale_price IS NOT NULL AND (purchase_price + extra_costs) > 0
        THEN ROUND(((sale_price - purchase_price - extra_costs - platform_fees) / (purchase_price + extra_costs) * 100), 2)
        ELSE NULL END
    ) STORED,
    status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'reserved', 'returned')),
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colonne di supporto: tempo impiegato (per il profitto orario reale dell'Avvocato del Diavolo) e cestino
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS hours_spent NUMERIC(6,2);
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.trading_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_trading_items_status ON public.trading_items(status);
CREATE INDEX IF NOT EXISTS idx_trading_items_user_id ON public.trading_items(user_id);

-- ---------------------------------------------------------------------------
-- 3. CODA APPUNTI RAPIDI (ai_note_queue): N note durante il giorno -> 1 sola chiamata IA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_note_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_note_queue ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_note_queue_user_status ON public.ai_note_queue(user_id, status);

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) E POLICIES: ogni utente vede e modifica solo i propri record
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_note_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own finance_transactions" ON public.finance_transactions;
CREATE POLICY "Users can manage own finance_transactions"
    ON public.finance_transactions
    FOR ALL
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own trading_items" ON public.trading_items;
CREATE POLICY "Users can manage own trading_items"
    ON public.trading_items
    FOR ALL
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own ai_note_queue" ON public.ai_note_queue;
CREATE POLICY "Users can manage own ai_note_queue"
    ON public.ai_note_queue
    FOR ALL
    TO authenticated
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. RETROCOMPATIBILITÀ: copia idempotente di public.expenses -> finance_transactions (type = 'expense')
--    (stesso id => rieseguire la migration non duplica nulla; la tabella expenses resta intatta)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.expenses') IS NOT NULL THEN
        INSERT INTO public.finance_transactions (
            id, user_id, date, type, category, amount, description, payment_method,
            client_id, quote_id, is_recurring, recurrence_frequency, notes,
            recurrence_start_date, recurrence_end_date, is_suspended,
            is_deleted, deleted_at, created_at, updated_at
        )
        SELECT
            e.id, e.user_id, e.date, 'expense', COALESCE(NULLIF(e.category, ''), 'generale'), e.amount, e.description, 'altro',
            e.client_id, e.quote_id, e.is_recurring,
            CASE e.recurrence_frequency WHEN 'annual' THEN 'yearly' ELSE e.recurrence_frequency END,
            e.notes, e.recurrence_start_date, e.recurrence_end_date, e.is_suspended,
            e.is_deleted, e.deleted_at, e.created_at, e.updated_at
        FROM public.expenses e
        ON CONFLICT (id) DO NOTHING;

        -- Il collegamento padre/figlio delle ricorrenze viene ripristinato dopo l'inserimento (FK autoreferenziale)
        UPDATE public.finance_transactions ft
        SET recurrence_parent_id = e.recurrence_parent_id
        FROM public.expenses e
        WHERE ft.id = e.id
          AND e.recurrence_parent_id IS NOT NULL
          AND ft.recurrence_parent_id IS NULL
          AND EXISTS (SELECT 1 FROM public.finance_transactions p WHERE p.id = e.recurrence_parent_id);
    END IF;
END $$;
