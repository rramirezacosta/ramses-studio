import { memo } from 'react'
import { useTranslation } from '../../i18n'

/** Skeleton placeholder shown while a song's stems are decoding and loading. */
const SKELETON_COUNT = 6

export const SkeletonLoader = memo(function SkeletonLoader() {
  const t = useTranslation()
  return (
    <div className="skeleton-loader" role="status" aria-label={t('loadingSongStems')}>
      <div className="skeleton-loader-text">{t('loadingSongStems')}</div>
      <div className="skeleton-tracks">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div className="skeleton-track" key={i}>
            <div className="skeleton-track-controls">
              <div className="skeleton-track-name" />
              <div className="skeleton-toggle-row">
                <div className="skeleton-toggle" />
                <div className="skeleton-toggle" />
              </div>
              <div className="skeleton-slider" />
              <div className="skeleton-slider" />
            </div>
            <div className="skeleton-waveform">
              <div className="skeleton-waveform-bar" />
              <div className="skeleton-waveform-bar" />
              <div className="skeleton-waveform-bar" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})
