'use client'

import React from 'react'
import Link from 'next/link'
import { FileText, Clock, Trash2, ChevronRight } from 'lucide-react'

export interface DBDocument {
  id: string
  file_name: string
  file_type: string
  storage_path: string
  folder_id: string | null
  status: string
  ocr_text: string | null
  description: string | null
  partially_scanned: boolean
  created_at: string
  signedUrl: string | null
  thumbnailError?: boolean
}

interface DocumentRowProps {
  doc: DBDocument
  selectedIds: Set<string>
  toggleSelect: (docId: string, e: React.MouseEvent) => void
  handleDeleteDoc?: (e: React.MouseEvent, docId: string) => void
  searchQuery?: string
  folderName?: string
  snippet?: string
}

export default function DocumentRow({
  doc,
  selectedIds,
  toggleSelect,
  handleDeleteDoc,
  searchQuery = "",
  folderName,
  snippet
}: DocumentRowProps) {
  const [imgError, setImgError] = React.useState(false)
  const highlightText = (text: string, search: string) => {
    if (!search.trim()) return text
    const regex = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-indigo-500/30 text-indigo-300 px-1 py-0.5 rounded font-bold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    )
  }

  const isPdf = doc.file_type === 'application/pdf'
  const isImg = doc.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(doc.file_name)
  const fileExt = (doc.file_name.split('.').pop() || 'doc').toLowerCase()

  let badgeBg = 'bg-indigo-950/40 text-indigo-400 border-indigo-950/50'
  if (['docx', 'doc'].includes(fileExt)) badgeBg = 'bg-blue-950/40 text-blue-400 border-blue-950/50 font-bold'
  else if (['xlsx', 'xls'].includes(fileExt)) badgeBg = 'bg-emerald-950/40 text-emerald-400 border-emerald-950/50 font-bold'
  else if (['pptx', 'ppt'].includes(fileExt)) badgeBg = 'bg-orange-950/40 text-orange-400 border-orange-950/50 font-bold'
  else if (['csv'].includes(fileExt)) badgeBg = 'bg-teal-950/40 text-teal-400 border-teal-950/50 font-bold'
  else if (['txt'].includes(fileExt)) badgeBg = 'bg-zinc-800/40 text-zinc-400 border-zinc-700/50 font-semibold'
  else if (isPdf) badgeBg = 'bg-rose-950/40 text-rose-400 border-rose-950/50 font-bold'
  else if (isImg) badgeBg = 'bg-purple-950/40 text-purple-400 border-purple-950/50 font-bold'

  // Extract page count
  let pageCount: number | null = null
  if (doc.description) {
    try {
      const parsed = JSON.parse(doc.description)
      if (typeof parsed.page_count === 'number') {
        pageCount = parsed.page_count
      }
    } catch (e) {
      // ignore
    }
  }
  // Fallback: estimate page count from ocr_text for legacy PDFs
  if (pageCount === null && isPdf && doc.ocr_text) {
    const matches = doc.ocr_text.match(/--- Page \d+ ---/g)
    if (matches) {
      pageCount = matches.length
    }
  }

  // Find page matching the search query
  const findPageForSearchQuery = (ocrText: string | null, query: string): number | null => {
    if (!ocrText || !query.trim()) return null
    const lowerQuery = query.toLowerCase()
    
    // Extract page numbers and content segments
    const pageHeaderRegex = /--- Page (\d+) ---/g
    const pageNumbers: number[] = []
    let match
    while ((match = pageHeaderRegex.exec(ocrText)) !== null) {
      pageNumbers.push(parseInt(match[1], 10))
    }

    if (pageNumbers.length === 0) return null

    const segments = ocrText.split(/--- Page \d+ ---/)
    const offset = ocrText.trim().startsWith('--- Page') ? 1 : 0

    for (let i = 0; i < pageNumbers.length; i++) {
      const segmentIndex = i + offset
      const segmentText = segments[segmentIndex] || ''
      if (segmentText.toLowerCase().includes(lowerQuery)) {
        return pageNumbers[i]
      }
    }

    return null
  }

  const matchedPage = searchQuery && doc.ocr_text ? findPageForSearchQuery(doc.ocr_text, searchQuery) : null
  const linkHref = searchQuery
    ? `/dashboard/document/${doc.id}?search=${encodeURIComponent(searchQuery)}${matchedPage ? `&page=${matchedPage}` : ''}`
    : `/dashboard/document/${doc.id}`

  return (
    <Link
      href={linkHref}
      onClick={() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('app-loading-start', {
            detail: { title: 'Loading', subtitle: 'Decrypting secure document contents...' }
          }))
        }
      }}
      className="group flex items-center justify-between p-4 hover:bg-zinc-900/30 transition-all duration-200 ease-out gap-4 animate-fade-in"
    >
      <div className="flex items-center space-x-4 min-w-0 flex-1">
        {/* Checkbox Select */}
        <div
          onClick={(e) => toggleSelect(doc.id, e)}
          className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
            selectedIds.has(doc.id)
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'border-zinc-800 bg-zinc-950 hover:border-zinc-650'
          }`}
        >
          {selectedIds.has(doc.id) && (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {doc.signedUrl && !doc.thumbnailError && !imgError ? (
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex-shrink-0 relative group-hover:border-indigo-500/20 transition-all flex items-center justify-center">
            <img
              src={doc.signedUrl}
              alt={doc.file_name}
              className="w-full h-full object-cover"
              loading="eager"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div className={`w-10 h-10 rounded-lg border ${badgeBg} flex-shrink-0 flex items-center justify-center text-[10px] tracking-wider uppercase`}>
            {fileExt}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-zinc-200 font-semibold truncate group-hover:text-white transition-colors">
            {highlightText(doc.file_name, searchQuery)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
            {folderName ? (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                {folderName}
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-850 text-zinc-400">
                {fileExt.toUpperCase()}
              </span>
            )}
            {pageCount !== null && (
              <>
                <span className="text-zinc-700">•</span>
                <span className="inline-flex items-center text-[10px] text-indigo-400 bg-indigo-950/20 border border-indigo-950 px-1.5 py-0.5 rounded font-semibold">
                  {pageCount} {
                    ['pptx', 'ppt'].includes(fileExt)
                      ? (pageCount === 1 ? 'slide' : 'slides')
                      : ['xlsx', 'xls'].includes(fileExt)
                      ? (pageCount === 1 ? 'sheet' : 'sheets')
                      : ['csv'].includes(fileExt)
                      ? (pageCount === 1 ? 'row' : 'rows')
                      : (pageCount === 1 ? 'page' : 'pages')
                  }
                </span>
              </>
            )}
            <span className="text-zinc-700">•</span>
            <div className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5 text-zinc-650" />
              <span>{new Date(doc.created_at).toLocaleDateString()}</span>
            </div>
            {doc.partially_scanned && (
              <>
                <span className="text-zinc-700 text-xs hidden sm:inline">•</span>
                <span className="inline-flex items-center text-[10px] text-amber-500 bg-amber-950/20 border border-amber-950 px-1.5 py-0.5 rounded font-semibold">
                  Partially Scanned
                </span>
              </>
            )}
            {snippet && (
              <>
                <span className="text-zinc-700 hidden sm:inline">•</span>
                <span className="italic text-[11px] text-zinc-400 max-w-[350px] truncate hidden sm:inline">
                  {highlightText(snippet, searchQuery)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status Badge & Actions */}
      <div className="flex items-center space-x-3 flex-shrink-0">
        <span
          className={`inline-flex items-center text-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full font-semibold border ${
            doc.status === 'done'
              ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30'
              : doc.status === 'failed'
              ? 'bg-red-950/20 text-red-400 border-red-900/30'
              : 'bg-indigo-950/20 text-indigo-400 border-indigo-900/30 animate-pulse'
          }`}
        >
          <span className="hidden sm:inline">
            {doc.status === 'done' && 'Ready'}
            {doc.status === 'failed' && 'Failed'}
            {doc.status === 'processing' && 'Processing'}
          </span>
          <span className="inline sm:hidden">
            {doc.status === 'done' && '✓'}
            {doc.status === 'failed' && '✗'}
            {doc.status === 'processing' && '...'}
          </span>
        </span>
        
        {handleDeleteDoc && (
          <button
            onClick={(e) => handleDeleteDoc(e, doc.id)}
            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 border border-transparent hover:border-red-900/30 rounded-lg transition-all cursor-pointer flex-shrink-0"
            title="Delete Document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        
        <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-1 transition-transform duration-300 ease-out hidden sm:block flex-shrink-0" />
      </div>
    </Link>
  )
}
