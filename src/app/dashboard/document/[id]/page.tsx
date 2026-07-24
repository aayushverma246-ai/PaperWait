'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  FileText,
  ArrowLeft,
  Calendar,
  Layers,
  ExternalLink,
  Download,
  Copy,
  Check,
  Loader2,
  FolderOpen,
  Trash2,
  Info,
  RotateCw,
  Maximize2,
  Minimize2
} from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'

interface DBFolder {
  id: string
  name: string
}

interface DBDocument {
  id: string
  file_name: string
  file_type: string
  storage_path: string
  ocr_text: string | null
  description: string | null
  status: string
  folder_id: string | null
  partially_scanned: boolean
  created_at: string
}

export default function DocumentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = React.use(params)
  const resolvedSearchParams = React.use(searchParams)
  const pageParam = typeof resolvedSearchParams.page === 'string' ? resolvedSearchParams.page : null
  const searchQueryParam = typeof resolvedSearchParams.search === 'string' ? resolvedSearchParams.search : null
  const router = useRouter()
  const supabase = createClient()

  const [document, setDocument] = useState<DBDocument | null>(null)
  const [folders, setFolders] = useState<DBFolder[]>([])
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'text'>('preview')
  const [isMobile, setIsMobile] = useState(false)
  const [viewerType, setViewerType] = useState<'google' | 'microsoft'>('google')
  const [iframeKey, setIframeKey] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [csvData, setCsvData] = useState<string[][] | null>(null)
  const [txtContent, setTxtContent] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (isFullscreen) {
        window.document.body.style.overflow = 'hidden'
      } else {
        window.document.body.style.overflow = ''
      }
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.document.body.style.overflow = ''
      }
    }
  }, [isFullscreen])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    if (document) {
      const isPdf = document.file_type === 'application/pdf'
      const isImg = document.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(document.file_name)
      // Default to 'preview' tab now that visual previews exist for non-media formats too
      setActiveTab('preview')

      const fileExt = (document.file_name.split('.').pop() || '').toLowerCase()
      if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(fileExt)) {
        setViewerType('microsoft')
      } else {
        setViewerType('google')
      }
    }
  }, [document])

  useEffect(() => {
    if (!document) return

    const fileExt = (document.file_name.split('.').pop() || '').toLowerCase()
    
    if (fileExt === 'csv') {
      setPreviewLoading(true)
      fetch(`/api/documents/${document.id}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch')
          return res.text()
        })
        .then(text => {
          const lines = text.split(/\r?\n/)
          const parsed = lines
            .map(line => {
              const cells: string[] = []
              let current = ''
              let inQuotes = false
              for (let i = 0; i < line.length; i++) {
                const char = line[i]
                if (char === '"') {
                  inQuotes = !inQuotes
                } else if (char === ',' && !inQuotes) {
                  cells.push(current.trim())
                  current = ''
                } else {
                  current += char
                }
              }
              cells.push(current.trim())
              return cells
            })
            .filter(row => row.some(cell => cell.length > 0))
          setCsvData(parsed)
          setFetchError(false)
          setPreviewLoading(false)
          setIframeLoaded(true)
        })
        .catch(err => {
          console.error('Error fetching CSV:', err)
          setFetchError(true)
          setPreviewLoading(false)
        })
    } else if (fileExt === 'txt') {
      setPreviewLoading(true)
      fetch(`/api/documents/${document.id}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch')
          return res.text()
        })
        .then(text => {
          setTxtContent(text)
          setFetchError(false)
          setPreviewLoading(false)
          setIframeLoaded(true)
        })
        .catch(err => {
          console.error('Error fetching TXT:', err)
          setFetchError(true)
          setPreviewLoading(false)
        })
    } else {
      setCsvData(null)
      setTxtContent(null)
    }
  }, [document])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])
  const [loadingSubtitle, setLoadingSubtitle] = useState("Decrypting secure document contents...")
  const [moving, setMoving] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Custom confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void | Promise<void>
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  const loadData = useCallback(async () => {
    setPreviewLoading(true)
    setIframeLoaded(false)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-loading-start', {
        detail: { title: 'Loading Document', subtitle: 'Decrypting secure document contents...' }
      }))
    }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Step 1: Fetch document details and all folders in parallel
      const [docResult, foldersResult] = await Promise.all([
        supabase
          .from('documents')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('folders')
          .select('id, name')
          .eq('user_id', user.id)
          .order('name', { ascending: true })
      ])

      if (docResult.error) throw docResult.error
      if (foldersResult.error) throw foldersResult.error

      const docData = docResult.data
      setDocument(docData)
      setFolders(foldersResult.data || [])

      const isPdf = docData.file_type === 'application/pdf'
      const isImg = docData.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(docData.file_name)
      
      const displayPreviewPath = isImg
        ? docData.storage_path
        : `${user.id}/previews/${docData.id}.png`

      // Step 2: Generate original signed URL and preview signed URL in parallel
      const [urlResult, previewUrlResult] = await Promise.all([
        supabase.storage
          .from('documents')
          .createSignedUrl(docData.storage_path, 3600), // 1 hour expiry
        supabase.storage
          .from('documents')
          .createSignedUrl(displayPreviewPath, 3600)
      ])

      if (urlResult.error) throw urlResult.error
      setSignedUrl(urlResult.data.signedUrl)

      const previewUrlData = previewUrlResult.data

      if (previewUrlData?.signedUrl) {
        if (!isImg) {
          // For non-media files and PDFs, set the remote signedUrl of the preview card directly as visual placeholder
          setPreviewUrl(previewUrlData.signedUrl)
        } else {
          // Fetch preview blob and create local Object URL to avoid rendering delays for image media files
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 6000) // max 6s fetch
            const res = await fetch(previewUrlData.signedUrl, { signal: controller.signal })
            clearTimeout(timeoutId)
            if (!res.ok) throw new Error('Blob fetch failed')
            const blob = await res.blob()
            const localUrl = URL.createObjectURL(blob)
            
            if (previewUrlRef.current) {
              URL.revokeObjectURL(previewUrlRef.current)
            }
            previewUrlRef.current = localUrl
            setPreviewUrl(localUrl)
          } catch (preloadErr) {
            console.warn('Preload/Blob fetch failed, falling back to signedUrl:', preloadErr)
            setPreviewUrl(previewUrlData.signedUrl)
          }
        }
      } else {
        if (isPdf || isImg) {
          setPreviewLoading(false)
        }
      }

    } catch (err) {
      console.error('Error loading document details:', err)
      router.push('/dashboard')
    } finally {
      setLoading(false)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-loading-stop'))
        sessionStorage.removeItem('next_loading_type')
      }
    }
  }, [supabase, id, router])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Move document folder
  const handleMoveFolder = async (folderId: string | null) => {
    if (!document) return
    setMoving(true)

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to move document')
      }

      const updated = await response.json()
      setDocument((prev) => prev ? { ...prev, folder_id: updated.folder_id } : null)
    } catch (err) {
      console.error('Error moving document:', err)
    } finally {
      setMoving(false)
    }
  }



  const handleDownload = async () => {
    if (!signedUrl || !document) return
    setDownloading(true)
    try {
      const res = await fetch(signedUrl)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url
      a.download = document.file_name
      window.document.body.appendChild(a)
      a.click()
      window.document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download failed:', err)
      window.open(signedUrl, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  // Delete document
  const handleDeleteDoc = () => {
    if (!document) return
    
    setConfirmModal({
      isOpen: true,
      title: 'Delete Document?',
      message: 'Are you sure you want to delete this document permanently? This cannot be undone.',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/documents/${document.id}`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            const result = await response.json()
            throw new Error(result.error || 'Failed to delete document')
          }

          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('app-loading-start', {
              detail: { title: 'Deleting Document', subtitle: 'Permanently purging document assets...' }
            }))
          }
          setLoading(true)
          router.push(backPath)
        } catch (err: any) {
          alert(err.message)
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        {/* Back button & title header skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-2 h-9 w-9 bg-zinc-850 rounded-xl flex-shrink-0"></div>
            <div className="space-y-2">
              <div className="h-3 w-24 bg-zinc-855 rounded"></div>
              <div className="h-8 w-64 bg-zinc-800/80 rounded-lg mt-1"></div>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="h-9 w-32 bg-zinc-800/80 rounded-xl"></div>
            <div className="h-9 w-24 bg-zinc-800/80 rounded-xl"></div>
            <div className="h-9 w-36 bg-zinc-800/80 rounded-xl"></div>
          </div>
        </div>

        {/* Main split display skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Preview Column */}
          <div className="bg-zinc-900 border border-zinc-850 rounded-2xl h-[550px] flex flex-col">
            <div className="p-4 border-b border-zinc-850 bg-zinc-950/60 flex justify-between items-center">
              <div className="h-8 w-44 bg-zinc-800/80 rounded-lg"></div>
              <div className="h-6 w-20 bg-zinc-800/80 rounded"></div>
            </div>
            <div className="flex-1 bg-zinc-950 flex items-center justify-center p-4">
              <div className="h-full w-full bg-zinc-900/30 rounded-lg border border-zinc-850"></div>
            </div>
          </div>

          {/* Right Metadata Column */}
          <div className="space-y-8">
            {/* Folder Move Widget */}
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6">
              <div className="h-5 w-32 bg-zinc-800/80 rounded mb-4"></div>
              <div className="h-10 w-full bg-zinc-800/80 rounded-xl"></div>
            </div>

            {/* AI Summary Card */}
            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6">
              <div className="h-5 w-32 bg-zinc-800/80 rounded mb-4"></div>
              <div className="h-4 w-full bg-zinc-800/80 rounded mb-2"></div>
              <div className="h-4 w-5/6 bg-zinc-800/80 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!document) return null

  let aiMetadata: {
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
  } | null = null

  try {
    if (document.description && document.description.trim().startsWith('{')) {
      aiMetadata = JSON.parse(document.description)
    }
  } catch (e) {
    aiMetadata = null
  }

  const isPdf = document.file_type === 'application/pdf'
  const isImg = document.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(document.file_name)
  const backPath = document.folder_id
    ? `/dashboard/folder/${document.folder_id}`
    : '/dashboard/folder/uncategorized'

  // Extract snippet for the search query on the matched page
  let matchedSnippet = ''
  if (searchQueryParam && document.ocr_text) {
    const pageNum = parseInt(pageParam || '1', 10)
    // Find the text for this specific page
    const pages = document.ocr_text.split(/--- Page \d+ ---/)
    const offset = document.ocr_text.trim().startsWith('--- Page') ? 1 : 0
    let pageContent = pages[pageNum - 1 + offset] || ''
    
    // Fall back to full text if page splitting is empty or does not match
    if (!pageContent || !pageContent.toLowerCase().includes(searchQueryParam.toLowerCase())) {
      pageContent = document.ocr_text
    }
    
    const idx = pageContent.toLowerCase().indexOf(searchQueryParam.toLowerCase())
    if (idx !== -1) {
      const start = Math.max(0, idx - 40)
      const end = Math.min(pageContent.length, idx + 80)
      matchedSnippet = (start > 0 ? '...' : '') + pageContent.substring(start, end).replace(/\n/g, ' ') + (end < pageContent.length ? '...' : '')
    }
  }

  // Highlight search word inside the snippet
  const highlightSnippet = (text: string, search: string) => {
    if (!search.trim()) return text
    const regex = new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-indigo-500/40 text-indigo-200 px-1 py-0.5 rounded font-bold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    )
  }

  const renderCsvTable = () => {
    if (!csvData || csvData.length === 0) return null
    
    const headers = csvData[0]
    const rows = csvData.slice(1)
    
    return (
      <div className="w-full h-full overflow-auto p-3 bg-zinc-950/60 rounded-xl border border-zinc-850 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        <table className="min-w-full text-left border-collapse text-xs text-zinc-350 table-auto">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              {headers.map((cell, idx) => (
                <th key={idx} className="p-3 font-extrabold text-zinc-200 border border-zinc-800 whitespace-nowrap">
                  {cell || `Column ${idx + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-zinc-850 even:bg-zinc-900/20 odd:bg-zinc-950/20 hover:bg-zinc-900/40 transition-colors">
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx} className="p-3 border border-zinc-900 text-zinc-300 font-sans text-xs leading-normal whitespace-pre-wrap break-words max-w-sm" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderTxtContent = () => {
    if (txtContent === null) return null
    return (
      <div className="w-full h-full overflow-auto p-4 bg-zinc-950/60 rounded-xl border border-zinc-850">
        <pre className="whitespace-pre-wrap text-zinc-350 font-mono text-xs leading-relaxed">
          {txtContent}
        </pre>
      </div>
    )
  }

  let pdfViewerUrl = signedUrl
  let iframeUrl = undefined
  if (pdfViewerUrl) {
    if (pageParam) {
      pdfViewerUrl = `${pdfViewerUrl}#page=${pageParam}`
      iframeUrl = `${pdfViewerUrl}&toolbar=0`
    } else {
      iframeUrl = `${pdfViewerUrl}#toolbar=0`
    }
  }

  const getDocViewerUrl = () => {
    if (!signedUrl) return ''
    if (viewerType === 'microsoft') {
      const fileExt = (document?.file_name.split('.').pop() || '').toLowerCase()
      const isPpt = ['pptx', 'ppt'].includes(fileExt)
      if (isPpt && pageParam) {
        return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}&wdStartOnSlide=${pageParam}`
      }
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
    }
    return `https://docs.google.com/viewer?url=${encodeURIComponent(signedUrl)}&embedded=true${pageParam ? `&page=${pageParam}` : ''}`
  }

  return (
    <div className="space-y-8">
      {/* Back button & title header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link
            href={backPath}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('app-loading-start', {
                  detail: { title: 'Loading Folder', subtitle: 'Decrypting catalog components...' }
                }))
              }
            }}
            className="p-2 border border-zinc-800 bg-zinc-950/40 rounded-xl text-zinc-400 hover:text-zinc-200 transition-all duration-200 ease-out hover:scale-[1.05] active:scale-[0.95]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <span className="text-zinc-500 font-semibold text-xs uppercase tracking-wider">Document Viewer</span>
            <h1 className="text-2xl font-extrabold tracking-tight text-white truncate max-w-xl">
              {document.file_name}
            </h1>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {signedUrl && (
            <>
              <a
                href={signedUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center space-x-2 px-3 py-2 border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto text-center font-bold"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Original</span>
              </a>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center justify-center space-x-2 px-3 py-2 border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50 w-full sm:w-auto text-center font-bold"
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{downloading ? 'Downloading...' : 'Download'}</span>
              </button>
            </>
          )}
          
          <button
            onClick={handleDeleteDoc}
            className="flex items-center justify-center space-x-2 px-3 py-2 border border-red-500/20 bg-red-950/10 hover:bg-red-950/20 text-red-400 rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer w-full sm:w-auto text-center font-bold"
            title="Delete Document permanently"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Document</span>
          </button>
        </div>
      </div>

      {/* Main split display */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        <div className={`bg-zinc-900 border border-zinc-850 rounded-2xl overflow-hidden flex flex-col transition-all duration-300 ${
          isFullscreen
            ? 'fixed inset-0 z-50 w-screen h-screen rounded-none border-none bg-zinc-950 p-2 sm:p-4'
            : 'h-[480px] sm:h-[550px]'
        }`}>
          {/* Tab Header Bar */}
          <div className="p-4 border-b border-zinc-850 bg-zinc-950/60 flex items-center justify-between flex-wrap gap-2">
            <div className="flex space-x-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800/80">
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                  activeTab === 'preview'
                    ? 'bg-indigo-650 text-white shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                }`}
              >
                {isPdf || isImg ? 'Visual Preview' : 'Visual Preview'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                  activeTab === 'text'
                    ? 'bg-indigo-650 text-white shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                }`}
              >
                Extracted Text
              </button>
            </div>
            <div className="flex items-center space-x-2">
              {activeTab === 'preview' && !isImg && (
                <div className="flex items-center space-x-2">
                  {/* Viewer switcher for Office documents */}
                  {['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes((document.file_name.split('.').pop() || '').toLowerCase()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setViewerType(t => t === 'google' ? 'microsoft' : 'google')
                        setPreviewLoading(true)
                        setIframeLoaded(false)
                      }}
                      className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                      title="Switch rendering engine"
                    >
                      Engine: {viewerType === 'microsoft' ? 'MS Office' : 'Google'}
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={() => {
                      setIframeKey(k => k + 1)
                      setPreviewLoading(true)
                      setIframeLoaded(false)
                    }}
                    className="p-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer"
                    title="Reload viewer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              
              {isPdf && signedUrl && (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] bg-indigo-950/40 text-indigo-400 border border-indigo-950/50 hover:bg-indigo-600 hover:text-white font-semibold px-2.5 py-1 rounded transition-colors hidden sm:inline"
                >
                  Open Full PDF ↗
                </a>
              )}
              
              <button
                type="button"
                onClick={() => setIsFullscreen(f => !f)}
                className="p-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white rounded-lg transition-all cursor-pointer flex-shrink-0"
                title={isFullscreen ? "Exit fullscreen" : "View fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

              <span className="text-[10px] bg-zinc-800/80 text-zinc-400 font-semibold px-2 py-0.5 rounded uppercase">
                {(document.file_name.split('.').pop() || document.file_type.split('/')[1] || 'DOC').toUpperCase()}
              </span>
            </div>
          </div>

          {/* Tab Content Pane */}
          <div className="flex-1 bg-zinc-950 flex min-h-0 relative">
            {activeTab === 'preview' ? (
              <div className="flex-1 flex items-center justify-center p-2 min-h-0 relative">
                {previewLoading && (isPdf || isImg) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 z-10 space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                      Rendering Document Preview...
                    </span>
                  </div>
                )}
                {pdfViewerUrl ? (
                  isPdf ? (
                    isMobile ? (
                      /* Mobile PDF Viewer using Google Docs Viewer and instant visual thumbnail placeholder */
                      <div className="w-full h-full p-2 relative bg-zinc-950/40 rounded-lg flex items-center justify-center overflow-hidden">
                        {previewUrl && !iframeLoaded && (
                          <div className="absolute inset-0 flex items-center justify-center p-2 bg-zinc-950/60 z-0">
                            <img
                              src={previewUrl}
                              alt={`${document.file_name} Preview Placeholder`}
                              className="max-w-full max-h-full object-contain rounded-lg shadow-md opacity-40 select-none pointer-events-none"
                            />
                          </div>
                        )}
                        <iframe
                          key={iframeKey}
                          src={`https://docs.google.com/viewer?url=${encodeURIComponent(signedUrl || '')}&embedded=true&zoom=width${pageParam ? `&page=${pageParam}` : ''}`}
                          className={`w-full h-full border-none rounded-lg bg-zinc-900 transition-opacity duration-350 z-5 ${
                            iframeLoaded ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
                          }`}
                          onLoad={() => {
                            setIframeLoaded(true)
                            setPreviewLoading(false)
                          }}
                          onError={() => {
                            setPreviewLoading(false)
                          }}
                        />
                      </div>
                    ) : (
                      /* Desktop PDF Viewer using high-performance <object> element */
                      <div className="w-full h-full overflow-y-auto -webkit-overflow-scrolling-touch">
                        <object
                          data={pdfViewerUrl ?? undefined}
                          type="application/pdf"
                          className="w-full h-full min-h-[480px] rounded-lg border-0"
                          onLoad={() => setPreviewLoading(false)}
                        >
                          <iframe
                            src={iframeUrl}
                            className="w-full h-full rounded-lg border-0"
                            title="PDF Preview"
                            onLoad={() => setPreviewLoading(false)}
                          />
                        </object>
                      </div>
                    )
                  ) : isImg ? (
                    <img
                      src={(previewUrl || signedUrl) ?? undefined}
                      alt={document.file_name}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                      onLoad={() => setPreviewLoading(false)}
                      onError={() => setPreviewLoading(false)}
                    />
                  ) : (
                    /* Render Document Viewer using Google Docs Viewer for Word, Excel, PPTX, CSV, TXT */
                    (() => {
                      const fileExt = (document.file_name.split('.').pop() || '').toLowerCase()
                      console.log('Rendering visual preview for extension:', fileExt, 'csvData loaded:', !!csvData, 'fetchError:', fetchError)
                      
                      if (fileExt === 'csv') {
                        if (fetchError) {
                          return (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center text-zinc-650 p-4">
                              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50 text-red-500" />
                              <p className="text-sm font-bold text-zinc-400">Failed to load spreadsheet</p>
                              <p className="text-xs text-zinc-600 mt-1">Please download the file to view its contents.</p>
                            </div>
                          )
                        }
                        if (!csvData) {
                          return (
                            <div className="w-full h-full p-2 relative bg-zinc-950/40 rounded-lg flex items-center justify-center overflow-hidden">
                              {previewUrl && (
                                <div className="absolute inset-0 flex items-center justify-center p-2 bg-zinc-950/60 z-0">
                                  <img
                                    src={previewUrl}
                                    alt={`${document.file_name} Preview Placeholder`}
                                    className="max-w-full max-h-full object-contain rounded-lg shadow-md opacity-40 select-none pointer-events-none"
                                  />
                                </div>
                              )}
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 z-10 space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                  Loading Spreadsheet Data...
                                </span>
                              </div>
                            </div>
                          )
                        }
                        return renderCsvTable()
                      }
                      
                      if (fileExt === 'txt') {
                        if (fetchError) {
                          return (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center text-zinc-650 p-4">
                              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50 text-red-500" />
                              <p className="text-sm font-bold text-zinc-400">Failed to load text content</p>
                              <p className="text-xs text-zinc-600 mt-1">Please download the file to view its contents.</p>
                            </div>
                          )
                        }
                        if (txtContent === null) {
                          return (
                            <div className="w-full h-full p-2 relative bg-zinc-950/40 rounded-lg flex items-center justify-center overflow-hidden">
                              {previewUrl && (
                                <div className="absolute inset-0 flex items-center justify-center p-2 bg-zinc-950/60 z-0">
                                  <img
                                    src={previewUrl}
                                    alt={`${document.file_name} Preview Placeholder`}
                                    className="max-w-full max-h-full object-contain rounded-lg shadow-md opacity-40 select-none pointer-events-none"
                                  />
                                </div>
                              )}
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 z-10 space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                  Loading Text Content...
                                </span>
                              </div>
                            </div>
                          )
                        }
                        return renderTxtContent()
                      }
                      
                      return (
                        <div className="w-full h-full p-2 relative bg-zinc-950/40 rounded-lg flex items-center justify-center overflow-hidden">
                          {/* Visual Preview Card as instant placeholder */}
                          {previewUrl && !iframeLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center p-2 bg-zinc-950/60 z-0">
                              <img
                                src={previewUrl}
                                alt={`${document.file_name} Preview Placeholder`}
                                className="max-w-full max-h-full object-contain rounded-lg shadow-md opacity-40 select-none pointer-events-none"
                              />
                            </div>
                          )}

                          {previewLoading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 z-10 space-y-3">
                              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                Loading Interactive Viewer...
                              </span>
                            </div>
                          )}
                          {signedUrl ? (
                            <div className="w-full h-full overflow-hidden relative rounded-lg">
                              <iframe
                                key={iframeKey}
                                src={getDocViewerUrl()}
                                className={`border-none bg-zinc-900 transition-opacity duration-350 z-5 ${
                                  iframeLoaded ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
                                }`}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                }}
                                onLoad={() => {
                                  setIframeLoaded(true)
                                  setPreviewLoading(false)
                                }}
                                onError={() => {
                                  setPreviewLoading(false)
                                }}
                              />
                            </div>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center text-zinc-650 z-5">
                              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No preview available</p>
                            </div>
                          )}
                        </div>
                      )
                    })()
                  )
                ) : (
                  <div className="text-center text-zinc-650">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No preview available</p>
                  </div>
                )}
              </div>
            ) : (
              /* Extracted Text view tab */
              <div className="w-full h-full bg-zinc-950 p-4 font-mono text-xs text-zinc-300 overflow-y-auto select-text scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                {document.ocr_text ? (
                  <pre className="whitespace-pre-wrap break-all pr-2 leading-relaxed text-zinc-350 select-text">
                    {document.ocr_text}
                  </pre>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-2 text-zinc-600 font-sans">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500/50" />
                    <p className="text-xs uppercase tracking-wider font-bold">No text content available.</p>
                    <p className="text-[11px] max-w-xs leading-normal">Processing is in progress, or this document does not contain extractable characters.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Metadata & OCR Text */}
        <div className="flex flex-col space-y-8">
          
          {/* Matched Search Snippet Banner */}
          {matchedSnippet && (
            <div className="bg-indigo-950/25 border border-indigo-500/20 p-5 rounded-2xl flex items-start space-x-3 text-sm text-indigo-300 animate-fade-in shadow-md">
              <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-zinc-200 mb-1">
                  Matched text on Page {pageParam}:
                </p>
                <p className="italic text-zinc-300 pr-2 leading-relaxed">
                  {highlightSnippet(matchedSnippet, searchQueryParam || '')}
                </p>
              </div>
            </div>
          )}

          {/* Metadata & Folder Assignment */}
          <div className="bg-zinc-900/20 border border-zinc-850 rounded-2xl p-6 space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Details & Classification</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center space-x-3 text-sm">
                <Calendar className="w-5 h-5 text-zinc-500" />
                <div>
                  <p className="text-zinc-500 text-xs">Uploaded On</p>
                  <p className="text-zinc-300 font-medium">
                    {new Date(document.created_at).toLocaleDateString()} at{' '}
                    {new Date(document.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 text-sm">
                <Layers className="w-5 h-5 text-zinc-500" />
                <div>
                  <p className="text-zinc-500 text-xs">Page Scan Range</p>
                  <p className="text-zinc-300 font-medium">
                    Full scan (Processed)
                  </p>
                </div>
              </div>
            </div>

            {/* Folder Select Dropdown */}
            <div className="pt-4 border-t border-zinc-850">
              <label className="block text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">
                Move Document to Folder
              </label>
              
              <div className="flex items-center space-x-3">
                <div className="relative flex-1">
                  <select
                    disabled={moving}
                    value={document.folder_id || 'uncategorized'}
                    onChange={(e) => {
                      const val = e.target.value
                      handleMoveFolder(val === 'uncategorized' ? null : val)
                    }}
                    className="block w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm appearance-none cursor-pointer"
                  >
                    <option value="uncategorized">Uncategorized (Default)</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-zinc-500">
                    {moving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <span className="text-xs">▼</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {aiMetadata ? (
            /* Premium AI Categorization Dashboard (Optimized to hide internal metrics/models) */
            <div className="bg-zinc-900/10 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[250px] shadow-lg animate-fade-in">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="relative flex items-center">
                    <div className="absolute inset-0 bg-indigo-500/20 rounded-full filter blur-md animate-pulse"></div>
                    <Layers className="w-4 h-4 text-indigo-400 relative" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">AI Analysis Insight</span>
                </div>
                <span className="text-[9px] font-bold px-2.5 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md uppercase tracking-wider">
                  Auto-Classified
                </span>
              </div>

              <div className="flex-1 p-6 space-y-5">
                {/* Short Summary Card */}
                <div className="p-4 bg-zinc-950/40 border border-zinc-850 rounded-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 text-zinc-800 text-3xl font-serif select-none pointer-events-none">”</div>
                  <h4 className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider mb-1">Document Summary</h4>
                  <p className="text-zinc-350 text-xs leading-relaxed italic pr-4">
                    "{aiMetadata.short_summary || 'No summary generated.'}"
                  </p>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Category */}
                  <div className="p-3 bg-zinc-950/30 border border-zinc-850 rounded-xl">
                    <span className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider block mb-1">Final Category</span>
                    <span className="text-zinc-200 font-semibold text-xs">{aiMetadata.final_category}</span>
                    {aiMetadata.document_title && (
                      <div className="mt-2 pt-2 border-t border-zinc-850/50">
                        <span className="text-zinc-500 text-[8px] font-bold uppercase tracking-wider block">Detected Title</span>
                        <span className="text-zinc-400 text-[10px] truncate block">{aiMetadata.document_title}</span>
                      </div>
                    )}
                  </div>

                  {/* Folder & Entity */}
                  <div className="p-3 bg-zinc-950/30 border border-zinc-850 rounded-xl">
                    <span className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider block mb-1">Folder Placement</span>
                    <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-semibold">
                      <FolderOpen className="w-3 h-3" />
                      <span>{aiMetadata.suggested_folder}</span>
                    </span>
                    {aiMetadata.primary_entity && (
                      <div className="mt-2 pt-2 border-t border-zinc-850/50">
                        <span className="text-zinc-500 text-[8px] font-bold uppercase tracking-wider block">Primary Entity</span>
                        <span className="text-zinc-350 text-[10px] truncate block">{aiMetadata.primary_entity}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Fallback Plain Text Purpose Card */
            <div className="bg-zinc-900/20 border border-zinc-850 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[250px]">
              <div className="p-4 border-b border-zinc-850 bg-zinc-950/60 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Document Purpose</span>
                </div>
              </div>
   
              <div className="flex-1 p-6 bg-zinc-950/40 flex flex-col justify-center text-center">
                <div className="max-w-md mx-auto space-y-4">
                  <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/10">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h3 className="text-zinc-200 font-bold text-lg">What is this document for?</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed italic">
                    "{document.description || 'This document has been processed and indexed for global searches.'}"
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Reusable ConfirmModal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
