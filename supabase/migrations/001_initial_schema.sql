-- 001_initial_schema.sql
-- Schema completo del Gestionale con Row Level Security (RLS)

-- Abilita estensione pgcrypto per UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABELLA IMPOSTAZIONI UTENTE / WORKSPACE
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL DEFAULT 'Gestionale',
    logo_url TEXT,
    app_icon_url TEXT,
    primary_color TEXT NOT NULL DEFAULT '#1e293b',
    accent_color TEXT NOT NULL DEFAULT '#2563eb',
    business_name TEXT DEFAULT '',
    owner_name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    postal_code TEXT DEFAULT '',
    vat_number TEXT DEFAULT '',
    fiscal_code TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    pec TEXT DEFAULT '',
    sdi_code TEXT DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'EUR',
    currency_symbol TEXT NOT NULL DEFAULT '€',
    language TEXT NOT NULL DEFAULT 'it',
    timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
    date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    quote_default_validity_days INT DEFAULT 30,
    quote_default_conditions TEXT DEFAULT 'Pagamento: 30% acconto alla conferma, saldo alla consegna dei lavori.',
    fiscal_levy_name TEXT DEFAULT 'Cassa Previdenziale',
    fiscal_levy_percent NUMERIC(5,2) DEFAULT 4.00,
    fiscal_levy_enabled BOOLEAN DEFAULT false,
    vat_percent NUMERIC(5,2) DEFAULT 22.00,
    vat_enabled BOOLEAN DEFAULT false,
    google_calendar_connected BOOLEAN DEFAULT false,
    google_calendar_id TEXT,
    google_sync_last_at TIMESTAMPTZ,
    notion_connected BOOLEAN DEFAULT false,
    notion_database_id TEXT,
    notion_sync_last_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TABELLA CLIENTI
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('person', 'company')),
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    company_name TEXT DEFAULT '',
    contact_person TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    postal_code TEXT DEFAULT '',
    city TEXT DEFAULT '',
    vat_number TEXT DEFAULT '',
    fiscal_code TEXT DEFAULT '',
    pec TEXT DEFAULT '',
    sdi_code TEXT DEFAULT '',
    tags TEXT[] DEFAULT '{}',
    origin TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABELLA CATALOGO SERVIZI
CREATE TABLE IF NOT EXISTS public.services_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'Generale',
    price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    unit TEXT DEFAULT 'pz',
    description TEXT DEFAULT '',
    details TEXT DEFAULT '',
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TABELLA PREVENTIVI
CREATE TABLE IF NOT EXISTS public.quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL,
    title TEXT NOT NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    recipient_manual JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('bozza', 'inviato', 'accettato', 'rifiutato', 'scaduto')) DEFAULT 'bozza',
    internal_notes TEXT DEFAULT '',
    work_status TEXT NOT NULL DEFAULT 'Da iniziare',
    expected_delivery DATE,
    show_total_in_pdf BOOLEAN NOT NULL DEFAULT true,
    global_discount_percent NUMERIC(5,2) DEFAULT 0.00,
    agreed_total NUMERIC(12,2),
    fiscal_levy_enabled BOOLEAN DEFAULT false,
    fiscal_levy_name TEXT DEFAULT 'Cassa Previdenziale',
    fiscal_levy_percent NUMERIC(5,2) DEFAULT 0.00,
    vat_enabled BOOLEAN DEFAULT false,
    vat_percent NUMERIC(5,2) DEFAULT 0.00,
    conditions TEXT DEFAULT '',
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABELLA VOCI PREVENTIVO
CREATE TABLE IF NOT EXISTS public.quote_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1.00,
    unit TEXT NOT NULL DEFAULT 'pz',
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    is_freebie BOOLEAN NOT NULL DEFAULT false,
    visible_details TEXT DEFAULT '',
    internal_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TABELLA IMMAGINI VOCI PREVENTIVO
CREATE TABLE IF NOT EXISTS public.quote_item_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_item_id UUID NOT NULL REFERENCES public.quote_items(id) ON DELETE CASCADE,
    storage_path TEXT,
    file_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_size INT DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. TABELLA SERVIZI EXTRA PREVENTIVO
