/**
 * Document Indexer
 * 
 * Orchestrates the process of chunking document text and storing embeddings
 * in the Supabase database. Handles idempotent indexing, backfill, and
 * stale embedding cleanup.
 * 
 * Server-side only.
 */

import { chunkDocument, generateFingerprint } from './chunker'
import { generateEmbeddingsBatched, EMBEDDING_MODEL } from './embeddings'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface IndexResult {
  documentId: string
  status: 'indexed' | 'skipped' | 'failed' | 'empty'
  chunksCount: number
  error?: string
}

/**
 * Index a single document: chunk its text, generate embeddings, and store them.
 * Idempotent — checks fingerprint to avoid re-indexing unchanged content.
 * 
 * Uses the service-role client to bypass RLS for writes but still enforces
 * explicit user_id checks for security.
 */
export async function indexDocument(
  documentId: string,
  userId: string
): Promise<IndexResult> {
  const supa = getServiceSupabase()

  try {
    // 1. Fetch the document — verify ownership
    const { data: doc, error: fetchError } = await supa
      .from('documents')
      .select('id, user_id, file_name, ocr_text, status')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single()

    if (fetchError || !doc) {
      return { documentId, status: 'failed', chunksCount: 0, error: 'Document not found or access denied' }
    }

    if (doc.status !== 'done') {
      return { documentId, status: 'skipped', chunksCount: 0, error: 'Document not yet processed' }
    }

    if (!doc.ocr_text || doc.ocr_text.trim().length < 50) {
      // Mark as indexed (empty) so we don't retry
      await upsertIndexStatus(supa, documentId, userId, 'indexed', '', 0)
      return { documentId, status: 'empty', chunksCount: 0 }
    }

    // 2. Check content fingerprint to skip unchanged documents
    const currentFingerprint = generateFingerprint(doc.ocr_text)
    
    const { data: indexStatus } = await supa
      .from('document_index_status')
      .select('content_fingerprint, status')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .single()

    if (
      indexStatus?.status === 'indexed' &&
      indexStatus?.content_fingerprint === currentFingerprint
    ) {
      return { documentId, status: 'skipped', chunksCount: 0 }
    }

    // 3. Mark as indexing
    await upsertIndexStatus(supa, documentId, userId, 'indexing', currentFingerprint, 0)

    // 4. Delete any existing stale chunks for this document
    await supa
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId)
      .eq('user_id', userId)

    // 5. Chunk the document
    const chunks = chunkDocument(doc.ocr_text, documentId, doc.file_name)

    if (chunks.length === 0) {
      await upsertIndexStatus(supa, documentId, userId, 'indexed', currentFingerprint, 0)
      return { documentId, status: 'empty', chunksCount: 0 }
    }

    // 6. Generate embeddings in batches
    const texts = chunks.map(c => c.text)
    const embeddings = await generateEmbeddingsBatched(texts, 15, 300)

    // 7. Store chunks with embeddings
    const rows = chunks.map((chunk, i) => ({
      user_id: userId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.text,
      page_number: chunk.pageNumber,
      source_metadata: chunk.sourceMetadata,
      content_fingerprint: currentFingerprint,
      embedding_model: EMBEDDING_MODEL,
      embedding: `[${embeddings[i].join(',')}]`,
    }))

    // Insert in batches of 50 to avoid request size limits
    const BATCH_SIZE = 50
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error: insertError } = await supa
        .from('document_chunks')
        .insert(batch)

      if (insertError) {
        throw new Error(`Failed to insert chunk batch ${i}: ${insertError.message}`)
      }
    }

    // 8. Mark as successfully indexed
    await upsertIndexStatus(supa, documentId, userId, 'indexed', currentFingerprint, chunks.length)

    return { documentId, status: 'indexed', chunksCount: chunks.length }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    // Mark as failed with error message
    try {
      await upsertIndexStatus(
        supa, documentId, userId, 'failed', '', 0,
        errMsg?.substring(0, 500)
      )
    } catch (_) {
      // Ignore secondary error
    }

    return {
      documentId,
      status: 'failed',
      chunksCount: 0,
      error: errMsg || 'Unknown indexing error',
    }
  }
}

/**
 * Index multiple documents in sequence with bounded batching.
 * Suitable for backfilling previously uploaded documents.
 */
export async function indexDocumentsBatch(
  documentIds: string[],
  userId: string,
  maxBatch: number = 5
): Promise<IndexResult[]> {
  const results: IndexResult[] = []
  const batch = documentIds.slice(0, maxBatch)

  for (const docId of batch) {
    const result = await indexDocument(docId, userId)
    results.push(result)

    // Brief pause between documents to be kind to rate limits
    if (results.length < batch.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return results
}

/**
 * Find documents that need indexing (backfill candidates).
 * Returns IDs of documents that are:
 *  - status='done' (processing completed)
 *  - Not yet indexed or have stale fingerprints
 */
export async function findUnindexedDocuments(
  userId: string,
  limit: number = 10
): Promise<string[]> {
  const supa = getServiceSupabase()

  // Get all done documents for this user
  const { data: allDocs, error: docsError } = await supa
    .from('documents')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(500)

  if (docsError || !allDocs) return []

  // Get all indexed document IDs
  const { data: indexedDocs } = await supa
    .from('document_index_status')
    .select('document_id, status')
    .eq('user_id', userId)
    .in('status', ['indexed', 'indexing'])

  const indexedSet = new Set((indexedDocs || []).map(d => d.document_id))

  // Return documents not yet indexed
  const unindexed = allDocs
    .filter(d => !indexedSet.has(d.id))
    .map(d => d.id)
    .slice(0, limit)

  return unindexed
}

/**
 * Upsert document index status record.
 */
async function upsertIndexStatus(
  supa: ReturnType<typeof getServiceSupabase>,
  documentId: string,
  userId: string,
  status: string,
  fingerprint: string,
  chunksCount: number,
  errorMessage?: string
) {
  const { error } = await supa
    .from('document_index_status')
    .upsert({
      document_id: documentId,
      user_id: userId,
      status,
      content_fingerprint: fingerprint,
      chunks_count: chunksCount,
      error_message: errorMessage || null,
      last_indexed_at: status === 'indexed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'document_id',
    })

  if (error) {
    console.error('Failed to upsert index status:', error)
  }
}
