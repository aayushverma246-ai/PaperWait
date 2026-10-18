'use client'

import React, { useState, useCallback } from 'react'
import { Search, Sparkles, Loader2, FileText, ChevronRight, Zap } from 'lucide-react'
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
}

export default function SemanticSearch({ isActive, query, onToggle }: SemanticSearchProps) {
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
      if (query !== lastQuery) {
        performSearch(query)
      }
    }, 500)

    return () => clearTimeout(debounce)
  }, [query, isActive, lastQuery, performSearch])

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
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            AI Search Results
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
          <span className="text-xs bg-violet-950/40 text-violet-400 border border-violet-950/50 font-semibold px-2.5 py-1 rounded-full">
            {loading ? 'Searching...' : `${results.length} results`}
          </span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl mb-4 animate-fade-in">
          <p className="text-xs text-red-400 font-medium">{error}</p>
          <p className="text-[10px] text-red-500/70 mt-1">
            Tip: Make sure your documents are indexed. Check the AI Chat panel for indexing status.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && results.length === 0 && query.trim() && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-500 bg-zinc-900/10 border border-zinc-850 rounded-2xl">
          <Sparkles className="w-10 h-10 text-zinc-800 mb-3" />
          <p className="font-semibold text-zinc-400">No semantic matches found</p>
          <p className="text-xs text-zinc-600 mt-1 max-w-xs">
            Try rephrasing your query or switch to keyword search. Make sure documents are indexed.
          </p>
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
                      detail: { title: 'Loading', subtitle: 'Decrypting secure document contents...' }
                    }))
                  }
                }}
                className="group flex items-center justify-between p-4 hover:bg-zinc-900/30 transition-all duration-200 ease-out gap-4 animate-fade-in"
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
                        <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
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
                    <p className="text-[11px] text-zinc-500 mt-1.5 line-clamp-2 hidden sm:block">
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
        Semantic search uses Cloudflare AI to understand meaning. Your query text is sent to Cloudflare Workers AI for processing.
      </p>
    </div>
  )
}
