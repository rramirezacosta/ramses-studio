import { useTranslation } from '../../i18n'
import { useSyncStore } from '../../store/useSyncStore'

interface ConflictDialogProps {
  songName: string
  onResolve: (resolution: 'local' | 'remote' | 'both') => void
  onCancel: () => void
}

/** Dialog shown when a sync conflict is detected for a song. */
export function ConflictDialog({ songName, onResolve, onCancel }: ConflictDialogProps) {
  const t = useTranslation()
  const sync = useSyncStore()

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="rename-dialog confirm-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="dialog-header"><h2 id="conflict-title">{t('conflictTitle')}</h2><button type="button" className="dialog-close" onClick={onCancel} aria-label={t('close')}>×</button></div>
        <p id="conflict-body">{t('conflictBody', { name: songName })}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => { void sync.resolveConflict(songName, 'local'); onResolve('local') }}>{t('keepLocal')}</button>
          <button type="button" onClick={() => { void sync.resolveConflict(songName, 'remote'); onResolve('remote') }}>{t('keepRemote')}</button>
          <button type="button" autoFocus className="primary-button" onClick={() => { void sync.resolveConflict(songName, 'both'); onResolve('both') }}>{t('keepBoth')}</button>
        </div>
      </div>
    </div>
  )
}
