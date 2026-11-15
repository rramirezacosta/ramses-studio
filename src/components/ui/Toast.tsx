import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'

let toastId = 0

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

const DURATION = 4000

export const ToastContainer = ({ toasts, onDismiss }: ToastContainerProps) => {
  return createPortal(
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: number) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    timer.current = setTimeout(() => onDismiss(toast.id), DURATION)
    return () => clearTimeout(timer.current)
  }, [toast.id, onDismiss])

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

export interface ToastHandle {
  push: (message: string, type?: ToastType) => void
  dismiss: (id: number) => void
}
