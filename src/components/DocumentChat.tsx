'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
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
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    documentId: string
    fileName: string
    pageNumber: number | null
  }>
  error?: boolean
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
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
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
      setMessages(prev => [...prev, assistantMessage])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: err.message || 'Something went wrong. Please try again.',
        error: true,
      }])
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

  const clearChat = () => {
    setMessages([])
    setInput('')
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
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ease-out cursor-pointer shadow-xl ${
          isOpen
            ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-750 shadow-zinc-900/50 rotate-0'
            : 'bg-gradient-to-tr from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:scale-105'
        }`}
        title={isOpen ? 'Close AI Chat' : 'Open AI Chat'}
      >
        {isOpen ? (
          <X className="w-5 h-5 text-zinc-300" />
        ) : (
          <MessageSquare className="w-5 h-5 text-white" />
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[min(420px,calc(100vw-2rem))] h-[min(600px,calc(100vh-8rem))] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-scale-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                <Sparkles className="w-4 h-4 text-white" />
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
                  title="New Chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
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
                  {indexStatus.indexed}/{indexStatus.total} docs indexed
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
                <span>{indexing ? 'Indexing...' : 'Index Now'}</span>
              </button>
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            {messages.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/10 to-violet-600/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                  <Bot className="w-8 h-8 text-indigo-400" />
                </div>
                <h4 className="text-sm font-bold text-zinc-300 mb-1">Ask about your documents</h4>
                <p className="text-[11px] text-zinc-600 max-w-[280px] mb-6 leading-relaxed">
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

                <p className="text-[9px] text-zinc-700 mt-5 max-w-[280px]">
                  Your document text is sent to Groq and Cloudflare AI for processing. No data is stored by these providers.
                </p>
              </div>
            ) : (
              /* Message bubbles */
              messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
                    {/* Message bubble */}
                    <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : msg.error
                          ? 'bg-red-950/30 border border-red-900/30 text-red-300 rounded-bl-md'
                          : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-bl-md'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-invert prose-xs max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
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

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-zinc-800/80 bg-zinc-900/50 p-3">
            <div className="flex items-end space-x-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your documents..."
                rows={1}
                className="flex-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-zinc-100 placeholder-zinc-600 text-sm rounded-xl px-3.5 py-2.5 resize-none transition-all max-h-[100px] overflow-y-auto"
                style={{ minHeight: '40px' }}
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all cursor-pointer shadow-md shadow-indigo-500/20"
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
 * Simple markdown-to-JSX formatter for assistant messages.
 * Handles bold, code, and line breaks without importing a full markdown library.
 */
function formatMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!line.trim()) {
      elements.push(<br key={`br-${i}`} />)
      continue
    }

    // Process inline formatting
    const processed = processInline(line)

    // Check for bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('• ') || line.trim().match(/^\d+\.\s/)) {
      elements.push(
        <div key={i} className="flex items-start space-x-1.5 ml-1">
          <span className="text-zinc-500 flex-shrink-0 mt-[2px]">•</span>
          <span>{processed}</span>
        </div>
      )
    } else {
      elements.push(<p key={i}>{processed}</p>)
    }
  }

  return <>{elements}</>
}

function processInline(text: string): React.ReactNode {
  // Handle **bold** and `code`
  const parts: React.ReactNode[] = []
  let remaining = text
  let keyCounter = 0

  while (remaining.length > 0) {
    // Check for bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`(.+?)`/)
    // Check for [Document: xxx] citations
    const docMatch = remaining.match(/\[Document:\s*(.+?)\]/)

    // Find the earliest match
    const matches = [
      boldMatch ? { type: 'bold', match: boldMatch } : null,
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

    // Add text before the match
    if (idx > 0) {
      parts.push(remaining.substring(0, idx))
    }

    if (first.type === 'bold') {
      parts.push(
        <strong key={`b-${keyCounter++}`} className="text-zinc-100 font-semibold">
          {first.match[1]}
        </strong>
      )
    } else if (first.type === 'code') {
      parts.push(
        <code key={`c-${keyCounter++}`} className="px-1 py-0.5 bg-zinc-800 rounded text-indigo-300 text-[12px]">
          {first.match[1]}
        </code>
      )
    } else if (first.type === 'doc') {
      parts.push(
        <span key={`d-${keyCounter++}`} className="inline-flex items-center space-x-1 text-indigo-400 font-semibold text-[11px]">
          <FileText className="w-3 h-3 inline" />
          <span>{first.match[1]}</span>
        </span>
      )
    }

    remaining = remaining.substring(idx + first.match[0].length)
  }

  return <>{parts}</>
}
