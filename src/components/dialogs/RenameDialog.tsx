import { useRef } from 'react'
import { useTranslation } from '../../i18n'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface RenameDialogProps {
  artist: string
  title: string
  onArtistChange: (value: string) => void
  onTitleChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

/** Modal dialog for renaming a song's artist and title. */
export function RenameDialog({ artist, title, onArtistChange, onTitleChange, onSave, onCancel }: RenameDialogProps) {
  const t = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  useDialogFocusTrap(formRef, true)

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <form className="rename-dialog" ref={formRef} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave() }} role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <div className="dialog-header"><h2 id="rename-title">{t('renameSong')}</h2><button type="button" className="dialog-close" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <label htmlFor="rename-artist">{t('artistName')}</label>
        <input id="rename-artist" value={artist} onChange={(event) => onArtistChange(event.target.value)} autoFocus />
        <label htmlFor="rename-title">{t('songTitle')}</label>
        <input id="rename-title" value={title} onChange={(event) => onTitleChange(event.target.value)} />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className="primary-button">{t('save')}</button>
        </div>
      </form>
    </div>
  )
}
