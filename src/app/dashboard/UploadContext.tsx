'use client'

import React, { createContext, useContext, useState, useRef, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'

export interface UploadQueueItem {
  id: string
  fileName: string
  status: 'queued' | 'uploading' | 'ocr' | 'categorizing' | 'done' | 'failed'
  error?: string
  folderName?: string
  docId?: string
}

export interface DBDocument {
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

interface UploadContextType {
  uploadQueue: UploadQueueItem[]
  setUploadQueue: React.Dispatch<React.SetStateAction<UploadQueueItem[]>>
  uploadTargetFolderId: string
  setUploadTargetFolderId: (id: string) => void
  uploadFile: (file: File, replaceDocId?: string, batchHint?: string, existingQueueId?: string) => Promise<void>
  cancelUpload: (queueId: string) => Promise<void>
  processUploadQueue: (filesToUpload: File[]) => Promise<void>
  duplicateFile: File | null
  setDuplicateFile: (file: File | null) => void
  duplicateExistingDoc: DBDocument | null
  setDuplicateExistingDoc: (doc: DBDocument | null) => void
  pendingUploadsQueue: File[]
  setPendingUploadsQueue: (files: File[]) => void
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState('auto')

  // Conflict resolution states
  const [duplicateFile, setDuplicateFile] = useState<File | null>(null)
  const [duplicateExistingDoc, setDuplicateExistingDoc] = useState<DBDocument | null>(null)
  const [pendingUploadsQueue, setPendingUploadsQueue] = useState<File[]>([])

  // Abort and cancellation refs
  const cancelledQueueIds = useRef<Set<string>>(new Set())
  const activeControllers = useRef<Map<string, AbortController>>(new Map())

  // Cancel upload handler
  const cancelUpload = useCallback(async (queueId: string) => {
    cancelledQueueIds.current.add(queueId)
    const controller = activeControllers.current.get(queueId)
    if (controller) {
      controller.abort()
      activeControllers.current.delete(queueId)
    }
    setUploadQueue((prev) => prev.filter((item) => item.id !== queueId))
  }, [])

  // File upload logic
  const uploadFile = useCallback(async (file: File, replaceDocId?: string, batchHint?: string, existingQueueId?: string) => {
    const queueId = existingQueueId || crypto.randomUUID()
    
    // Add to queue
    if (!existingQueueId) {
      setUploadQueue((prev) => [
        { id: queueId, fileName: replaceDocId ? `${file.name} (Replacing)` : file.name, status: 'uploading' },
        ...prev,
      ])
    } else {
      setUploadQueue((prev) =>
        prev.map((item) => (item.id === queueId ? { ...item, status: 'uploading' } : item))
      )
    }

    const updateItemStatus = (status: UploadQueueItem['status'], error?: string) => {
      setUploadQueue((prev) =>
        prev.map((item) => (item.id === queueId ? { ...item, status, error } : item))
      )
    }

    const controller = new AbortController()
    activeControllers.current.set(queueId, controller)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User session not found')
      const userId = user.id

      const documentId = replaceDocId || crypto.randomUUID()
      const storagePath = `${userId}/${documentId}/${file.name}`

      // Check if cancelled before starting upload
      if (cancelledQueueIds.current.has(queueId)) {
        throw new Error('Upload cancelled')
      }

      // Step 1: Upload the file directly to Supabase Storage (bypasses 4.5MB Vercel serverless request body size limits!)
      const isStandardType = file.type === 'application/pdf' || file.type.startsWith('image/')
      const uploadContentType = isStandardType ? file.type : 'application/pdf'
      const fileToUpload = isStandardType ? file : new File([file], file.name, { type: 'application/pdf' })

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, fileToUpload, {
          contentType: uploadContentType,
          upsert: true,
        })

      if (uploadError) {
        throw new Error(`Direct storage upload failed: ${uploadError.message}`)
      }

      // Check if cancelled during storage upload
      if (cancelledQueueIds.current.has(queueId)) {
        await supabase.storage.from('documents').remove([storagePath])
        throw new Error('Upload cancelled')
      }

      // Step 2: Post document metadata to the Vercel API endpoint
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId,
          fileName: file.name,
          fileType: file.type,
          storagePath,
          folderId: uploadTargetFolderId,
          replaceDocId: replaceDocId || null,
          batchHint: batchHint || null,
        }),
        signal: controller.signal,
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to initialize processing')
      }

      // Check if cancelled before entering polling phase
      if (cancelledQueueIds.current.has(queueId)) {
        await supabase.from('documents').delete().eq('id', result.id)
        await supabase.storage.from('documents').remove([storagePath])
        throw new Error('Upload cancelled')
      }

      // The document is now in 'processing' state — poll until it completes
      const docId = result.id
      updateItemStatus('ocr')

      // Poll for completion every 1.5 seconds
      const pollForCompletion = async (): Promise<any> => {
        const maxAttempts = 120 // 3 minutes max
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500))

          // Check if cancelled during polling
          if (cancelledQueueIds.current.has(queueId)) {
            await supabase.from('documents').delete().eq('id', docId)
            await supabase.storage.from('documents').remove([storagePath, `${userId}/previews/${docId}.png`])
            throw new Error('Upload cancelled')
          }

          // Transition UI through stages for visual feedback
          if (attempt === 2) updateItemStatus('categorizing')

          const { data: doc, error } = await supabase
            .from('documents')
            .select('id, status, folder_id, ocr_text')
            .eq('id', docId)
            .single()

          if (error) continue

          if (doc.status === 'done') {
            return doc
          } else if (doc.status === 'failed') {
            const failMsg = doc.ocr_text?.replace('Processing failed: ', '') || 'Processing failed'
            throw new Error(failMsg)
          }
        }
        throw new Error('Document processing timed out')
      }

      const completedDoc = await pollForCompletion()

      // Dispatch global event so any mounted page list knows to silent-refresh its list
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('document-processed'))
      }

      // Look up folder name
      let destFolderName = 'Uncategorized'
      if (completedDoc.folder_id) {
        const { data: latestFolder } = await supabase
          .from('folders')
          .select('name')
          .eq('id', completedDoc.folder_id)
          .single()
        if (latestFolder) {
          destFolderName = latestFolder.name
        }
      }

      setUploadQueue((prev) =>
        prev.map((item) => (item.id === queueId ? { ...item, status: 'done', folderName: destFolderName, docId: completedDoc.id } : item))
      )
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Upload cancelled') {
        return
      }
      updateItemStatus('failed', err.message || 'An error occurred during processing')
    } finally {
      activeControllers.current.delete(queueId)
    }
  }, [supabase, uploadTargetFolderId])

  // Extract common words from batch filenames for intelligent grouping
  const extractBatchHint = (fileNames: string[]): string => {
    if (fileNames.length <= 1) return ''

    // Normalize: strip extensions, replace separators with spaces, lowercase
    const normalized = fileNames.map(name =>
      name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').toLowerCase().trim()
    )

    // Count word frequency across all filenames
    const wordCounts = new Map<string, number>()
    normalized.forEach(n => {
      const words = new Set(n.split(/\s+/).filter(w => w.length >= 3))
      words.forEach(word => {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
      })
    })

    // Find words that appear in at least half of the filenames (and more than once)
    const threshold = Math.max(2, Math.ceil(fileNames.length * 0.5))
    const commonWords = [...wordCounts.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word)

    return commonWords.slice(0, 4).join(' ')
  }

  // Process selected uploads sequentially or with limited concurrency
  const processUploadQueue = useCallback(async (filesToUpload: File[]) => {
    const nextPending = [...filesToUpload]
    const duplicates: { file: File; existing: any }[] = []

    // Extract batch hint from all filenames for intelligent grouping
    const batchHint = extractBatchHint(nextPending.map(f => f.name))

    // Fetch existing documents from Supabase to check conflicts
    const { data: currentDocs } = await supabase
      .from('documents')
      .select('id, file_name, storage_path')

    const existingDocs = currentDocs || []

    const queueItemsToAdd: UploadQueueItem[] = []
    const filesToProcess: { file: File; queueId: string }[] = []

    for (const file of nextPending) {
      // Detect and rename generic image files to avoid naming conflicts on upload
      let fileToProcess = file
      const isGenericImageName = (name: string): boolean => {
        const lower = name.toLowerCase()
        return (
          lower === 'image.png' ||
          lower === 'image.jpg' ||
          lower === 'image.jpeg' ||
          lower === 'image.webp' ||
          lower === 'image.gif' ||
          lower.startsWith('image (') || // e.g. "image (1).png"
          lower.startsWith('camera_capture_') ||
          lower.startsWith('captured_image_')
        )
      }

      if (isGenericImageName(file.name)) {
        const dotIndex = file.name.lastIndexOf('.')
        const ext = dotIndex !== -1 ? file.name.substring(dotIndex) : '.png'
        const uniqueName = `image_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`
        fileToProcess = new File([file], uniqueName, { type: file.type })
      }

      // Client-side validations
      const maxSizeBytes = 50 * 1024 * 1024 // 50MB
      const allowedTypes = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/msword', // .doc
        'text/csv', // .csv
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'text/plain', // .txt
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
        'application/vnd.ms-powerpoint', // .ppt
      ]
      
      let validationError = ''
      if (!allowedTypes.includes(fileToProcess.type)) {
        validationError = 'Unsupported file format. Supported: PDF, PNG, JPG, DOCX, CSV, XLSX, PPTX, PPT, TXT'
      }

      if (validationError) {
        const queueId = crypto.randomUUID()
        queueItemsToAdd.push({ id: queueId, fileName: fileToProcess.name, status: 'failed', error: validationError })
        continue
      }

      // Check if file_name already exists in documents list
      const existingDoc = existingDocs.find(
        (d) => d.file_name.toLowerCase() === fileToProcess.name.toLowerCase()
      )
      if (existingDoc) {
        duplicates.push({ file: fileToProcess, existing: existingDoc })
      } else {
        // Prepare queued item
        const queueId = crypto.randomUUID()
        queueItemsToAdd.push({ id: queueId, fileName: fileToProcess.name, status: 'queued' })
        filesToProcess.push({ file: fileToProcess, queueId })
      }
    }

    if (queueItemsToAdd.length > 0) {
      setUploadQueue((prev) => [...queueItemsToAdd, ...prev])
    }

    // Process files sequentially or with limited concurrency (limit to 2 active tasks)
    const runQueue = async () => {
      const limit = 2
      let index = 0
      
      const worker = async () => {
        while (index < filesToProcess.length) {
          const currentIdx = index++
          const { file, queueId } = filesToProcess[currentIdx]
          try {
            // Only apply batchHint if the file name contains one of the common batch words
            let fileSpecificBatchHint = undefined
            if (batchHint) {
              const hintWords = batchHint.split(/\s+/).filter(Boolean)
              const fileNameLower = file.name.toLowerCase()
              const hasCommonWord = hintWords.some(word => fileNameLower.includes(word))
              if (hasCommonWord) {
                fileSpecificBatchHint = batchHint
              }
            }
            await uploadFile(file, undefined, fileSpecificBatchHint, queueId)
          } catch (err) {
            console.error('Queue item failed:', file.name, err)
          }
        }
      }

      const workers = Array.from({ length: Math.min(limit, filesToProcess.length) }, worker)
      await Promise.all(workers)
    }

    runQueue()

    // If we have duplicates, trigger conflict modal for the first one
    if (duplicates.length > 0) {
      const firstDuplicate = duplicates[0]
      const remainingDuplicates = duplicates.slice(1).map((d) => d.file)
      setDuplicateFile(firstDuplicate.file)
      setDuplicateExistingDoc(firstDuplicate.existing)
      setPendingUploadsQueue(remainingDuplicates)
    }
  }, [supabase, uploadFile])

  return (
    <UploadContext.Provider
      value={{
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
      }}
    >
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const context = useContext(UploadContext)
  if (!context) {
    throw new Error('useUpload must be used within an UploadProvider')
  }
  return context
}
