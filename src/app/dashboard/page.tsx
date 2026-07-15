'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  Folder as FolderIcon,
  Plus,
  FileText,
  UploadCloud,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  Search,
  X,
  Camera,
  Trash2
} from 'lucide-react'
import VelocityLoader from '@/components/VelocityLoader'

interface DBFolder {
  id: string
  name: string
  created_at: string
}

interface DBDocument {
  id: string
  file_name: string
  file_type?: string
  storage_path: string
  folder_id: string | null
  status: string
  created_at: string
  ocr_text?: string | null
  description?: string | null
  signedUrl?: string | null
}

interface UploadQueueItem {
  id: string
  fileName: string
  status: 'uploading' | 'ocr' | 'categorizing' | 'done' | 'failed'
  error?: string
  folderName?: string
}

function highlightText(text: string, highlight: string) {
  if (!highlight.trim()) {
    return <span>{text}</span>
  }
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedHighlight})`, 'gi')
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

export default function DashboardPage() {
  const supabase = createClient()

  const [folders, setFolders] = useState<DBFolder[]>([])
  const [documents, setDocuments] = useState<DBDocument[]>([])
  const [loading, setLoading] = useState(true)
  
  // New folder dialog
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const [folderSubmitting, setFolderSubmitting] = useState(false)

  // Upload queue
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)

  // Search query
  const [searchQuery, setSearchQuery] = useState('')

  // Filtered documents for search
  const filteredDocs = documents.filter((doc) => {
    const nameMatch = doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    const contentMatch = doc.ocr_text && doc.ocr_text.toLowerCase().includes(searchQuery.toLowerCase())
    const descMatch = doc.description && doc.description.toLowerCase().includes(searchQuery.toLowerCase())
    return nameMatch || contentMatch || descMatch
  })

  // Camera Capture state & handlers
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const startCamera = async () => {
    setIsCameraActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      setCameraStream(stream)
      // Small timeout to allow video element ref to mount
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }, 100)
    } catch (err: any) {
      console.error('Failed to open camera:', err)
      alert('Camera permission denied or camera not available.')
      setIsCameraActive(false)
    }
  }

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
    }
    setIsCameraActive(false)
  }

  const capturePhoto = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_capture_${Date.now()}.png`, { type: 'image/png' })
          uploadFile(file)
          stopCamera()
        }
      }, 'image/png')
    }
  }

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingSelected, setDeletingSelected] = useState(false)

  const toggleSelect = (docId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const isAllSelected = filteredDocs.length > 0 && filteredDocs.every(doc => selectedIds.has(doc.id))

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (isAllSelected) {
        filteredDocs.forEach(doc => next.delete(doc.id))
      } else {
        filteredDocs.forEach(doc => next.add(doc.id))
      }
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (!confirm(`Are you sure you want to permanently delete the ${selectedIds.size} selected documents? This cannot be undone.`)) return
    setDeletingSelected(true)

    try {
      const deletePromises = Array.from(selectedIds).map(id =>
        fetch(`/api/documents/${id}`, { method: 'DELETE' })
      )
      await Promise.all(deletePromises)

      setDocuments(prev => prev.filter(doc => !selectedIds.has(doc.id)))
      setSelectedIds(new Set())
    } catch (err: any) {
      alert('Error deleting documents: ' + err.message)
    } finally {
      setDeletingSelected(false)
    }
  }

  // Folder Selection States
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())
  const [deletingFolders, setDeletingFolders] = useState(false)

  const toggleSelectFolder = (folderId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const isAllFoldersSelected = folders.length > 0 && folders.every(f => selectedFolderIds.has(f.id))

  const toggleSelectAllFolders = () => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (isAllFoldersSelected) {
        folders.forEach(f => next.delete(f.id))
      } else {
        folders.forEach(f => next.add(f.id))
      }
      return next
    })
  }

  const handleDeleteSelectedFolders = async () => {
    if (!confirm(`Are you sure you want to permanently delete the ${selectedFolderIds.size} selected folders and ALL documents inside them? This cannot be undone.`)) return
    setDeletingFolders(true)

    try {
      const deletePromises = Array.from(selectedFolderIds).map(id =>
        fetch(`/api/folders/${id}`, { method: 'DELETE' })
      )
      await Promise.all(deletePromises)

      setFolders(prev => prev.filter(f => !selectedFolderIds.has(f.id)))
      setSelectedFolderIds(new Set())
    } catch (err: any) {
      alert('Error deleting folders: ' + err.message)
    } finally {
      setDeletingFolders(false)
    }
  }

  // Load data
  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch folders
      const { data: foldersData, error: foldersErr } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (foldersErr) throw foldersErr

      // Fetch documents
      const { data: docsData, error: docsErr } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (docsErr) throw docsErr

      setFolders(foldersData || [])
      // Batch create signed URLs for image preview thumbnails
      let docsWithUrls: DBDocument[] = (docsData || []).map((doc: any) => ({ ...doc, signedUrl: null }))

      if (docsData && docsData.length > 0) {
        const paths = docsData.map((d: any) =>
          d.file_type === 'application/pdf' || /\.pdf$/i.test(d.file_name)
            ? `previews/${d.id}.png`
            : d.storage_path
        )

        try {
          const { data: signedUrls } = await supabase.storage
            .from('documents')
            .createSignedUrls(paths, 3600)
          
          if (signedUrls) {
            docsWithUrls = docsData.map((doc: any) => {
              const targetPath = doc.file_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name)
                ? `previews/${doc.id}.png`
                : doc.storage_path
              const match = signedUrls.find((s) => s.path === targetPath)
              return {
                ...doc,
                signedUrl: match ? match.signedUrl : null
              }
            })
          }
        } catch (err) {
          console.error('Signed URL load failed:', err)
        }
      }

      setFolders(foldersData || [])
      setDocuments(docsWithUrls)
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
    } catch (err) {
      console.error('Error loading dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Count documents per folder
  const getDocCount = (folderId: string | null) => {
    return documents.filter((doc) => doc.folder_id === folderId).length
  }

  // Create folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim()) return

    setFolderSubmitting(true)
    setFolderError('')

    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create folder')
      }

      setFolders((prev) => [...prev, result].sort((a, b) => a.name.localeCompare(b.name)))
      setNewFolderName('')
      setIsCreatingFolder(false)
    } catch (err: any) {
      setFolderError(err.message)
    } finally {
      setFolderSubmitting(false)
    }
  }

  // File upload logic
  const uploadFile = async (file: File) => {
    const queueId = crypto.randomUUID()
    
    // Add to queue
    setUploadQueue((prev) => [
      { id: queueId, fileName: file.name, status: 'uploading' },
      ...prev,
    ])

    const updateItemStatus = (status: UploadQueueItem['status'], error?: string) => {
      setUploadQueue((prev) =>
        prev.map((item) => (item.id === queueId ? { ...item, status, error } : item))
      )
    }

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Start upload & process. The endpoint performs OCR and LLM classification inline
      // We will simulate step transitions for better UI feel.
      
      const uploadPromise = fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      // Shift to OCR after ~1.5s (average upload time)
      const ocrTimeout = setTimeout(() => {
        updateItemStatus('ocr')
      }, 1500)

      // Shift to categorizing after ~5s (average OCR time)
      const categorizingTimeout = setTimeout(() => {
        updateItemStatus('categorizing')
      }, 5500)

      const response = await uploadPromise
      clearTimeout(ocrTimeout)
      clearTimeout(categorizingTimeout)

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to process document')
      }

      // Reload dashboard data first
      await loadData()

      // Look up folder name
      let destFolderName = 'Uncategorized'
      if (result.folder_id) {
        const { data: latestFolder } = await supabase
          .from('folders')
          .select('name')
          .eq('id', result.folder_id)
          .single()
        if (latestFolder) {
          destFolderName = latestFolder.name
        }
      }

      setUploadQueue((prev) =>
        prev.map((item) => (item.id === queueId ? { ...item, status: 'done', folderName: destFolderName } : item))
      )
    } catch (err: any) {
      updateItemStatus('failed', err.message || 'An error occurred during processing')
    }
  }

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((file) => {
      uploadFile(file)
    })
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.files).forEach((file) => {
        uploadFile(file)
      })
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#09090b] flex items-center justify-center">
        <VelocityLoader
          title="Loading Dashboard"
          subtitle="Decrypting catalog structure..."
        />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* Title & Actions bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Dashboard</h1>
          <p className="text-zinc-400 mt-1">Manage folders and drop files to categorize them automatically.</p>
        </div>
        <button
          onClick={() => setIsCreatingFolder(true)}
          className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-medium transition-all shadow-md shadow-indigo-500/20 cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span>New Folder</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="relative max-w-xl">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-500">
          <Search className="w-5 h-5" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search all documents by name or content..."
          className="block w-full pl-11 pr-10 py-3 bg-zinc-900/30 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-zinc-100 placeholder-zinc-500 text-sm rounded-xl transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {searchQuery ? (
        /* Search Results Mode */
        <div>
          {/* Bulk actions banner */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between p-4 bg-indigo-950/20 border border-indigo-900/40 rounded-2xl mb-4 text-sm text-indigo-300 animate-fade-in">
              <div className="flex items-center space-x-3">
                <span className="font-semibold text-zinc-200">{selectedIds.size} items selected</span>
                <span className="text-zinc-600">•</span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-indigo-400 hover:text-indigo-200 transition-colors font-semibold"
                >
                  Deselect All
                </button>
              </div>
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-red-600/10"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deletingSelected ? 'Deleting...' : 'Delete Selected'}</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 border-b border-zinc-800/60 pb-3">
            <div className="flex items-center space-x-3">
              {filteredDocs.length > 0 && (
                <div
                  onClick={toggleSelectAll}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                    isAllSelected
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'
                  }`}
                >
                  {isAllSelected && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                Search Results for "{searchQuery}"
              </h2>
            </div>
            <span className="text-xs bg-indigo-950/40 text-indigo-400 border border-indigo-950/50 font-semibold px-2.5 py-1 rounded-full">
              {filteredDocs.length} matches
            </span>
          </div>
          
          {filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500 bg-zinc-900/10 border border-zinc-850 rounded-2xl">
              <FileText className="w-12 h-12 text-zinc-800 mb-3" />
              <p className="font-semibold text-zinc-400">No matching documents found</p>
              <p className="text-xs text-zinc-600 mt-1 max-w-xs">
                Try searching for a different keyword or file name.
              </p>
            </div>
          ) : (
            <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl overflow-hidden divide-y divide-zinc-900">
              {filteredDocs.map((doc) => {
                const docFolder = folders.find((f) => f.id === doc.folder_id)
                // Try to find context match snippet
                let snippet = ''
                if (doc.ocr_text) {
                  const idx = doc.ocr_text.toLowerCase().indexOf(searchQuery.toLowerCase())
                  if (idx !== -1) {
                    const start = Math.max(0, idx - 30)
                    const end = Math.min(doc.ocr_text.length, idx + 70)
                    snippet = (start > 0 ? '...' : '') + doc.ocr_text.substring(start, end).replace(/\n/g, ' ') + (end < doc.ocr_text.length ? '...' : '')
                  }
                }
                if (!snippet && doc.description) {
                  const idx = doc.description.toLowerCase().indexOf(searchQuery.toLowerCase())
                  if (idx !== -1) {
                    const start = Math.max(0, idx - 30)
                    const end = Math.min(doc.description.length, idx + 70)
                    snippet = (start > 0 ? '...' : '') + doc.description.substring(start, end).replace(/\n/g, ' ') + (end < doc.description.length ? '...' : '')
                  }
                }

                return (
                  <Link
                    key={doc.id}
                    href={`/dashboard/document/${doc.id}`}
                    className="group flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 hover:bg-zinc-900/30 transition-all animate-fade-in"
                  >
                    <div className="flex items-center space-x-4 min-w-0">
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

                      {doc.signedUrl && (doc.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(doc.file_name)) ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex-shrink-0 relative group-hover:border-indigo-500/20 transition-all flex items-center justify-center">
                          <img
                            src={doc.signedUrl}
                            alt={doc.file_name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ) : (
                        <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-xl text-zinc-400 group-hover:text-indigo-400 group-hover:border-indigo-500/10 transition-all flex-shrink-0">
                          <FileText className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-zinc-200 font-semibold truncate group-hover:text-white transition-colors">
                          {highlightText(doc.file_name, searchQuery)}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                          <span className="text-[10px] font-semibold uppercase tracking-wider bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                            {docFolder ? docFolder.name : 'Uncategorized'}
                          </span>
                          <span className="text-zinc-700">•</span>
                          <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                          {snippet && (
                            <>
                              <span className="text-zinc-700">•</span>
                              <span className="italic text-[11px] text-zinc-400 max-w-[300px] sm:max-w-[450px] truncate">
                                {highlightText(snippet, searchQuery)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all hidden sm:block flex-shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Normal Dashboard Mode */
        <>
          {/* Folders Selection actions banner */}
          {selectedFolderIds.size > 0 && (
            <div className="flex items-center justify-between p-4 bg-indigo-950/20 border border-indigo-900/40 rounded-2xl text-sm text-indigo-300 animate-fade-in mb-6">
              <div className="flex items-center space-x-3">
                <span className="font-semibold text-zinc-200">{selectedFolderIds.size} folders selected</span>
                <span className="text-zinc-600">•</span>
                <button
                  onClick={() => setSelectedFolderIds(new Set())}
                  className="text-indigo-400 hover:text-indigo-200 transition-colors font-semibold"
                >
                  Deselect All
                </button>
              </div>
              <button
                onClick={handleDeleteSelectedFolders}
                disabled={deletingFolders}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-red-600/10"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deletingFolders ? 'Deleting...' : 'Delete Selected Folders'}</span>
              </button>
            </div>
          )}

          {/* Grid of Folders */}
          <div className="mb-10">
            <div className="flex items-center space-x-3 mb-4">
              {folders.length > 0 && (
                <div
                  onClick={toggleSelectAllFolders}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                    isAllFoldersSelected
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'
                  }`}
                >
                  {isAllFoldersSelected && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Your Folders</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {/* Special Card for Uncategorized */}
                <Link
                  href="/dashboard/folder/uncategorized"
                  className="group relative flex flex-col justify-between p-6 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/60 transition-all shadow-md hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl group-hover:border-zinc-700 transition-colors">
                      <FolderOpen className="w-6 h-6 text-zinc-500 group-hover:text-zinc-400" />
                    </div>
                    <span className="text-xs bg-zinc-800/60 text-zinc-400 font-semibold px-2.5 py-1 rounded-full">
                      {getDocCount(null)} docs
                    </span>
                  </div>
                  <div className="mt-8 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-zinc-300 group-hover:text-white transition-colors">
                        Uncategorized
                      </h3>
                      <p className="text-xs text-zinc-500 mt-1">Default landing folder</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>

                {/* Custom Folders */}
                {folders.map((folder) => (
                  <Link
                    key={folder.id}
                    href={`/dashboard/folder/${folder.id}`}
                    className="group relative flex flex-col justify-between p-6 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/60 transition-all shadow-md hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        {/* Select Folder Checkbox */}
                        <div
                          onClick={(e) => toggleSelectFolder(folder.id, e)}
                          className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                            selectedFolderIds.has(folder.id)
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'border-zinc-800 bg-zinc-950 hover:border-zinc-650'
                          }`}
                        >
                          {selectedFolderIds.has(folder.id) && (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl group-hover:border-indigo-500/20 transition-colors">
                          <FolderIcon className="w-6 h-6 text-indigo-400 group-hover:text-indigo-300" />
                        </div>
                      </div>
                      <span className="text-xs bg-indigo-950/40 text-indigo-400 border border-indigo-950 font-semibold px-2.5 py-1 rounded-full">
                        {getDocCount(folder.id)} docs
                      </span>
                    </div>
                    <div className="mt-8 flex items-center justify-between">
                      <div className="pr-4 overflow-hidden">
                        <h3 className="font-semibold text-zinc-300 group-hover:text-white transition-colors truncate">
                          {folder.name}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1 truncate">Created {new Date(folder.created_at).toLocaleDateString()}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-1 transition-all flex-shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
          </div>

          {/* Drag & Drop Upload Zone */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Upload Documents</h2>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-10 text-center transition-all min-h-[250px] ${
                  isDragOver
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700 hover:bg-zinc-900/30'
                }`}
              >
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/jpg"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  className="hidden"
                />
                
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl mb-4">
                  <UploadCloud className="w-8 h-8 text-indigo-400" />
                </div>
                
                <h3 className="font-semibold text-zinc-200">Drag & Drop Files Here</h3>
                <p className="text-xs text-zinc-500 max-w-sm mt-2">
                  Supports PDFs and images (PNG, JPEG, JPG) of any size and length.
                </p>
                
                <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                  <label
                    htmlFor="file-upload"
                    className="inline-flex items-center justify-center px-4 py-2 border border-zinc-800 bg-zinc-900 hover:bg-zinc-850 hover:text-white rounded-xl text-sm font-semibold text-zinc-300 transition-all cursor-pointer shadow-md"
                  >
                    Browse Files
                  </label>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex items-center justify-center px-4 py-2 border border-zinc-800 bg-zinc-900 hover:bg-zinc-850 hover:text-white rounded-xl text-sm font-semibold text-zinc-300 transition-all cursor-pointer shadow-md"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Take Photo
                  </button>
                </div>
              </div>
            </div>

            {/* Upload Queue Panel */}
            <div className="bg-zinc-900/20 border border-zinc-850 rounded-2xl p-6 flex flex-col">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Processing Queue</h2>
              {uploadQueue.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="w-10 h-10 text-zinc-700 mb-3" />
                  <p className="text-zinc-500 text-sm">No active uploads</p>
                  <p className="text-xs text-zinc-600 mt-1">Uploaded files will queue here.</p>
                </div>
              ) : (
                <div className="flex-1 space-y-4 max-h-[300px] overflow-y-auto pr-1">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl space-y-2">
                      <div className="flex items-start justify-between">
                        <p className="text-xs text-zinc-300 font-medium truncate max-w-[180px]">{item.fileName}</p>
                        {item.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                        {item.status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                        {item.status !== 'done' && item.status !== 'failed' && (
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" />
                        )}
                      </div>
                      
                      {/* Status Indicator */}
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-zinc-500 uppercase tracking-wider font-semibold">
                          {item.status === 'uploading' && 'Uploading...'}
                          {item.status === 'ocr' && 'Extracting text (OCR)...'}
                          {item.status === 'categorizing' && 'Auto-categorizing...'}
                          {item.status === 'done' && 'Processed'}
                          {item.status === 'failed' && 'Failed'}
                        </span>
                      </div>

                      {/* Progress bar simulation */}
                      <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            item.status === 'uploading' ? 'w-1/4 bg-indigo-500' :
                            item.status === 'ocr' ? 'w-2/3 bg-indigo-500' :
                            item.status === 'categorizing' ? 'w-11/12 bg-indigo-500' :
                            item.status === 'done' ? 'w-full bg-emerald-500' :
                            'w-full bg-red-500'
                          }`}
                        />
                      </div>

                      {item.error && (
                        <p className="text-[10px] text-red-400 mt-1 line-clamp-2 leading-relaxed">
                          {item.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* New Folder Modal */}
      {isCreatingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">Create New Folder</h3>
            <p className="text-xs text-zinc-400 mb-6">Enter a name for the folder. Names must be unique.</p>
            
            <form onSubmit={handleCreateFolder} className="space-y-4">
              {folderError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg">
                  {folderError}
                </div>
              )}
              
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Invoices"
                className="block w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm"
              />
              
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingFolder(false)
                    setFolderError('')
                    setNewFolderName('')
                  }}
                  className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={folderSubmitting}
                  className="flex-1 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {folderSubmitting ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Camera Capture Modal */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md px-4 animate-fade-in">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-zinc-850 bg-zinc-950 flex items-center justify-between">
              <h3 className="font-semibold text-white">Capture Document Photo</h3>
              <button
                onClick={stopCamera}
                className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Live Video Feed */}
            <div className="relative bg-black flex items-center justify-center aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {!cameraStream && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                  <Loader2 className="w-6 h-6 animate-spin mr-2 text-indigo-500" />
                  <span>Requesting camera permission...</span>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div className="p-4 bg-zinc-950 flex items-center justify-center space-x-4">
              <button
                type="button"
                onClick={stopCamera}
                className="px-4 py-2.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              
              <button
                type="button"
                onClick={capturePhoto}
                disabled={!cameraStream}
                className="flex items-center space-x-2 px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Capture Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
