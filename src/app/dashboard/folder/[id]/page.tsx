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

interface DBFolder {
  id: string
  name: string
  created_at: string
}

interface DBDocument {
  id: string
  file_name: string
  file_type: string
  status: string
  partially_scanned: boolean
  created_at: string
  ocr_text: string | null
}

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const supabase = createClient()

  const isUncategorized = id === 'uncategorized'

  const [folder, setFolder] = useState<DBFolder | null>(null)
  const [documents, setDocuments] = useState<DBDocument[]>([])
  const [loading, setLoading] = useState(true)

  // Actions states
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)

  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [deletingAll, setDeletingAll] = useState(false)

  // Filter documents by name or content
  const filteredDocs = documents.filter((doc) => {
    const nameMatch = doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    const contentMatch = doc.ocr_text && doc.ocr_text.toLowerCase().includes(searchQuery.toLowerCase())
    return nameMatch || contentMatch
  })

  const loadData = useCallback(async () => {
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
        .select('id, file_name, file_type, status, partially_scanned, created_at, ocr_text')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (isUncategorized) {
        query.is('folder_id', null)
      } else {
        query.eq('folder_id', id)
      }

      const { data: docsData, error: docsErr } = await query
      if (docsErr) throw docsErr

      setDocuments(docsData || [])
    } catch (err) {
      console.error('Error loading folder page:', err)
      router.push('/dashboard')
    } finally {
      setLoading(false)
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

  // Handle Delete Folder
  const handleDelete = async () => {
    setDeleteSubmitting(true)

    try {
      const response = await fetch(`/api/folders/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete folder')
      }

      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      console.error('Delete folder failed:', err)
      setDeleteSubmitting(false)
      setIsDeleting(false)
    }
  }

  // Handle Delete Document
  const handleDeleteDoc = async (e: React.MouseEvent, docId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this document permanently?')) return

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
    }
  }

  // Handle Delete All Documents in Uncategorized/Folder
  const handleDeleteAllDocs = async () => {
    if (!confirm('Are you sure you want to delete ALL documents in this folder? This action cannot be undone.')) return
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
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 text-zinc-400">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <span>Loading folder details...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Back button & header bar */}
      <div className="flex items-center space-x-4">
        <Link
          href="/dashboard"
          className="p-2 border border-zinc-800 bg-zinc-900/40 rounded-xl text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
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
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
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
              <h1 className="text-3xl font-extrabold tracking-tight text-white truncate">
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

        {/* Delete actions */}
        {isUncategorized ? (
          documents.length > 0 && (
            <button
              onClick={handleDeleteAllDocs}
              disabled={deletingAll}
              className="flex items-center space-x-2 px-3 py-2 border border-red-500/20 bg-red-950/10 hover:bg-red-950/20 text-red-400 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>{deletingAll ? 'Deleting All...' : 'Delete All Docs'}</span>
            </button>
          )
        ) : (
          <button
            onClick={() => setIsDeleting(true)}
            className="flex items-center space-x-2 px-3 py-2 border border-red-500/20 bg-red-950/10 hover:bg-red-950/20 text-red-400 rounded-xl text-sm font-semibold transition-all cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Delete Folder</span>
          </button>
        )}
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
          placeholder="Search this folder by name or content..."
          className="block w-full pl-11 pr-10 py-2.5 bg-zinc-900/30 border border-zinc-800 hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-zinc-100 placeholder-zinc-500 text-sm rounded-xl transition-all"
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

      {/* List of Documents */}
      <div className="bg-zinc-900/10 border border-zinc-850 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-zinc-850 flex items-center justify-between">
          <h2 className="font-semibold text-zinc-300">Documents in this folder</h2>
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
            {filteredDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/dashboard/document/${doc.id}`}
                className="group flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 hover:bg-zinc-900/30 transition-all"
              >
                <div className="flex items-center space-x-4 min-w-0">
                  <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-xl text-zinc-400 group-hover:text-indigo-400 group-hover:border-indigo-500/10 transition-all flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-zinc-200 font-semibold truncate group-hover:text-white transition-colors">
                      {doc.file_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                        {doc.file_type.split('/')[1] || doc.file_type}
                      </span>
                      <span className="text-zinc-700 text-xs hidden sm:inline">•</span>
                      <div className="flex items-center space-x-1 text-zinc-500 text-xs">
                        <Clock className="w-3.5 h-3.5" />
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
                    </div>
                  </div>
                </div>

                {/* Status Badge & Actions */}
                <div className="flex items-center justify-between sm:justify-end mt-4 sm:mt-0 space-x-4">
                  <span
                    className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full font-semibold border ${
                      doc.status === 'done'
                        ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30'
                        : doc.status === 'failed'
                        ? 'bg-red-950/20 text-red-400 border-red-900/30'
                        : 'bg-indigo-950/20 text-indigo-400 border-indigo-900/30 animate-pulse'
                    }`}
                  >
                    {doc.status === 'done' && 'Ready'}
                    {doc.status === 'failed' && 'Failed'}
                    {doc.status === 'processing' && 'Processing...'}
                  </span>
                  
                  <button
                    onClick={(e) => handleDeleteDoc(e, doc.id)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 border border-transparent hover:border-red-900/30 rounded-lg transition-all cursor-pointer flex-shrink-0"
                    title="Delete Document"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  
                  <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all hidden sm:block flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Delete Folder Modal */}
      {isDeleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">Delete Folder?</h3>
            
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start space-x-3 mb-6">
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed font-semibold">
                WARNING: Deletions are permanent. Deleting this folder will permanently delete ALL documents inside it from the database and storage. This cannot be undone.
              </p>
            </div>
            
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setIsDeleting(false)}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteSubmitting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-red-600/20 disabled:opacity-50 cursor-pointer"
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
