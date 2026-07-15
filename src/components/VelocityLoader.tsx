import React from 'react'

interface VelocityLoaderProps {
  title?: string
  subtitle?: string
}

export default function VelocityLoader({
  title = "Processing Request",
  subtitle = "Synchronizing with global networks"
}: VelocityLoaderProps) {
  return (
    <div className="fixed inset-0 z-50 bg-[#09090b] flex flex-col items-center justify-center overflow-hidden p-6 select-none">
      {/* Background Texture SVG Noise */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-repeat bg-[url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')]"></div>

      {/* Long Fazers Background */}
      <div className="longfazers">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>

      {/* Loader Component Container */}
      <div className="relative w-full h-[200px] flex items-center justify-center">
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
      <div className="z-10 text-center mt-8 space-y-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white uppercase animate-pulse">
          {title}
        </h1>
        <p className="text-zinc-500 uppercase tracking-widest text-[9px] sm:text-[10px] font-bold max-w-sm mx-auto">
          {subtitle}
        </p>

        {/* Progress Bar Mockup */}
        <div className="w-56 h-1 bg-zinc-900 rounded-full mx-auto mt-6 overflow-hidden relative">
          <div className="h-full bg-red-500 w-1/3 animate-progress-bar"></div>
        </div>
      </div>
    </div>
  )
}
