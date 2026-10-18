-- ============================================================================
-- ADDITIVE MIGRATION: Semantic Search & AI Chat — Document Embeddings
-- This migration does NOT modify any existing tables, columns, or policies.
-- It only adds new objects for the semantic search feature.
-- ============================================================================

-- 1. Enable pgvector extension (safe to call if already enabled)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Create document_chunks table for storing embeddings
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  page_number INTEGER,
  source_metadata JSONB DEFAULT '{}'::jsonb,
  content_fingerprint TEXT NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT '@cf/qwen/qwen3-embedding-0.6b',
  embedding extensions.vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Prevent duplicate chunks for the same document+chunk_index+fingerprint
  UNIQUE(document_id, chunk_index, content_fingerprint)
);

-- 3. Create document_index_status table for tracking indexing state
CREATE TABLE IF NOT EXISTS public.document_index_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, indexing, indexed, failed, stale
  content_fingerprint TEXT,
  chunks_count INTEGER DEFAULT 0,
  error_message TEXT,
  last_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Enable Row Level Security
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_index_status ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for document_chunks (user isolation)
DROP POLICY IF EXISTS "Users can select their own chunks" ON public.document_chunks;
CREATE POLICY "Users can select their own chunks"
  ON public.document_chunks FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own chunks" ON public.document_chunks;
CREATE POLICY "Users can insert their own chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own chunks" ON public.document_chunks;
CREATE POLICY "Users can delete their own chunks"
  ON public.document_chunks FOR DELETE
  USING (auth.uid() = user_id);

-- 6. RLS Policies for document_index_status
DROP POLICY IF EXISTS "Users can select their own index status" ON public.document_index_status;
CREATE POLICY "Users can select their own index status"
  ON public.document_index_status FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own index status" ON public.document_index_status;
CREATE POLICY "Users can insert their own index status"
  ON public.document_index_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own index status" ON public.document_index_status;
CREATE POLICY "Users can update their own index status"
  ON public.document_index_status FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own index status" ON public.document_index_status;
CREATE POLICY "Users can delete their own index status"
  ON public.document_index_status FOR DELETE
  USING (auth.uid() = user_id);

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON public.document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_index_status_user_id ON public.document_index_status(user_id);
CREATE INDEX IF NOT EXISTS idx_document_index_status_status ON public.document_index_status(status);

-- 8. HNSW vector index for cosine similarity search
--    Using HNSW for fast approximate nearest neighbor search.
--    m=16 and ef_construction=64 are good defaults for datasets up to ~100k vectors.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON public.document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 9. Create a SECURITY INVOKER function for vector search
--    This function runs with the caller's permissions, so RLS is enforced.
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding extensions.vector(1024),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INTEGER,
  chunk_text TEXT,
  page_number INTEGER,
  source_metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.chunk_text,
    dc.page_number,
    dc.source_metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.user_id = match_user_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
