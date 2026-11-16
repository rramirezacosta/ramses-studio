import { useRef } from 'react'
import { useTranslation } from '../../i18n'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface ConfirmDialogProps {
  title: string
  body: string
  onConfirm: () => void
  onCancel: () => void
}

/** Generic confirmation modal with a title, body text, and cancel/delete actions. */
export function ConfirmDialog({ title, body, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocusTrap(ref, true)

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="rename-dialog confirm-dialog" ref={ref} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <div className="dialog-header"><h2 id="confirm-title">{title}</h2><button type="button" className="dialog-close" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <p id="confirm-body">{body}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="button" autoFocus className="primary-button danger" onClick={onConfirm}>{t('delete')}</button>
        </div>
      </div>
    </div>
  )
}
