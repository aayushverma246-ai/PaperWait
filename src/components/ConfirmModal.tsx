import React, { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  isDanger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDanger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      console.error('Action failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6 sm:p-4 animate-fade-in">
      {/* Modal Container */}
      <div 
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-6 space-y-6 transform animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Icon */}
        <div className="flex items-start space-x-4">
          <div className={`p-3 rounded-xl flex-shrink-0 ${
            isDanger ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
          }`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white leading-6">{title}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed font-medium">{message}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:space-x-3 space-y-2.5 sm:space-y-0 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="w-full sm:flex-1 py-2.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          
          <button
            type="button"
            disabled={submitting}
            onClick={handleConfirm}
            className={`w-full sm:flex-1 flex items-center justify-center space-x-2 py-2.5 text-white rounded-xl text-sm font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
              isDanger 
                ? 'bg-red-650 hover:bg-red-700 shadow-red-500/10' 
                : 'bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-indigo-500/10'
            }`}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{submitting ? 'Processing...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
