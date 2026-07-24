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
  Trash2,
  ExternalLink
} from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import SearchInput from '@/components/SearchInput'
import DocumentRow from '@/components/DocumentRow'
import { useUpload } from './UploadContext'

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
  thumbnailError?: boolean
}

interface UploadQueueItem {
  id: string
  fileName: string
  status: 'uploading' | 'ocr' | 'categorizing' | 'done' | 'failed'
  error?: string
  folderName?: string
}

export default function DashboardPage() {
  const supabase = createClient()

  const [folders, setFolders] = useState<DBFolder[]>([])
  const [documents, setDocuments] = useState<DBDocument[]>([])
  const [loading, setLoading] = useState(true)

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
  
  // New folder dialog
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [folderError, setFolderError] = useState('')
  const [folderSubmitting, setFolderSubmitting] = useState(false)

  // Upload context
  const {
    uploadQueue,
    setUploadQueue,
    uploadTargetFolderId,
    setUploadTargetFolderId,
    uploadFile,
    cancelUpload,
    processUploadQueue,
    duplicateFile,
    setDuplicateFile,
    duplicateExistingDoc,
    setDuplicateExistingDoc,
    pendingUploadsQueue,
    setPendingUploadsQueue,
  } = useUpload()

  const [isDragOver, setIsDragOver] = useState(false)

  // Search query
  const [searchQuery, setSearchQuery] = useState('')

  // Filtered documents for search
  const filteredDocs = documents.filter((doc) => {
    const nameMatch = doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    const contentMatch = doc.ocr_text && doc.ocr_text.toLowerCase().includes(searchQuery.toLowerCase())
    
    let plainDescription = doc.description || ''
    if (plainDescription.startsWith('{')) {
      try {
        const parsed = JSON.parse(plainDescription)
        plainDescription = (parsed.short_summary || '') + ' ' + (parsed.document_title || '') + ' ' + (parsed.final_category || '') + ' ' + (parsed.primary_entity || '')
      } catch (e) {}
    }
    const descMatch = plainDescription && plainDescription.toLowerCase().includes(searchQuery.toLowerCase())
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

  const handleDeleteSelected = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Documents?',
      message: `Are you sure you want to permanently delete the ${selectedIds.size} selected documents? This cannot be undone.`,
      onConfirm: async () => {
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
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
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

  const isAllFoldersSelected = folders.length > 0 && folders.every(f => selectedFolderIds.has(f.id)) && selectedFolderIds.has('uncategorized')

  const toggleSelectAllFolders = () => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (isAllFoldersSelected) {
        folders.forEach(f => next.delete(f.id))
        next.delete('uncategorized')
      } else {
        folders.forEach(f => next.add(f.id))
        next.add('uncategorized')
      }
      return next
    })
  }

  const handleDeleteSelectedFolders = () => {
    const hasUncategorized = selectedFolderIds.has('uncategorized')
    const customFolderIds = Array.from(selectedFolderIds).filter(id => id !== 'uncategorized')

    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Folders?',
      message: `Are you sure you want to permanently delete the selected folders and all documents inside them?${hasUncategorized ? ' This will also permanently delete all uncategorized documents.' : ''} This cannot be undone.`,
      onConfirm: async () => {
        setDeletingFolders(true)
        try {
          // Delete custom folders (which cleans up db and storage)
          const deletePromises = customFolderIds.map(id =>
            fetch(`/api/folders/${id}`, { method: 'DELETE' })
          )
          await Promise.all(deletePromises)

          // If uncategorized selected, delete all uncategorized documents
          if (hasUncategorized) {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
              const { data: uncDocs } = await supabase
                .from('documents')
                .select('id')
                .eq('user_id', user.id)
                .is('folder_id', null)

              if (uncDocs && uncDocs.length > 0) {
                const deleteDocPromises = uncDocs.map(doc =>
                  fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
                )
                await Promise.all(deleteDocPromises)
              }
            }
          }

          setSelectedFolderIds(new Set())
          await loadData(false)
        } catch (err: any) {
          alert('Error deleting folders: ' + err.message)
        } finally {
          setDeletingFolders(false)
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  // Load data
  const loadData = useCallback(async (showOverlay: boolean = true) => {
    if (showOverlay && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-loading-start', {
        detail: { title: 'Loading Dashboard', subtitle: 'Decrypting catalog structure...' }
      }))
    }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch folders and documents in parallel
      const [foldersResult, docsResult] = await Promise.all([
        supabase
          .from('folders')
          .select('*')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),
        supabase
          .from('documents')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
      ])

      if (foldersResult.error) throw foldersResult.error
      if (docsResult.error) throw docsResult.error

      const foldersData = foldersResult.data
      const docsData = docsResult.data

      // Batch create signed URLs for image preview thumbnails
      let docsWithUrls: DBDocument[] = (docsData || []).map((doc: any) => ({ ...doc, signedUrl: null }))

      if (docsData && docsData.length > 0) {
        const paths = docsData.map((d: any) => `${user.id}/previews/${d.id}.png`)

        try {
          const { data: signedUrls } = await supabase.storage
            .from('documents')
            .createSignedUrls(paths, 3600)
          
          if (signedUrls) {
            docsWithUrls = docsData.map((doc: any) => {
              const targetPath = `${user.id}/previews/${doc.id}.png`
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

      // Trigger thumbnail preloading asynchronously in the background so it doesn't block page rendering
      if (docsWithUrls && docsWithUrls.length > 0) {
        const preloadPromises = docsWithUrls.map(d => {
          const hasThumbnail = !!d.signedUrl
          if (!hasThumbnail) return Promise.resolve()
          
          return new Promise<void>((resolve) => {
            const img = new Image()
            img.src = d.signedUrl!
            const timer = setTimeout(() => {
              resolve()
            }, 2000)
            img.onload = () => {
              clearTimeout(timer)
              resolve()
            }
            img.onerror = () => {
              clearTimeout(timer)
              setDocuments(prev => prev.map(doc => doc.id === d.id ? { ...doc, thumbnailError: true } : doc))
              resolve()
            }
          })
        })
        Promise.all(preloadPromises).catch(err => console.warn('Background preload failed:', err))
      }

    } catch (err) {
      console.error('Error loading dashboard data:', err)
    } finally {
      setLoading(false)
      if (showOverlay && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-loading-stop'))
        sessionStorage.removeItem('next_loading_type')
      }
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
      // Close modal without triggering a scroll jump
      const savedScroll = typeof window !== 'undefined' ? window.scrollY : 0
      setIsCreatingFolder(false)
      requestAnimationFrame(() => {
        if (typeof window !== 'undefined') window.scrollTo({ top: savedScroll, behavior: 'instant' })
      })
    } catch (err: any) {
      setFolderError(err.message)
    } finally {
      setFolderSubmitting(false)
    }
  }

  // Listen to background document completions to refresh document list
  useEffect(() => {
    const handleProcessed = () => {
      // Preserve scroll position across the silent data refresh
      const savedScroll = typeof window !== 'undefined' ? window.scrollY : 0
      loadData(false).then(() => {
        requestAnimationFrame(() => {
          if (typeof window !== 'undefined') window.scrollTo({ top: savedScroll, behavior: 'instant' })
        })
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('document-processed', handleProcessed)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('document-processed', handleProcessed)
      }
    }
  }, [loadData])

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return
    processUploadQueue(Array.from(files))
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
      processUploadQueue(Array.from(e.dataTransfer.files))
    }
  }

  if (loading) {
    return (
      <div className="space-y-10 animate-pulse">
        {/* Title & Actions bar skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div className="space-y-2">
            <div className="h-9 w-48 bg-zinc-800/80 rounded-xl"></div>
            <div className="h-4 w-80 bg-zinc-900/80 rounded-lg"></div>
          </div>
          <div className="h-11 w-32 bg-zinc-800/80 rounded-xl"></div>
        </div>

        {/* Search Input Bar skeleton */}
        <div className="h-12 w-full bg-zinc-900/20 border border-zinc-800/50 rounded-2xl"></div>

        {/* Grid of Folders skeleton */}
        <div>
          <div className="h-5 w-28 bg-zinc-800/80 rounded mb-4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div className="h-12 w-12 bg-zinc-800/80 rounded-xl"></div>
                  <div className="h-5 w-16 bg-zinc-800/80 rounded-full"></div>
                </div>
                <div className="h-4 w-24 bg-zinc-800/80 rounded mt-4"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Upload and Documents section skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex flex-col space-y-4">
            <div className="h-5 w-40 bg-zinc-800/80 rounded"></div>
            <div className="h-64 bg-zinc-900/20 border border-zinc-800/80 rounded-2xl"></div>
          </div>
          <div className="flex flex-col space-y-4">
            <div className="h-5 w-40 bg-zinc-800/80 rounded"></div>
            <div className="h-64 bg-zinc-900/20 border border-zinc-800/80 rounded-2xl"></div>
          </div>
        </div>
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
          className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-medium transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-indigo-500/20 cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span>New Folder</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search all documents by name or content..."
      />

      {searchQuery ? (
        /* Search Results Mode */
        <div>
          {/* Bulk actions banner */}
          {selectedIds.size > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-indigo-950/20 border border-indigo-900/40 rounded-2xl mb-4 text-sm text-indigo-300 animate-fade-in gap-3">
              <div className="flex items-center justify-center space-x-3 w-full sm:w-auto">
                <span className="font-semibold text-zinc-200">{selectedIds.size} items selected</span>
                <span className="text-zinc-700 font-bold">•</span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-indigo-400 hover:text-indigo-200 transition-colors font-semibold underline underline-offset-4 cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="flex items-center justify-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-750 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md w-full sm:w-auto text-center"
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
                {`Search Results for "${searchQuery}"`}
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
                let plainDescription = doc.description || ''
                if (plainDescription.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(plainDescription)
                    plainDescription = parsed.short_summary || parsed.description || ''
                  } catch (e) {}
                }

                if (!snippet && plainDescription) {
                  const idx = plainDescription.toLowerCase().indexOf(searchQuery.toLowerCase())
                  if (idx !== -1) {
                    const start = Math.max(0, idx - 30)
                    const end = Math.min(plainDescription.length, idx + 70)
                    snippet = (start > 0 ? '...' : '') + plainDescription.substring(start, end).replace(/\n/g, ' ') + (end < plainDescription.length ? '...' : '')
                  }
                }

                return (
                  <DocumentRow
                    key={doc.id}
                    doc={doc as any}
                    selectedIds={selectedIds}
                    toggleSelect={toggleSelect}
                    searchQuery={searchQuery}
                    folderName={docFolder ? docFolder.name : 'Uncategorized'}
                    snippet={snippet}
                  />
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
            <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-indigo-950/20 border border-indigo-900/40 rounded-2xl text-sm text-indigo-300 animate-fade-in mb-6 gap-3">
              <div className="flex items-center justify-center space-x-3 w-full sm:w-auto">
                <span className="font-semibold text-zinc-200">{selectedFolderIds.size} folders selected</span>
                <span className="text-zinc-700 font-bold">•</span>
                <button
                  onClick={() => setSelectedFolderIds(new Set())}
                  className="text-indigo-400 hover:text-indigo-200 transition-colors font-semibold underline underline-offset-4 cursor-pointer"
                >
                  Deselect All
                </button>
              </div>
              <button
                onClick={handleDeleteSelectedFolders}
                disabled={deletingFolders}
                className="flex items-center justify-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-750 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md w-full sm:w-auto text-center"
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
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('app-loading-start', {
                        detail: { title: 'Loading', subtitle: 'Decrypting catalog components...' }
                      }))
                    }
                  }}
                  className="group relative flex flex-col justify-between p-6 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/60 transition-all duration-300 ease-out hover:scale-[1.02] hover:-translate-y-0.5 shadow-md hover:shadow-lg hover:shadow-indigo-500/5"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      {/* Select Uncategorized Checkbox */}
                      <div
                        onClick={(e) => toggleSelectFolder('uncategorized', e)}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                          selectedFolderIds.has('uncategorized')
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-650'
                        }`}
                      >
                        {selectedFolderIds.has('uncategorized') && (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>

                      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl group-hover:border-zinc-700 transition-colors">
                        <FolderOpen className="w-6 h-6 text-zinc-500 group-hover:text-zinc-400" />
                      </div>
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
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('app-loading-start', {
                          detail: { title: 'Loading', subtitle: 'Decrypting catalog components...' }
                        }))
                      }
                    }}
                    className="group relative flex flex-col justify-between p-6 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/60 transition-all duration-300 ease-out hover:scale-[1.02] hover:-translate-y-0.5 shadow-md hover:shadow-lg hover:shadow-indigo-500/5"
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:items-stretch">
            <div className="lg:col-span-2 flex flex-col">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Upload Documents</h2>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-10 text-center transition-all flex-1 min-h-[250px] ${
                  isDragOver
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700 hover:bg-zinc-900/30'
                }`}
              >
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/jpg,.docx,.doc,.csv,.xlsx,.pptx,.ppt,.txt"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  className="hidden"
                />
                
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl mb-4">
                  <UploadCloud className="w-8 h-8 text-indigo-400" />
                </div>
                
                <h3 className="font-semibold text-zinc-200">Drag & Drop Files Here</h3>
                <p className="text-xs text-zinc-500 max-w-sm mt-2">
                  Supports PDF, PNG, JPG, DOCX, CSV, XLSX, PPTX, PPT, TXT.
                </p>

                {/* Destination Folder Selector */}
                <div className="mt-5 flex flex-col items-center z-10">
                  <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Destination Folder</label>
                  <div className="relative">
                    <select
                      value={uploadTargetFolderId}
                      onChange={(e) => setUploadTargetFolderId(e.target.value)}
                      className="bg-zinc-950 border border-zinc-850 hover:border-zinc-700 text-zinc-300 hover:text-white rounded-xl text-xs px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 appearance-none cursor-pointer pr-10 transition-all font-medium"
                    >
                      <option value="auto">⚡ Auto-categorize with AI</option>
                      <option value="uncategorized">📁 Uncategorized</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>📁 {f.name}</option>
                      ))}
                    </select>
                    <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-zinc-500 text-[10px]">▼</span>
                  </div>
                </div>
                
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

              {/* System Constraints Details Grid */}
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3.5 bg-zinc-900/10 border border-zinc-850 rounded-xl space-y-1.5 flex flex-col justify-center text-left">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Max File Size</span>
                  <span className="text-xs font-extrabold text-indigo-400">50 MB per file</span>
                </div>
                <div className="p-3.5 bg-zinc-900/10 border border-zinc-850 rounded-xl space-y-1.5 flex flex-col justify-center text-left">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Formats</span>
                  <span className="text-xs font-extrabold text-zinc-300 whitespace-normal break-words">PDF, Images, Office (Word/PPT/Excel), CSV, TXT</span>
                </div>
                <div className="p-3.5 bg-zinc-900/10 border border-zinc-850 rounded-xl space-y-1.5 flex flex-col justify-center text-left">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">AI Scanner limit</span>
                  <span className="text-xs font-extrabold text-zinc-400">Unlimited Pages</span>
                </div>
                <div className="p-3.5 bg-zinc-900/10 border border-zinc-850 rounded-xl space-y-1.5 flex flex-col justify-center text-left">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Security layer</span>
                  <span className="text-xs font-extrabold text-emerald-400">Private & Secured</span>
                </div>
              </div>
            </div>

            {/* Upload Queue Panel */}
            <div className="flex flex-col">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Processing Queue</h2>
              <div className="flex-1 bg-zinc-900/20 border border-zinc-850 rounded-2xl p-6 flex flex-col min-h-[300px] lg:min-h-0 lg:max-h-[440px]">
                {uploadQueue.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="w-10 h-10 text-zinc-700 mb-3" />
                    <p className="text-zinc-500 text-sm">No active uploads</p>
                    <p className="text-xs text-zinc-600 mt-1">Uploaded files will queue here.</p>
                  </div>
                ) : (
                  <div className="flex-1 space-y-4 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                    {uploadQueue.map((item) => (
                      <div key={item.id} className="p-3.5 bg-zinc-950 border border-zinc-900 rounded-xl space-y-2.5 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center justify-between gap-4">
                          {item.status === 'done' && item.docId ? (
                            <Link
                              href={`/dashboard/document/${item.docId}`}
                              onClick={() => {
                                if (typeof window !== 'undefined') {
                                  window.dispatchEvent(new CustomEvent('app-loading-start', {
                                    detail: { title: 'Loading Document', subtitle: 'Decrypting secure document contents...' }
                                  }))
                                }
                              }}
                              className="text-xs text-zinc-300 hover:text-indigo-400 font-semibold truncate max-w-[190px] hover:underline"
                              title={`Open ${item.fileName}`}
                            >
                              {item.fileName}
                            </Link>
                          ) : (
                            <span className="text-xs text-zinc-300 font-medium truncate max-w-[190px]" title={item.fileName}>
                              {item.fileName}
                            </span>
                          )}
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            {item.status === 'done' && (
                              <div className="flex items-center space-x-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <button
                                  onClick={() => setUploadQueue((prev) => prev.filter((q) => q.id !== item.id))}
                                  className="p-0.5 text-zinc-650 hover:text-zinc-400 hover:bg-zinc-900 rounded transition-all cursor-pointer"
                                  title="Dismiss"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            {item.status === 'failed' && (
                              <div className="flex items-center space-x-1.5">
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                <button
                                  onClick={() => setUploadQueue((prev) => prev.filter((q) => q.id !== item.id))}
                                  className="p-0.5 text-zinc-650 hover:text-zinc-400 hover:bg-zinc-900 rounded transition-all cursor-pointer"
                                  title="Dismiss"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            {item.status !== 'done' && item.status !== 'failed' && (
                              <div className="flex items-center space-x-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                                <button
                                  onClick={() => cancelUpload(item.id)}
                                  className="p-0.5 text-zinc-550 hover:text-zinc-300 hover:bg-zinc-900 rounded transition-all cursor-pointer"
                                  title="Cancel Upload"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Status Indicator */}
                        <div className="flex items-center text-[10px] min-h-[16px]">
                          {item.status === 'done' ? (
                            <div className="flex items-center w-full gap-2 flex-nowrap overflow-hidden">
                              <span className="flex items-center gap-1 text-zinc-400 text-[10px] min-w-0 flex-1 overflow-hidden">
                                <span className="uppercase text-[9px] tracking-wider text-zinc-500 font-semibold whitespace-nowrap flex-shrink-0">Processed • Saved in</span>
                                <strong className="text-indigo-400 font-bold text-xs truncate">{item.folderName || 'Uncategorized'}</strong>
                              </span>
                              {item.docId && (
                                <Link
                                  href={`/dashboard/document/${item.docId}`}
                                  onClick={() => {
                                    if (typeof window !== 'undefined') {
                                      window.dispatchEvent(new CustomEvent('app-loading-start', {
                                        detail: { title: 'Loading Document', subtitle: 'Decrypting secure document contents...' }
                                      }))
                                    }
                                  }}
                                  className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold hover:underline transition-colors flex-shrink-0"
                                >
                                  <span>Open</span>
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-500 uppercase tracking-wider font-semibold text-[9px]">
                              {item.status === 'queued' && 'Queued...'}
                              {item.status === 'uploading' && 'Uploading...'}
                              {item.status === 'ocr' && 'Extracting text (OCR)...'}
                              {item.status === 'categorizing' && 'Auto-categorizing...'}
                              {item.status === 'failed' && 'Failed'}
                            </span>
                          )}
                        </div>

                        {/* Progress bar simulation */}
                        <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              item.status === 'queued' ? 'w-1/12 bg-zinc-800' :
                              item.status === 'uploading' ? 'w-1/4 bg-indigo-500' :
                              item.status === 'ocr' ? 'w-2/3 bg-indigo-500' :
                              item.status === 'categorizing' ? 'w-11/12 bg-indigo-500' :
                              item.status === 'done' ? 'w-full bg-emerald-500' :
                              'w-full bg-indigo-500'
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
                <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs p-3 rounded-lg">
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
