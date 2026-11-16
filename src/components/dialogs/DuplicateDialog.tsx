import { useRef } from 'react'
import { useTranslation } from '../../i18n'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface DuplicateDialogProps {
  displayName: string
  onCancel: () => void
  onReplace: () => void
  onKeepBoth: () => void
}

/** Dialog shown when an imported song name already exists in the library. */
export function DuplicateDialog({ displayName, onCancel, onReplace, onKeepBoth }: DuplicateDialogProps) {
  const t = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocusTrap(ref, true)

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="rename-dialog confirm-dialog" ref={ref} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
        <div className="dialog-header"><h2 id="duplicate-title">{t('duplicateSongTitle')}</h2><button type="button" className="dialog-close" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <p id="duplicate-body">{t('duplicateSongBody', { name: displayName })}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="button" className="primary-button danger" onClick={onReplace}>{t('replaceSong')}</button>
          <button type="button" autoFocus className="primary-button" onClick={onKeepBoth}>{t('keepBoth')}</button>
        </div>
      </div>
    </div>
  )
}
