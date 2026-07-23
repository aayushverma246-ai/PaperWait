'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { FileText, LogOut, Loader2, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { UploadProvider, useUpload } from './UploadContext'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <UploadProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </UploadProvider>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const {
    uploadQueue,
    duplicateFile,
    setDuplicateFile,
    duplicateExistingDoc,
    setDuplicateExistingDoc,
    pendingUploadsQueue,
    setPendingUploadsQueue,
    uploadFile,
    processUploadQueue
  } = useUpload()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email ?? 'Authenticated User')
      }
    }
    getUser()
  }, [supabase])

  const handleSignOut = async () => {
    setIsSigningOut(true)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-loading-start', {
        detail: { title: 'Signing Out', subtitle: 'Terminating secure session...' }
      }))
    }
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Sign out error:', err)
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  // Count active uploads in the background
  const activeUploadsCount = uploadQueue.filter(
    (item) => item.status !== 'done' && item.status !== 'failed'
  ).length

  // Only show the floating status widget if we are NOT on the main dashboard page
  const showFloatingWidget = activeUploadsCount > 0 && pathname !== '/dashboard'

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b]">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/dashboard"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('app-loading-start', {
                    detail: { title: 'Loading Dashboard', subtitle: 'Decrypting catalog structure...' }
                  }))
                }
              }}
              className="flex items-center space-x-2.5"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                PaperWait
              </span>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            <span className="hidden sm:inline-block text-sm text-zinc-400 font-medium">
              {userEmail}
            </span>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 active:scale-95 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-all duration-100 cursor-pointer disabled:opacity-50"
            >
              {isSigningOut ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">
                {isSigningOut ? 'Signing Out...' : 'Sign Out'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
        {children}
      </main>

      {/* Floating Upload Progress Widget */}
      {showFloatingWidget && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-3.5 bg-zinc-950/90 border border-zinc-800/80 backdrop-blur-md rounded-2xl shadow-2xl animate-fade-in shadow-indigo-500/10 hover:border-zinc-750 transition-all">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
          <span className="text-xs font-semibold text-zinc-200">
            Processing {activeUploadsCount} document{activeUploadsCount > 1 ? 's' : ''} in background...
          </span>
        </div>
      )}

      {/* Global Duplicate File Conflict Modal */}
      {duplicateFile && duplicateExistingDoc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-md px-4 animate-fade-in">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-6">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-lg font-bold text-white">Duplicate File Detected</h3>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              A file named <strong className="text-zinc-200">"{duplicateFile.name}"</strong> already exists in your collection. What would you like to do?
            </p>

            <div className="flex flex-col space-y-2.5">
              <button
                type="button"
                onClick={async () => {
                  const docToReplace = duplicateExistingDoc
                  const fileToUpload = duplicateFile
                  const nextQueue = [...pendingUploadsQueue]

                  setDuplicateFile(null)
                  setDuplicateExistingDoc(null)
                  setPendingUploadsQueue([])

                  await uploadFile(fileToUpload, docToReplace.id)
                  processUploadQueue(nextQueue)
                }}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-semibold rounded-xl text-xs transition-all shadow-md shadow-indigo-500/25 cursor-pointer text-center"
              >
                Replace Existing version
              </button>

              <button
                type="button"
                onClick={() => {
                  const file = duplicateFile
                  const nextQueue = [...pendingUploadsQueue]

                  setDuplicateFile(null)
                  setDuplicateExistingDoc(null)
                  setPendingUploadsQueue([])

                  const dotIndex = file.name.lastIndexOf('.')
                  let baseName = file.name
                  let extension = ''
                  if (dotIndex !== -1) {
                    baseName = file.name.substring(0, dotIndex)
                    extension = file.name.substring(dotIndex)
                  }
                  
                  let counter = 1
                  let newName = `${baseName} (${counter})${extension}`
                  
                  // Simple renaming logic using basic counter
                  const renamedFile = new File([file], newName, { type: file.type })
                  uploadFile(renamedFile)
                  processUploadQueue(nextQueue)
                }}
                className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 hover:text-white font-semibold rounded-xl text-xs border border-zinc-750 transition-all cursor-pointer text-center"
              >
                Keep Both (rename to copy)
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextQueue = [...pendingUploadsQueue]
                  setDuplicateFile(null)
                  setDuplicateExistingDoc(null)
                  setPendingUploadsQueue([])
                  processUploadQueue(nextQueue)
                }}
                className="w-full py-2.5 px-4 bg-transparent hover:bg-zinc-850/50 text-zinc-500 hover:text-zinc-300 font-semibold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                Skip Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
