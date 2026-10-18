'use client'

import React, { useState, useCallback } from 'react'
import { Sparkles, Loader2, ChevronRight, Zap, RefreshCw } from 'lucide-react'
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
}

interface SemanticSearchProps {
  isActive: boolean
  query: string
  onToggle: () => void
  onSelectQuery?: (q: string) => void
}

export default function SemanticSearch({ isActive, query, onToggle, onSelectQuery }: SemanticSearchProps) {
  const [results, setResults] = useState<SemanticResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState('')

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
      setLastQuery(searchQuery)
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
      setLastQuery('')
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
    <div className="animate-fade-in">
      {/* Results header */}
      <div className="flex items-center justify-between mb-4 border-b border-zinc-800/60 pb-3">
        <div className="flex items-center space-x-3">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            AI Semantic Search Results
          </h2>
          <span className="text-xs text-zinc-500 hidden sm:inline">for &ldquo;{query}&rdquo;</span>
        </div>
        <div className="flex items-center space-x-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
          <span className="text-xs bg-violet-950/40 text-violet-300 border border-violet-800/50 font-semibold px-2.5 py-1 rounded-full">
            {loading ? 'Searching meaning...' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
          </span>
          <button
            onClick={() => performSearch(query)}
            disabled={loading}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Refresh search"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl mb-4 animate-fade-in">
          <p className="text-xs text-red-400 font-medium">{error}</p>
          <p className="text-[10px] text-red-500/70 mt-1">
            Tip: Documents are automatically indexed in the background. If this persists, please try refreshing the search.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500 bg-zinc-900/10 border border-zinc-850 rounded-2xl">
          <Sparkles className="w-8 h-8 text-violet-400/40 mb-3" />
          <p className="font-semibold text-zinc-300 text-sm">No semantic matches found for &ldquo;{query}&rdquo;</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm">
            Try searching for related keywords or questions, or switch back to standard keyword search.
          </p>
          {onSelectQuery && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <span className="text-[11px] text-zinc-500">Suggestions:</span>
              {['resume', 'application', 'booking', 'voucher'].map((s) => (
                <button
                  key={s}
                  onClick={() => onSelectQuery(s)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl overflow-hidden divide-y divide-zinc-900">
          {results.map((result, idx) => {
            const ext = getFileExt(result.fileName)
            const badgeColor = getBadgeColor(ext)

            return (
              <Link
                key={`${result.documentId}-${idx}`}
                href={
                  result.pageNumber
                    ? `/dashboard/document/${result.documentId}?page=${result.pageNumber}`
                    : `/dashboard/document/${result.documentId}`
                }
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('app-loading-start', {
                      detail: { title: 'Loading', subtitle: 'Opening document...' }
                    }))
                  }
                }}
                className="group flex items-center justify-between p-4 hover:bg-zinc-900/40 transition-all duration-200 ease-out gap-4 animate-fade-in"
              >
                <div className="flex items-center space-x-4 min-w-0 flex-1">
                  {/* File type badge */}
                  <div className={`w-10 h-10 rounded-lg border ${badgeColor} flex-shrink-0 flex items-center justify-center text-[10px] tracking-wider uppercase font-bold`}>
                    {ext}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-200 font-semibold truncate group-hover:text-white transition-colors">
                      {result.fileName}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                      {result.folderName && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-400">
                          {result.folderName}
                        </span>
                      )}
                      {result.pageNumber && (
                        <>
                          <span className="text-zinc-700">•</span>
                          <span className="text-[10px] text-indigo-400 font-semibold">
                            Page {result.pageNumber}
                          </span>
                        </>
                      )}
                      {result.section && (
                        <>
                          <span className="text-zinc-700">•</span>
                          <span className="text-[10px] text-indigo-400 font-semibold">
                            {result.section}
                          </span>
                        </>
                      )}
                      <span className="text-zinc-700">•</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 font-semibold">
                        <Zap className="w-3 h-3" />
                        {Math.round(result.similarity * 100)}% match
                      </span>
                    </div>
                    {/* Snippet */}
                    <p className="text-[11px] text-zinc-400 mt-1.5 line-clamp-2 hidden sm:block font-mono bg-zinc-900/40 p-2 rounded-lg border border-zinc-800/40">
                      {result.snippet}
                    </p>
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-1 transition-transform duration-300 ease-out hidden sm:block flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      )}

      {/* Privacy notice */}
      <p className="text-[10px] text-zinc-600 mt-3 text-center">
        Semantic search understands meaning across all your documents powered by Cloudflare Workers AI.
      </p>
    </div>
  )
}
