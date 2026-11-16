import { useTranslation } from '../../i18n'

interface RamWarningDialogProps {
  ramGb: number | undefined
  onClose: () => void
}

/** Warning dialog shown when system RAM is below the recommended threshold. */
export function RamWarningDialog({ ramGb, onClose }: RamWarningDialogProps) {
  const t = useTranslation()

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="rename-dialog confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ram-warning-title">
        <div className="dialog-header"><h2 id="ram-warning-title">{t('ramWarningTitle')}</h2><button type="button" className="dialog-close" onClick={onClose} aria-label={t('close')}>×</button></div>
        <p id="ram-warning-body">{t('ramWarningBody', { ram: ramGb ?? '—' })}</p>
        <div className="dialog-actions">
          <button type="button" autoFocus className="primary-button" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}
