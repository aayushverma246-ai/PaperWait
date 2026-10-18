'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  FileText,
  RefreshCw,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Database,
  ArrowRight,
  Trash2,
  Bot,
  User as UserIcon,
} from 'lucide-react'

interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    documentId: string
    fileName: string
    pageNumber: number | null
  }>
  error?: boolean
  createdAt?: string
}

interface IndexStatus {
  total: number
  indexed: number
  pending: number
  failed: number
  indexing: number
  isFullyIndexed: boolean
}

export default function DocumentChat() {
  const supabase = createClient()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [indexing, setIndexing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Hydrate authenticated user and persistent chat history
  useEffect(() => {
    let active = true

    async function loadUserAndChatHistory() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || !active) return

        const uid = user.id
        setUserId(uid)

        // 1. Instantly hydrate from localStorage for 0ms load time
        const localCache = localStorage.getItem(`paperwait_chat_history_${uid}`)
        if (localCache) {
          try {
            const parsed = JSON.parse(localCache)
            if (Array.isArray(parsed) && parsed.length > 0 && active) {
              setMessages(parsed)
            }
          } catch (e) {
            // ignore corrupted cache
          }
        }

        // 2. Fetch from Supabase database to sync across devices/sessions
        try {
          const res = await fetch('/api/ai/chat/history')
          if (res.ok) {
            const data = await res.json()
            if (data?.messages && Array.isArray(data.messages) && data.messages.length > 0 && active) {
              setMessages(data.messages)
              localStorage.setItem(`paperwait_chat_history_${uid}`, JSON.stringify(data.messages))
            }
          }
        } catch (e) {
          // graceful fallback to local cache
        }
      } catch (err) {
        console.warn('Failed to load user chat history:', err)
      }
    }

    loadUserAndChatHistory()

    return () => {
      active = false
    }
  }, [supabase])

  // Fetch index status when chat opens
  const fetchIndexStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/index-status')
      if (res.ok) {
        const data = await res.json()
        setIndexStatus(data)
      }
    } catch (e) {
      // Silently fail — index status is non-critical
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchIndexStatus()
      inputRef.current?.focus()
    }
  }, [isOpen, fetchIndexStatus])

  useEffect(() => {
    if (isOpen && indexStatus && !indexStatus.isFullyIndexed && indexStatus.total > 0 && !indexing) {
      handleIndexDocuments()
    }
  }, [isOpen, indexStatus?.isFullyIndexed, indexing])

  const handleIndexDocuments = async () => {
    setIndexing(true)
    try {
      const res = await fetch('/api/ai/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.remaining > 0) {
          // More documents to index — schedule another batch
          setTimeout(handleIndexDocuments, 1000)
          return
        }
      }
      await fetchIndexStatus()
    } catch (e) {
      console.error('Indexing failed:', e)
    } finally {
      setIndexing(false)
    }
  }

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    if (userId) {
      localStorage.setItem(`paperwait_chat_history_${userId}`, JSON.stringify(updatedMessages))
    }
    setInput('')
    setLoading(true)

    try {
      // Build history from previous messages (bounded)
      const history = updatedMessages
        .slice(-7, -1) // Last 6 messages before current
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to get response')
      }

      const data = await res.json()
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources || [],
      }
      setMessages(prev => {
        const next = [...prev, assistantMessage]
        if (userId) {
          localStorage.setItem(`paperwait_chat_history_${userId}`, JSON.stringify(next))
        }
        return next
      })
    } catch (err: any) {
      setMessages(prev => {
        const next: ChatMessage[] = [...prev, {
          role: 'assistant',
          content: err.message || 'Something went wrong. Please try again.',
          error: true,
        }]
        if (userId) {
          localStorage.setItem(`paperwait_chat_history_${userId}`, JSON.stringify(next))
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = async () => {
    setMessages([])
    setInput('')
    if (userId) {
      localStorage.removeItem(`paperwait_chat_history_${userId}`)
    }
    try {
      await fetch('/api/ai/chat/history', { method: 'DELETE' })
    } catch (err) {
      console.warn('Failed to clear server chat history:', err)
    }
  }

  const exampleQuestions = [
    'Summarize all my documents',
    'Find my electricity bills',
    'What documents mention insurance?',
    'Compare my recent invoices',
    'Find warranty information',
  ]

  // ---------- Render ----------

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ease-out cursor-pointer shadow-xl ${
          isOpen
            ? 'hidden sm:flex bg-zinc-800 border border-zinc-700 hover:bg-zinc-750 shadow-zinc-900/50'
            : 'flex bg-gradient-to-tr from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:scale-105'
        }`}
        title={isOpen ? 'Close AI Chat' : 'Open AI Chat'}
      >
        {isOpen ? (
          <X className="w-5 h-5 text-zinc-300" />
        ) : (
          <MessageSquare className="w-5 h-5 text-white" />
        )}
      </button>

      {/* Chat Panel - Full responsive bottom sheet on mobile, floating card on desktop */}
      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-24 sm:right-6 z-50 w-full sm:w-[460px] h-[92vh] sm:h-[min(640px,calc(100vh-7rem))] bg-zinc-950 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden animate-scale-up">
          {/* Mobile Sheet Drag Indicator */}
          <div className="w-10 h-1 bg-zinc-700/80 rounded-full mx-auto mt-2 mb-0.5 sm:hidden flex-shrink-0" />

          {/* Header with Official PaperWait Logo */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20 flex-shrink-0">
                <FileText className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">PaperWait AI</h3>
                <p className="text-[10px] text-zinc-500 font-medium">Ask about your documents</p>
              </div>
            </div>
            <div className="flex items-center space-x-1.5">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
                  title="New Chat / Clear History"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
                title="Close Chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Index Status Banner */}
          {indexStatus && !indexStatus.isFullyIndexed && indexStatus.total > 0 && (
            <div className="px-4 py-2.5 bg-amber-950/20 border-b border-amber-900/30 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center space-x-2 min-w-0">
                <Database className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-[10px] text-amber-400 font-semibold truncate">
                  {indexing ? 'Auto-indexing documents...' : `${indexStatus.indexed}/${indexStatus.total} docs indexed`}
                </span>
              </div>
              <button
                onClick={handleIndexDocuments}
                disabled={indexing}
                className="flex items-center space-x-1 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50 flex-shrink-0"
              >
                {indexing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                <span>{indexing ? 'Syncing...' : 'Sync Index'}</span>
              </button>
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            {messages.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-violet-600/20 border border-indigo-500/30 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/10">
                  <FileText className="w-7 h-7 text-indigo-400" />
                </div>
                <h4 className="text-sm font-bold text-zinc-300 mb-1">Ask about your documents</h4>
                <p className="text-[11px] text-zinc-500 max-w-[280px] mb-6 leading-relaxed">
                  I can search through your uploaded documents and answer questions about their contents.
                </p>

                <div className="w-full space-y-2">
                  <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2">Try asking</p>
                  {exampleQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(q)
                        inputRef.current?.focus()
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-900/50 border border-zinc-850 rounded-xl text-left text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 hover:border-zinc-750 transition-all cursor-pointer group"
                    >
                      <span className="truncate">{q}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-indigo-400 transition-colors flex-shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message bubbles */
              messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`${msg.role === 'user' ? 'max-w-[88%] sm:max-w-[85%] order-2' : 'max-w-[96%] order-1'}`}>
                    {/* Message bubble */}
                    <div className={`px-4 py-3 rounded-2xl text-xs sm:text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                        : msg.error
                          ? 'bg-red-950/30 border border-red-900/30 text-red-300 rounded-bl-md'
                          : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-md shadow-sm'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="text-xs sm:text-[13px] leading-relaxed text-zinc-200">
                          {formatMarkdown(msg.content)}
                        </div>
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>

                    {/* Source references */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[9px] text-zinc-600 font-semibold uppercase tracking-wider px-1">
                          Sources
                        </p>
                        {msg.sources.map((source, si) => (
                          <Link
                            key={si}
                            href={
                              source.pageNumber
                                ? `/dashboard/document/${source.documentId}?page=${source.pageNumber}`
                                : `/dashboard/document/${source.documentId}`
                            }
                            className="flex items-center space-x-2 px-2.5 py-1.5 bg-zinc-900/50 border border-zinc-850 rounded-lg hover:bg-zinc-900 hover:border-zinc-750 transition-all group"
                            onClick={() => {
                              if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('app-loading-start', {
                                  detail: { title: 'Loading', subtitle: 'Decrypting secure document contents...' }
                                }))
                              }
                            }}
                          >
                            <FileText className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200 truncate transition-colors">
                              {source.fileName}
                              {source.pageNumber ? ` (p.${source.pageNumber})` : ''}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-2xl rounded-bl-md">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span className="text-xs text-zinc-500 font-medium">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area - Mobile optimized */}
          <div className="flex-shrink-0 border-t border-zinc-800/80 bg-zinc-900/70 p-3 pb-5 sm:pb-3">
            <div className="flex items-end space-x-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your documents..."
                rows={1}
                className="flex-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-zinc-100 placeholder-zinc-600 text-base sm:text-sm rounded-xl px-3.5 py-2.5 resize-none transition-all max-h-[100px] overflow-y-auto"
                style={{ minHeight: '42px' }}
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-11 h-11 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all cursor-pointer shadow-md shadow-indigo-500/20"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Send className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Elegant markdown-to-JSX formatter for assistant messages.
 * Beautifully formats tables, headings, lists, blockquotes, code blocks,
 * and inline elements (bold, italic, code, document citations).
 */
function formatMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 1. Skip completely empty lines
    if (!trimmed) {
      elements.push(<div key={`space-${i}`} className="h-1.5" />)
      i++
      continue
    }

    // 2. Markdown Table Detection
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
      const tableLines: string[] = []
      let j = i
      while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
        tableLines.push(lines[j].trim())
        j++
      }

      if (tableLines.length >= 2) {
        // Table found!
        const parseRow = (rowStr: string) => {
          const inner = rowStr.replace(/^\|/, '').replace(/\|$/, '')
          return inner.split('|').map(c => c.trim())
        }

        const headers = parseRow(tableLines[0])
        const separator = tableLines[1]
        const isSep = /^\|[\s\-:|]+\|$/.test(separator)

        if (isSep) {
          const rows = tableLines.slice(2).map(parseRow)

          elements.push(
            <div
              key={`table-${i}`}
              className="my-3 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/70 shadow-md scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-900/90 border-b border-zinc-800">
                    {headers.map((h, hi) => (
                      <th
                        key={hi}
                        className="px-3.5 py-2.5 text-zinc-300 font-semibold tracking-wider uppercase text-[10px] whitespace-nowrap bg-zinc-900/90"
                      >
                        {processInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="hover:bg-zinc-900/50 transition-colors even:bg-zinc-950/30"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3.5 py-2 text-zinc-300 whitespace-nowrap font-normal"
                        >
                          {processInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )

          i = j
          continue
        }
      }
    }

    // 3. Fenced Code Block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith('```')) {
        codeLines.push(lines[j])
        j++
      }
      elements.push(
        <div key={`code-${i}`} className="my-2.5 rounded-xl border border-zinc-800 bg-zinc-950 p-3 overflow-x-auto font-mono text-xs text-indigo-300">
          <pre><code>{codeLines.join('\n')}</code></pre>
        </div>
      )
      i = j < lines.length ? j + 1 : j
      continue
    }

    // 4. Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-[13px] font-bold text-zinc-100 mt-3 mb-1 flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block flex-shrink-0" />
          <span>{processInline(trimmed.substring(4))}</span>
        </h3>
      )
      i++
      continue
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-sm font-bold text-zinc-100 mt-3.5 mb-1.5 pb-1 border-b border-zinc-800/60">
          {processInline(trimmed.substring(3))}
        </h2>
      )
      i++
      continue
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-base font-bold text-white mt-4 mb-2 pb-1 border-b border-zinc-800">
          {processInline(trimmed.substring(2))}
        </h1>
      )
      i++
      continue
    }

    // 5. Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote key={`quote-${i}`} className="border-l-2 border-indigo-500 pl-3 py-1 my-2 bg-indigo-950/20 rounded-r-lg text-zinc-300 italic text-xs">
          {processInline(trimmed.substring(2))}
        </blockquote>
      )
      i++
      continue
    }

    // 6. Horizontal Rule
    if (trimmed === '---' || trimmed === '***') {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-zinc-800" />)
      i++
      continue
    }

    // 7. Numbered List
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/)
    if (numMatch) {
      elements.push(
        <div key={`num-${i}`} className="flex items-start space-x-2 my-1 ml-0.5">
          <span className="text-[11px] font-bold text-indigo-400 flex-shrink-0 min-w-[1.2rem] mt-0.5">
            {numMatch[1]}.
          </span>
          <span className="text-zinc-200 text-[13px] leading-relaxed flex-1">
            {processInline(numMatch[2])}
          </span>
        </div>
      )
      i++
      continue
    }

    // 8. Bullet List
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      const content = trimmed.replace(/^[-•*]\s+/, '')
      elements.push(
        <div key={`bullet-${i}`} className="flex items-start space-x-2 my-1 ml-0.5">
          <span className="text-violet-400 flex-shrink-0 mt-1 text-xs leading-none">•</span>
          <span className="text-zinc-200 text-[13px] leading-relaxed flex-1">
            {processInline(content)}
          </span>
        </div>
      )
      i++
      continue
    }

    // 9. Standard Paragraph
    elements.push(
      <p key={`p-${i}`} className="my-1 text-zinc-200 text-[13px] leading-relaxed">
        {processInline(line)}
      </p>
    )
    i++
  }

  return <>{elements}</>
}

function processInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let keyCounter = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+?)\*(?!\*)/)
    const codeMatch = remaining.match(/`(.+?)`/)
    const docMatch = remaining.match(/\[Document:\s*(.+?)\]/)

    const matches = [
      boldMatch ? { type: 'bold', match: boldMatch } : null,
      italicMatch ? { type: 'italic', match: italicMatch } : null,
      codeMatch ? { type: 'code', match: codeMatch } : null,
      docMatch ? { type: 'doc', match: docMatch } : null,
    ]
      .filter(Boolean)
      .sort((a, b) => (a!.match.index || 0) - (b!.match.index || 0))

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    const first = matches[0]!
    const idx = first.match.index || 0

    if (idx > 0) {
      parts.push(remaining.substring(0, idx))
    }

    if (first.type === 'bold') {
      parts.push(
        <strong key={`b-${keyCounter++}`} className="text-zinc-100 font-semibold">
          {first.match[1]}
        </strong>
      )
    } else if (first.type === 'italic') {
      parts.push(
        <em key={`i-${keyCounter++}`} className="text-zinc-300 italic">
          {first.match[1]}
        </em>
      )
    } else if (first.type === 'code') {
      parts.push(
        <code key={`c-${keyCounter++}`} className="px-1.5 py-0.5 bg-zinc-800/80 border border-zinc-700/60 rounded text-indigo-300 font-mono text-[11px]">
          {first.match[1]}
        </code>
      )
    } else if (first.type === 'doc') {
      parts.push(
        <span key={`d-${keyCounter++}`} className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-indigo-950/50 border border-indigo-900/60 text-indigo-300 font-medium text-[10px] mx-0.5">
          <FileText className="w-2.5 h-2.5 text-indigo-400 inline flex-shrink-0" />
          <span className="truncate max-w-[140px]">{first.match[1]}</span>
        </span>
      )
    }

    remaining = remaining.substring(idx + first.match[0].length)
  }

  return <>{parts}</>
}

