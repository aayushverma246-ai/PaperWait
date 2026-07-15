import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  const isUncategorized = id === 'uncategorized'

  try {
    // 1. Fetch all documents in this folder (or where folder_id is null if uncategorized)
    const query = supabase
      .from('documents')
      .select('id, storage_path')
      .eq('user_id', user.id)

    if (isUncategorized) {
      query.is('folder_id', null)
    } else {
      query.eq('folder_id', id)
    }

    const { data: docs, error: fetchErr } = await query
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    if (docs && docs.length > 0) {
      const storagePaths = docs.map((doc) => doc.storage_path)
      const docIds = docs.map((doc) => doc.id)

      // 2. Delete files from Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove(storagePaths)

      if (storageError) {
        console.error('Failed to delete files from storage:', storageError)
      }

      // 3. Delete from DB
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .in('id', docIds)
        .eq('user_id', user.id)

      if (dbError) {
        return NextResponse.json({ error: dbError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