CREATE TABLE IF NOT EXISTS public.quote_extra_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL CHECK (status IN ('proposto', 'approvato', 'rifiutato')) DEFAULT 'proposto',
    proposed_at DATE DEFAULT CURRENT_DATE,
    approved_at DATE,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. TABELLA PAGAMENTI
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('acconto', 'saldo', 'extra', 'rimborso', 'altro')),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL CHECK (status IN ('previsto', 'incassato', 'annullato')) DEFAULT 'previsto',
    due_date DATE,
    payment_date DATE,
    method TEXT DEFAULT 'Bonifico',
    reference_number TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. TABELLA TO-DO
CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    compensation_mode TEXT NOT NULL CHECK (compensation_mode IN ('autonomous', 'included_in_quote', 'extra', 'none')) DEFAULT 'none',
    compensation_amount NUMERIC(12,2) DEFAULT 0.00,
    deposit_received NUMERIC(12,2) DEFAULT 0.00,
    balance_received NUMERIC(12,2) DEFAULT 0.00,
    due_date TIMESTAMPTZ,
    priority TEXT NOT NULL CHECK (priority IN ('bassa', 'media', 'alta', 'urgente')) DEFAULT 'media',
    is_completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMPTZ,
    source TEXT NOT NULL CHECK (source IN ('manual', 'ai', 'integration')) DEFAULT 'manual',
    notion_page_id TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. TABELLA APPUNTAMENTI E SHOOTING (CALENDARIO)
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    is_all_day BOOLEAN NOT NULL DEFAULT false,
    timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
    compensation_amount NUMERIC(12,2) DEFAULT 0.00,
    is_shooting BOOLEAN NOT NULL DEFAULT false,
    shooting_type TEXT DEFAULT '',
    google_event_id TEXT,
    google_etag TEXT,
    google_sync_status TEXT DEFAULT 'synced',
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. TABELLA SPESE
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    category TEXT NOT NULL DEFAULT 'Generale',
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT DEFAULT '',
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_frequency TEXT CHECK (recurrence_frequency IN ('weekly', 'monthly', 'annual')),
    recurrence_start_date DATE,
    recurrence_end_date DATE,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    recurrence_parent_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. TABELLA LOG INTEGRAZIONI
CREATE TABLE IF NOT EXISTS public.integrations_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    service TEXT NOT NULL CHECK (service IN ('google_calendar', 'notion', 'gemini')),
    direction TEXT DEFAULT 'outbound',
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'pending')),
    payload JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ABILITAZIONE ROW LEVEL SECURITY (RLS) SU TUTTE LE TABELLE
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_extra_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations_log ENABLE ROW LEVEL SECURITY;

-- POLICIES PER OGNI TABELLA (ISOLAMENTO TOTALE TRA UTENTI)
CREATE POLICY "Users can manage own settings" ON public.settings
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own clients" ON public.clients
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own services" ON public.services_catalog
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own quotes" ON public.quotes
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage items of own quotes" ON public.quote_items
    FOR ALL USING (EXISTS (SELECT 1 FROM public.quotes WHERE quotes.id = quote_items.quote_id AND quotes.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.quotes WHERE quotes.id = quote_items.quote_id AND quotes.user_id = auth.uid()));

CREATE POLICY "Users can manage images of own quote items" ON public.quote_item_images
    FOR ALL USING (EXISTS (
        SELECT 1 FROM public.quote_items
        JOIN public.quotes ON quotes.id = quote_items.quote_id
        WHERE quote_items.id = quote_item_images.quote_item_id AND quotes.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.quote_items
        JOIN public.quotes ON quotes.id = quote_items.quote_id
        WHERE quote_items.id = quote_item_images.quote_item_id AND quotes.user_id = auth.uid()
    ));

CREATE POLICY "Users can manage extra services of own quotes" ON public.quote_extra_services
    FOR ALL USING (EXISTS (SELECT 1 FROM public.quotes WHERE quotes.id = quote_extra_services.quote_id AND quotes.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.quotes WHERE quotes.id = quote_extra_services.quote_id AND quotes.user_id = auth.uid()));

CREATE POLICY "Users can manage own payments" ON public.payments
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own todos" ON public.todos
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own appointments" ON public.appointments
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own expenses" ON public.expenses
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own integration logs" ON public.integrations_log
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- INDICI DI PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_user_id ON public.quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON public.quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON public.todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_client_id ON public.todos(client_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON public.todos(due_date);
CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON public.appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON public.appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_quote_id ON public.payments(quote_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON public.expenses(user_id);
