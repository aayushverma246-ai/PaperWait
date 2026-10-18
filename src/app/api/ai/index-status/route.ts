/**
 * Index Status API
 * 
 * GET /api/ai/index-status
 * 
 * Returns the indexing status overview for the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Count total done documents
    const { count: totalDocs, error: countError } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'done')

    if (countError) {
      return NextResponse.json({ error: 'Failed to count documents' }, { status: 500 })
    }

    // Count indexed documents
    const { count: indexedDocs, error: indexCountError } = await supabase
      .from('document_index_status')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'indexed')

    if (indexCountError) {
      return NextResponse.json({ error: 'Failed to count indexed documents' }, { status: 500 })
    }

    // Count failed indexing
    const { count: failedDocs } = await supabase
      .from('document_index_status')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'failed')

    // Count currently indexing
    const { count: indexingDocs } = await supabase
      .from('document_index_status')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'indexing')

    const total = totalDocs || 0
    const indexed = indexedDocs || 0
    const pending = total - indexed - (failedDocs || 0) - (indexingDocs || 0)

    return NextResponse.json({
      total,
      indexed,
      unindexed: Math.max(0, total - indexed),
      pending: Math.max(0, pending),
      failed: failedDocs || 0,
      indexing: indexingDocs || 0,
      isFullyIndexed: indexed >= total && total > 0,
    })
  } catch (error: any) {
    console.error('Index status error:', error)
    return NextResponse.json({ error: 'Failed to get index status' }, { status: 500 })
  }
}
