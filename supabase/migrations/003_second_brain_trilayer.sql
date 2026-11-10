-- 003_second_brain_trilayer.sql
-- Architettura Cognitiva Tri-Layer Ibrida per Second Brain (Semantic Memory + Mem0 Atomic Facts + Knowledge Graph)

-- 1. Abilita l'estensione pgvector per gli embedding semantici
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. LIVELLO 1 — MEMORIA SEMANTICA (brain_memories)
CREATE TABLE IF NOT EXISTS public.brain_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    summary TEXT DEFAULT '',
    domain TEXT NOT NULL DEFAULT 'work' CHECK (domain IN ('work', 'client', 'tech', 'body', 'personal', 'idea')),
    source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'ai_chat', 'client_event', 'todo', 'body_log')),
    source_id TEXT,
    tags TEXT[] DEFAULT '{}',
    embedding vector(768),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indici Livello 1: HNSW per cosine similarity e GIN sui tag
CREATE INDEX IF NOT EXISTS idx_brain_memories_embedding
    ON public.brain_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_brain_memories_tags
    ON public.brain_memories USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_brain_memories_user_id
    ON public.brain_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_memories_domain
    ON public.brain_memories(domain);

-- 3. LIVELLO 2 — MEMORIA EPISODICA E FATTI ATOMICI (brain_facts — Pattern Mem0)
CREATE TABLE IF NOT EXISTS public.brain_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'status' CHECK (category IN ('preference', 'status', 'metric', 'rule', 'client_info')),
    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    is_active BOOLEAN NOT NULL DEFAULT true,
    superseded_by UUID REFERENCES public.brain_facts(id) ON DELETE SET NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ,
    source_memory_id UUID REFERENCES public.brain_memories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indici Livello 2
CREATE INDEX IF NOT EXISTS idx_brain_facts_user_id
    ON public.brain_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_facts_subject_key_active
    ON public.brain_facts (lower(subject), lower(fact_key)) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_brain_facts_superseded_by
    ON public.brain_facts(superseded_by);
CREATE INDEX IF NOT EXISTS idx_brain_facts_source_memory_id
    ON public.brain_facts(source_memory_id);

-- 4. LIVELLO 3 — KNOWLEDGE GRAPH RELAZIONALE (brain_nodes e brain_edges)
CREATE TABLE IF NOT EXISTS public.brain_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    node_type TEXT NOT NULL CHECK (node_type IN ('person', 'client', 'technology', 'project', 'exercise', 'biometric', 'concept', 'issue')),
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vincolo unique logico su (lower(label), node_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_nodes_unique_label_type
    ON public.brain_nodes (lower(label), node_type);
CREATE INDEX IF NOT EXISTS idx_brain_nodes_user_id
    ON public.brain_nodes(user_id);

CREATE TABLE IF NOT EXISTS public.brain_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES public.brain_nodes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    weight NUMERIC(8,2) NOT NULL DEFAULT 1.00,
    evidence TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_edges_user_id
    ON public.brain_edges(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_edges_source_node_id
    ON public.brain_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_brain_edges_target_node_id
    ON public.brain_edges(target_node_id);

-- 5. FUNZIONE SQL RPC PER RICERCA SEMANTICA VETTORIALE
CREATE OR REPLACE FUNCTION public.match_brain_memories(
    query_embedding vector(768),
    match_threshold float,
    match_count int,
    filter_domain text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    title text,
    content text,
    summary text,
    domain text,
    source_type text,
    source_id text,
    tags text[],
    created_at timestamptz,
    updated_at timestamptz,
    similarity float
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT
        bm.id,
        bm.title,
        bm.content,
        bm.summary,
        bm.domain,
        bm.source_type,
        bm.source_id,
        bm.tags,
        bm.created_at,
        bm.updated_at,
        1 - (bm.embedding <=> query_embedding) AS similarity
    FROM public.brain_memories bm
    WHERE NOT bm.is_deleted
      AND bm.embedding IS NOT NULL
      AND (filter_domain IS NULL OR bm.domain = filter_domain)
      AND 1 - (bm.embedding <=> query_embedding) > match_threshold
    ORDER BY bm.embedding <=> query_embedding ASC
    LIMIT match_count;
$$;

-- 6. ROW LEVEL SECURITY (RLS) E POLICIES
ALTER TABLE public.brain_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own brain_memories" ON public.brain_memories
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own brain_facts" ON public.brain_facts
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own brain_nodes" ON public.brain_nodes
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can manage own brain_edges" ON public.brain_edges
    FOR ALL USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
