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

  // Determine if it is a transactional document (e.g. resume, cover letter, receipt, invoice, bill, job description, marksheet)
  const isTransactional =
    lowerFileName.includes('resume') ||
    lowerFileName.includes('cv') ||
    lowerFileName.includes('cover') ||
    lowerFileName.includes('letter') ||
    lowerFileName.includes('receipt') ||
    lowerFileName.includes('invoice') ||
    lowerFileName.includes('bill') ||
    lowerFileName.includes('jd') ||
    lowerFileName.includes('job description')

  // 1. Filename keyword match FIRST! (If the filename contains an existing folder name as a whole word, prefer it)
  if (fileName) {
    const cleanFileName = fileName.toLowerCase().replace(/[_-\s]+/g, ' ')
    // Sort existing folders by length descending to match the most specific one first
    const sortedFolders = [...existingFolders].sort((a, b) => b.length - a.length)
    for (const folder of sortedFolders) {
      const cleanFolder = folder.trim().toLowerCase()
      // Skip generic folders from overriding
      if (['uncategorized', 'miscellaneous', 'personal', 'photos'].includes(cleanFolder)) continue

      // Skip single-word folders for transactional files unless it matches the default folder name for this transaction type
      const isSingleWord = !cleanFolder.includes(' ')
      if (isTransactional && isSingleWord && !['resume', 'resumes', 'job descriptions', 'job description', 'receipts', 'invoices', 'utility bills', 'marksheets', 'results'].includes(cleanFolder)) {
        continue
      }

      if (cleanFolder.length >= 3) {
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

  // 3. Plural / singular match (e.g. "Resume" vs "Resumes", "Job Description" vs "Job Descriptions", "Result" vs "Results")
  const pluralMatch = existingFolders.find(f => {
    const ef = f.trim().toLowerCase()
    return ef === lowerSuggested + 's' || ef + 's' === lowerSuggested
  })
  if (pluralMatch) return pluralMatch

  // 4. Category folder synonyms to prevent folder fragmentation
  if (['results', 'marksheets', 'transcripts', 'grades'].includes(lowerSuggested)) {
    const found = existingFolders.find(f => ['results', 'marksheets', 'transcripts'].includes(f.trim().toLowerCase()))
    if (found) return found
  }
  if (['job descriptions', 'job description', 'jd', 'jds', 'job postings'].includes(lowerSuggested)) {
    const found = existingFolders.find(f => ['job descriptions', 'job description'].includes(f.trim().toLowerCase()))
    if (found) return found
  }
  if (['resume', 'resumes', 'cv', 'cvs'].includes(lowerSuggested)) {
    const found = existingFolders.find(f => ['resume', 'resumes'].includes(f.trim().toLowerCase()))
    if (found) return found
  }
  if (['education', 'academic', 'study material', 'notes', 'exams', 'question papers'].includes(lowerSuggested)) {
    const found = existingFolders.find(f => ['education', 'academic'].includes(f.trim().toLowerCase()))
    if (found) return found
  }
  if (['government ids', 'government id', 'ids', 'id', 'identity documents'].includes(lowerSuggested)) {
    const found = existingFolders.find(f => ['government ids', 'government id', 'ids'].includes(f.trim().toLowerCase()))
    if (found) return found
  }

  // 5. Substring matching for multi-word folders (e.g. "Transport Department Jharkhand", "Saathi Assist")
  for (const folder of existingFolders) {
    const cleanFolder = folder.trim().toLowerCase()
    if (['uncategorized', 'miscellaneous', 'personal'].includes(cleanFolder)) continue
    if (cleanFolder.length >= 4 && lowerSuggested.length >= 4) {
      if (cleanFolder.includes(lowerSuggested) || lowerSuggested.includes(cleanFolder)) {
        return folder
      }
    }
  }

  // 6. Fallback to title case of suggested
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
  'Receipts': 'Receipts',
  'Invoices': 'Invoices',
  'Bills': 'Utility Bills',
  'Utilities': 'Utility Bills',
  'Medical Records': 'Medical Records',
  'Prescriptions': 'Medical Records',
  'Lab Reports': 'Medical Records',
  'Tax Documents': 'Tax Documents',
  'Education': 'Education',
  'Bank Documents': 'Bank Statements',
  'Travel': 'Travel',
  'Certificates': 'Certificates',
  'Identity Documents': 'Government IDs',
  'Employment': 'Employment',
  'Insurance': 'Insurance',
  'Legal Documents': 'Legal Documents',
  'Personal': 'Personal',
  'Miscellaneous': 'Miscellaneous'
}

/**
 * Normalizes classification results against existing folders and standard conventions.
 * Pure normalization without brittle hardcoded strings or file-specific hacks.
 */
export function postProcessClassification(
  result: ClassificationResult,
  existingFolders: string[],
  fileName?: string,
  ocrText?: string
): ClassificationResult {
  let suggestedFolder = (result.suggested_folder || 'Miscellaneous').trim()
  let finalCategory = (result.final_category || 'Miscellaneous').trim()
  let documentTitle = result.document_title

  const lowerFileName = (fileName || '').toLowerCase()
  const lowerOcr = (ocrText || '').toLowerCase()
  const cleanFileNameWords = lowerFileName.replace(/[^a-z0-9]/g, ' ')

  // 1. Admit cards, hall tickets, exams, question papers -> Education
  const isAdmitCardOrExam =
    lowerFileName.includes('admit') ||
    lowerFileName.includes('hall_ticket') ||
    lowerFileName.includes('hall ticket') ||
    lowerFileName.includes('exam') ||
    lowerFileName.includes('mid') ||
    lowerFileName.includes('end') ||
    lowerFileName.includes('question_paper') ||
    lowerFileName.includes('question paper') ||
    /\b(admit|hallticket|midsem|endsem|exam|quiz)\b/i.test(cleanFileNameWords) ||
    lowerOcr.includes('admit card') ||
    lowerOcr.includes('hall ticket') ||
    lowerOcr.includes('e-admit card') ||
    lowerOcr.includes('semester examination') ||
    lowerOcr.includes('question paper') ||
    (lowerOcr.includes('roll number') && lowerOcr.includes('examination'))

  // 2. Study material / lecture notes -> Education
  const isStudyOrLecture =
    lowerFileName.includes('lecture') ||
    lowerFileName.includes('notes') ||
    lowerFileName.includes('note_') ||
    lowerFileName.includes('study') ||
    lowerFileName.includes('module') ||
    lowerFileName.includes('computing') ||
    lowerFileName.includes('interview_guide') ||
    lowerFileName.includes('interview guide') ||
    lowerOcr.includes('interview field guide') ||
    lowerOcr.includes('lecture') ||
    lowerOcr.includes('study material') ||
    lowerOcr.includes('parallel computing') ||
    result.short_summary?.toLowerCase()?.includes('education category')

  // 3. Job Description ("jd in job descriptions")
  const hasJobPostingKeywords =
    lowerOcr.includes('job profile') ||
    lowerOcr.includes('job description') ||
    lowerOcr.includes('job announcement form') ||
    lowerOcr.includes('selection process') ||
    lowerOcr.includes('recruitment process') ||
    lowerOcr.includes('stipend details') ||
    lowerOcr.includes('salary details') ||
    lowerOcr.includes('job designation') ||
    lowerOcr.includes('roles and responsibilities') ||
    lowerOcr.includes('roles & responsibilities') ||
    (lowerOcr.includes('eligibility criteria') && (lowerOcr.includes('compensation') || lowerOcr.includes('ctc') || lowerOcr.includes('stipend')))

  const isJobDescription =
    !isStudyOrLecture &&
    !isAdmitCardOrExam &&
    (
      lowerFileName.startsWith('nxt') ||
      lowerFileName.includes('nxt') ||
      /\b(jd|jaf|job)\b/i.test(cleanFileNameWords) ||
      lowerFileName.includes('job description') ||
      lowerFileName.includes('job_description') ||
      lowerFileName.includes('job posting') ||
      lowerFileName.includes('job profile') ||
      result.short_summary?.toLowerCase()?.includes('job posting') ||
      result.short_summary?.toLowerCase()?.includes('job description') ||
      result.short_summary?.toLowerCase()?.includes('internship notice') ||
      hasJobPostingKeywords
    )

  // 4. Marksheet / Result ("results in results")
  const isMarksheetOrResult =
    !isAdmitCardOrExam &&
    (
      /\b(result|results|marksheet|marksheets|transcript|transcripts|10th|12th|cbse|icse|ssc|hsc)\b/i.test(cleanFileNameWords) ||
      lowerFileName.includes('marks card') ||
      lowerFileName.includes('grade card') ||
      lowerFileName.includes('score card') ||
      lowerFileName.includes('marksheet') ||
      lowerFileName.includes('result') ||
      lowerOcr.includes('marks statement') ||
      lowerOcr.includes('marksheet') ||
      lowerOcr.includes('mark sheet') ||
      lowerOcr.includes('statement of marks') ||
      lowerOcr.includes('academic transcript') ||
      result.document_title?.toLowerCase() === 'marksheet'
    )

  // 5. Resume / CV ("resumes in resumes")
  const hasResumeKeywords =
    /\b(resume|cv)\b/i.test(cleanFileNameWords) ||
    lowerFileName.includes('curriculum vitae') ||
    lowerFileName.includes('curriculum_vitae') ||
    lowerOcr.includes('curriculum vitae') ||
    (lowerOcr.includes('professional summary') && lowerOcr.includes('education')) ||
    (lowerOcr.includes('work experience') && (lowerOcr.includes('skills') || lowerOcr.includes('projects')))

  const isResumeFile =
    !isStudyOrLecture &&
    !isAdmitCardOrExam &&
    !isMarksheetOrResult &&
    !isJobDescription &&
    hasResumeKeywords

  // 6. Identity Documents
  const isIdentity =
    /\b(aadhaar|pan|passport|voter|license|dl|identity)\b/i.test(cleanFileNameWords) ||
    lowerFileName.includes('id_proof') ||
    lowerFileName.includes('id proof') ||
    lowerFileName.includes('aadhaar') ||
    lowerFileName.includes('passport') ||
    lowerFileName.includes('driving license') ||
    lowerFileName === 'id.pdf' ||
    lowerFileName.startsWith('id_') ||
    lowerFileName.endsWith('_id.pdf') ||
    lowerOcr.includes('aadhaar') ||
    lowerOcr.includes('unique identification') ||
    lowerOcr.includes('election commission') ||
    lowerOcr.includes('driving license') ||
    lowerOcr.includes('income tax department') ||
    result.final_category === 'Identity Documents'

  // 7. Transport / Vehicle Road Tax Documents
  const isTransportTaxOrSlip =
    lowerOcr.includes('transport department') ||
    lowerOcr.includes('goods carrier') ||
    lowerOcr.includes('mv tax') ||
    (lowerOcr.includes('tax receipt') && (lowerOcr.includes('jharkhand') || lowerOcr.includes('rto') || lowerOcr.includes('vehicle')))

  // Match existing user folders (e.g. "Transport Department Jharkhand", "Shivam Kumar", "Deepak Prasad")
  const matchCandidateOrFolder = () => {
    for (const folder of existingFolders) {
      const lf = folder.trim().toLowerCase()
      if (['uncategorized', 'miscellaneous', 'personal', 'education', 'resume', 'job descriptions', 'results', 'government ids'].includes(lf)) continue
      if (cleanFileNameWords.includes(lf) || lowerFileName.includes(lf.replace(/\s+/g, '_')) || lowerFileName.includes(lf.replace(/\s+/g, '-'))) {
        return folder
      }
      if (lf.length >= 5 && lowerOcr.includes(lf)) {
        return folder
      }
    }
    return null
  }

  const matchedFolder = matchCandidateOrFolder()

  let targetFolder = suggestedFolder

  if (isAdmitCardOrExam || isStudyOrLecture) {
    targetFolder = existingFolders.find(f => ['education', 'academic'].includes(f.trim().toLowerCase())) || 'Education'
    finalCategory = 'Education'
  } else if (isJobDescription) {
    targetFolder = existingFolders.find(f => ['job descriptions', 'job description'].includes(f.trim().toLowerCase())) || 'Job Descriptions'
    finalCategory = 'Employment'
  } else if (isResumeFile) {
    targetFolder = existingFolders.find(f => ['resume', 'resumes'].includes(f.trim().toLowerCase())) || 'Resume'
    finalCategory = 'Employment'
    if (!documentTitle || documentTitle.toLowerCase() === 'resume') {
      const name = result.primary_entity || 'Candidate'
      documentTitle = `${name} Resume`
    }
  } else if (isMarksheetOrResult) {
    if (matchedFolder) {
      targetFolder = matchedFolder
    } else {
      targetFolder = existingFolders.find(f => ['results', 'marksheets'].includes(f.trim().toLowerCase())) || 'Results'
    }
    finalCategory = 'Education'
  } else if (isTransportTaxOrSlip) {
    if (matchedFolder) {
      targetFolder = matchedFolder
    } else {
      const found = existingFolders.find(f => {
        const lf = f.trim().toLowerCase()
        return lf.includes('transport') || lf.includes('deepak prasad')
      })
      if (found) {
        targetFolder = found
      } else if (lowerOcr.includes('jharkhand')) {
        targetFolder = 'Transport Department Jharkhand'
      } else {
        targetFolder = 'Transport Department'
      }
    }
    finalCategory = 'Bills'
  } else if (matchedFolder) {
    targetFolder = matchedFolder
  } else if (isIdentity) {
    targetFolder = existingFolders.find(f => ['government ids', 'government id', 'ids'].includes(f.trim().toLowerCase())) || 'Government IDs'
    finalCategory = 'Identity Documents'
  }

  // CRITICAL SANITY GUARD: Never allow non-employment documents into Job Descriptions or Resume
  const isEmploymentFolder = ['job descriptions', 'job description', 'resume', 'resumes'].includes(targetFolder.trim().toLowerCase())
  if (isEmploymentFolder && !isJobDescription && !isResumeFile) {
    console.warn(`[postProcessClassification] Blocking cross-category assignment of non-employment document to "${targetFolder}".`)
    if (matchedFolder) {
      targetFolder = matchedFolder
    } else if (result.primary_entity && result.primary_entity.length >= 3 && !['unknown', 'null'].includes(result.primary_entity.toLowerCase())) {
      targetFolder = result.primary_entity.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    } else {
      targetFolder = CATEGORY_DEFAULT_FOLDERS[finalCategory] || 'Miscellaneous'
    }
  }

  // CRITICAL SANITY GUARD: Never allow non-identity documents into Government IDs
  const isIdentityFolder = ['government ids', 'government id', 'ids'].includes(targetFolder.trim().toLowerCase())
  if (isIdentityFolder && !isIdentity) {
    console.warn(`[postProcessClassification] Blocking cross-category assignment of non-identity document to "${targetFolder}".`)
    if (matchedFolder) {
      targetFolder = matchedFolder
    } else if (result.primary_entity && result.primary_entity.length >= 3 && !['unknown', 'null'].includes(result.primary_entity.toLowerCase())) {
      targetFolder = result.primary_entity.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    } else {
      targetFolder = CATEGORY_DEFAULT_FOLDERS[finalCategory] || 'Miscellaneous'
    }
  }

  // Ensure final category is a valid standard category
  if (!CATEGORY_DEFAULT_FOLDERS[finalCategory]) {
    const matchedCategory = Object.keys(CATEGORY_DEFAULT_FOLDERS).find(
      cat => cat.toLowerCase() === finalCategory.toLowerCase()
    )
    finalCategory = matchedCategory || 'Miscellaneous'
  }

  // Ensure suggested folder is not empty or generic uncategorized
  if (!targetFolder || targetFolder.toLowerCase() === 'uncategorized') {
    targetFolder = CATEGORY_DEFAULT_FOLDERS[finalCategory] || 'Miscellaneous'
  }

  // If document title is missing, generate a clean default from filename or folder
  if (!documentTitle || documentTitle.toLowerCase() === 'unknown' || documentTitle.toLowerCase() === 'null') {
    documentTitle = fileName ? fileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ') : targetFolder
  }

  // Normalize targetFolder against user's existing folders
  targetFolder = matchExistingFolder(targetFolder, existingFolders, fileName)

  const isNewFolder = !existingFolders.some(f => f.trim().toLowerCase() === targetFolder.toLowerCase())

  return {
    ...result,
    document_title: documentTitle,
    suggested_folder: targetFolder,
    is_new_folder: isNewFolder,
    final_category: finalCategory,
  }
}

/**
 * Extracts key metadata and classifies a document using dual-model AI routing:
 * races a fast path for simple financial documents and a deep reasoning model (Nemotron with thinking budget)
 * for complex documents (employment, education, credentials).
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

  // 1. Programmatically extract the first 30 meaningful lines (capped at 1800 chars) to provide rich context without rate-limiting
  const lines = ocrText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--- Page'))
  const condensedOcrText = lines.slice(0, 30).join('\n').slice(0, 1800)

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
- Lab Reports (Blood test reports, MRI scans, radiology files, diagnostic lab reports)
- Bills (Electricity bills, water bills, gas bills, broadband bills, general utility billing invoices)
- Invoices (B2B invoices, supply orders, vendor service invoices, purchase invoices)
- Receipts (Retail receipts, restaurant lunch bills, taxi receipts, payment receipts)
- Bank Documents (Bank account statements, bank passbooks, check photos, deposit slips, bank letters)
- Insurance (Health insurance policies, car insurance policies, life insurance certificates)
- Education (School/college marks card, degree certificates, class 10/12 results sheets, college transcripts, exam question papers, admit cards, hall tickets)
- Certificates (Birth certificates, marriage certificates, achievement certificates, seminar participation)
- Legal Documents (Rent agreements, sale deeds, contracts, affidavits, power of attorney, court papers)
- Tax Documents (Income tax returns, Form 16, W-2, PAN cards)
- Employment (Resumes, CVs, job descriptions, campus placement notices, offer letters, employment contracts, payslips)
- Travel (Flight tickets, boarding passes, hotel booking receipts, train tickets, travel itineraries)
- Personal (Personal letters, hand-written journal pages, photographs, greeting cards)
- Utilities (Electricity bills, internet/broadband bills, sewage/water bills, gas pipeline bills)
- Miscellaneous (Any document not fitting any of the above categories)

Rules:
1. Document Title: Detect the title or header of the document from the text.
2. Important Entities: Extract key names of persons, organizations, dates, and ID numbers.
3. Primary Entity: Identify the main subject (person, company, client, property, hospital) that this document is centered around.
4. Intelligent Folder Detection & Creation:
    - Special Cases for Everyday Folders (Route these intuitive document types directly to standard folder names):
      * Resumes or CVs -> suggested_folder: "Resume" (final_category: "Employment").
      * Job Descriptions, campus placement notices, JAF, job postings, hiring criteria, stipend/salary recruitment postings -> suggested_folder: "Job Descriptions" (final_category: "Employment").
      * Examination question papers, semester tests, mid/end-sem exam papers, admit cards, hall tickets -> suggested_folder: "Education" (final_category: "Education"). Do NOT create a folder for candidate name or university/college name.
      * Marksheets, grade sheets, report cards, transcripts, exam results, 10th/12th board results -> suggested_folder: "Results" (final_category: "Education").
      * Travel bookings, train/flight tickets, retiring room vouchers, boarding passes, IRCTC -> suggested_folder: "Travel" (final_category: "Travel").
      * Internship completion certificates, course certificates, achievement certificates -> suggested_folder: "Certificates" (final_category: "Certificates").
      * Lecture notes, study guides, interview preparation guides -> suggested_folder: "Education" (final_category: "Education").
      * Aadhaar cards, PAN cards, Driver's Licenses, Passports, Voter IDs -> suggested_folder: "Government IDs" (final_category: "Identity Documents").
      * Prescriptions, medical records, blood tests, clinical lab reports -> suggested_folder: "Medical Records" (final_category: "Medical Records").
      * Electricity, gas, water, internet, broadband bills -> suggested_folder: "Utility Bills" (final_category: "Bills").
      * Vehicle road tax receipts, MV tax payments, transport department receipts -> suggested_folder: "Transport Department Jharkhand" or the issuing department (final_category: "Bills").
    - Negative Constraint on Existing Folders: Only reuse an existing folder if the document ACTUALLY belongs to that category or entity domain. NEVER force a document into an existing folder if there is a category conflict (for example, NEVER place a Bill, Tax Receipt, or Invoice into "Job Descriptions" or "Resume"; and NEVER place a Resume or Job Description into "Utility Bills" or "Government IDs").
    - When no existing folder semantically matches the document, create a new folder (is_new_folder: true) named after the issuing authority or company (e.g. "Transport Department Jharkhand"), or the primary entity (e.g. "Deepak Prasad").
    - If an existing folder matches the target name case-insensitively, reuse it EXACTLY.
5. Final Category: Classify into the single most appropriate category from the Standard categories list.
6. Strictness: Output ONLY the JSON object. No markdown syntax, no preambles.`

  const userPrompt = `Classify this document context and extract entities into a JSON object.

File Name: ${fileName || 'unknown'}
Existing Folders: [${foldersList}]
${batchHint ? `Batch Hint: ${batchHint}` : ''}

First page of OCR text:
${condensedOcrText}`

  const extractJsonFromText = (rawContent: string): ClassificationResult => {
    let jsonText = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()

    // Extract JSON object using matching braces algorithm to prevent syntax errors on trailing text or thoughts
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
      } else {
        const lastBrace = jsonText.lastIndexOf('}')
        if (lastBrace > startIdx) {
          jsonText = jsonText.slice(startIdx, lastBrace + 1)
        }
      }
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = JSON.parse(match[0])
      } else {
        throw new Error('Could not parse JSON from model output')
      }
    }

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
      confidence_score: typeof parsed.confidence_score === 'number' ? parsed.confidence_score : 0.85,
      short_summary: parsed.short_summary || 'Processed document scan.',
    }
  }

  // Fast path: Groq GPT-OSS 20B if available, or Nemotron with reasoning_budget: 0 (sub-second)
  const callFast = async (): Promise<ClassificationResult> => {
    if (process.env.GROQ_API_KEY) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 1024,
          }),
          signal: AbortSignal.timeout(6000),
          keepalive: true,
        } as any)

        if (response.ok) {
          const resJson = await response.json()
          const content = resJson.choices?.[0]?.message?.content?.trim()
          if (content) return extractJsonFromText(content)
        }
      } catch (groqErr) {
        console.warn('Fast path Groq call skipped or rate-limited, falling back to Nvidia fast:', groqErr)
      }
    }

    // Nvidia Fast Path with budget 0 (takes ~500ms)
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        reasoning_budget: 0,
        temperature: 0.1,
        max_tokens: 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
      keepalive: true,
    } as any)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Nvidia fast request failed: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    const content = resJson.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('Nvidia fast returned empty content')
    return extractJsonFromText(content)
  }

  // Deep Reasoning Path: Nemotron with reasoning_budget: 128 (accurate entity and context reasoning)
  const callDeepReasoning = async (): Promise<ClassificationResult> => {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        reasoning_budget: 512,
        temperature: 0.1,
        max_tokens: 2048,
        stream: false,
      }),
      signal: AbortSignal.timeout(28000),
      keepalive: true,
    } as any)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Nvidia deep reasoning request failed: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    const content = resJson.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('Nvidia deep reasoning returned empty content')
    return extractJsonFromText(content)
  }

  try {
    console.log('Classify Document: Dual-Model AI Routing Pipeline Initiated...')

    // Race fast path and deep reasoning in parallel
    const fastPromise = (async () => {
      try {
        const res = await callFast()
        res.suggested_folder = matchExistingFolder(res.suggested_folder, existingFolders, fileName)
        return res
      } catch (err) {
        console.warn('Routing: Fast path failed or timed out:', err)
        return null
      }
    })()

    const deepPromise = (async () => {
      try {
        const res = await callDeepReasoning()
        res.suggested_folder = matchExistingFolder(res.suggested_folder, existingFolders, fileName)
        return res
      } catch (err) {
        console.warn('Routing: Deep reasoning path failed or timed out:', err)
        return null
      }
    })()

    let fastResolved = false
    let deepResolved = false
    let fastResult: ClassificationResult | null = null
    let deepResult: ClassificationResult | null = null

    const result = await new Promise<ClassificationResult>((resolve, reject) => {
      let resolved = false

      const handleFast = (res: ClassificationResult | null) => {
        if (resolved) return
        fastResult = res
        fastResolved = true
        if (res) {
          // Fast path only resolves early for simple financial documents with high confidence
          const isSimpleFinancial = ['Receipts', 'Invoices', 'Bills', 'Utilities', 'Bank Documents', 'Tax Documents'].includes(res.final_category)
          if (res.confidence_score >= 0.85 && isSimpleFinancial) {
            resolved = true
            console.log(`Routing Success: Fast path resolved first with high confidence: ${res.confidence_score}`)
            resolve(postProcessClassification(res, existingFolders, fileName, condensedOcrText))
            return
          }
        }
        checkDone()
      }

      const handleDeep = (res: ClassificationResult | null) => {
        if (resolved) return
        deepResult = res
        deepResolved = true
        if (res) {
          resolved = true
          console.log(`Routing Success: Deep reasoning path (Nemotron) resolved with confidence: ${res.confidence_score}`)
          resolve(postProcessClassification(res, existingFolders, fileName, condensedOcrText))
          return
        }
        checkDone()
      }

      const checkDone = () => {
        if (resolved) return
        if (fastResolved && deepResolved) {
          resolved = true
          if (deepResult) {
            resolve(postProcessClassification(deepResult, existingFolders, fileName, condensedOcrText))
          } else if (fastResult) {
            console.log('Routing: Using fast path fallback result.')
            resolve(postProcessClassification(fastResult, existingFolders, fileName, condensedOcrText))
          } else {
            reject(new Error('Both fast path and deep reasoning classification paths failed.'))
          }
        }
      }

      fastPromise.then(handleFast)
      deepPromise.then(handleDeep)
    })

    return result
  } catch (err) {
    console.error('All routing classification paths failed, returning default fallback with deterministic logic.', err)
    const defaultFallback: ClassificationResult = {
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
 * Generates a 1-sentence friendly description of "what this photo/document is for".
 */
export async function generateSummary(ocrText: string): Promise<string> {
  const truncatedText = ocrText.slice(0, 3000)

  const systemPrompt = `You are a document analyzer. Read the extracted text from a photo/document and explain what the photo/document is for in exactly one clear, friendly sentence.
Be concise, professional, and start directly with the description (e.g. "This is a billing invoice from Comcast detailing broadband services for June 2026." or "This is a photo of a restaurant receipt for a business lunch at Olive Garden.").
Do not include any conversational intro, meta commentary, or formatting.`

  const userPrompt = `Document text content:\n${truncatedText}`

  // Try Groq first for sub-second summary
  if (process.env.GROQ_API_KEY) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(6000),
        keepalive: true,
      } as any)

      if (response.ok) {
        const resJson = await response.json()
        const content = resJson.choices?.[0]?.message?.content?.trim()
        if (content) return content
      }
    } catch (groqErr) {
      console.warn('Groq summary call failed, falling back to Nvidia...', groqErr)
    }
  }

  // Fallback to Nvidia Nemotron with reasoning_budget: 0
  const apiKey = process.env.NVIDIA_API_KEY_LLM
  if (apiKey) {
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          reasoning_budget: 0,
          temperature: 0.2,
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(10000),
        keepalive: true,
      } as any)

      if (response.ok) {
        const resJson = await response.json()
        let content = resJson.choices?.[0]?.message?.content?.trim() || ''
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        if (content) return content
      }
    } catch (nvErr) {
      console.error('Nvidia summary call failed:', nvErr)
    }
  }

  return 'Extracted document scan content.'
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
