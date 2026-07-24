import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'

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
export async function rasterizePdf(pdfBuffer: Buffer, maxPages = 99999): Promise<ProcessedPdf> {
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

  // Sequentially render pages to prevent container memory crashes and CPU thrashing
  for (let index = 0; index < pagesToScan; index++) {
    const pageNum = index + 1
    const page = await pdf.getPage(pageNum)

    // Scale 1.5 is a good balance between OCR readability and image size
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context as any,
      viewport: viewport,
      canvas: canvas as any,
    }).promise

    const buffer = canvas.toBuffer('image/jpeg', 80)
    const base64 = buffer.toString('base64')
    images.push(`data:image/jpeg;base64,${base64}`)
  }

  return {
    images,
    partiallyScanned: numPages > maxPages,
  }
}

interface ProcessedPdfData {
  ocrText: string
  summaryImageBase64: string
  partiallyScanned: boolean
  pageCount: number
}

async function localRunWithConcurrencyLimit(
  tasks: (() => Promise<void>)[],
  limit = 3
): Promise<void> {
  const taskQueue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, taskQueue.length) }, async () => {
    while (taskQueue.length > 0) {
      const task = taskQueue.shift()
      if (task) {
        await task()
      }
    }
  })
  await Promise.all(workers)
}

/**
 * Wraps a promise with a timeout. If the promise does not resolve within the specified
 * limit (in milliseconds), it rejects with a timeout error.
 */
