'use client'

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  Folder,
  ArrowLeft,
  Edit2,
  Trash2,
  FileText,
  Clock,
  ExternalLink,
  Loader2,
  ChevronRight,
  Info,
  Search,
  X
} from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import SearchInput from '@/components/SearchInput'
import DocumentRow from '@/components/DocumentRow'

interface DBFolder {
  id: string
  name: string
  created_at: string
}

interface DBDocument {
  id: string
  file_name: string
  file_type: string
  storage_path: string
  status: string
  partially_scanned: boolean
  created_at: string
  ocr_text: string | null
  description: string | null
  signedUrl?: string | null
  thumbnailError?: boolean
}


export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const supabase = createClient()

  const isUncategorized = id === 'uncategorized'

  const [folder, setFolder] = useState<DBFolder | null>(null)
  const [documents, setDocuments] = useState<DBDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSubtitle, setLoadingSubtitle] = useState("Decrypting catalog components...")

  // Actions states
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)

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

  const [searchQuery, setSearchQuery] = useState('')
  const [deletingAll, setDeletingAll] = useState(false)

  // Filter documents by name or content or description
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

  const loadData = useCallback(async () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-loading-start', {
        detail: { title: 'Loading Folder', subtitle: 'Decrypting catalog components...' }
      }))
    }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Load folder details (if not uncategorized)
      if (!isUncategorized) {
        const { data: folderData, error: folderErr } = await supabase
          .from('folders')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single()

        if (folderErr) throw folderErr
        setFolder(folderData)
        setRenameValue(folderData.name)
      } else {
        setFolder({
          id: 'uncategorized',
          name: 'Uncategorized',
          created_at: '',
        })
      }

      // Load documents
      const query = supabase
        .from('documents')
        .select('id, file_name, file_type, storage_path, status, partially_scanned, created_at, ocr_text, description')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (isUncategorized) {
        query.is('folder_id', null)
      } else {
        query.eq('folder_id', id)
      }

      const { data: docsData, error: docsErr } = await query
      if (docsErr) throw docsErr

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

      // Preload all thumbnail images to prevent blank squares
      if (docsWithUrls && docsWithUrls.length > 0) {
        try {
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
                d.thumbnailError = true
                resolve()
              }
            })
          })
          await Promise.all(preloadPromises)
        } catch (preloadErr) {
          console.warn('Thumbnail preloading failed:', preloadErr)
        }
      }

      setDocuments(docsWithUrls)
      setSelectedIds(new Set())
    } catch (err) {
      console.error('Error loading folder page:', err)
      router.push('/dashboard')
    } finally {
      setLoading(false)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-loading-stop'))
        sessionStorage.removeItem('next_loading_type')
      }
    }
  }, [supabase, id, isUncategorized, router])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Handle Rename
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameValue.trim() || renameValue.trim() === folder?.name) {
      setIsRenaming(false)
      return
    }

    setRenameSubmitting(true)
    setRenameError('')

    try {
      const response = await fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to rename folder')
      }

      setFolder((prev) => prev ? { ...prev, name: result.name } : null)
      setIsRenaming(false)
    } catch (err: any) {
      setRenameError(err.message)
    } finally {
      setRenameSubmitting(false)
    }
  }

  // Handle Delete Folder Confirmation Trigger
  const triggerDeleteFolderConfirm = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Folder?',
      message: 'WARNING: Deletions are permanent. Deleting this folder will permanently delete ALL documents inside it from the database and storage. This cannot be undone.',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/folders/${id}`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            const result = await response.json()
            throw new Error(result.error || 'Failed to delete folder')
          }

          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('app-loading-start', {
              detail: { title: 'Deleting Folder', subtitle: 'Permanently purging folder assets...' }
            }))
          }
          setLoading(true)
          router.push('/dashboard')
          router.refresh()
        } catch (err) {
          console.error('Delete folder failed:', err)
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  // Handle Delete Document
  const handleDeleteDoc = (e: React.MouseEvent, docId: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    setConfirmModal({
      isOpen: true,
      title: 'Delete Document?',
      message: 'Are you sure you want to delete this document permanently? This cannot be undone.',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/documents/${docId}`, {
            method: 'DELETE',
          })
          if (!response.ok) {
            const result = await response.json()
            throw new Error(result.error || 'Failed to delete document')
          }
          setDocuments((prev) => prev.filter((d) => d.id !== docId))
        } catch (err: any) {
          alert(err.message)
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  // Handle Delete All Documents in Uncategorized/Folder
  const handleDeleteAllDocs = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete All Documents?',
      message: 'Are you sure you want to delete ALL documents in this folder? This action cannot be undone.',
      onConfirm: async () => {
        setDeletingAll(true)
        try {
          const response = await fetch(`/api/folders/${id}/documents`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            const result = await response.json()
            throw new Error(result.error || 'Failed to delete documents')
          }

          setDocuments([])
          setSearchQuery('')
        } catch (err: any) {
          alert(err.message)
        } finally {
          setDeletingAll(false)
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  if (loading) {
    return null
  }

  return (
    <div className="space-y-8">
      {/* Back button & header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/60 pb-6">
        <div className="flex items-center space-x-4 min-w-0">
          <Link
            href="/dashboard"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('app-loading-start', {
                  detail: { title: 'Loading', subtitle: 'Decrypting catalog structure...' }
                }))
              }
            }}
            className="p-2 border border-zinc-800 bg-zinc-900/40 rounded-xl text-zinc-400 hover:text-zinc-200 transition-all duration-200 ease-out hover:scale-[1.05] active:scale-[0.95] flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-3">
              <span className="text-zinc-500 font-semibold text-xs uppercase tracking-wider">Folder</span>
              {isUncategorized && (
                <span className="text-xs font-semibold px-2 py-0.5 bg-zinc-850 text-zinc-400 border border-zinc-800 rounded-full">
                  System Default
                </span>
              )}
            </div>
            {isRenaming ? (
              <form onSubmit={handleRename} className="flex items-center space-x-3 mt-1 max-w-md">
                <input
                  type="text"
                  required
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button
                  type="submit"
                  disabled={renameSubmitting}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-750 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {renameSubmitting ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(false)
                    setRenameValue(folder?.name || '')
                    setRenameError('')
                  }}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center space-x-3 mt-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white truncate">
                  {folder?.name}
                </h1>
                {!isUncategorized && (
                  <button
                    onClick={() => setIsRenaming(true)}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-900/50 cursor-pointer"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {renameError && <p className="text-red-400 text-xs mt-1">{renameError}</p>}
          </div>
        </div>

        {/* Delete actions */}
        {isUncategorized ? (
          documents.length > 0 && (
            <button
              onClick={handleDeleteAllDocs}
              disabled={deletingAll}
              className="flex items-center space-x-2 px-3 py-2 border border-indigo-500/20 bg-indigo-950/10 hover:bg-indigo-950/20 text-indigo-400 rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>{deletingAll ? 'Deleting All...' : 'Delete All Docs'}</span>
            </button>
          )
        ) : (
          <button
            onClick={triggerDeleteFolderConfirm}
            className="flex items-center space-x-2 px-3 py-2 border border-indigo-500/20 bg-indigo-950/10 hover:bg-indigo-950/20 text-indigo-400 rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span className="inline">Delete Folder</span>
          </button>
        )}
      </div>

      {/* Search Input Bar */}
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search this folder by name or content..."
      />

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

      {/* List of Documents */}
      <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-850 flex items-center justify-between">
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
            <h2 className="font-semibold text-zinc-300">Documents in this folder</h2>
          </div>
          <span className="text-xs bg-zinc-800/60 text-zinc-400 font-semibold px-2.5 py-1 rounded-full">
            {filteredDocs.length} files
          </span>
        </div>

        {filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
            <FileText className="w-12 h-12 text-zinc-850 mb-3" />
            <p className="font-medium text-zinc-400">No documents found</p>
            <p className="text-xs text-zinc-600 mt-1 max-w-xs">
              {searchQuery ? 'No documents match your search criteria.' : 'Upload documents on the main dashboard to have them auto-categorized here.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-900">
            {filteredDocs.map((doc) => {
              // Context snippet
              let snippet = ''
              if (searchQuery && doc.ocr_text) {
                const idx = doc.ocr_text.toLowerCase().indexOf(searchQuery.toLowerCase())
                if (idx !== -1) {
                  const start = Math.max(0, idx - 20)
                  const end = Math.min(doc.ocr_text.length, idx + 50)
                  snippet = (start > 0 ? '...' : '') + doc.ocr_text.substring(start, end).replace(/\n/g, ' ') + (end < doc.ocr_text.length ? '...' : '')
                }
              }
              if (searchQuery && !snippet && doc.description) {
                let plainDescription = doc.description || ''
                if (plainDescription.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(plainDescription)
                    plainDescription = parsed.short_summary || parsed.description || ''
                  } catch (e) {}
                }
                const idx = plainDescription.toLowerCase().indexOf(searchQuery.toLowerCase())
                if (idx !== -1) {
                  const start = Math.max(0, idx - 20)
                  const end = Math.min(plainDescription.length, idx + 50)
                  snippet = (start > 0 ? '...' : '') + plainDescription.substring(start, end).replace(/\n/g, ' ') + (end < plainDescription.length ? '...' : '')
                }
              }
              
              return (
                <DocumentRow
                  key={doc.id}
                  doc={doc as any}
                  selectedIds={selectedIds}
                  toggleSelect={toggleSelect}
                  handleDeleteDoc={handleDeleteDoc}
                  searchQuery={searchQuery}
                  snippet={snippet}
                />
              )
            })}
          </div>
        )}
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
