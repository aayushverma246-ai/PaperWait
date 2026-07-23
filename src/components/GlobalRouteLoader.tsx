'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import VelocityLoader from './VelocityLoader'

export default function GlobalRouteLoader() {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const [loaderMeta, setLoaderMeta] = useState({
    title: 'Loading',
    subtitle: 'Decrypting catalog structure...'
  })
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // When pathname changes, set a small timer to auto-hide the loader
    // to give the newly mounted page's useEffect a chance to call app-loading-start
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current)
    autoHideTimerRef.current = setTimeout(() => {
      setLoading(false)
    }, 200)

    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current)
    }
  }, [pathname])

  useEffect(() => {
    const handleStart = (e: Event) => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current)
        autoHideTimerRef.current = null
      }
      const customEv = e as CustomEvent
      const { title, subtitle } = customEv.detail || {}
      setLoaderMeta({
        title: title || 'Loading',
        subtitle: subtitle || 'Decrypting catalog structure...'
      })
      setLoading(true)
    }

    const handleStop = () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current)
        autoHideTimerRef.current = null
      }
      setLoading(false)
    }

    window.addEventListener('app-loading-start', handleStart)
    window.addEventListener('app-loading-stop', handleStop)

    // Global click listener to intercept link navigation and show loader immediately
    const handleLinkClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null
      while (target && target.tagName !== 'A') {
        target = target.parentElement
      }

      if (!target || !(target as HTMLAnchorElement).href) return

      const anchor = target as HTMLAnchorElement

      // Exclude external links, targets, downloads, same page links, email, phone etc.
      if (
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('href')?.startsWith('http') ||
        anchor.getAttribute('href')?.startsWith('//') ||
        anchor.getAttribute('href')?.startsWith('#') ||
        anchor.getAttribute('href')?.startsWith('mailto:') ||
        anchor.getAttribute('href')?.startsWith('tel:')
      ) {
        return
      }

      // Check if it's the exact same pathname and search
      try {
        const targetUrl = new URL(anchor.href)
        if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) {
          return
        }
      } catch (err) {
        return
      }

      if (e.defaultPrevented) return

      // Determine loader metadata based on the path
      let title = 'Loading'
      let subtitle = 'Decrypting catalog structure...'
      const path = anchor.getAttribute('href') || ''

      if (path === '/dashboard') {
        title = 'Loading Dashboard'
        subtitle = 'Decrypting catalog structure...'
      } else if (path.includes('/dashboard/folder/')) {
        title = 'Loading Folder'
        subtitle = 'Decrypting catalog components...'
      } else if (path.includes('/dashboard/document/')) {
        title = 'Loading'
        subtitle = 'Decrypting secure document contents...'
      } else if (path === '/login') {
        title = 'Sign In'
        subtitle = 'Redirecting to login portal...'
      } else if (path === '/signup') {
        title = 'Sign Up'
        subtitle = 'Redirecting to signup portal...'
      }

      // Dispatch loading start event
      window.dispatchEvent(new CustomEvent('app-loading-start', {
        detail: { title, subtitle }
      }))
    }

    document.addEventListener('click', handleLinkClick)

    return () => {
      window.removeEventListener('app-loading-start', handleStart)
      window.removeEventListener('app-loading-stop', handleStop)
      document.removeEventListener('click', handleLinkClick)
    }
  }, [])

  if (!loading) return null

  return <VelocityLoader title={loaderMeta.title} subtitle={loaderMeta.subtitle} />
}
