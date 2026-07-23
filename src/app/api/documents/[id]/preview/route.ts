import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateFilePreviewCard, sanitizePostgresString, ensureFonts } from '@/utils/ai'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await context.params

  try {
    // 1. Fetch document from database
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, file_name, file_type, ocr_text, user_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (docErr || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // 2. Generate visual preview card
    await ensureFonts()
    const previewBuffer = generateFilePreviewCard(doc.file_name, doc.file_type, doc.ocr_text || '')

    // 3. Upload to Supabase Storage
    const previewPath = `${user.id}/previews/${doc.id}.png`
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(previewPath, previewBuffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(`Failed to upload preview: ${uploadError.message}`)
    }

    // 4. Create signed URL for the newly uploaded preview
    const { data: urlData, error: signErr } = await supabase.storage
      .from('documents')
      .createSignedUrl(previewPath, 3600)

    if (signErr) {
      throw new Error(`Failed to sign URL: ${signErr.message}`)
    }

    return NextResponse.json({ success: true, signedUrl: urlData.signedUrl })
  } catch (err: any) {
    console.error('On-demand preview generation failed:', err)
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
