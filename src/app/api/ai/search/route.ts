/**
 * Semantic Search API
 * 
 * POST /api/ai/search
 * Body: { query: string, limit?: number }
 * 
 * Returns semantically relevant document chunks for the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateQueryEmbedding } from '@/utils/semantic/embeddings'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'what', 'where', 'who', 'how',
  'find', 'show', 'get', 'search', 'me', 'my', 'all', 'please'
])

// Helper to strip internal OCR delimiters and markdown artifacts
function cleanOcrText(rawText: string): string {
  if (!rawText) return ''
  return rawText
    .replace(/---+\s*(?:Page\s*\d+|Sheet:\s*[^-\n]+)\s*---+/gi, ' ')
    .replace(/(?:^|\n)\s*[-=_]{3,}\s*(?:\n|$)/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Helper to extract a clean window of text centered on matched terms
function extractRelevantSnippet(rawText: string, searchPhrase: string, targetLength: number = 220): string {
  const cleaned = cleanOcrText(rawText)
  if (!cleaned || cleaned.length <= targetLength) return cleaned

  const terms = searchPhrase
    .toLowerCase()
    .split(/[\s,.;:!?/\\(){}[\]"']+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))

  let bestMatchIndex = -1
  for (const term of terms) {
    const idx = cleaned.toLowerCase().indexOf(term)
    if (idx !== -1 && (bestMatchIndex === -1 || idx < bestMatchIndex)) {
      bestMatchIndex = idx
    }
  }

  if (bestMatchIndex === -1 || bestMatchIndex < 40) {
    let snippet = cleaned.substring(0, targetLength)
    const lastSpace = snippet.lastIndexOf(' ')
    if (lastSpace > targetLength * 0.7) {
      snippet = snippet.substring(0, lastSpace)
    }
    return snippet.trimEnd() + '...'
  }

  const startOffset = Math.max(0, bestMatchIndex - 50)
  let actualStart = startOffset
  if (actualStart > 0) {
    const nextSpace = cleaned.indexOf(' ', actualStart)
    if (nextSpace !== -1 && nextSpace - actualStart < 20) {
      actualStart = nextSpace + 1
    }
  }

  const endOffset = Math.min(cleaned.length, actualStart + targetLength)
  let actualEnd = endOffset
  if (actualEnd < cleaned.length) {
    const prevSpace = cleaned.lastIndexOf(' ', actualEnd)
    if (prevSpace > actualStart && actualEnd - prevSpace < 20) {
      actualEnd = prevSpace
    }
  }

  let snippet = cleaned.substring(actualStart, actualEnd).trim()
  if (actualStart > 0) snippet = '...' + snippet
  if (actualEnd < cleaned.length) snippet = snippet + '...'

  return snippet
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { query, limit = 15 } = body

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    if (query.length > 2000) {
      return NextResponse.json({ error: 'Query too long (max 2000 chars)' }, { status: 400 })
    }

    const clampedLimit = Math.min(Math.max(1, limit), 30)

    // 1. Generate query embedding
    let queryEmbedding: number[]
    try {
      queryEmbedding = await generateQueryEmbedding(query.trim())
    } catch (embeddingError: any) {
      console.error('Embedding generation failed:', embeddingError.message)
      return NextResponse.json({
        error: 'Semantic search temporarily unavailable',
        details: embeddingError.message?.includes('RATE_LIMIT')
          ? 'Rate limit reached. Please try again in a moment.'
          : 'Embedding service error. Please try again.',
      }, { status: 503 })
    }

    // 2. Search for similar chunks using the database function
    let matches: any[] = []
    try {
      const { data: rpcMatches, error: searchError } = await supabase.rpc(
        'match_document_chunks',
        {
          query_embedding: `[${queryEmbedding.join(',')}]`,
          match_user_id: user.id,
          match_threshold: 0.15,
          match_count: clampedLimit * 2, // Fetch extra for deduplication
        }
      )

      if (searchError) {
        console.error('Vector search error:', searchError)
      } else if (rpcMatches) {
        matches = rpcMatches
      }
    } catch (err) {
      console.error('Vector search exception:', err)
    }

    // 3. Keyword fallback if vector matches are few or if user queried a direct keyword
    const matchedDocIds = new Set(matches.map(m => m.document_id))
    try {
      const queryTerm = query.trim()
      const { data: fallbackDocs } = await supabase
        .from('documents')
        .select('id, file_name, file_type, description, ocr_text, created_at, storage_path')
        .eq('user_id', user.id)
        .eq('status', 'done')
        .ilike('file_name', `%${queryTerm}%`)
        .limit(clampedLimit)

      if (fallbackDocs && fallbackDocs.length > 0) {
        for (const fbDoc of fallbackDocs) {
          if (!matchedDocIds.has(fbDoc.id)) {
            matchedDocIds.add(fbDoc.id)
            matches.unshift({
              id: fbDoc.id,
              document_id: fbDoc.id,
              chunk_index: 0,
              chunk_text: fbDoc.ocr_text ? fbDoc.ocr_text.substring(0, 400) : fbDoc.file_name,
              page_number: 1,
              source_metadata: { fileName: fbDoc.file_name, documentId: fbDoc.id },
              similarity: 0.95, // Direct title match
            })
          }
        }
      }
    } catch (fbErr) {
      console.error('Fallback search error:', fbErr)
    }

    if (!matches || matches.length === 0) {
      return NextResponse.json({ results: [], query })
    }

    // 4. Deduplicate by document — keep best match per document
    type ChunkMatch = (typeof matches)[number]
    const seenDocuments = new Map<string, ChunkMatch>()
    const deduplicatedMatches: ChunkMatch[] = []

    for (const match of matches) {
      const existing = seenDocuments.get(match.document_id)
      if (!existing) {
        seenDocuments.set(match.document_id, match)
        deduplicatedMatches.push(match)
      }
      // Allow up to 2 chunks per document for context
      else if (
        deduplicatedMatches.filter((m: ChunkMatch) => m.document_id === match.document_id).length < 2
      ) {
        deduplicatedMatches.push(match)
      }
    }

    // 5. Fetch document metadata for the matched documents
    const uniqueDocIds = [...new Set(deduplicatedMatches.map((m: ChunkMatch) => m.document_id))]
    const { data: documents, error: docError } = await supabase
      .from('documents')
      .select('id, file_name, file_type, description, status, created_at, storage_path')
      .in('id', uniqueDocIds)
      .eq('user_id', user.id)

    if (docError) {
      console.error('Document fetch error:', docError)
    }

    const docMap = new Map((documents || []).map(d => [d.id, d]))

    // Generate signed URLs for preview thumbnails if applicable (for images)
    const imageDocPaths = (documents || [])
      .filter(d => d.storage_path && (d.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(d.file_name)))
      .map(d => d.storage_path)

    const signedUrlMap = new Map<string, string>()
    if (imageDocPaths.length > 0) {
      try {
        const { data: signedUrls } = await supabase.storage
          .from('documents')
          .createSignedUrls(imageDocPaths, 3600)
        if (signedUrls) {
          for (const item of signedUrls) {
            if (item.path && item.signedUrl) {
              signedUrlMap.set(item.path, item.signedUrl)
            }
          }
        }
      } catch (storageErr) {
        // silent fallback to badge
      }
    }

    // 6. Format results with cleaned, contextual snippets
    const results = deduplicatedMatches
      .slice(0, clampedLimit)
      .map(match => {
        const doc = docMap.get(match.document_id)
        
        const snippet = extractRelevantSnippet(match.chunk_text || '', query, 220)

        let folderInfo = ''
        if (doc?.description) {
          try {
            const parsed = JSON.parse(doc.description)
            folderInfo = parsed.suggested_folder || ''
          } catch (e) { /* ignore */ }
        }

        const signedUrl = doc?.storage_path ? signedUrlMap.get(doc.storage_path) || null : null

        return {
          documentId: match.document_id,
          fileName: doc?.file_name || 'Unknown',
          fileType: doc?.file_type || '',
          snippet,
          pageNumber: match.page_number,
          section: match.source_metadata?.section || null,
          similarity: Math.round(match.similarity * 100) / 100,
          folderName: folderInfo,
          createdAt: doc?.created_at,
          signedUrl,
        }
      })

    return NextResponse.json({ results, query })
  } catch (error: any) {
    console.error('Semantic search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
