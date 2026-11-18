/**
 * Semantic Search API
 * 
 * POST /api/ai/search
 * Body: { query: string, limit?: number }
 * 
 * Returns semantically relevant document chunks for the authenticated user
 * using a resilient Hybrid Scoring Engine combining dense vector similarity,
 * title exact/keyword boosts, folder classification boosts, and content term frequency.
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

// Helper to strip internal OCR delimiters, excessive symbols, and markdown artifacts
function cleanOcrText(rawText: string): string {
  if (!rawText) return ''
  return rawText
    .replace(/---+\s*(?:Page\s*\d+|Sheet:\s*[^-\n]+)\s*---+/gi, ' ')
    .replace(/(?:^|\n)\s*[-=_]{3,}\s*(?:\n|$)/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[,|;]{2,}/g, ', ')
    .replace(/\s*,\s*/g, ', ')
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
    snippet = snippet.replace(/^[,.;:!|/\-\s]+/, '').trimEnd()
    return snippet ? snippet + '...' : cleaned.substring(0, targetLength) + '...'
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

  let snippet = cleaned.substring(actualStart, actualEnd).replace(/^[,.;:!|/\-\s]+/, '').trim()
  if (actualStart > 0) snippet = '...' + snippet
  if (actualEnd < cleaned.length) snippet = snippet + '...'

  return snippet
}

interface CandidateMatch {
  id: string
  document_id: string
  chunk_text: string
  page_number: number | null
  source_metadata: any
  vector_sim: number
  doc: any
  hybridScore?: number
  keywordHits?: number
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
    const queryLower = query.toLowerCase().trim()
    const queryKeywords = queryLower
      .split(/[\s,.;:!?/\\(){}[\]"']+/)
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t))

    // 1. Fetch all user documents with their real joined folder name
    const { data: allDocs, error: docError } = await supabase
      .from('documents')
      .select('id, file_name, file_type, description, ocr_text, created_at, storage_path, folder_id, folders:folder_id(id, name)')
      .eq('user_id', user.id)
      .eq('status', 'done')

    if (docError) {
      console.error('Document fetch error:', docError)
    }

    const docMap = new Map((allDocs || []).map(d => [d.id, d]))

