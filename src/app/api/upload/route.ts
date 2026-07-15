import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { rasterizePdf, performOcr, classifyDocument, generateSummary, generateSummaryFromImage } from '@/utils/ai'

export const maxDuration = 60 // Allow up to 60s execution on Vercel Pro/Enterprise if needed, though usually much faster

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const documentId = crypto.randomUUID()
    const fileName = file.name
    const fileType = file.type
    const storagePath = `${user.id}/${documentId}/${fileName}`

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 1. Upload file to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: fileType,
        upsert: true,
      })

    if (storageError) {
      console.error('Storage upload error:', storageError)
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
    }

    // 2. Insert initial processing row in database
    const { data: docData, error: insertError } = await supabase
      .from('documents')
      .insert({
        id: documentId,
        user_id: user.id,
        file_name: fileName,
        storage_path: storagePath,
        file_type: fileType,
        status: 'processing',
        folder_id: null,
        partially_scanned: false,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Database insert error:', insertError)
      return NextResponse.json({ error: `Database entry creation failed: ${insertError.message}` }, { status: 500 })
    }

    // Run processing
    let ocrText = ''
    let partiallyScanned = false
    let summaryImageBase64 = ''

    try {
      if (fileType === 'application/pdf') {
        // PDF processing - scan all pages (999999 limit)
        const rasterized = await rasterizePdf(buffer, 999999)
        partiallyScanned = rasterized.partiallyScanned
        
        const pageTexts: string[] = []
        for (let i = 0; i < rasterized.images.length; i++) {
          try {
            const text = await performOcr(rasterized.images[i])
            pageTexts.push(`--- Page ${i + 1} ---\n${text}`)
          } catch (ocrErr) {
            console.error(`OCR failed on page ${i + 1}:`, ocrErr)
            pageTexts.push(`--- Page ${i + 1} ---\n[OCR failed for this page]`)
          }
        }
        ocrText = pageTexts.join('\n\n')
        if (rasterized.images.length > 0) {
          summaryImageBase64 = rasterized.images[0]
        }
      } else if (fileType.startsWith('image/')) {
        // Image processing
        const base64Image = buffer.toString('base64')
        ocrText = await performOcr(`data:${fileType};base64,${base64Image}`)
        summaryImageBase64 = `data:${fileType};base64,${base64Image}`
      } else {
        throw new Error(`Unsupported file type: ${fileType}`)
      }

      // 3. Classify document into a folder
      // Fetch user's existing folders
      const { data: folders, error: foldersError } = await supabase
        .from('folders')
        .select('id, name')
        .eq('user_id', user.id)

      if (foldersError) {
        throw new Error(`Failed to fetch folders: ${foldersError.message}`)
      }

      const folderNames = folders?.map((f) => f.name) || []
      const classification = await classifyDocument(ocrText, folderNames)

      let targetFolderId: string | null = null

      if (classification.folder_name && classification.folder_name.toLowerCase() !== 'uncategorized') {
        // Try to match existing folder case-insensitively
        const matchedFolder = folders?.find(
          (f) => f.name.toLowerCase() === classification.folder_name.toLowerCase()
        )

        if (matchedFolder) {
          targetFolderId = matchedFolder.id
        } else {
          // Create new folder
          const { data: newFolder, error: createFolderError } = await supabase
            .from('folders')
            .insert({
              user_id: user.id,
              name: classification.folder_name,
            })
            .select()
            .single()

          if (createFolderError) {
            console.error('Failed to create classified folder, falling back to Uncategorized:', createFolderError)
          } else {
            targetFolderId = newFolder.id
          }
        }
      }

      // 3.5 Generate summary/description of what the document is for
      let description = 'Processed document scan.'
      if (summaryImageBase64) {
        description = await generateSummaryFromImage(summaryImageBase64)
      } else {
        description = await generateSummary(ocrText)
      }

      // 4. Update document status to done
      const { data: updatedDoc, error: updateError } = await supabase
        .from('documents')
        .update({
          status: 'done',
          ocr_text: ocrText,
          description: description,
          folder_id: targetFolderId,
          partially_scanned: partiallyScanned,
        })
        .eq('id', documentId)
        .select()
        .single()

      if (updateError) {
        throw new Error(`Failed to update document: ${updateError.message}`)
      }

      return NextResponse.json(updatedDoc)

    } catch (processError: any) {
      console.error('Document processing failed:', processError)
      
      // Update document to failed
      await supabase
        .from('documents')
        .update({
          status: 'failed',
          ocr_text: `Processing failed: ${processError.message || processError}`,
        })
        .eq('id', documentId)

      return NextResponse.json({
        error: `Document processing failed: ${processError.message}`,
        documentId
      }, { status: 500 })
    }

  } catch (err: any) {
    console.error('Upload route error:', err)
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
