import React, { useState, useEffect } from 'react'
import { FileText, Folder, Sparkles } from 'lucide-react'

interface VelocityLoaderProps {
  title?: string
  subtitle?: string
}

export default function VelocityLoader({
  title = "Loading Dashboard",
  subtitle = "Preparing secure document safe..."
}: VelocityLoaderProps) {
  const [displayTitle, setDisplayTitle] = useState(title)
  const [displaySubtitle, setDisplaySubtitle] = useState(subtitle)
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    if (title !== displayTitle || subtitle !== displaySubtitle) {
      setIsFading(true)
      const timer = setTimeout(() => {
        setDisplayTitle(title)
        setDisplaySubtitle(subtitle)
        setIsFading(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [title, subtitle, displayTitle, displaySubtitle])

  return (
    <div className="fixed inset-0 z-50 bg-[#09090b] flex flex-col items-center justify-center overflow-hidden p-4 sm:p-6 select-none animate-fade-in">
      
      {/* Background: Exact App Skeleton Preview (Nothing Imagined) */}
      <div className="absolute inset-0 max-w-5xl mx-auto px-4 py-8 opacity-25 pointer-events-none flex flex-col justify-between">
        {/* App Header Preview */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse" />
          </div>
          <div className="h-7 w-20 bg-zinc-850 rounded-lg border border-zinc-800" />
        </div>

        {/* Dashboard Content Skeleton */}
        <div className="space-y-6 pt-6 flex-1">
          {/* Title & Action */}
          <div className="flex justify-between items-center">
            <div className="space-y-1.5">
              <div className="h-6 w-36 bg-zinc-800 rounded animate-pulse" />
              <div className="h-3 w-56 bg-zinc-850 rounded" />
            </div>
            <div className="h-9 w-28 bg-indigo-600/30 border border-indigo-500/40 rounded-xl" />
          </div>

          {/* Search bar with AI Active */}
          <div className="flex gap-2.5">
            <div className="h-11 flex-1 bg-zinc-950 border border-zinc-850 rounded-xl" />
            <div className="h-11 w-28 bg-indigo-950/40 border border-indigo-900/60 rounded-xl flex items-center justify-center space-x-1.5 text-indigo-400 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Search</span>
            </div>
          </div>

          {/* 3 Real Folders */}
          <div className="grid grid-cols-3 gap-3">
            {['Receipts', 'Invoices', 'Contracts'].map((folder) => (
              <div key={folder} className="h-20 bg-zinc-900/40 border border-zinc-850 rounded-xl p-3 flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
                    <Folder className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="h-3.5 w-6 bg-zinc-850 rounded-full" />
                </div>
                <div className="text-[11px] font-bold text-zinc-400">{folder}</div>
              </div>
            ))}
          </div>

          {/* Document Rows Skeleton */}
          <div className="space-y-2 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-zinc-900/30 border border-zinc-850/80 rounded-xl flex items-center px-3 justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-7 h-7 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-center text-zinc-500">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div className="h-3 w-32 bg-zinc-800 rounded" />
                </div>
                <div className="h-4 w-14 bg-emerald-950/40 border border-emerald-900/40 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Centered Loading Focus Card */}
      <div className="relative z-10 bg-zinc-950/90 border border-zinc-800/90 backdrop-blur-xl rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl shadow-indigo-500/10 space-y-4">
        {/* Pulsing PaperWait Icon */}
        <div className="relative mx-auto w-14 h-14 flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-indigo-500/20 animate-ping opacity-60" />
          <div className="relative w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <FileText className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Title and Subtitle */}
        <div className={`transition-all duration-150 ${isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
            {displayTitle}
          </h2>
          <p className="text-xs text-zinc-400 mt-1 font-medium">
            {displaySubtitle}
          </p>
        </div>

        {/* Elegant Animated Progress Bar */}
        <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden relative">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 w-1/2 rounded-full animate-[progress_1.2s_ease-in-out_infinite]" />
        </div>
      </div>

    </div>
  )
}
