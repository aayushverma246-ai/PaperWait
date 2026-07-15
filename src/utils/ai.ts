import { createCanvas } from '@napi-rs/canvas'

// Use require for pdfjs legacy build to prevent Node CJS/ESM issues in Next.js compilation
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pathToFileURL } from 'url'
import path from 'path'

if (typeof window === 'undefined') {
  // Convert local worker path to a file:// URL scheme.
  // We use process.cwd() to dynamically resolve the path at runtime rather than require.resolve (which Turbopack compiles to a numeric module ID).
  const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
}

interface ProcessedPdf {
  images: string[] // base64 data URLs
  partiallyScanned: boolean
}

/**
 * Rasterizes a PDF buffer page-by-page into base64 PNG images.
 * Scans up to maxPages.
 */
export async function rasterizePdf(pdfBuffer: Buffer, maxPages = 10): Promise<ProcessedPdf> {
  if (!pdfjs) {
    throw new Error('PDF.js is not loaded on the server')
  }

  const data = new Uint8Array(pdfBuffer)
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    disableWorker: true,
  } as any)
  
  const pdf = await loadingTask.promise
  const numPages = pdf.numPages
  const pagesToScan = Math.min(numPages, maxPages)
  const images: string[] = []

  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i)
    
    // Scale 1.5 is a good balance between OCR readability and image size
    const viewport = page.getViewport({ scale: 1.5 })
    
    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context as any,
      viewport: viewport,
      canvas: canvas as any,
    }).promise

    const buffer = canvas.toBuffer('image/png')
    const base64 = buffer.toString('base64')
    images.push(`data:image/png;base64,${base64}`)
  }

  return {
    images,
    partiallyScanned: numPages > maxPages,
  }
}

/**
 * Sends a base64 image (PNG/JPEG) to NVIDIA Nemotron OCR v2 to extract text.
 */
export async function performOcr(base64Image: string): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY_OCR
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_OCR is not defined in environment')
  }

  // Ensure base64 starts with correct prefix
  let imageUrl = base64Image
  if (!imageUrl.startsWith('data:')) {
    imageUrl = `data:image/png;base64,${imageUrl}`
  }

  const payload = {
    input: [
      {
        type: 'image_url',
        url: imageUrl,
      }
    ],
    merge_levels: ['paragraph']
  }

  const response = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`NVIDIA OCR NIM request failed: ${response.status} - ${errorText}`)
  }

  const resJson = await response.json()
  
  // Extract all text detections in order
  const detections = resJson.data?.[0]?.text_detections || []
  const text = detections
    .map((det: any) => det.text_prediction?.text || '')
    .filter(Boolean)
    .join('\n')

  return text
}

interface ClassificationResult {
  folder_name: string
  is_new_folder: boolean
}

/**
 * Classifies extracted text into a folder using NVIDIA's Llama-3.1-8b-instruct.
 */
export async function classifyDocument(
  ocrText: string,
  existingFolders: string[]
): Promise<ClassificationResult> {
  const apiKey = process.env.NVIDIA_API_KEY_LLM
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_LLM is not defined in environment')
  }

  const truncatedText = ocrText.slice(0, 3000)
  const foldersList = existingFolders.length > 0
    ? existingFolders.map((f) => `"${f}"`).join(', ')
    : 'None (this is the first document, create a generic, sensible category name)'

  const systemPrompt = `You are a document classifier. You analyze extracted document text and decide which folder it belongs to.
You MUST respond ONLY with a raw JSON object matching this schema:
{
  "folder_name": string,
  "is_new_folder": boolean
}

Rules:
1. "folder_name" should be the name of the folder the document belongs in.
2. Review the user's existing folders list carefully: [${foldersList}]. If the document fits one of the existing folders (case-insensitive comparison), reuse it. Set "folder_name" to the exact casing of that existing folder, and set "is_new_folder" to false. For example, if an existing folder is "Bills", then any bill/receipt/invoice should go in "Bills".
3. If the document does not fit any of the existing folders, invent a new, short, sensible folder name (1-3 words, capitalized like 'Utilities', 'Medical', 'Tax', 'Receipts'). Set "folder_name" to this new name, and set "is_new_folder" to true.
4. Respond ONLY with the raw JSON object. Do not include markdown code block formatting (like \`\`\`json) or any other conversational text.`

  const userPrompt = `Document text content:\n${truncatedText}`

  const makeCall = async (): Promise<ClassificationResult> => {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        top_p: 0.7,
        max_tokens: 512,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`NVIDIA LLM NIM request failed: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    const content = resJson.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('LLM returned an empty response')
    }

    // Strip markdown code block formatting if present
    let jsonText = content
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim()
    }

    const parsed = JSON.parse(jsonText)
    if (!parsed.folder_name) {
      throw new Error('Parsed JSON is missing folder_name')
    }

    return {
      folder_name: parsed.folder_name,
      is_new_folder: typeof parsed.is_new_folder === 'boolean' ? parsed.is_new_folder : true,
    }
  }

  try {
    return await makeCall()
  } catch (err) {
    console.error('LLM classification failed, retrying once...', err)
    try {
      return await makeCall()
    } catch (retryErr) {
      console.error('LLM classification failed again, falling back to Uncategorized', retryErr)
      return {
        folder_name: 'Uncategorized',
        is_new_folder: false,
      }
    }
  }
}

/**
 * Generates a 1-sentence friendly description of "what this photo/document is for" using Llama LLM.
 */
export async function generateSummary(ocrText: string): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY_LLM
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_LLM is not defined in environment')
  }

  const truncatedText = ocrText.slice(0, 3000)

  const systemPrompt = `You are a document analyzer. Read the extracted text from a photo/document and explain what the photo/document is for in exactly one clear, friendly sentence.
Be concise, professional, and start directly with the description (e.g. "This is a billing invoice from Comcast detailing broadband services for June 2026." or "This is a photo of a restaurant receipt for a business lunch at Olive Garden.").
Do not include any conversational intro, meta commentary, or formatting.`

  const userPrompt = `Document text content:\n${truncatedText}`

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        top_p: 0.7,
        max_tokens: 256,
        stream: false,
      }),
    })

    if (!response.ok) {
      return 'Extracted document scan content.'
    }

    const resJson = await response.json()
    return resJson.choices?.[0]?.message?.content?.trim() || 'Extracted document scan content.'
  } catch (err) {
    console.error('Error generating summary:', err)
    return 'Extracted document scan content.'
  }
}
