import { useRef } from 'react'
import { useTranslation } from '../../i18n'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface ImportDialogProps {
  youTubeUrl: string
  onYouTubeUrlChange: (value: string) => void
  onImportLocal: () => void
  onImportYouTube: () => void
  onCancel: () => void
}

/** Dialog for choosing import source: local file or YouTube URL. */
export function ImportDialog({ youTubeUrl, onYouTubeUrlChange, onImportLocal, onImportYouTube, onCancel }: ImportDialogProps) {
  const t = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  useDialogFocusTrap(formRef, true)

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <form className="rename-dialog import-source-dialog" ref={formRef} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onImportYouTube() }} role="dialog" aria-modal="true" aria-labelledby="import-source-title">
        <div className="dialog-header"><h2 id="import-source-title">{t('importAudio')}</h2><button type="button" className="dialog-close" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <p>{t('importAudioDescription')}</p>
        <button type="button" className="source-option" onClick={onImportLocal}>{t('chooseLocalFile')}</button>
        <div className="source-option-divider">{t('or')}</div>
        <label htmlFor="youtube-url">{t('youTubeLink')}</label>
        <input id="youtube-url" type="url" value={youTubeUrl} onChange={(event) => onYouTubeUrlChange(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." autoFocus />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className="primary-button" disabled={!youTubeUrl.trim()}>{t('import')}</button>
        </div>
      </form>
    </div>
  )
}
