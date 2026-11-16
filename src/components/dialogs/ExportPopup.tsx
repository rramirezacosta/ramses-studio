import { useTranslation } from '../../i18n'

interface ExportPopupProps {
  onExportMix: () => void
  onExportStems: () => void
  onClose: () => void
}

/** Popup menu for choosing export format: mix or individual stems. */
export function ExportPopup({ onExportMix, onExportStems, onClose }: ExportPopupProps) {
  const t = useTranslation()

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="export-popup" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('export')}>
        <button type="button" onClick={() => { onClose(); onExportMix() }} autoFocus>{t('exportCurrentMix')}</button>
        <button type="button" onClick={() => { onClose(); onExportStems() }}>{t('exportStems')}</button>
      </div>
    </div>
  )
}