    // 2. Generate query embedding (with graceful fallback if embedding API fails)
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await generateQueryEmbedding(query.trim())
    } catch (embeddingError: any) {
      console.warn('Embedding generation failed, falling back to hybrid keyword search:', embeddingError.message)
    }

    // 3. Retrieve dense vector matches if embedding succeeded
    let vectorMatches: any[] = []
    if (queryEmbedding) {
      try {
        const { data: rpcMatches, error: searchError } = await supabase.rpc(
          'match_document_chunks',
          {
            query_embedding: `[${queryEmbedding.join(',')}]`,
            match_user_id: user.id,
            match_threshold: 0.25, // Broad candidate threshold for hybrid re-ranking
            match_count: Math.max(50, clampedLimit * 4),
          }
        )

        if (searchError) {
          console.error('Vector search error:', searchError)
        } else if (rpcMatches) {
          vectorMatches = rpcMatches
        }
      } catch (err) {
        console.error('Vector search exception:', err)
      }
    }

    // 4. Candidate Pooling: Merge vector chunks + document-level title/folder matches
    const candidateMap = new Map<string, CandidateMatch>()

    for (const vm of vectorMatches) {
      const doc = docMap.get(vm.document_id)
      if (!doc) continue
      candidateMap.set(vm.id, {
        id: vm.id,
        document_id: vm.document_id,
        chunk_text: vm.chunk_text || '',
        page_number: vm.page_number,
        source_metadata: vm.source_metadata,
        vector_sim: vm.similarity || 0,
        doc
      })
    }

    // Ensure documents with title or folder matches are present in candidates
    for (const doc of (allDocs || [])) {
      const titleLower = (doc.file_name || '').toLowerCase()
      const folderName = (doc as any).folders?.name || ''
      const folderLower = folderName.toLowerCase()

      const hasTitleMatch = queryKeywords.some(t => titleLower.includes(t)) || titleLower.includes(queryLower)
      const hasFolderMatch = queryKeywords.some(t => folderLower.includes(t))

      if (hasTitleMatch || hasFolderMatch) {
        const hasExistingChunk = Array.from(candidateMap.values()).some(c => c.document_id === doc.id)
        if (!hasExistingChunk) {
          candidateMap.set(`synth_${doc.id}`, {
            id: `synth_${doc.id}`,
            document_id: doc.id,
            chunk_text: doc.ocr_text ? doc.ocr_text.substring(0, 500) : doc.file_name,
            page_number: 1,
            source_metadata: { fileName: doc.file_name, documentId: doc.id },
            vector_sim: 0.35, // default baseline
            doc
          })
        }
      }
    }

    if (candidateMap.size === 0) {
      return NextResponse.json({ results: [], query })
    }

    // 5. Hybrid Scoring Engine: Combine Dense Vector + Title + Folder + Content
    const scoredCandidates: CandidateMatch[] = []

    for (const candidate of candidateMap.values()) {
      const doc = candidate.doc
      const titleLower = (doc.file_name || '').toLowerCase()
      const folderName = (doc as any).folders?.name || ''
      const folderLower = folderName.toLowerCase()
      const textLower = (candidate.chunk_text || '').toLowerCase()

      let titleBoost = 0
      let folderBoost = 0
      let contentBoost = 0
      let keywordHits = 0

      // A. Title boost: Exact phrase or keyword matches
      if (queryKeywords.length > 0 && titleLower.includes(queryLower)) {
        titleBoost += 0.35
        keywordHits += 3
      } else {
        for (const t of queryKeywords) {
          if (titleLower.includes(t)) {
            titleBoost += 0.12
            keywordHits += 1
          }
        }
      }

      // B. Folder boost: Match user's real folder classification
      for (const t of queryKeywords) {
        if (folderLower.includes(t)) {
          folderBoost += 0.20
          keywordHits += 1
          break
        }
      }

      // C. Content keyword matches in chunk
      for (const t of queryKeywords) {
        if (textLower.includes(t)) {
          contentBoost += 0.05
          keywordHits += 1
        }
      }

      // Cap individual boosts
      titleBoost = Math.min(titleBoost, 0.40)
      folderBoost = Math.min(folderBoost, 0.25)
      contentBoost = Math.min(contentBoost, 0.15)

      const sim = candidate.vector_sim || 0

      // Noise Rejection Gate:
      // If zero keywords match across title, folder, and text, require high vector similarity (>= 0.52)
      if (keywordHits === 0 && sim < 0.52) {
        continue
      }

      const hybridScore = Math.min(0.99, sim + titleBoost + folderBoost + contentBoost)

      // Baseline floor: Discard candidates below 0.42 hybrid score
      if (hybridScore < 0.42) {
        continue
      }

      scoredCandidates.push({
        ...candidate,
        hybridScore,
        keywordHits
      })
    }

    if (scoredCandidates.length === 0) {
      return NextResponse.json({ results: [], query })
    }

    // 6. Sort by hybridScore descending
    scoredCandidates.sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))

    // 7. Dynamic relative drop-off floor
    const topScore = scoredCandidates[0].hybridScore || 0
    const relativeFloor = Math.max(0.42, topScore - 0.25)
    const qualifiedCandidates = scoredCandidates.filter(c => (c.hybridScore || 0) >= relativeFloor)

    // 8. Deduplicate by document: keep single best chunk per document
    const seenDocuments = new Set<string>()
    const deduplicatedMatches: CandidateMatch[] = []

    for (const match of qualifiedCandidates) {
      if (!seenDocuments.has(match.document_id)) {
        seenDocuments.add(match.document_id)
        deduplicatedMatches.push(match)
      }
    }

    const limitedMatches = deduplicatedMatches.slice(0, clampedLimit)

    // 9. Generate signed URLs for preview thumbnails if applicable (for images)
    const imageDocPaths = limitedMatches
      .map(m => m.doc)
      .filter(d => d?.storage_path && (d.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(d.file_name)))
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

    // 10. Format results with cleaned, contextual snippets and verified metadata
    const results = limitedMatches.map(match => {
      const doc = match.doc
      const snippet = extractRelevantSnippet(match.chunk_text || '', query, 220)
      const folderName = (doc as any)?.folders?.name || 'Uncategorized'
      const signedUrl = doc?.storage_path ? signedUrlMap.get(doc.storage_path) || null : null

      return {
        documentId: match.document_id,
        fileName: doc?.file_name || 'Unknown',
        fileType: doc?.file_type || '',
        snippet,
        pageNumber: match.page_number,
        section: match.source_metadata?.section || null,
        similarity: Math.round((match.hybridScore || 0) * 100) / 100,
        folderName,
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
