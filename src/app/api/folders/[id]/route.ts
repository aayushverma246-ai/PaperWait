import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const { name } = await request.json()
    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('folders')
      .update({ name: name.trim() })
      .eq('id', id)
      .eq('user_id', user.id) // Ensure security boundary
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A folder with this name already exists' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await context.params

  try {
    // 1. Fetch all documents in the folder first
    const { data: docs, error: fetchErr } = await supabase
      .from('documents')
      .select('id, storage_path')
      .eq('folder_id', id)
      .eq('user_id', user.id)

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    if (docs && docs.length > 0) {
      const storagePaths = docs.map((d) => d.storage_path)
      const docIds = docs.map((d) => d.id)

      // 2. Delete from Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove(storagePaths)

      if (storageError) {
        console.error('Failed to delete files from storage:', storageError)
      }

      // 3. Delete from DB documents table
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .in('id', docIds)
        .eq('user_id', user.id)

      if (dbError) {
        return NextResponse.json({ error: dbError.message }, { status: 500 })
      }
    }

    // 4. Delete the folder
    const { error: folderError } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (folderError) {
      return NextResponse.json({ error: folderError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
