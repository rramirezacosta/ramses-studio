import { Download, ExternalLink, Loader, RefreshCw } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from '../../i18n'
import { useUpdaterStore } from '../../store/useUpdaterStore'

export const UpdateIndicator = memo(function UpdateIndicator() {
  const t = useTranslation()
  const { status, checkForUpdates, downloadUpdate, openReleasesPage } = useUpdaterStore()

  if (status === 'idle' || status === 'not-available') return null

  const isChecking = status === 'checking'
  const isDownloading = status === 'downloading'
  const isAvailable = status === 'available' || status === 'ready'
  const isError = status === 'error'
  const isPortable = status === 'portable'

  const label = isError
    ? t('updateError', { message: useUpdaterStore.getState().message ?? '' })
    : isChecking
      ? t('updateChecking')
      : isDownloading
        ? t('updateDownload')
        : isAvailable
          ? t('updateAvailable')
          : isPortable
            ? t('updatePortable')
            : ''

  return (
    <div className="update-indicator" title={label}>
      {isChecking || isDownloading ? (
        <Loader size={14} className="update-indicator-spinner" />
      ) : isAvailable ? (
        <button
          className="update-indicator-button"
          type="button"
          title={t('updateDownload')}
          onClick={downloadUpdate}
        >
          <Download size={14} />
        </button>
      ) : isPortable ? (
        <button
          className="update-indicator-button"
          type="button"
          title={t('updatePortableHint')}
          onClick={openReleasesPage}
        >
          <ExternalLink size={14} />
        </button>
      ) : null}
      {!isPortable && (
        <button
          className="update-indicator-check"
          type="button"
          title={t('checkForUpdates')}
          onClick={checkForUpdates}
          disabled={isChecking || isDownloading}
        >
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  )
})
