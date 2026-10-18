'use client'

import React, { useState, useCallback } from 'react'
import { Sparkles, Loader2, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface SemanticResult {
  documentId: string
  fileName: string
  fileType: string
  snippet: string
  pageNumber: number | null
  section: string | null
  similarity: number
  folderName: string
  createdAt: string
  signedUrl?: string | null
}

interface SemanticSearchProps {
  isActive: boolean
  query: string
  onToggle: () => void
  onSelectQuery?: (q: string) => void
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'what', 'where', 'who', 'how',
  'find', 'show', 'get', 'search', 'me', 'my', 'all', 'please'
])

/**
 * Strips internal OCR page delimiters and markdown symbols from snippet text
 */
function cleanSnippetText(text: string): string {
  if (!text) return ''
  return text
    .replace(/---+\s*(?:Page\s*\d+|Sheet:\s*[^-\n]+)\s*---+/gi, ' ')
    .replace(/(?:^|\n)\s*[-=_]{3,}\s*(?:\n|$)/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Highlights matched query keywords with elegant indigo theme marks
 */
function highlightKeywords(text: string, query: string): React.ReactNode {
  if (!text || !query.trim()) return text

  const rawTerms = query
    .trim()
    .toLowerCase()
    .split(/[\s,.;:!?/\\(){}[\]"']+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))

  const terms = rawTerms.length > 0 
    ? rawTerms 
    : query.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2)

  if (terms.length === 0) return text

  // Escape special regex characters
  const escapedTerms = terms.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'))
  const pattern = new RegExp(`(${escapedTerms.join('|')})`, 'gi')

  const parts = text.split(pattern)

  return (
    <span>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark
            key={i}
            className="bg-indigo-500/25 text-indigo-300 px-1 py-0.5 rounded font-medium border border-indigo-500/30"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  )
}

export default function SemanticSearch({ isActive, query, onToggle, onSelectQuery }: SemanticSearchProps) {
  const [results, setResults] = useState<SemanticResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set())

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setResults([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), limit: 15 }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || data.details || 'Search failed')
      }

      const data = await response.json()
      setResults(data.results || [])
    } catch (err: any) {
      setError(err.message || 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Trigger search when query changes and semantic mode is active
  React.useEffect(() => {
    if (!isActive || !query.trim()) {
      return
    }

    const debounce = setTimeout(() => {
      performSearch(query)
    }, 250)

    return () => clearTimeout(debounce)
  }, [query, isActive, performSearch])

  // Clear results when switching modes
  React.useEffect(() => {
    if (!isActive) {
      setResults([])
      setError(null)
    }
  }, [isActive])

  const getFileExt = (fileName: string) => (fileName.split('.').pop() || 'doc').toLowerCase()

  const getBadgeColor = (ext: string) => {
    if (['docx', 'doc'].includes(ext)) return 'bg-blue-950/40 text-blue-400 border-blue-950/50'
    if (['xlsx', 'xls'].includes(ext)) return 'bg-emerald-950/40 text-emerald-400 border-emerald-950/50'
    if (['pptx', 'ppt'].includes(ext)) return 'bg-orange-950/40 text-orange-400 border-orange-950/50'
    if (['csv'].includes(ext)) return 'bg-teal-950/40 text-teal-400 border-teal-950/50'
    if (['txt'].includes(ext)) return 'bg-zinc-800/40 text-zinc-400 border-zinc-700/50'
    if (ext === 'pdf') return 'bg-rose-950/40 text-rose-400 border-rose-950/50'
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'bg-purple-950/40 text-purple-400 border-purple-950/50'
    return 'bg-indigo-950/40 text-indigo-400 border-indigo-950/50'
  }

  if (!isActive || !query.trim()) return null

  return (
    <div className="animate-fade-in w-full">
      {/* Sleek Results header */}
      <div className="flex items-center justify-between mb-3 border-b border-zinc-850 pb-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-indigo-500/20">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 truncate">
            AI Semantic Search Results
          </h2>
          <span className="text-xs text-zinc-500 hidden md:inline truncate">for &ldquo;{query}&rdquo;</span>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
          <span className="text-xs bg-indigo-950/40 text-indigo-300 border border-indigo-800/50 font-medium px-2.5 py-0.5 rounded-full shadow-sm shadow-indigo-950/30">
            {loading ? 'Searching meaning...' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </span>
          <button
            onClick={() => performSearch(query)}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-transparent hover:border-zinc-700/50 cursor-pointer"
            title="Refresh search"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl mb-4 animate-fade-in flex items-start space-x-3">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-red-400 font-medium">{error}</p>
            <p className="text-[10px] text-red-500/70 mt-1">
              Tip: Documents are automatically analyzed and indexed. If this persists, please try refreshing the search.
            </p>
          </div>
        </div>
      )}

      {/* Empty state (Not Found) */}
      {!loading && !error && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-10 sm:py-14 text-center text-zinc-500 bg-zinc-900/10 border border-zinc-850 rounded-2xl px-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500/15 to-violet-600/15 border border-indigo-500/30 flex items-center justify-center mb-3 shadow-md shadow-indigo-500/10">
            <Sparkles className="w-6 h-6 text-indigo-400" />
          </div>
          <p className="font-semibold text-zinc-200 text-sm">No documents found matching &ldquo;{query}&rdquo;</p>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm leading-relaxed">
            No relevant content matched your query with sufficient confidence. Try describing the document differently or switch back to keyword search.
          </p>
          {onSelectQuery && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mt-4 max-w-md">
              <span className="text-[11px] text-zinc-500 font-medium w-full mb-1">Suggestions:</span>
              {['resume', 'application', 'booking', 'voucher'].map((s) => (
                <button
                  key={s}
                  onClick={() => onSelectQuery(s)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-850 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results List */}
      {results.length > 0 && (
        <div className="bg-zinc-900/20 backdrop-blur-sm border border-zinc-850 rounded-2xl overflow-hidden divide-y divide-zinc-850/60 shadow-xl shadow-black/20">
          {results.map((result, idx) => {
            const ext = getFileExt(result.fileName)
            const badgeColor = getBadgeColor(ext)
            const cleanSnippet = cleanSnippetText(result.snippet)
            const isImg = ['png', 'jpg', 'jpeg', 'webp'].includes(ext)

            const linkHref = result.pageNumber
              ? `/dashboard/document/${result.documentId}?page=${result.pageNumber}&search=${encodeURIComponent(query)}`
              : `/dashboard/document/${result.documentId}?search=${encodeURIComponent(query)}`

            return (
              <Link
                key={`${result.documentId}-${idx}`}
                href={linkHref}
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('app-loading-start', {
                        detail: { title: 'Loading', subtitle: 'Opening document...' },
                      })
                    )
                  }
                }}
                className="group flex items-start sm:items-center justify-between p-3.5 sm:p-4 hover:bg-zinc-900/40 transition-all duration-200 ease-out gap-3 sm:gap-4 animate-fade-in"
              >
                <div className="flex items-start sm:items-center space-x-3 sm:space-x-3.5 min-w-0 flex-1">
                  {/* File type badge / thumbnail */}
                  {result.signedUrl && isImg && !imgErrors.has(result.documentId) ? (
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex-shrink-0 relative group-hover:border-indigo-500/30 transition-all flex items-center justify-center mt-0.5 sm:mt-0">
                      <img
                        src={result.signedUrl}
                        alt={result.fileName}
                        className="w-full h-full object-cover"
                        loading="eager"
                        onError={() => {
                          setImgErrors(prev => new Set(prev).add(result.documentId))
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg border ${badgeColor} flex-shrink-0 flex items-center justify-center text-[10px] tracking-wider uppercase font-bold mt-0.5 sm:mt-0`}
                    >
                      {ext}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {/* Document Title */}
                    <div className="flex items-center space-x-2">
                      <p className="text-zinc-200 font-semibold text-xs sm:text-sm group-hover:text-white transition-colors truncate">
                        {highlightKeywords(result.fileName, query)}
                      </p>
                    </div>

                    {/* Metadata Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1 text-xs">
                      {result.folderName && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900/90 px-1.5 sm:px-2 py-0.5 rounded border border-zinc-800 text-zinc-400">
                          {result.folderName}
                        </span>
                      )}
                      {result.pageNumber && (
                        <span className="inline-flex items-center text-[10px] text-indigo-400 bg-indigo-950/30 border border-indigo-900/50 px-1.5 sm:px-2 py-0.5 rounded font-medium">
                          Page {result.pageNumber}
                        </span>
                      )}
                      {result.section && (
                        <span className="inline-flex items-center text-[10px] text-indigo-400 bg-indigo-950/30 border border-indigo-900/50 px-1.5 sm:px-2 py-0.5 rounded font-medium">
                          {result.section}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 px-2 sm:px-2.5 py-0.5 rounded-full shadow-sm shadow-indigo-950/30">
                        <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                        {Math.round(result.similarity * 100)}% match
                      </span>
                    </div>

                    {/* Refined Excerpt */}
                    {cleanSnippet && (
                      <div className="mt-1.5 sm:mt-2 pl-2.5 sm:pl-3 border-l-2 border-indigo-500/40 group-hover:border-indigo-400 transition-colors">
                        <p className="text-[11px] sm:text-xs text-zinc-400 group-hover:text-zinc-300 leading-relaxed line-clamp-2">
                          {highlightKeywords(cleanSnippet, query)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Arrow */}
                <div className="flex items-center flex-shrink-0 self-center">
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-700 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all duration-300 ease-out flex-shrink-0" />
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Footer notice (No vendor branding) */}
      <p className="text-[11px] text-zinc-600 mt-3 text-center">
        AI semantic search understands meaning across all your documents.
      </p>
    </div>
  )
}