export function promiseWithTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timeoutId: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Model call timed out for ${name} after ${ms}ms`))
    }, ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

/**
 * Extracts digital text directly from PDF page text content in milliseconds.
 * Falls back to sequentially rasterizing and running OCR only for scanned/image pages.
 */
export async function processPdfDocument(pdfBuffer: Buffer, maxPages = 99999): Promise<ProcessedPdfData> {
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

  let firstPageImage = ''
  const pageTexts: string[] = Array(pagesToScan).fill('')

  // Prefetch pages and extract text in parallel
  const pagePromises = Array.from({ length: pagesToScan }, async (_, index) => {
    const pageNum = index + 1
    try {
      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()
      const extractedText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim()
      return { index, page, extractedText }
    } catch (err) {
      console.error(`Error loading page ${pageNum}:`, err)
      return { index, page: null, extractedText: '' }
    }
  })

  const pagesData = await Promise.all(pagePromises)

  // Render first page for thumbnail preview
  let firstPageBase64 = ''
  const firstPage = pagesData[0]
  if (firstPage && firstPage.page) {
    try {
      const page = firstPage.page
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = createCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      await page.render({
        canvasContext: context as any,
        viewport: viewport,
        canvas: canvas as any,
      }).promise
      const imgBuffer = canvas.toBuffer('image/jpeg', 80)
      firstPageBase64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`
      firstPageImage = firstPageBase64
    } catch (err) {
      console.error('Failed to render first page thumbnail:', err)
    }
  }

  const ocrTasks: { index: number; renderAndOcr: () => Promise<string> }[] = []

  for (const { index, page, extractedText } of pagesData) {
    if (!page) continue
    const pageNum = index + 1

    if (extractedText.length > 30) {
      // Use extracted digital text directly (instant & 100% accurate)
      pageTexts[index] = `--- Page ${pageNum} ---\n${extractedText}`
    } else {
      // Scanned/image page - mark for OCR fallback
      ocrTasks.push({
        index,
        renderAndOcr: async () => {
          try {
            let pageBase64 = (index === 0) ? firstPageBase64 : ''
            if (!pageBase64) {
              const viewport = page.getViewport({ scale: 1.5 })
              const canvas = createCanvas(viewport.width, viewport.height)
              const context = canvas.getContext('2d')
              await page.render({
                canvasContext: context as any,
                viewport: viewport,
                canvas: canvas as any,
              }).promise
              const imgBuffer = canvas.toBuffer('image/jpeg', 80)
              pageBase64 = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`
            }
            const text = await performOcr(pageBase64)
            return `--- Page ${pageNum} ---\n${text}`
          } catch (err) {
            console.error(`OCR failed for page ${pageNum}:`, err)
            return `--- Page ${pageNum} ---\n[OCR failed for this page]`
          }
        }
      })
    }
  }

  // Run OCR tasks with rate-limit-safe concurrency limit of 5
  if (ocrTasks.length > 0) {
    const ocrPromises = ocrTasks.map((task) => async () => {
      const text = await task.renderAndOcr()
      pageTexts[task.index] = text
    })
    await localRunWithConcurrencyLimit(ocrPromises, 5)
  }

  const ocrText = pageTexts.filter(Boolean).join('\n\n')

  return {
    ocrText,
    summaryImageBase64: firstPageImage,
    partiallyScanned: numPages > maxPages,
    pageCount: numPages,
  }
}

/**
 * Resizes and compresses an uploaded image to prevent NVIDIA's 413 Payload Too Large error.
 * Scales the image to fit within a maximum dimension of 1800px and returns a JPEG buffer.
 */
export async function compressImageForOcr(buffer: Buffer): Promise<Buffer> {
  const img = await loadImage(buffer)
  const maxDim = 1800
  let width = img.width
  let height = img.height

  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width)
      width = maxDim
    } else {
      width = Math.round((width * maxDim) / height)
      height = maxDim
    }
  }

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toBuffer('image/jpeg', 85)
}

/**
 * Helper to draw a rounded rectangle path on canvas context.
 */
function drawRoundRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

let interRegistered = false;
let robotoRegistered = false;
let fontsRegistered = false;

export function ensureFontsSync() {
  if (fontsRegistered) return;
  try {
    const rootDir = process.cwd();
    
    // Check multiple potential paths (public/fonts is copied by Next.js/Vercel)
    const possibleInterPaths = [
      path.join(rootDir, 'public/fonts/Inter-Regular.ttf'),
      path.join(rootDir, 'src/fonts/Inter-Regular.ttf'),
      path.join(rootDir, '.next/server/public/fonts/Inter-Regular.ttf')
    ];
    
    const possibleRobotoPaths = [
      path.join(rootDir, 'public/fonts/RobotoMono-Regular.ttf'),
      path.join(rootDir, 'src/fonts/RobotoMono-Regular.ttf'),
      path.join(rootDir, '.next/server/public/fonts/RobotoMono-Regular.ttf')
    ];

    for (const interPath of possibleInterPaths) {
      if (fs.existsSync(interPath)) {
        GlobalFonts.registerFromPath(interPath, 'Inter');
        console.log('Registered Inter font successfully from path:', interPath);
        interRegistered = true;
        break;
      }
    }

    for (const robotoPath of possibleRobotoPaths) {
      if (fs.existsSync(robotoPath)) {
        GlobalFonts.registerFromPath(robotoPath, 'Roboto Mono');
        console.log('Registered Roboto Mono font successfully from path:', robotoPath);
        robotoRegistered = true;
        break;
      }
    }

    // Also try to load system fonts
    try {
      (GlobalFonts as any).loadSystemFonts();
    } catch (_) {}
  } catch (err) {
    console.error('Failed to register custom fonts synchronously:', err);
  }
  fontsRegistered = true;
}

export async function ensureFonts() {
  ensureFontsSync();

  // Asynchronous CDN Fallback (crucial for Vercel Serverless environment where local files may be omitted)
  if (!interRegistered) {
    try {
      console.log('Inter font not registered locally. Attempting CDN download...');
      const res = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf');
      if (res.ok) {
        const buf = await res.arrayBuffer();
        GlobalFonts.register(Buffer.from(buf), 'Inter');
        console.log('Registered Inter font successfully from CDN.');
        interRegistered = true;
      } else {
        console.error('Failed to fetch Inter font from CDN:', res.status, res.statusText);
      }
    } catch (cdnErr) {
      console.error('Error fetching Inter font from CDN:', cdnErr);
    }
  }

  if (!robotoRegistered) {
    try {
      console.log('Roboto Mono font not registered locally. Attempting CDN download...');
      const res = await fetch('https://raw.githubusercontent.com/googlefonts/RobotoMono/main/fonts/ttf/RobotoMono-Regular.ttf');
      if (res.ok) {
        const buf = await res.arrayBuffer();
        GlobalFonts.register(Buffer.from(buf), 'Roboto Mono');
        console.log('Registered Roboto Mono font successfully from CDN.');
        robotoRegistered = true;
      } else {
        console.error('Failed to fetch Roboto Mono font from CDN:', res.status, res.statusText);
      }
    } catch (cdnErr) {
      console.error('Error fetching Roboto Mono font from CDN:', cdnErr);
    }
  }
}

/**
 * Generates a premium visual representation image of a text/office document file.
 */
export function generateFilePreviewCard(fileName: string, fileType: string, extractedText: string): Buffer {
  ensureFontsSync();
  // Create canvas at 2x resolution (1600x1200) for Retina / crisp mobile display
  const canvas = createCanvas(1600, 1200);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // Keep standard 800x600 coordinates in the drawing code

  const fileExt = (fileName.split('.').pop() || 'doc').toLowerCase();

  // Determine format category
  const isExcel = ['xlsx', 'xls', 'csv'].includes(fileExt);
  const isPPT = ['pptx', 'ppt'].includes(fileExt);

  if (isExcel) {
    // ----------------------------------------------------
    // EXCEL SPREADSHEET MOCKUP LAYOUT
    // ----------------------------------------------------
    // Workspace background (light slate grey)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, 800, 600);

    // Sheet container (white page)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(40, 40, 720, 520);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, 40, 720, 520);

    // Green Excel title bar
    ctx.fillStyle = '#15803d'; // Excel dark green
    ctx.fillRect(40, 40, 720, 50);

    // File name inside green bar
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "Inter"';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fileName.substring(0, 60) + (fileName.length > 60 ? '...' : ''), 60, 65);

    // "Spreadsheet" Type Indicator on the right
    ctx.fillStyle = '#bbf7d0';
    ctx.font = 'bold 11px "Inter"';
    ctx.textAlign = 'right';
    ctx.fillText('SPREADSHEET / ' + fileExt.toUpperCase(), 740, 65);

    // Draw grid headers (A, B, C, D, E, F)
    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    const colWidths = [50, 110, 110, 110, 110, 110, 120]; // 50 for row nums, then cols
    const rowHeight = 32;
    let currentY = 90;

    // Header row background (light grey)
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(40, currentY, 720, rowHeight);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(40, currentY, 720, rowHeight);

    // Draw Column Headers
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 12px "Roboto Mono"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let currentX = 40 + colWidths[0];
    for (let i = 0; i < cols.length; i++) {
      ctx.fillText(cols[i], currentX + colWidths[i+1]/2, currentY + rowHeight/2);
      ctx.beginPath();
      ctx.moveTo(currentX, currentY);
      ctx.lineTo(currentX, currentY + 470);
      ctx.strokeStyle = '#e2e8f0';
      ctx.stroke();
      currentX += colWidths[i+1];
    }

    // Process extracted text into grid cells
    // Split by commas/tabs or spaces
    const words = (extractedText || '')
      .replace(/[\r\n\t,]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.trim().length > 0)
      .slice(0, 78);

    let wordIdx = 0;
    
    // Draw cells
    ctx.font = '11px "Inter"';
    ctx.textBaseline = 'middle';

    for (let row = 1; row <= 13; row++) {
      const y = 90 + row * rowHeight;
      
      // Draw Row Header Background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(40, y, colWidths[0], rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(40, y, colWidths[0], rowHeight);

      // Row Number
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 12px "Roboto Mono"';
      ctx.textAlign = 'center';
      ctx.fillText(row.toString(), 65, y + rowHeight/2);

      // Draw cell grid lines and contents
      ctx.font = '11px "Inter"';
      ctx.textAlign = 'left';
      let cellX = 40 + colWidths[0];
      for (let col = 1; col <= cols.length; col++) {
        // Draw cell border
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(cellX, y, colWidths[col], rowHeight);

        // Fill cell text
        const cellText = words[wordIdx++] || '';
        if (cellText) {
          ctx.fillStyle = '#334155';
          // Truncate cell text if too long
          let drawText = cellText;
          if (ctx.measureText(drawText).width > colWidths[col] - 12) {
            while (ctx.measureText(drawText + '...').width > colWidths[col] - 12 && drawText.length > 2) {
              drawText = drawText.substring(0, drawText.length - 1);
            }
            drawText += '...';
          }
          ctx.fillText(drawText, cellX + 6, y + rowHeight/2);
        }
        cellX += colWidths[col];
      }
    }

    // Border line at bottom row
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(40, 90 + 14 * rowHeight);
    ctx.lineTo(760, 90 + 14 * rowHeight);
    ctx.stroke();

  } else if (isPPT) {
    // ----------------------------------------------------
    // PRESENTATION SLIDE MOCKUP LAYOUT (16:9 ratio)
    // ----------------------------------------------------
    // Dark presentation desk background
    ctx.fillStyle = '#0f172a'; // Dark slate 900
    ctx.fillRect(0, 0, 800, 600);

    // Slide Page Sheet (Landscape slide)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(60, 80, 680, 440);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 80, 680, 440);

    // Left orange indicator bar (slide design element)
    ctx.fillStyle = '#ea580c'; // PPTX Orange
    ctx.fillRect(60, 80, 16, 440);

    // Slide Header
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px "Inter"';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('PRESENTATION SLIDE / PAGE 1', 96, 110);

    ctx.textAlign = 'right';
    ctx.fillText(fileExt.toUpperCase(), 714, 110);

    // Slide Content Title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Inter"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Wrap Slide Title
    let wrappedTitle = [];
    const words = fileName.split(' ');
    let currentLine = '';
    for (let word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(test).width > 520 && currentLine) {
        wrappedTitle.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) wrappedTitle.push(currentLine);
    if (wrappedTitle.length > 2) {
      wrappedTitle = wrappedTitle.slice(0, 2);
      wrappedTitle[1] += '...';
    }

    let titleY = 220 - (wrappedTitle.length - 1) * 18;
    for (let line of wrappedTitle) {
      ctx.fillText(line, 400, titleY);
      titleY += 36;
    }

    // Divider line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(180, titleY + 10);
    ctx.lineTo(620, titleY + 10);
    ctx.stroke();

    // Body Bullet Points
    const bulletLines = (extractedText || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 15 && !l.startsWith('---'))
      .slice(0, 3);

    ctx.font = '15px "Inter"';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'left';
    
    let bulletY = titleY + 40;
    if (bulletLines.length === 0) {
      ctx.textAlign = 'center';
      ctx.fillText('[ No slide body content extracted ]', 400, bulletY);
    } else {
      for (let line of bulletLines) {
        // Draw Bullet point
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.arc(160, bulletY + 8, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw Bullet text
        ctx.fillStyle = '#334155';
        let drawText = line;
        if (ctx.measureText(drawText).width > 480) {
          while (ctx.measureText(drawText + '...').width > 480 && drawText.length > 5) {
            drawText = drawText.substring(0, drawText.length - 2);
          }
          drawText += '...';
        }
        ctx.fillText(drawText, 180, bulletY);
        bulletY += 32;
      }
    }

    // Page Number at bottom right
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "Roboto Mono"';
    ctx.textAlign = 'right';
    ctx.fillText('Slide 1 of 1', 714, 490);

  } else {
    // ----------------------------------------------------
    // WORD DOCUMENT / TEXT PORTRAIT PAGE LAYOUT
    // ----------------------------------------------------
    // Workspace background (light slate grey)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, 800, 600);

    // Portrait Paper Sheet
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(80, 40, 640, 520);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(80, 40, 640, 520);

    // Side accent line (blue for DOCX, zinc for TXT)
    ctx.fillStyle = fileExt === 'txt' ? '#71717a' : '#2563eb';
    ctx.fillRect(80, 40, 8, 520);

    // Document Header
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px "Inter"';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('DOCUMENT PAGE 1 / ' + fileExt.toUpperCase(), 110, 65);

    ctx.textAlign = 'right';
    ctx.fillText('PAPERWAIT ARCHIVE', 690, 65);

    // Divider Rule
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(110, 85);
    ctx.lineTo(690, 85);
    ctx.stroke();

    // Document Title
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px "Inter"';
    ctx.textAlign = 'left';

    let wrappedTitle = [];
    const words = fileName.split(' ');
    let currentLine = '';
    for (let word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(test).width > 550 && currentLine) {
        wrappedTitle.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) wrappedTitle.push(currentLine);
    if (wrappedTitle.length > 2) {
      wrappedTitle = wrappedTitle.slice(0, 2);
      wrappedTitle[1] += '...';
    }

    let titleY = 115;
    for (let line of wrappedTitle) {
      ctx.fillText(line, 110, titleY);
      titleY += 28;
    }

    // Title line separator
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(110, titleY + 8);
    ctx.lineTo(690, titleY + 8);
    ctx.stroke();

    // Body Text Paragraphs
    const textLines = (extractedText || '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('---'));

    ctx.font = '13px "Inter"';
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'left';

    let bodyY = titleY + 30;
    const maxBodyLines = 11;
    let printedLines = 0;

    if (textLines.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('[ No text contents extracted from document ]', 110, bodyY);
    } else {
      for (let line of textLines) {
        if (printedLines >= maxBodyLines) break;

        let drawText = line;
        if (ctx.measureText(drawText).width > 560) {
          while (ctx.measureText(drawText + '...').width > 560 && drawText.length > 5) {
            drawText = drawText.substring(0, drawText.length - 2);
          }
          drawText += '...';
        }

        ctx.fillText(drawText, 110, bodyY);
        bodyY += 24;
        printedLines++;
      }
    }

    // Page marker at bottom
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "Roboto Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('Page 1 of 1', 400, 535);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Sanitizes strings for PostgreSQL insertion by removing null bytes (\u0000) and
 * invalid non-printable control characters which Postgres rejects.
 */
export function sanitizePostgresString(str: string): string {
  if (!str) return ''
  let sanitized = str.replace(/\u0000/g, '')
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
  return sanitized
}

/**
 * Fuzzy-matches folder suggestions against existing folders to prevent duplicate creation
 * (e.g. merging "Saathi" and "Saathi Assist" if one of them is already present).
 */
export function matchExistingFolder(suggested: string, existingFolders: string[], fileName?: string): string {
  const cleanSuggested = suggested.trim()
  if (!cleanSuggested) return 'Uncategorized'

  const lowerSuggested = cleanSuggested.toLowerCase()
  const lowerFileName = (fileName || '').toLowerCase()

  // Determine if it is a transactional document (e.g. resume, cover letter, receipt, invoice, bill)
  const isTransactional =
    lowerFileName.includes('resume') ||
    lowerFileName.includes('cv') ||
    lowerFileName.includes('cover') ||
    lowerFileName.includes('letter') ||
    lowerFileName.includes('receipt') ||
    lowerFileName.includes('invoice') ||
    lowerFileName.includes('bill')

  // 1. Filename keyword match FIRST! (If the filename contains an existing folder name as a whole word, prefer it)
  if (fileName) {
    const cleanFileName = fileName.toLowerCase().replace(/[_-\s]+/g, ' ')
    // Sort existing folders by length descending to match the most specific one first
    const sortedFolders = [...existingFolders].sort((a, b) => b.length - a.length)
    for (const folder of sortedFolders) {
      const cleanFolder = folder.trim().toLowerCase()
      // Skip generic folders from overriding
      if (['uncategorized', 'miscellaneous', 'personal', 'photos'].includes(cleanFolder)) continue

      // Skip single-word folders (like "Aayush") for transactional files unless it matches the default folder name for this transaction type
      const isSingleWord = !cleanFolder.includes(' ')
      if (isTransactional && isSingleWord && !['resume', 'receipts', 'invoices', 'utility bills'].includes(cleanFolder)) {
        continue
      }

      if (cleanFolder.length >= 3) {
        // Escape special characters for regex safety
        const escapedFolder = cleanFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`\\b${escapedFolder}\\b`, 'i')
        if (regex.test(cleanFileName)) {
          console.log(`Filename match override: "${suggested}" -> "${folder}" (filename: "${fileName}")`)
          return folder
        }
      }
    }
  }

  // 2. Exact case-insensitive match
  const exactMatch = existingFolders.find(f => f.trim().toLowerCase() === lowerSuggested)
  if (exactMatch) return exactMatch

  // 3. Fuzzy substring match (if suggested is substring of existing, or vice versa)
  // Sort existing folders by length descending to match the most specific one first
  const sortedFolders = [...existingFolders].sort((a, b) => b.length - a.length)
  const commonCategories = ['invoices', 'receipts', 'bills', 'personal', 'photos', 'medical records', 'uncategorized', 'miscellaneous']

  for (const folder of sortedFolders) {
    const cleanFolder = folder.trim().toLowerCase()
    if (commonCategories.includes(cleanFolder)) continue

    // Check if one contains the other (using word boundary check to prevent false positives like "plantation" matching "plan")
    if (cleanFolder.length >= 3 && lowerSuggested.length >= 3) {
      const escapedFolder = cleanFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const folderRegex = new RegExp(`\\b${escapedFolder}\\b`, 'i')

      const escapedSuggested = lowerSuggested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const suggestedRegex = new RegExp(`\\b${escapedSuggested}\\b`, 'i')

      if (folderRegex.test(lowerSuggested) || suggestedRegex.test(cleanFolder)) {
        console.log(`Fuzzy matched folder suggestion: "${suggested}" -> "${folder}"`)
        return folder
      }
    }
  }

  // 4. Fallback to title case of suggested
  return cleanSuggested.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export interface OcrWordDetection {
  text: string
  confidence: number
  points: Array<{ x: number; y: number }>
}

export interface OcrDetailedResult {
  text: string
  detections: OcrWordDetection[]
}

/**
 * Sends a base64 image (PNG/JPEG) to NVIDIA Nemotron OCR v2 to extract text with detailed word bounding boxes.
 */
export async function performOcrDetailed(base64Image: string): Promise<OcrDetailedResult> {
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
    merge_levels: ['word'] // Use word-level detections for precise highlights
  }

  const makeRequest = async (retries = 1, delay = 1000): Promise<OcrDetailedResult> => {
    try {
      const response = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000), // 15-second timeout per request
        keepalive: true,
      } as any)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`NVIDIA OCR NIM request failed: ${response.status} - ${errorText}`)
      }

      const resJson = await response.json()

      // Extract all word detections in order
      const detections = resJson.data?.[0]?.text_detections || []
      const words: OcrWordDetection[] = detections.map((det: any) => ({
        text: det.text_prediction?.text || '',
        confidence: det.text_prediction?.confidence || 0,
        points: det.bounding_box?.points || []
      })).filter((w: any) => w.text.length > 0)

      const text = words.map(w => w.text).join(' ')

      return {
        text,
        detections: words
      }
    } catch (err) {
      if (retries > 0) {
        console.warn(`OCR request failed, retrying in ${delay}ms... (${retries} retries left):`, err)
        await new Promise(resolve => setTimeout(resolve, delay))
        return makeRequest(retries - 1, delay * 2) // exponential backoff
      }
      throw err
    }
  }

  return makeRequest()
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

  const makeRequest = async (retries = 1, delay = 1000): Promise<string> => {
    try {
      const response = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000), // 15-second timeout per request
        keepalive: true,
      } as any)

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
    } catch (err) {
      if (retries > 0) {
        console.warn(`OCR request failed, retrying in ${delay}ms... (${retries} retries left):`, err)
        await new Promise(resolve => setTimeout(resolve, delay))
        return makeRequest(retries - 1, delay * 2) // exponential backoff
      }
      throw err
    }
  }

  return makeRequest()
}

export interface ClassificationResult {
  document_title: string | null
  important_entities: {
    names: string[]
    organizations: string[]
    dates: string[]
    ids: string[]
  }
  primary_entity: string | null
  suggested_folder: string
  is_new_folder: boolean
  final_category: string
  confidence_score: number
  short_summary: string
}

const CATEGORY_DEFAULT_FOLDERS: Record<string, string> = {
  // Removed 'Employment': 'Resume' to prevent forcing other employment docs to Resume
  'Receipts': 'Receipts',
  'Invoices': 'Invoices',
  'Bills': 'Utility Bills',
  'Utilities': 'Utility Bills',
  'Medical Records': 'Medical Records',
  'Prescriptions': 'Medical Records',
  'Lab Reports': 'Medical Records',
  'Tax Documents': 'Tax Documents',
  'Education': 'Aayush', // Default education files go to personal folder if not marksheets
  'Bank Documents': 'Bank Statements'
}

/**
 * Normalizes suggested folder and final category outputs using programmatic overrides and existing folder matching.
 * This runs at the output boundary of all execution paths (try ensembling, catch fallback, and default recovery).
 */
export function postProcessClassification(
  result: ClassificationResult,
  existingFolders: string[],
  fileName?: string,
  ocrText?: string
): ClassificationResult {
  let suggestedFolder = result.suggested_folder
  let finalCategory = result.final_category

  // Pre-process: Detect and correct clear mismatches between primary_entity and suggested_folder
  const primary = result.primary_entity || ''
  if (primary && suggestedFolder) {
    const cleanPrimary = primary.trim().toLowerCase()
    const cleanSuggested = suggestedFolder.trim().toLowerCase()
    const genericFolders = ['uncategorized', 'miscellaneous', 'personal', 'photos', 'resume', 'marksheets', 'certificates', 'receipts', 'utility bills', 'government ids']
    if (!genericFolders.includes(cleanSuggested) && !cleanSuggested.includes(cleanPrimary) && !cleanPrimary.includes(cleanSuggested)) {
      // Check if they are fuzzy matched (e.g. "Swari Burman" vs "Swati Burman")
      let isFuzzyMatch = false
      const a = cleanPrimary, b = cleanSuggested
      if (Math.abs(a.length - b.length) <= 3) {
        const tmp: number[][] = []
        for (let i = 0; i <= a.length; i++) tmp[i] = [i]
        for (let j = 0; j <= b.length; j++) tmp[0][j] = j
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            tmp[i][j] = Math.min(
              tmp[i - 1][j] + 1,
              tmp[i][j - 1] + 1,
              tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
          }
        }
        const dist = tmp[a.length][b.length]
        const threshold = Math.min(2, Math.floor(Math.max(a.length, b.length) / 4))
        if (dist <= threshold) {
          isFuzzyMatch = true
        }
      }
      if (!isFuzzyMatch) {
        console.log(`Overriding mismatched folder suggestion: "${suggestedFolder}" -> "${primary}"`)
        suggestedFolder = primary
      }
    }
  }

  const lowerFileName = (fileName || '').toLowerCase()
  const lowerOcr = (ocrText || '').toLowerCase()
  // Collapse single-character spacings (e.g. "P R O F E S S I O N A L" -> "professional") for robust OCR matching
  const normalizedOcr = lowerOcr.replace(/([a-z])\s+(?=[a-z])/gi, '$1')

  // Dynamic checks for specific document subtypes (filename + OCR text + LLM classification output)
  const isCoverLetterOrContract =
    lowerFileName.includes('cover') ||
    lowerFileName.includes('offer') ||
    lowerFileName.includes('contract') ||
    lowerFileName.includes('payslip') ||
    lowerFileName.includes('pay slip') ||
    lowerOcr.includes('cover letter') ||
    lowerOcr.includes('dear hiring manager') ||
    lowerOcr.includes('dear recruiter')

  const isResumeFile =
    (lowerFileName.includes('resume') ||
     lowerFileName.includes('cv') ||
     lowerOcr.includes('curriculum vitae') ||
     (lowerOcr.includes('resume') && !lowerOcr.includes('cover letter')) ||
     normalizedOcr.includes('curriculumvitae') ||
     normalizedOcr.includes('professionalsummary') ||
     result.document_title?.toLowerCase() === 'resume' ||
     result.document_title?.toLowerCase() === 'professional summary' ||
     result.suggested_folder?.toLowerCase() === 'resume' ||
     result.final_category?.toLowerCase() === 'resume' ||
     result.final_category?.toLowerCase() === 'cv') &&
    !isCoverLetterOrContract

  const isRegistrationOrAcademic =
    lowerFileName.includes('registration') ||
    lowerFileName.includes('enrollment') ||
    lowerFileName.includes('admission') ||
    lowerFileName.includes('course') ||
    lowerOcr.includes('course registration') ||
    lowerOcr.includes('enrollment confirmation') ||
    result.document_title?.toLowerCase()?.includes('registration') ||
    result.document_title?.toLowerCase()?.includes('enrollment') ||
    result.document_title?.toLowerCase()?.includes('admission')

  const isMarksheetFile =
    lowerFileName.includes('marksheet') ||
    lowerFileName.includes('marks card') ||
    lowerFileName.includes('result') ||
    lowerFileName.includes('transcript') ||
    lowerFileName.includes('grade') ||
    ((result.document_title?.toLowerCase() === 'marksheet' ||
      result.document_title?.toLowerCase() === 'grade card' ||
      result.suggested_folder?.toLowerCase() === 'marksheets') &&
     !isRegistrationOrAcademic)

  const isPersonalOnboarding =
    lowerFileName.includes('bgc') ||
    lowerFileName.includes('onboarding') ||
    lowerOcr.includes('background check') ||
    lowerOcr.includes('background verification')

  const isIdentityDocument =
    lowerFileName.includes('proof') ||
    lowerFileName.includes('aadhaar') ||
    lowerFileName.includes('pan') ||
    lowerFileName.includes('license') ||
    lowerFileName.includes('passport') ||
    lowerFileName.includes('voter') ||
    lowerOcr.includes('aadhaar') ||
    lowerOcr.includes('unique identification') ||
    lowerOcr.includes('election commission') ||
    lowerOcr.includes('driving license') ||
    lowerOcr.includes('income tax department') ||
    result.document_title?.toLowerCase()?.includes('aadhaar') ||
    result.document_title?.toLowerCase()?.includes('pan card') ||
    result.final_category === 'Identity Documents'

  const isNonFinancial =
    lowerFileName.includes('plan') ||
    lowerFileName.includes('roadmap') ||
    lowerFileName.includes('matrix') ||
    lowerFileName.includes('brochure') ||
    lowerFileName.includes('guide') ||
    lowerFileName.includes('profile') ||
    lowerFileName.includes('result') ||
    lowerFileName.includes('marksheet') ||
    lowerFileName.includes('bgc')

  // 1. Align final category dynamically based on clear filename/OCR keywords
  if (isResumeFile) {
    finalCategory = 'Employment'
  } else if (isCoverLetterOrContract) {
    finalCategory = 'Employment'
  } else if (isPersonalOnboarding) {
    finalCategory = 'Employment'
  } else if (isIdentityDocument) {
    finalCategory = 'Identity Documents'
  } else if (!isNonFinancial && (lowerFileName.includes('receipt') || lowerOcr.includes('receipt'))) {
    finalCategory = 'Receipts'
  } else if (!isNonFinancial && (lowerFileName.includes('invoice') || lowerOcr.includes('invoice'))) {
    finalCategory = 'Invoices'
  } else if (!isNonFinancial && (lowerFileName.includes('bill') || lowerOcr.includes('bill statement'))) {
    finalCategory = 'Bills'
  } else if (isRegistrationOrAcademic) {
    finalCategory = 'Education'
  }

  if (isNonFinancial && ['receipts', 'invoices', 'bills'].includes(finalCategory.toLowerCase())) {
    finalCategory = 'Miscellaneous'
  }

  // 2. Map category to standard default folder name
  let defaultFolder = CATEGORY_DEFAULT_FOLDERS[finalCategory]

  const getDynamicFolder = (fallback: string, allowNewFolder = false) => {
    const primary = result.primary_entity || ''
    if (primary) {
      // First try exact/substring matching via matchExistingFolder
      const matched = matchExistingFolder(primary, existingFolders, fileName)
      const exists = existingFolders.some(f => f.trim().toLowerCase() === matched.toLowerCase())
      if (exists) return matched

      // Then try Levenshtein fuzzy match for OCR typos (e.g. "Swati Burman" vs "Swari Burman")
      const lowerPrimary = primary.toLowerCase()
      const genericFolders = ['uncategorized', 'miscellaneous', 'personal', 'photos', 'resume', 'marksheets', 'certificates', 'receipts', 'utility bills', 'government ids']
      for (const folder of existingFolders) {
        const lf = folder.trim().toLowerCase()
        if (genericFolders.includes(lf)) continue
        // Inline Levenshtein distance
        const a = lowerPrimary, b = lf
        const tmp: number[][] = []
        for (let i = 0; i <= a.length; i++) tmp[i] = [i]
        for (let j = 0; j <= b.length; j++) tmp[0][j] = j
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            tmp[i][j] = Math.min(tmp[i-1][j]+1, tmp[i][j-1]+1, tmp[i-1][j-1] + (a[i-1]===b[j-1]?0:1))
          }
        }
        const dist = tmp[a.length][b.length]
        const maxAllowed = Math.min(2, Math.floor(Math.max(a.length, b.length) / 4))
        if (dist <= maxAllowed && dist > 0) {
          console.log(`Dynamic folder Levenshtein match: "${primary}" -> "${folder}" (distance: ${dist})`)
          return folder
        }
      }

      if (allowNewFolder) {
        // Return the primary entity itself (formatted to Title Case) to allow creating a folder for it
        return primary.split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ')
      }
    }
    return fallback
  }

  // Custom overrides for specific subtypes to prevent misrouting
  if (isResumeFile) {
    defaultFolder = 'Resume'
    finalCategory = 'Employment'
  } else if (isMarksheetFile) {
    defaultFolder = 'Marksheets'
    finalCategory = 'Education'
  } else if (finalCategory === 'Employment') {
    // Allow creating a new folder for the candidate's name (e.g. Swati Burman, Aayush) for BGC forms, cover letters, contracts
    defaultFolder = getDynamicFolder('Miscellaneous', true)
  } else if (finalCategory === 'Education') {
    defaultFolder = getDynamicFolder('Education', true)
  } else if (finalCategory === 'Identity Documents') {
    defaultFolder = getDynamicFolder('Government IDs', false)
  }

  if (!defaultFolder) {
    const genericFallback = CATEGORY_DEFAULT_FOLDERS[finalCategory] || 'Miscellaneous'
    defaultFolder = getDynamicFolder(genericFallback, true)
  }

  if (defaultFolder) {
    const isGeneric = ['uncategorized', 'miscellaneous', 'personal', 'photos'].includes(suggestedFolder.toLowerCase())
    const forceOverride =
      isGeneric ||
      isResumeFile ||
      isCoverLetterOrContract ||
      isPersonalOnboarding ||
      isRegistrationOrAcademic ||
      isMarksheetFile ||
      lowerFileName.includes('receipt') ||
      (finalCategory === 'Receipts' && (lowerOcr.includes('tax receipt') || lowerOcr.includes('payment receipt'))) ||
      lowerFileName.includes('invoice') ||
      lowerFileName.includes('bill') ||
      (suggestedFolder.toLowerCase() === 'resume' && !isResumeFile) ||
      (suggestedFolder.toLowerCase() === 'marksheets' && !isMarksheetFile) ||
      (finalCategory === 'Identity Documents' && suggestedFolder.toLowerCase() !== defaultFolder.toLowerCase()) ||
      (!!result.primary_entity && isGeneric && suggestedFolder.toLowerCase() !== defaultFolder.toLowerCase())

    if (forceOverride) {
      suggestedFolder = defaultFolder
    }
  }

  // 3. Normalize suggestedFolder against existing folders (handles exact match, filename match with transactional guards, and fuzzy match)
  suggestedFolder = matchExistingFolder(suggestedFolder, existingFolders, fileName)

  const isNewFolder = !existingFolders.some(f => f.trim().toLowerCase() === suggestedFolder.toLowerCase())

  return {
    ...result,
    suggested_folder: suggestedFolder,
    is_new_folder: isNewFolder,
    final_category: finalCategory,
  }
}

/**
 * Extracts key metadata and classifies a document using DeepSeek V4 Flash.
 * Uses a programmatically condensed context of the first 15 meaningful lines of OCR text
 * to minimize latency, tokens, and prevent unnecessary repeated processing.
 */
export async function classifyDocument(
  ocrText: string,
  existingFolders: string[],
  fileName?: string,
  batchHint?: string | null
): Promise<ClassificationResult> {
  const apiKey = process.env.NVIDIA_API_KEY_LLM
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_LLM is not defined in environment')
  }

  // 1. Programmatically extract the first 35 meaningful lines of text (non-empty, non-page boundaries) to provide a rich context (full first page + start of second page)
  const lines = ocrText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--- Page'))
  const condensedOcrText = lines.slice(0, 35).join('\n')

  const foldersList = existingFolders.length > 0
    ? existingFolders.map((f) => `"${f}"`).join(', ')
    : 'None'

  const systemPrompt = `You are an expert document classifier and entity extractor. Analyze the provided file name, the first page of OCR text, and the user's existing folders, and output a structured JSON categorization.

You MUST respond ONLY with a raw JSON object matching this schema:
{
  "document_title": "string or null",
  "important_entities": {
    "names": ["string"],
    "organizations": ["string"],
    "dates": ["string"],
    "ids": ["string"]
  },
  "primary_entity": "string or null",
  "suggested_folder": "string",
  "is_new_folder": boolean,
  "final_category": "string",
  "confidence_score": number,
  "short_summary": "string"
}

Standard categories (final_category must be exactly one of these):
- Identity Documents (Aadhaar cards, PAN cards, Driver's licenses, Passports, Voter IDs, Government ID cards)
- Medical Records (Medical prescription sheets, health logs, clinic summary files, patient intake forms)
- Prescriptions (Doctor prescription slips, pharmacy orders)
- Lab Reports (Blood test reports, MRI scans, radiology files, diagnostic lab reports, urine/stool check sheets)
- Bills (Electricity bills, water bills, gas bills, broadband bills, general utility billing invoices)
- Invoices (B2B invoices, supply orders, vendor service invoices, purchase invoices)
- Receipts (Retail receipts, restaurant lunch bills, taxi receipts, shop purchase receipts, payment receipts)
- Bank Documents (Bank account statements, bank passbooks, check photos, deposit slips, bank letters)
- Insurance (Health insurance policies, car insurance policies, life insurance certificates, premium invoices)
- Education (School/college marks card, degree certificates, class 10/12 results sheets, registration profiles, college transcripts, course registrations)
- Certificates (Birth certificates, marriage certificates, achievement certificates, seminar participation sheets)
- Legal Documents (Rent agreements, sale deeds, contracts, affidavits, power of attorney, court papers)
- Tax Documents (Income tax returns, Form 16, W-2, PAN cards when uploaded for tax validation)
- Employment (Resumes, CVs, job offer letters, job application confirmations, employment contract agreements, payslips)
- Travel (Flight tickets, boarding passes, hotel booking receipts, train tickets, travel itineraries)
- Personal (Personal letters, hand-written journal pages, photographs, greeting cards)
- Utilities (Electricity bills, internet/broadband bills, sewage/water bills, gas pipeline bills)
- Miscellaneous (Any document not fitting any of the above categories)

Rules:
1. Document Title: Detect the title or header of the document from the text (e.g. "Aadhaar Card", "Tax Invoice", "Complete Blood Count Report", "Rent Agreement", or null if not identifiable).
2. Important Entities: Extract key names of persons, organizations (companies, hospitals, schools, etc.), dates, and ID/reference numbers (Aadhaar number, PAN, DL number, Invoice ID) from the text.
3. Primary Entity: Identify the main subject (person, company, client, property, hospital) that this document is centered around.
   - Look at the Filename first! If the filename is "Aadhar_Aayush.pdf" or "Aayush_Resume_93.pdf", the primary entity is "Aayush". If the filename is "BESCOM_Bill.pdf", the primary entity is "BESCOM". Pay close attention to words before/after underscores or hyphens in filenames as they often denote client, project, or person names.
   - Look at the OCR text to confirm (e.g. For "Aadhaar_Aayush.pdf", the person is "Aayush"; for "Electricity_Bill_July.pdf" from "BESCOM", it could be "BESCOM"; for a clinic bill, it could be the hospital/clinic name).
4. Intelligent Folder Detection & Creation:
    - Prioritize Existing Folders: Before creating any new folder based on a primary entity, check if the Filename or the OCR text contains or matches any of the user's existing folders (case-insensitively). E.g. if the folder "Saathi Assist" is in the existing folders list and the filename contains "Saathi_Assist" or "Saathi Assist", you MUST suggest that existing folder name as the suggested_folder (with is_new_folder as false) instead of proposing a new folder for any newly discovered entity (like "Sankshit").
    - Special Cases for Everyday Folders (If there is NO clear primary entity, or if the document matches one of these types, route them to these intuitive folder names instead of general category names):
      * Resumes or CVs -> suggested_folder: "Resume" (to group resumes together).
      * Marksheets, grade sheets, report cards, transcripts, exam results -> suggested_folder: "Marksheets" (to group academic results).
      * Aadhaar cards, PAN cards, Driver's Licenses, Passports, Voter IDs -> suggested_folder: "Government IDs" (to group personal identity cards).
      * Prescriptions, medical records, blood tests, clinical lab reports -> suggested_folder: "Medical Records" (to group health documents).
      * Electricity, gas, water, internet, broadband bills -> suggested_folder: "Utility Bills" (to group recurring utility statements).
      * Bank statements, passbook pages -> suggested_folder: "Bank Statements" (to group statements).
      * Income tax returns, W-2, Form 16 -> suggested_folder: "Tax Documents".
      * Insurance policies, premium receipts -> suggested_folder: "Insurance".
      * Admission letters, course registrations, study cards -> suggested_folder: "Academic".
      * Receipts, retail purchase receipts, fee receipts, payment confirmations -> suggested_folder: "Receipts" (to group receipts together).
    - If there is a clear primary entity (person name, company, hospital, project, client, etc. - excluding the special cases above), the folder name should be that entity's name (in Title Case, e.g. "Aayush" or "BESCOM").
    - If an existing folder from the list matches the target folder name case-insensitively, reuse it EXACTLY (set suggested_folder to the existing folder name, set is_new_folder to false).
    - If no existing folder matches, suggest the target name as the new folder name (set is_new_folder to true).
    - If there is NO clear primary entity or special case match, classify the document into the most appropriate category from the Standard categories list, and use that category name as the suggested_folder. If a folder with that name already exists in the existing folders list (case-insensitive), set suggested_folder to that folder and set is_new_folder to false.
5. Final Category: Classify the document into the single most appropriate category from the Standard categories list. Categorization must be deterministic and accurate. Use "Miscellaneous" only as a last resort.
6. Confidence Score: A decimal between 0.0 and 1.0 representing your confidence in this categorization.
7. Short Summary: A concise summary of 1-2 sentences. Mention what the document is, whose it is if identifiable, and the most important details (without exposing full sensitive data).
8. Strictness: Output ONLY the JSON object. Do not include markdown code block syntax (like \`\`\`json ... \`\`\`), no preambles, no trailing text.
9. Categorization & Folder Precedence: Financial transaction documents like payment receipts, payment confirmations, purchase receipts, invoices, and billing statements MUST be categorized as "Receipts", "Bills", or "Invoices", even if they are for tuition fees, school charges, medical bills, or travel tickets. The transaction document type (Receipt/Bill/Invoice) takes precedence over the subject matter (e.g. a tuition payment receipt is a Receipt, not Education; a medical clinic bill is a Bill/Receipt, not Medical Records). In these cases, suggested_folder should be mapped to "Receipts" or "Utility Bills" accordingly, rather than a person name or subject name.`

  const userPrompt = `Classify this document context and extract entities.

File Name: ${fileName || 'unknown'}
Existing Folders: [${foldersList}]
${batchHint ? `Batch Hint (this document belongs to a batch that shares these keywords): ${batchHint}` : ''}

First page of OCR text:
${condensedOcrText}`

  const makeCall = async (budget: number, model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'): Promise<ClassificationResult> => {
    const payload: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' ? 0.6 : 0.1,
      top_p: 0.95,
      max_tokens: model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' ? 2048 : 512,
      stream: false,
    }

    if (model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning') {
      payload.reasoning_budget = budget
    }

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(budget > 0 ? 45000 : 15000), // longer timeout for deep reasoning
      keepalive: true,
    } as any)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`${model} request failed: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    const message = resJson.choices?.[0]?.message
    if (!message) {
      throw new Error('LLM returned an empty response')
    }

    const content = (message.content || '').trim()
    if (!content) {
      throw new Error('LLM returned empty content')
    }

    // Extract JSON object using matching braces algorithm to prevent syntax errors on trailing texts
    let jsonText = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    const startIdx = jsonText.indexOf('{')
    if (startIdx !== -1) {
      let braceCount = 0
      let inString = false
      let escape = false
      let endIdx = -1
      for (let i = startIdx; i < jsonText.length; i++) {
        const char = jsonText[i]
        if (escape) {
          escape = false
          continue
        }
        if (char === '\\') {
          escape = true
          continue
        }
        if (char === '"') {
          inString = !inString
          continue
        }
        if (!inString) {
          if (char === '{') braceCount++
          if (char === '}') braceCount--
          if (braceCount === 0) {
            endIdx = i
            break
          }
        }
      }
      if (endIdx !== -1) {
        jsonText = jsonText.slice(startIdx, endIdx + 1)
      }
    }

    const parsed = JSON.parse(jsonText)

    // Validate required fields and map defaults if missing
    return {
      document_title: parsed.document_title || null,
      important_entities: {
        names: Array.isArray(parsed.important_entities?.names) ? parsed.important_entities.names : [],
        organizations: Array.isArray(parsed.important_entities?.organizations) ? parsed.important_entities.organizations : [],
        dates: Array.isArray(parsed.important_entities?.dates) ? parsed.important_entities.dates : [],
        ids: Array.isArray(parsed.important_entities?.ids) ? parsed.important_entities.ids : [],
      },
      primary_entity: parsed.primary_entity || null,
      suggested_folder: parsed.suggested_folder || 'Uncategorized',
      is_new_folder: typeof parsed.is_new_folder === 'boolean' ? parsed.is_new_folder : false,
      final_category: parsed.final_category || 'Miscellaneous',
      confidence_score: typeof parsed.confidence_score === 'number' ? parsed.confidence_score : 0.8,
      short_summary: parsed.short_summary || 'Processed document scan.',
    }
  }

  try {
    console.log('Classify Document: Routing AI Pipeline Initiated...')

    // Start both requests in parallel
    const llamaPromise = (async () => {
      try {
        console.log('Routing: Querying Llama 3.1 8B (Fast path)...')
        const llamaRes = await promiseWithTimeout(makeCall(0, 'meta/llama-3.1-8b-instruct'), 8000, 'Llama-3.1-8B')
        llamaRes.suggested_folder = matchExistingFolder(llamaRes.suggested_folder, existingFolders, fileName)
        return llamaRes
      } catch (llamaErr) {
        console.warn('Routing: Llama 3.1 8B query failed or timed out:', llamaErr)
        return null
      }
    })()

    const nemotronPromise = (async () => {
      try {
        console.log('Routing: Querying Nemotron-3-Nano-Omni (Deep reasoning path)...')
        // Generous 28s timeout since Nemotron with reasoning budget can take time, keeping within Vercel's 30s function limit
        const nemotronRes = await promiseWithTimeout(makeCall(1024, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'), 28000, 'Nemotron-3-Nano-Omni')
        nemotronRes.suggested_folder = matchExistingFolder(nemotronRes.suggested_folder, existingFolders, fileName)
        return nemotronRes
      } catch (nemotronErr) {
        console.error('Routing: Nemotron Omni query failed or timed out:', nemotronErr)
        return null
      }
    })()

    let llamaResolved = false
    let nemotronResolved = false
    let llamaResult: ClassificationResult | null = null
    let nemotronResult: ClassificationResult | null = null

    const result = await new Promise<ClassificationResult>((resolve, reject) => {
      let resolved = false

      const handleLlama = (res: ClassificationResult | null) => {
        if (resolved) return
        llamaResult = res
        llamaResolved = true
        if (res) {
          const isSimpleFinancial = ['Receipts', 'Invoices', 'Bills', 'Utilities', 'Bank Documents'].includes(res.final_category)
          if (res.confidence_score >= 0.90 && isSimpleFinancial) {
            resolved = true
            console.log(`Routing Success: Fast path (Llama 3.1 8B) resolved first with high confidence: ${res.confidence_score}`)
            resolve(postProcessClassification(res, existingFolders, fileName, condensedOcrText))
            return
          }
        }
        checkDone()
      }

      const handleNemotron = (res: ClassificationResult | null) => {
        if (resolved) return
        nemotronResult = res
        nemotronResolved = true
        if (res) {
          resolved = true
          console.log(`Routing Success: Deep reasoning path (Nemotron Omni) resolved first with confidence: ${res.confidence_score}`)
          resolve(postProcessClassification(res, existingFolders, fileName, condensedOcrText))
          return
        }
        checkDone()
      }

      const checkDone = () => {
        if (resolved) return
        if (llamaResolved && nemotronResolved) {
          resolved = true
          if (nemotronResult) {
            resolve(postProcessClassification(nemotronResult, existingFolders, fileName, condensedOcrText))
          } else if (llamaResult) {
            console.log('Routing: Using fallback Llama 3.1 8B classification result.')
            resolve(postProcessClassification(llamaResult, existingFolders, fileName, condensedOcrText))
          } else {
            reject(new Error('Both Llama and Nemotron routing classification paths failed.'))
          }
        }
      }

      llamaPromise.then(handleLlama)
      nemotronPromise.then(handleNemotron)
    })
    return result
  } catch (err) {
    console.error('All routing classification paths failed, returning default fallback.', err)
    const defaultFallback = {
      document_title: null,
      important_entities: {
        names: [],
        organizations: [],
        dates: [],
        ids: []
      },
      primary_entity: null,
      suggested_folder: 'Uncategorized',
      is_new_folder: false,
      final_category: 'Miscellaneous',
      confidence_score: 0.1,
      short_summary: 'Processed document scan.',
    }
    return postProcessClassification(defaultFallback, existingFolders, fileName, condensedOcrText)
  }
}

/**
 * Generates a 1-sentence friendly description of "what this photo/document is for" using DeepSeek V4 Flash.
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

  const makeCall = async (budget: number, model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'): Promise<string> => {
    const payload: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' ? 0.6 : 0.5,
      top_p: model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' ? 0.95 : 0.9,
      max_tokens: model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' ? 65536 : 256,
      stream: false,
    }

    if (model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning') {
      payload.reasoning_budget = budget
    }

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    } as any)

    if (!response.ok) {
      throw new Error(`Summary call failed for model ${model}: ${response.status}`)
    }

    const resJson = await response.json()
    let content = resJson.choices?.[0]?.message?.content?.trim() || ''
    // Strip thinking block if present
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    return content
  }

  try {
    console.log('Generate Summary: Fast Path routing (Llama 3.1 8B)...')
    return await makeCall(0, 'meta/llama-3.1-8b-instruct')
  } catch (err) {
    console.error('Llama 3.1 8B summary call failed, falling back to Nvidia Nemotron (budget 512)...', err)
    try {
      return await makeCall(512, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning')
    } catch (retryErr) {
      console.error('Nvidia Nemotron summary fallback failed, falling back to DeepSeek V4 Flash...', retryErr)
      try {
        return await makeCall(0, 'deepseek-ai/deepseek-v4-flash')
      } catch (finalErr) {
        console.error('All summary paths failed, returning default fallback description.', finalErr)
        return 'Extracted document scan content.'
      }
    }
  }
}

/**
 * Generates a 1-sentence friendly description of "what this photo/document is for" using Llama 3.2 11B Vision.
 */
export async function generateSummaryFromImage(base64Image: string): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY_LLM
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_LLM is not defined in environment')
  }

  let imageUrl = base64Image
  if (!imageUrl.startsWith('data:')) {
    imageUrl = `data:image/png;base64,${imageUrl}`
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta/llama-3.2-11b-vision-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this photo/image and describe what is in it or what it is for in exactly one clear, friendly sentence (e.g. "This is a selfie of a smiling person inside a bedroom." or "This is a billing invoice from Comcast."). Be concise and start directly with the description.'
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        temperature: 0.1,
        top_p: 0.7,
        max_tokens: 128,
        stream: false,
      }),
      keepalive: true,
    } as any)

    if (!response.ok) {
      const errText = await response.text()
      console.error('NVIDIA Vision NIM failed:', response.status, errText)
      return 'Processed document scan.'
    }

    const resJson = await response.json()
    return resJson.choices?.[0]?.message?.content?.trim() || 'Processed document scan.'
  } catch (err) {
    console.error('Error generating image summary:', err)
    return 'Processed document scan.'
  }
}
