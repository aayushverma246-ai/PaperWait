/**
 * Document Indexing API
 * 
 * POST /api/ai/index
 * Body: { documentIds?: string[] }
 * 
 * If documentIds is provided, indexes those specific documents.
 * If omitted, finds and indexes unindexed documents (backfill).
 * 
 * Bounded batch processing — indexes at most 5 documents per call.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { indexDocumentsBatch, findUnindexedDocuments } from '@/utils/semantic/indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    let { documentIds } = body as { documentIds?: string[] }

    // Validate provided document IDs
    if (documentIds) {
      if (!Array.isArray(documentIds)) {
        return NextResponse.json({ error: 'documentIds must be an array' }, { status: 400 })
      }
      // Limit to 2 documents per request to safely stay well within Vercel timeout limits
      documentIds = documentIds.slice(0, 2)
    } else {
      // Auto-detect unindexed documents for backfill
      documentIds = await findUnindexedDocuments(user.id, 2)
    }

    if (documentIds.length === 0) {
      return NextResponse.json({
        message: 'All documents are already indexed',
        results: [],
        remaining: 0,
      })
    }

    // Index the batch
    const results = await indexDocumentsBatch(documentIds, user.id, 2)

    // Check if there are more unindexed documents
    const remainingDocs = await findUnindexedDocuments(user.id, 50)

    return NextResponse.json({
      message: `Indexed ${results.filter(r => r.status === 'indexed').length} documents`,
      results,
      remaining: remainingDocs.length,
    })
  } catch (error: any) {
    console.error('Indexing error:', error)
    return NextResponse.json({ error: 'Indexing failed: ' + error.message }, { status: 500 })
  }
}
