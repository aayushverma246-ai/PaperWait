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
    const { folder_id } = await request.json()

    // Validate that if folder_id is provided, it belongs to the user
    if (folder_id !== null) {
      const { data: folder, error: folderError } = await supabase
        .from('folders')
        .select('id')
        .eq('id', folder_id)
        .eq('user_id', user.id)
        .single()

      if (folderError || !folder) {
        return NextResponse.json({ error: 'Invalid folder selected' }, { status: 400 })
      }
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .update({ folder_id })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (documentError) {
      return NextResponse.json({ error: documentError.message }, { status: 500 })
    }

    return NextResponse.json(document)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
