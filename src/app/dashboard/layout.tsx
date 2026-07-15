'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { FileText, LogOut, Folder, Plus } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string | null>(null)

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
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b]">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/dashboard" className="flex items-center space-x-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/20">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                PaperWeights
              </span>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            <span className="hidden sm:inline-block text-sm text-zinc-400 font-medium">
              {userEmail}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-all cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
