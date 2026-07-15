import React from 'react'

interface VelocityLoaderProps {
  title?: string
  subtitle?: string
}

export default function VelocityLoader({
  title = "Processing Request",
  subtitle = "Synchronizing with global neural networks"
}: VelocityLoaderProps) {
  return (
    <div className="relative w-full h-[350px] flex flex-col items-center justify-center overflow-hidden bg-zinc-950/20 border border-zinc-900 rounded-2xl p-6">
      {/* Long Fazers Background */}
      <div className="longfazers">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>

      {/* Loader Component Container */}
      <div className="relative w-full h-[150px] flex items-center justify-center">
        <div className="loader">
          <span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </span>
          <div className="base">
            <span></span>
            <div className="face"></div>
          </div>
        </div>
      </div>

      {/* Content Overlay */}
      <div className="z-10 text-center mt-6 space-y-3">
        <h3 className="text-xl font-bold tracking-tight text-white uppercase animate-pulse">
          {title}
        </h3>
        <p className="text-zinc-500 uppercase tracking-widest text-[9px] font-semibold max-w-sm mx-auto">
          {subtitle}
        </p>

        {/* Progress Bar Mockup */}
        <div className="w-48 h-1 bg-zinc-900 rounded-full mx-auto mt-4 overflow-hidden relative">
          <div className="h-full bg-indigo-500 w-1/3 animate-progress-bar"></div>
        </div>
      </div>
    </div>
  )
}
