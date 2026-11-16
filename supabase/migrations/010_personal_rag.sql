-- 010_personal_rag.sql
-- "Chiedi a te stesso": archivio personale interrogabile (documenti e vecchie chat), ricerca ibrida sul server,
-- profilo di istruzioni dell'assistente e interruttori privacy per i dati vivi del gestionale.
--
-- Idempotente: si può rieseguire senza danni. Non cancella né modifica dati esistenti.

-- ---------------------------------------------------------------------------
-- 1. Fonti importate (una chat, un PDF, un file di testo). I "pezzi" stanno in brain_memories.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_provider TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_provider IN ('chatgpt', 'claude', 'gemini', 'pdf', 'markdown', 'text', 'manual')),
    external_conversation_id TEXT,
    domain TEXT NOT NULL DEFAULT 'personal' CHECK (length(trim(domain)) > 0),
    original_date TIMESTAMPTZ,          -- data vera della chat/documento: una chat vecchia non deve scavalcare fatti recenti
    raw_content TEXT,                   -- testo originale ripulito: non si butta mai, serve per re-indicizzare
    chunk_count INT NOT NULL DEFAULT 0,
    facts_extracted_count INT NOT NULL DEFAULT 0,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_documents_user_id ON public.brain_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_documents_external
    ON public.brain_documents(user_id, source_provider, external_conversation_id);

-- ---------------------------------------------------------------------------
-- 2. brain_memories: collegamento al documento padre, ricerca per parole esatte in italiano
-- ---------------------------------------------------------------------------
ALTER TABLE public.brain_memories
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.brain_documents(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS chunk_index INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS embedding_source TEXT;  -- chi ha calcolato il vettore: 'openai' | 'gemini' | 'local'

ALTER TABLE public.brain_memories
    ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_brain_memories_fts ON public.brain_memories USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_brain_memories_document_id ON public.brain_memories(document_id);

-- La sorgente del vettore finora viaggiava dentro `extra`: diventa una colonna vera (serve alla ricerca sul server)
UPDATE public.brain_memories
   SET embedding_source = extra->>'embedding_source'
 WHERE embedding_source IS NULL AND extra ? 'embedding_source';
UPDATE public.brain_memories SET extra = extra - 'embedding_source' WHERE extra ? 'embedding_source';

-- I pezzi di un documento hanno source_type = 'document': il vincolo diventa "testo non vuoto" (come per domain)
ALTER TABLE public.brain_memories DROP CONSTRAINT IF EXISTS brain_memories_source_type_check;
ALTER TABLE public.brain_memories
    ADD CONSTRAINT brain_memories_source_type_check CHECK (length(trim(source_type)) > 0);

-- ---------------------------------------------------------------------------
-- 3. Ricerca ibrida: significato (vettori) + parole esatte (nomi propri, ricette, sigle)
--    Ogni metà usa il proprio indice; poi i risultati si fondono con un punteggio unico.
--    filter_user serve quando chi chiama salta le regole RLS (il bot Telegram): NULL = usa solo RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_brain_memories_hybrid(
    query_embedding vector(768),
    query_text text,
    match_threshold float,
    match_count int,
    filter_domain text DEFAULT NULL,
    filter_source text DEFAULT 'openai',
    filter_user uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    chunk_index int,
    title text,
    content text,
    domain text,
    source_type text,
    source_date timestamptz,
    created_at timestamptz,
    document_title text,
    document_provider text,
    similarity float,
    lexical_rank float,
    score float
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
    WITH q AS (
        -- le parole della domanda, ridotte alla radice italiana e messe in OR (basta che ne compaia una)
        SELECT CASE WHEN coalesce(trim(query_text), '') = '' THEN NULL ELSE (
            SELECT to_tsquery('simple', string_agg('''' || replace(lexeme, '''', '''''') || '''', ' | '))
              FROM unnest(to_tsvector('italian', query_text))
        ) END AS tsq
    ),
    vec AS (
        SELECT bm.id, (1 - (bm.embedding <=> query_embedding))::float AS sim
          FROM public.brain_memories bm
         WHERE query_embedding IS NOT NULL
           AND NOT bm.is_deleted
           AND bm.embedding IS NOT NULL
           AND bm.embedding_source = filter_source
           AND (filter_domain IS NULL OR bm.domain = filter_domain)
           AND (filter_user IS NULL OR bm.user_id = filter_user)
         ORDER BY bm.embedding <=> query_embedding ASC
         LIMIT greatest(match_count * 4, 24)
    ),
    lex AS (
        SELECT bm.id, ts_rank_cd(bm.fts, q.tsq)::float AS rank
          FROM public.brain_memories bm, q
         WHERE q.tsq IS NOT NULL
           AND NOT bm.is_deleted
           AND bm.fts @@ q.tsq
           AND (filter_domain IS NULL OR bm.domain = filter_domain)
           AND (filter_user IS NULL OR bm.user_id = filter_user)
         ORDER BY rank DESC
         LIMIT greatest(match_count * 4, 24)
    ),
    merged AS (
        SELECT coalesce(vec.id, lex.id) AS id,
               coalesce(vec.sim, 0)::float AS sim,
               coalesce(lex.rank, 0)::float AS lex_rank
          FROM vec FULL OUTER JOIN lex ON vec.id = lex.id
    )
    SELECT bm.id, bm.document_id, bm.chunk_index, bm.title, bm.content, bm.domain, bm.source_type,
           coalesce(bm.source_date, d.original_date) AS source_date, bm.created_at,
           d.title AS document_title, d.source_provider AS document_provider,
           m.sim AS similarity,
           m.lex_rank AS lexical_rank,
           (m.sim * 0.7 + (m.lex_rank / (m.lex_rank + 0.1)) * 0.3)::float AS score
      FROM merged m
      JOIN public.brain_memories bm ON bm.id = m.id
      LEFT JOIN public.brain_documents d ON d.id = bm.document_id
     WHERE (m.sim > match_threshold OR m.lex_rank > 0)
       AND (d.id IS NULL OR NOT d.is_deleted)
     ORDER BY score DESC
     LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_brain_memories_hybrid(vector, text, float, int, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_brain_memories_hybrid(vector, text, float, int, text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Profilo dell'assistente: come deve rispondere e quali dati vivi può leggere
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_assistant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    global_instructions TEXT NOT NULL DEFAULT '',                 -- Livello 1: chi sei e come vuoi le risposte
    domain_rules JSONB NOT NULL DEFAULT '{}'::jsonb,              -- Livello 2: regole per ambito (cucina, work, body, tech, personal)
    live_data_permissions JSONB NOT NULL
        DEFAULT '{"body": true, "todos_calendar": true, "clients": false, "finances": false}'::jsonb,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_assistant_profiles_user_id ON public.brain_assistant_profiles(user_id);

-- ---------------------------------------------------------------------------
-- 5. Sicurezza (ognuno vede solo le proprie righe), data di modifica automatica, aggiornamenti in tempo reale
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['brain_documents', 'brain_assistant_profiles'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "Users can manage own %s" ON public.%I', t, t);
        EXECUTE format(
            'CREATE POLICY "Users can manage own %s" ON public.%I FOR ALL TO authenticated '
            'USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id)', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_touch_updated_at BEFORE INSERT OR UPDATE ON public.%I '
            'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
