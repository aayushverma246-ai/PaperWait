/**
 * Document Text Chunker
 * 
 * Splits document text into overlapping chunks suitable for embedding.
 * Preserves page boundaries and metadata from the existing OCR format.
 */

export interface TextChunk {
  text: string
  chunkIndex: number
  pageNumber: number | null
  sourceMetadata: {
    fileName: string
    documentId: string
    section?: string
  }
}

/**
 * Target chunk size in characters (~500-800 tokens).
 * Using 2000 chars as approximate 500-token target (conservative 4 chars/token ratio).
 */
const TARGET_CHUNK_SIZE = 2000
const CHUNK_OVERLAP = 300
const MIN_CHUNK_SIZE = 100

/**
 * Split document text into chunks with metadata.
 * Handles the existing PaperWait OCR text format including:
 *   - PDF: "--- Page N ---" markers
 *   - Excel: "--- Sheet: Name ---" markers
 *   - Plain text without markers
 */
export function chunkDocument(
  text: string,
  documentId: string,
  fileName: string
): TextChunk[] {
  if (!text || text.trim().length < MIN_CHUNK_SIZE) {
    return []
  }

  // Skip error messages stored as OCR text
  if (
    text.startsWith('[OCR failed') ||
    text.startsWith('[Text extraction failed') ||
    text.startsWith('Processing failed')
  ) {
    return []
  }

  const chunks: TextChunk[] = []

  // Detect page/sheet structure
  const pagePattern = /--- Page (\d+) ---/g
  const sheetPattern = /--- Sheet: (.+?) ---/g

  const hasPageMarkers = pagePattern.test(text)
  pagePattern.lastIndex = 0
  const hasSheetMarkers = sheetPattern.test(text)
  sheetPattern.lastIndex = 0

  if (hasPageMarkers) {
    // Split by page markers and chunk within each page
    const pages = splitByPattern(text, /--- Page (\d+) ---/)
    for (const page of pages) {
      const pageChunks = splitTextIntoChunks(page.content, TARGET_CHUNK_SIZE, CHUNK_OVERLAP)
      for (const chunkText of pageChunks) {
        if (chunkText.trim().length >= MIN_CHUNK_SIZE) {
          chunks.push({
            text: chunkText.trim(),
            chunkIndex: chunks.length,
            pageNumber: page.marker ? parseInt(page.marker, 10) : null,
            sourceMetadata: {
              fileName,
              documentId,
            },
          })
        }
      }
    }
  } else if (hasSheetMarkers) {
    // Split by sheet markers
    const sheets = splitByPattern(text, /--- Sheet: (.+?) ---/)
    for (const sheet of sheets) {
      const sheetChunks = splitTextIntoChunks(sheet.content, TARGET_CHUNK_SIZE, CHUNK_OVERLAP)
      for (const chunkText of sheetChunks) {
        if (chunkText.trim().length >= MIN_CHUNK_SIZE) {
          chunks.push({
            text: chunkText.trim(),
            chunkIndex: chunks.length,
            pageNumber: null,
            sourceMetadata: {
              fileName,
              documentId,
              section: sheet.marker || undefined,
            },
          })
        }
      }
    }
  } else {
    // No structural markers — chunk the entire text
    const textChunks = splitTextIntoChunks(text, TARGET_CHUNK_SIZE, CHUNK_OVERLAP)
    for (const chunkText of textChunks) {
      if (chunkText.trim().length >= MIN_CHUNK_SIZE) {
        chunks.push({
          text: chunkText.trim(),
          chunkIndex: chunks.length,
          pageNumber: null,
          sourceMetadata: {
            fileName,
            documentId,
          },
        })
      }
    }
  }

  return chunks
}

interface SplitSection {
  marker: string | null
  content: string
}

/**
 * Split text by a regex pattern that captures a marker group.
 */
function splitByPattern(text: string, pattern: RegExp): SplitSection[] {
  const sections: SplitSection[] = []
  const parts = text.split(pattern)

  // First element may be content before the first marker
  if (parts[0] && parts[0].trim()) {
    sections.push({ marker: null, content: parts[0] })
  }

  // Alternate between marker and content
  for (let i = 1; i < parts.length; i += 2) {
    const marker = parts[i] || null
    const content = parts[i + 1] || ''
    if (content.trim()) {
      sections.push({ marker, content })
    }
  }

  return sections
}

/**
 * Split a text into overlapping chunks trying to break at sentence/paragraph boundaries.
 */
function splitTextIntoChunks(
  text: string,
  targetSize: number,
  overlap: number
): string[] {
  if (text.length <= targetSize) {
    return [text]
  }

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + targetSize, text.length)

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      // Look for a paragraph break in the last 30% of the chunk
      const searchStart = start + Math.floor(targetSize * 0.7)
      const searchRegion = text.substring(searchStart, end)

      const paragraphBreak = searchRegion.lastIndexOf('\n\n')
      if (paragraphBreak !== -1) {
        end = searchStart + paragraphBreak + 2
      } else {
        // Try sentence boundary (. ! ?)
        const sentenceBreak = searchRegion.search(/[.!?]\s+(?=[A-Z])/g)
        if (sentenceBreak !== -1) {
          end = searchStart + sentenceBreak + 2
        } else {
          // Try any newline
          const lineBreak = searchRegion.lastIndexOf('\n')
          if (lineBreak !== -1) {
            end = searchStart + lineBreak + 1
          }
        }
      }
    }

    chunks.push(text.substring(start, end))

    // Move start with overlap
    start = end - overlap
    if (start >= text.length) break
    // Avoid tiny final chunks
    if (text.length - start < MIN_CHUNK_SIZE) {
      // Extend the last chunk instead
      if (chunks.length > 0) {
        chunks[chunks.length - 1] = text.substring(
          end - targetSize - overlap,
          text.length
        )
      }
      break
    }
  }

  return chunks
}

/**
 * Generate a content fingerprint for change detection.
 * Uses a simple hash of the text content.
 */
export function generateFingerprint(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  // Include text length for additional uniqueness
  return `v1_${Math.abs(hash).toString(36)}_${text.length}`
}
