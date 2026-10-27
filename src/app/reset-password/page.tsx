'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react'

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasValidSession, setHasValidSession] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let mounted = true

    const checkSession = async () => {
      // 1. Check current session
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        if (mounted) {
          setHasValidSession(true)
          setCheckingSession(false)
        }
        return
      }

      // 2. Listen for auth changes (e.g. if arriving via hash fragment #access_token=...)
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) {
          if (mounted) {
            setHasValidSession(true)
            setCheckingSession(false)
          }
        }
      })

      // Allow a brief moment for hash token exchange if any
      const timer = setTimeout(async () => {
        if (!mounted) return
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setHasValidSession(true)
        } else {
          const err = searchParams.get('error_description') || searchParams.get('error')
          if (err) {
            setErrorMsg(err)
          }
          setHasValidSession(false)
        }
        setCheckingSession(false)
      }, 1000)

      return () => {
        authListener.subscription.unsubscribe()
        clearTimeout(timer)
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [supabase, searchParams])

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    setLoading(true)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app-loading-start', {
          detail: { title: 'Updating Credentials', subtitle: 'Securing your account...' },
        })
      )
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      })

      if (error) {
        setErrorMsg(error.message)
      } else {
        setSuccess(true)
        setTimeout(() => {
          router.push('/dashboard')
          router.refresh()
        }, 2000)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred while updating your password.')
    } finally {
      setLoading(false)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app-loading-stop'))
      }
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center bg-[#09090b] px-4 overflow-hidden">
      {/* Background ambient glowing blobs */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-80 h-80 rounded-full bg-violet-500/10 blur-3xl" />

      <div className="w-full max-w-md z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 mb-4 animate-pulse">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            Set New Password
          </h1>
          <p className="text-zinc-400 mt-2 text-sm text-center">
            {success
              ? 'Password updated successfully! Redirecting...'
              : 'Choose a strong new password for your account'}
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800 backdrop-blur-xl p-8 rounded-2xl shadow-xl animate-slide-up">
          {checkingSession ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-zinc-400 text-sm">Verifying security token...</p>
            </div>
          ) : !hasValidSession && !success ? (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm p-4 rounded-xl">
                <ShieldAlert className="w-8 h-8 text-red-400 shrink-0" />
                <div>
                  <p className="font-semibold text-red-200">Invalid or Expired Link</p>
                  <p className="text-xs text-red-300/80 mt-1">
                    {errorMsg || 'This password reset link is invalid or has already expired.'}
                  </p>
                </div>
              </div>

              <Link
                href="/forgot-password"
                className="w-full flex items-center justify-center py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-95 duration-100 text-white rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-md shadow-indigo-500/25 text-sm"
              >
                Request a New Reset Link
              </Link>

              <div>
                <Link href="/login" className="text-xs text-zinc-400 hover:text-white transition-colors">
                  Return to Sign In
                </Link>
              </div>
            </div>
          ) : success ? (
            <div className="space-y-6 text-center animate-fade-in">
              <div className="flex flex-col items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm p-4 rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-200">Password Changed!</p>
                  <p className="text-xs text-emerald-300/90 mt-1">
                    Your password has been updated. Redirecting you to your dashboard...
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full flex items-center justify-center py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-95 duration-100 text-white rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-md shadow-indigo-500/25 text-sm cursor-pointer"
              >
                Go to Dashboard
              </button>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-6">
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-zinc-500" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="block w-full pl-10 pr-10 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-zinc-500" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="block w-full pl-10 pr-10 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-95 duration-100 text-white rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-md shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Updating Password...
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
