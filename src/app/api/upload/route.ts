import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { processPdfDocument, performOcr, classifyDocument, generateSummaryFromImage, compressImageForOcr, sanitizePostgresString, promiseWithTimeout, generateFilePreviewCard, ensureFonts } from '@/utils/ai'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import * as officeParser from 'officeparser'

export const maxDuration = 60

// Create a Supabase service-role client for use inside after() where cookies are unavailable
function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Concurrency helper to limit parallel OCR requests
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 3
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i]().then((res) => {
      results[i] = res
    })
    results.push(null as any)
    const e: Promise<void> = p.then(() => {
      executing.splice(executing.indexOf(e), 1)
    })
    executing.push(e)

    if (executing.length >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Get current user session
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { documentId, fileName, fileType, storagePath, folderId, replaceDocId, batchHint } = await request.json()

    if (!documentId || !fileName || !fileType || !storagePath) {
      return NextResponse.json({ error: 'Missing document metadata' }, { status: 400 })
    }

    let isReplacing = false
    let oldStoragePath = ''

    if (replaceDocId) {
      const { data: existingDoc, error: fetchError } = await supabase
        .from('documents')
        .select('id, storage_path')
        .eq('id', replaceDocId)
        .eq('user_id', user.id)
        .single()

      if (!fetchError && existingDoc) {
        oldStoragePath = existingDoc.storage_path
        isReplacing = true
      }
    }

    // 1. Delete old storage objects if replacing and path is different
    if (isReplacing && oldStoragePath) {
      if (oldStoragePath !== storagePath) {
        await supabase.storage.from('documents').remove([oldStoragePath])
      }
      const oldPreviewPath = `${user.id}/previews/${replaceDocId}.png`
      await supabase.storage.from('documents').remove([oldPreviewPath])
    }

    // 2. Insert or update processing row in database
    let docData
    let dbError

    if (isReplacing) {
      const { data, error } = await supabase
        .from('documents')
        .update({
          file_name: fileName,
          storage_path: storagePath,
          file_type: fileType,
          status: 'processing',
          ocr_text: null,
          description: null,
          partially_scanned: false,
        })
        .eq('id', replaceDocId)
        .eq('user_id', user.id)
        .select()
        .single()
      docData = data
      dbError = error
    } else {
      const { data, error } = await supabase
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
      docData = data
      dbError = error
    }

    if (dbError) {
      console.error('Database execution error:', dbError)
      return NextResponse.json({ error: `Database entry modification failed: ${dbError.message}` }, { status: 500 })
    }

    // 3. Return immediately — the client sees the document as "processing"
    //    All heavy AI work runs in the background via after() by downloading directly from Supabase Storage
    const manualFolderId = folderId
    const userId = user.id
    const finalDocId = isReplacing ? replaceDocId : documentId

    after(async () => {
      // Use service-role client inside after() since cookie-based auth is unavailable here
      const supa = getServiceSupabase()

      try {
        // Download the uploaded file from Supabase Storage (bypasses 4.5MB client-to-server request body limits)
        const { data: fileData, error: downloadError } = await supa.storage
          .from('documents')
          .download(storagePath)

        if (downloadError || !fileData) {
          throw new Error(`Failed to download file from Supabase Storage: ${downloadError?.message || 'Empty response'}`)
        }

        const buffer = Buffer.from(await fileData.arrayBuffer())

        let ocrText = ''
        let partiallyScanned = false
        let summaryImageBase64 = ''
        let visualSummary = ''
        let pageCount = 1

        // Start folder prefetch in parallel with OCR for maximum speed
        let folders: any[] = []
        const folderPrefetchPromise = (!manualFolderId || manualFolderId === 'auto')
          ? supa
              .from('folders')
              .select('id, name')
              .eq('user_id', userId)
              .then(({ data, error }) => {
                if (error) throw new Error(`Failed to fetch folders: ${error.message}`)
                folders = data || []
              })
          : Promise.resolve()

        if (fileType === 'application/pdf') {
          // PDF processing - Extract digital text or run OCR in a single unified step
          const pdfResult = await processPdfDocument(buffer)
          ocrText = pdfResult.ocrText
          summaryImageBase64 = pdfResult.summaryImageBase64
          partiallyScanned = pdfResult.partiallyScanned
          pageCount = pdfResult.pageCount

          // Wait for folder prefetch to finish before calling classification
          await folderPrefetchPromise
        } else if (fileType.startsWith('image/')) {
          // Only compress image for OCR if the size is > 1.5MB to avoid NVIDIA 413 Payload Too Large and save CPU
          let ocrBuffer: any = buffer
          if (buffer.length > 1500000) {
            try {
              ocrBuffer = await compressImageForOcr(buffer)
              console.log(`Compressed uploaded image for OCR: ${buffer.length} bytes -> ${ocrBuffer.length} bytes`)
            } catch (compressErr) {
              console.error('Failed to compress image for OCR, using original:', compressErr)
            }
          } else {
            console.log(`Skipping image compression for small image: ${buffer.length} bytes`)
          }

          const base64Image = ocrBuffer.toString('base64')
          const imageUri = `data:image/jpeg;base64,${base64Image}`
          summaryImageBase64 = imageUri

          // Run OCR, Vision, and folder prefetch ALL in parallel for maximum speed
          const [ocrRes, visionRes] = await Promise.all([
            performOcr(imageUri).catch((ocrErr) => {
              console.error('OCR failed for image:', ocrErr)
              return '[OCR failed for this image]'
            }),
            generateSummaryFromImage(imageUri).catch((err) => {
              console.error('Failed generating image summary using vision model:', err)
              return ''
            }),
            folderPrefetchPromise
          ])

          ocrText = ocrRes
          visualSummary = visionRes
        } else if (
          fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          fileType === 'application/msword' ||
          fileType === 'text/csv' ||
          fileType === 'text/plain' ||
          fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
          fileType === 'application/vnd.ms-powerpoint'
        ) {
          // Text-based document formats — extract text directly, no OCR needed
          try {
            if (
              fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
              fileType === 'application/msword'
            ) {
              // Word documents (.docx / .doc)
              const result = await mammoth.extractRawText({ buffer })
              ocrText = result.value || ''
              const words = ocrText.trim().split(/\s+/).filter(Boolean).length
              pageCount = Math.max(1, Math.ceil(words / 400))
            } else if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
              // Excel spreadsheets (.xlsx)
              const workbook = XLSX.read(buffer, { type: 'buffer' })
              const sheetTexts: string[] = []
              for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName]
                const csv = XLSX.utils.sheet_to_csv(sheet)
                sheetTexts.push(`--- Sheet: ${sheetName} ---\n${csv}`)
              }
              ocrText = sheetTexts.join('\n\n')
              pageCount = workbook.SheetNames.length
            } else if (
              fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
              fileType === 'application/vnd.ms-powerpoint'
            ) {
              // PowerPoint slides (.pptx / .ppt)
              const fileExt = fileName.split('.').pop() || 'pptx'
              // Fall back to pptx if ppt is unsupported or fails
              const parserExt = fileExt.toLowerCase() === 'ppt' ? 'ppt' : 'pptx'
              try {
                const result = await officeParser.convert(buffer, 'text', { parseConfig: { fileType: parserExt as any } })
                ocrText = (result.value as string) || ''
              } catch (pptErr) {
                // Try pptx parser as fallback
                const result = await officeParser.convert(buffer, 'text', { parseConfig: { fileType: 'pptx' } })
                ocrText = (result.value as string) || ''
              }

              // Count slides by matching slide xml files inside the PPTX zip structure
              try {
                const binaryStr = buffer.toString('binary')
                const matches = binaryStr.match(/ppt\/slides\/slide\d+\.xml/g)
                if (matches) {
                  pageCount = new Set(matches).size
                } else {
                  pageCount = 1
                }
              } catch (err) {
                pageCount = 1
              }
            } else {
              // CSV (.csv) and Plain Text (.txt) — read as UTF-8 directly
              ocrText = buffer.toString('utf-8')
              if (fileType === 'text/csv') {
                const rows = ocrText.split('\n').filter(line => line.trim().length > 0).length
                pageCount = Math.max(1, rows)
              } else {
                const words = ocrText.trim().split(/\s+/).filter(Boolean).length
                pageCount = Math.max(1, Math.ceil(words / 400))
              }
            }
          } catch (extractErr: any) {
            console.error('Text extraction failed for', fileType, extractErr)
            ocrText = `[Text extraction failed: ${extractErr.message}]`
          }

          // Wait for folder prefetch to finish
          await folderPrefetchPromise
        } else {
          throw new Error(`Unsupported file type: ${fileType}`)
        }

        const folderNames = folders.map((f) => f.name) || []

        // For images: enrich OCR text with visual summary so classification LLMs get both textual AND visual context
        let classificationText = ocrText
        if (fileType.startsWith('image/') && visualSummary) {
          classificationText = `[Visual Description]: ${visualSummary}\n\n${ocrText}`
        }

        // Always run classification to extract structured metadata (categories, summary, entities)
        // Uses 3-model ensemble (Llama 8B + DeepSeek V4 Flash + Nemotron Nano Omni) with weighted voting
        const classification = await classifyDocument(classificationText, folderNames, fileName, batchHint)

        // Ensure the visual summary is set as the short summary for images, and categorize personal photos to "Photos"
        if (visualSummary) {
          classification.short_summary = visualSummary
          const cleanOcr = ocrText.replace('[OCR failed for this image]', '').trim()
          const isMiscOrPersonal = classification.final_category === 'Miscellaneous' || classification.final_category === 'Personal'
          const isGenericFolder = !classification.suggested_folder || 
            ['uncategorized', 'miscellaneous', 'personal'].includes(classification.suggested_folder.toLowerCase())
          if (cleanOcr.length < 150 && isMiscOrPersonal && isGenericFolder) {
            classification.final_category = 'Photos'
            classification.suggested_folder = 'Photos'
          }
        }

        let targetFolderId: string | null = null

        // Determine target folder
        if (manualFolderId && manualFolderId !== 'auto') {
          targetFolderId = manualFolderId === 'uncategorized' ? null : manualFolderId
        } else if (classification && classification.suggested_folder) {
          const folderName = classification.suggested_folder

          if (folderName.toLowerCase() !== 'uncategorized') {
            // 1. Try to match existing folder case-insensitively
            let matchedFolder = folders.find(
              (f) => f.name.toLowerCase() === folderName.toLowerCase()
            )

            // 2. Try substring/superstring matching (e.g. "saathi" matches "saathi assist", or vice versa)
            if (!matchedFolder) {
              const cleanSuggested = folderName.trim().toLowerCase()
              const matches = folders.filter((f) => {
                const cleanExisting = f.name.trim().toLowerCase()
                // Avoid matching very generic/short folder names under 3 chars
                if (cleanExisting.length < 3 || cleanSuggested.length < 3) return false
                return cleanExisting.includes(cleanSuggested) || cleanSuggested.includes(cleanExisting)
              })
              if (matches.length > 0) {
                // Pick the match closest in length to minimize mismatches
                matches.sort((a, b) => Math.abs(a.name.length - folderName.length) - Math.abs(b.name.length - folderName.length))
                matchedFolder = matches[0]
              }
            }

            // 3. Try Levenshtein/typo matching to merge OCR typos (e.g., "Sasthi" vs "Saathi")
            if (!matchedFolder) {
              const getLevenshteinDistance = (a: string, b: string): number => {
                const tmp: number[][] = []
                for (let i = 0; i <= a.length; i++) {
                  tmp[i] = [i]
                }
                for (let j = 0; j <= b.length; j++) {
                  tmp[0][j] = j
                }
                for (let i = 1; i <= a.length; i++) {
                  for (let j = 1; j <= b.length; j++) {
                    tmp[i][j] = Math.min(
                      tmp[i - 1][j] + 1,
                      tmp[i][j - 1] + 1,
                      tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                    )
                  }
                }
                return tmp[a.length][b.length]
              }

              const cleanSuggested = folderName.trim().toLowerCase()
              const matches = folders.filter((f) => {
                const cleanExisting = f.name.trim().toLowerCase()
                if (cleanExisting.length < 4 || cleanSuggested.length < 4) return false
                const distance = getLevenshteinDistance(cleanSuggested, cleanExisting)
                // Allow up to 2 character difference depending on length
                const maxAllowed = Math.min(2, Math.floor(cleanExisting.length / 3))
                return distance <= maxAllowed
              })

              if (matches.length > 0) {
                matches.sort((a, b) => getLevenshteinDistance(cleanSuggested, a.name.toLowerCase()) - getLevenshteinDistance(cleanSuggested, b.name.toLowerCase()))
                matchedFolder = matches[0]
              }
            }

            if (matchedFolder) {
              targetFolderId = matchedFolder.id
              // Align classification metadata with the matched existing folder name
              classification.suggested_folder = matchedFolder.name
            } else {
              // Create new folder
              const { data: newFolder, error: createFolderError } = await supa
                .from('folders')
                .insert({
                  user_id: userId,
                  name: folderName,
                })
                .select()
                .single()

              if (createFolderError) {
                // Race condition: another parallel upload may have just created this folder
                // Re-fetch and try to find it
                const { data: retryFolders } = await supa
                  .from('folders')
                  .select('id, name')
                  .eq('user_id', userId)

                const retryMatch = retryFolders?.find(
                  (f) => f.name.toLowerCase() === folderName.toLowerCase()
                )
                if (retryMatch) {
                  targetFolderId = retryMatch.id
                } else {
                  console.error('Failed to create classified folder, falling back to safety net:', createFolderError)
                }
              } else {
                targetFolderId = newFolder.id
              }
            }
          }
        }

        // Generate and upload preview concurrently/afterwards in the background
        if (fileType === 'application/pdf' && summaryImageBase64) {
          try {
            const base64Data = summaryImageBase64.replace(/^data:image\/\w+;base64,/, '')
            const previewBuffer = Buffer.from(base64Data, 'base64')
            await supa.storage
              .from('documents')
              .upload(`${userId}/previews/${finalDocId}.png`, previewBuffer, {
                contentType: 'image/jpeg',
                upsert: true,
              })
            console.log(`Uploaded PDF preview for document ${finalDocId}`)
          } catch (previewErr) {
            console.error('Failed to upload PDF preview thumbnail:', previewErr)
          }
        } else if (fileType.startsWith('image/')) {
          try {
            const img = await loadImage(buffer)
            const maxDim = 120
            let width = img.width
            let height = img.height
            if (width > height) {
              if (width > maxDim) {
                height = Math.round((height * maxDim) / width)
                width = maxDim
              }
            } else {
              if (height > maxDim) {
                width = Math.round((width * maxDim) / height)
                height = maxDim
              }
            }

            const canvas = createCanvas(width, height)
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, width, height)
            const previewBuffer = canvas.toBuffer('image/png')

            await supa.storage
              .from('documents')
              .upload(`${userId}/previews/${finalDocId}.png`, previewBuffer, {
                contentType: 'image/png',
                upsert: true,
              })
            console.log(`Generated thumbnail preview for image ${finalDocId}`)
          } catch (imgPreviewErr) {
            console.error('Failed to generate image preview thumbnail:', imgPreviewErr)
          }
        } else {
          // Generate beautiful preview card for Word, Excel, PPT, CSV, TXT
          try {
            await ensureFonts()
            const previewBuffer = generateFilePreviewCard(fileName, fileType, ocrText)
            await supa.storage
              .from('documents')
              .upload(`${userId}/previews/${finalDocId}.png`, previewBuffer, {
                contentType: 'image/png',
                upsert: true,
              })
            console.log(`Generated text/office preview card for document ${finalDocId}`)
          } catch (textPreviewErr) {
            console.error('Failed to generate text file preview card:', textPreviewErr)
          }
        }

        // Serialize structured classification results as JSON in the description column
        const finalDescription = JSON.stringify({
          ...classification,
          page_count: pageCount
        })

        // Update document (no .select().single() to prevent huge serialization overhead of ocr_text)
        const { error: updateError } = await supa
          .from('documents')
          .update({
            status: 'done',
            ocr_text: sanitizePostgresString(ocrText),
            description: sanitizePostgresString(finalDescription),
            folder_id: targetFolderId,
            partially_scanned: partiallyScanned,
          })
          .eq('id', finalDocId)

        if (updateError) {
          throw new Error(`Failed to update document: ${updateError.message}`)
        }

        console.log(`Document ${finalDocId} status set to done in database.`)
        console.log(`Document ${finalDocId} classification complete and saved.`)

      } catch (processError: any) {
        console.error('Document background processing failed:', processError)

        // Update document to failed
        await supa
          .from('documents')
          .update({
            status: 'failed',
            ocr_text: `Processing failed: ${processError.message || processError}`,
          })
          .eq('id', finalDocId)
      }
    })

    // Return immediately with the processing document
    return NextResponse.json(docData)

  } catch (err: any) {
    console.error('Upload route error:', err)
    return NextResponse.json({ error: err.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
