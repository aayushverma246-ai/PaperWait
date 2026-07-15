'use client'

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
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
  Trash2
} from 'lucide-react'
import VelocityLoader from '@/components/VelocityLoader'

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

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const supabase = createClient()

  const [document, setDocument] = useState<DBDocument | null>(null)
  const [folders, setFolders] = useState<DBFolder[]>([])
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [moving, setMoving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Load document
      const { data: docData, error: docErr } = await supabase
        .from('documents')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (docErr) throw docErr
      setDocument(docData)

      // Load all folders
      const { data: foldersData, error: foldersErr } = await supabase
        .from('folders')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (foldersErr) throw foldersErr
      setFolders(foldersData || [])

      // Generate signed URL
      const { data: urlData, error: urlErr } = await supabase.storage
        .from('documents')
        .createSignedUrl(docData.storage_path, 3600) // 1 hour expiry

      if (urlErr) throw urlErr
      setSignedUrl(urlData.signedUrl)

    } catch (err) {
      console.error('Error loading document details:', err)
      router.push('/dashboard')
    } finally {
      setLoading(false)
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

  // Copy OCR Text
  const handleCopyText = () => {
    if (!document?.ocr_text) return
    navigator.clipboard.writeText(document.ocr_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
  const handleDeleteDoc = async () => {
    if (!document) return
    if (!confirm('Are you sure you want to delete this document permanently?')) return

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to delete document')
      }

      router.push(backPath)
    } catch (err: any) {
      alert(err.message)
    }
  }

  if (loading) {
    return (
      <VelocityLoader
        title="Loading Document"
        subtitle="Decrypting secure document contents..."
      />
    )
  }

  if (!document) return null

  const isPdf = document.file_type === 'application/pdf'
  const backPath = document.folder_id
    ? `/dashboard/folder/${document.folder_id}`
    : '/dashboard/folder/uncategorized'

  return (
    <div className="space-y-8">
      {/* Back button & title header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link
            href={backPath}
            className="p-2 border border-zinc-800 bg-zinc-900/40 rounded-xl text-zinc-400 hover:text-zinc-200 transition-colors"
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

        <div className="flex items-center space-x-3">
          {signedUrl && (
            <>
              <a
                href={signedUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-2 px-3 py-2 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden md:inline">Open Original</span>
              </a>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center space-x-2 px-3 py-2 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span className="hidden md:inline">{downloading ? 'Downloading...' : 'Download'}</span>
              </button>
            </>
          )}
          
          <button
            onClick={handleDeleteDoc}
            className="flex items-center space-x-2 px-3 py-2 border border-red-500/20 bg-red-950/10 hover:bg-red-950/20 text-red-400 rounded-xl text-sm font-semibold transition-all cursor-pointer"
            title="Delete Document permanently"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden md:inline">Delete Document</span>
          </button>
        </div>
      </div>

      {/* Main split display */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Column: File Preview */}
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-2xl overflow-hidden flex flex-col h-[550px]">
          <div className="p-4 border-b border-zinc-850 bg-zinc-950/60 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Document Preview</span>
            <span className="text-[10px] bg-zinc-800/80 text-zinc-400 font-semibold px-2 py-0.5 rounded uppercase">
              {document.file_type.split('/')[1] || document.file_type}
            </span>
          </div>

          <div className="flex-1 bg-zinc-950 flex items-center justify-center p-2">
            {signedUrl ? (
              isPdf ? (
                <iframe
                  src={`${signedUrl}#toolbar=0`}
                  className="w-full h-full rounded-lg border-0"
                  title="PDF Preview"
                />
              ) : (
                <img
                  src={signedUrl}
                  alt={document.file_name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                />
              )
            ) : (
              <div className="text-center text-zinc-600">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No preview available</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Metadata & OCR Text */}
        <div className="flex flex-col space-y-8">
          
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
                    className="block w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500/50 text-sm appearance-none cursor-pointer"
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

          {/* What is this document for */}
          <div className="bg-zinc-900/20 border border-zinc-850 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[250px]">
            <div className="p-4 border-b border-zinc-850 bg-zinc-950/60 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-red-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Document Purpose</span>
              </div>
            </div>

            <div className="flex-1 p-6 bg-zinc-950/40 flex flex-col justify-center text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="inline-flex items-center justify-center p-3 bg-red-500/10 text-red-400 rounded-2xl border border-red-500/10">
                  <FileText className="w-6 h-6" />
                </div>
                <h3 className="text-zinc-200 font-bold text-lg">What is this document for?</h3>
                <p className="text-zinc-400 text-sm leading-relaxed italic">
                  "{document.description || 'This document has been processed and indexed for global searches.'}"
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
