'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail } from 'lucide-react'

function ForgotPasswordContent() {
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [success, setSuccess] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
    }
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setErrorMsg(errorParam)
    }
  }, [searchParams])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setLoading(true)
    setErrorMsg('')
    setSuccess(false)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app-loading-start', {
          detail: { title: 'Sending Link', subtitle: 'Generating secure reset token...' },
        })
      )
    }

    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      })

      if (error) {
        setErrorMsg(error.message)
      } else {
        setSuccess(true)
        setResendCooldown(60)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send password reset email.')
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
            Forgot Password
          </h1>
          <p className="text-zinc-400 mt-2 text-sm text-center">
            {success
              ? 'Check your inbox for password reset instructions'
              : 'Enter your email address and we will send you a password recovery link'}
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800 backdrop-blur-xl p-8 rounded-2xl shadow-xl animate-slide-up">
          {errorMsg && (
            <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">
              {errorMsg}
            </div>
          )}

          {success ? (
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm p-4 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-emerald-200">Reset link sent!</p>
                  <p className="text-xs text-emerald-300/90 mt-1">
                    We sent an email to <span className="font-semibold text-white">{email}</span>. Click the link inside to set a new password.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleResetRequest}
                  disabled={loading || resendCooldown > 0}
                  className="w-full flex items-center justify-center py-3 px-4 bg-zinc-800 hover:bg-zinc-700 active:scale-95 duration-100 text-zinc-100 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                      Resending...
                    </>
                  ) : resendCooldown > 0 ? (
                    `Resend email in ${resendCooldown}s`
                  ) : (
                    'Resend email'
                  )}
                </button>

                <Link
                  href="/login"
                  className="w-full flex items-center justify-center py-3 px-4 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 active:scale-95 duration-100 text-white rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-md shadow-indigo-500/25 text-sm"
                >
                  Return to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleResetRequest} className="space-y-6">
              <div>
                <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-zinc-500" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="block w-full pl-10 pr-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
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
                    Sending Link...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>

              <div className="pt-2 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Sign In
                </Link>
              </div>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
            <p className="text-zinc-500 text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                Sign Up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  )
}
