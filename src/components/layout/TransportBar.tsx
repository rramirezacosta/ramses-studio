import { memo } from 'react'
import { Download, Pause, Play, Repeat, RotateCcw, Square } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTransportStore } from '../../store/useTransportStore'

interface Props {
  loopRange?: [number, number]
  looping: boolean
  exportingMix: boolean
  onPlayPause: () => void
  onStop: () => void
  onSeek: (value: number) => void
  onMasterVolume: (value: number) => void
  onToggleLoop: () => void
  onExportMix: () => void
}

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

export const TransportBar = memo(function TransportBar(props: Props) {
  const t = useTranslation()
  const isPlaying = useTransportStore((store) => store.isPlaying)
  const currentTime = useTransportStore((store) => store.currentTime)
  const duration = useTransportStore((store) => store.duration)
  const masterVolume = useTransportStore((store) => store.masterVolume)
  return (
    <header className="transport">
      <div className="transport-controls">
        <button className="icon-button" onClick={props.onStop} title={t('returnToStart')}><Square size={16} /></button>
        <button className="play-button" onClick={props.onPlayPause} title={t('playPause')}>
          {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <button className="icon-button" onClick={() => props.onSeek(0)} title={t('returnToStart')}><RotateCcw size={16} /></button>
        <button className={`icon-button loop-button ${props.looping ? 'active' : ''}`} onClick={props.onToggleLoop} disabled={!props.loopRange} title={props.loopRange ? t('loopSelectedRange') : t('dragToLoop')} aria-label={t('loopSelectedRange')}><Repeat size={16} /></button>
      </div>
      <div className="time-readout">{formatTime(currentTime)} <span>/ {formatTime(duration)}</span></div>
      {props.loopRange && <div className="loop-readout">{t('loopReadout')} {formatTime(props.loopRange[0])}–{formatTime(props.loopRange[1])}</div>}
      <input className="seek" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={currentTime} onChange={(event) => props.onSeek(Number(event.target.value))} />
      <label className="master-volume">{t('master')} <input type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={(event) => props.onMasterVolume(Number(event.target.value))} /></label>
      <button
        className="export-mix-button"
        onClick={props.onExportMix}
        disabled={!duration || props.exportingMix}
        title={duration ? t('exportMixTooltip') : t('exportMixDisabledTooltip')}
        aria-label={t('exportMixAria')}
      >
        <Download size={14} /> {props.exportingMix ? t('exporting') : t('exportMix')}
      </button>
    </header>
  )
})
