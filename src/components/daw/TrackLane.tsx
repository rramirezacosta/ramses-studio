import { memo } from 'react'
import { AudioLines, ClefBass, Drum, GuitarElectric, GripVertical, KeyboardMusic, MicVocal, Music, Trash2, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useTransportStore } from '../../store/useTransportStore'
import type { TrackState } from '../../types/audio'
import { WaveformDisplay } from './WaveformDisplay'

const colors = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#86efac', '#fcd34d', '#fb923c']

const stemIcons: Record<string, LucideIcon> = {
  drums: Drum,
  bass: ClefBass,
  guitar: GuitarElectric,
  piano: KeyboardMusic,
  other: Music,
  vocals: MicVocal,
}

function stemTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

type TrackPatch = Partial<Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>

interface Props {
  track: TrackState
  index: number
  onUpdate: (trackId: string, patch: TrackPatch) => void
  onRemove: (track: TrackState) => void
  dragging: boolean
  onDragStart: (trackId: string) => void
  onDragEnd: () => void
  onDrop: (trackId: string) => void
  onSeek: (time: number) => void
  loopRange?: [number, number]
  onRangeChange: (range: [number, number]) => void
  onRangeCommit: (range: [number, number]) => void
  onClearRange: () => void
}

export const TrackLane = memo(function TrackLane({ track, index, onUpdate, onRemove, dragging, onDragStart, onDragEnd, onDrop, onSeek, loopRange, onRangeChange, onRangeCommit, onClearRange }: Props) {
  const t = useTranslation()
  const duration = useTransportStore((store) => store.duration)
  const stemName = track.name.replace(/\.[^.]+$/, '').trim().toLowerCase()
  const StemIcon = stemIcons[stemName] ?? AudioLines
  const isOther = stemName === 'other'
  return (
    <section className={`track-lane ${dragging ? 'dragging' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(track.id) }}>
      <div className="track-controls">
        <div className="track-name">
          <span className="track-drag-handle" draggable onDragStart={() => onDragStart(track.id)} onDragEnd={onDragEnd} title={t('dragToReorder')} aria-label={t('dragToReorder')}><GripVertical size={16} /></span>
          {isOther ? (
            <strong className="track-stem-label" title={stemTitle(track.name)}>{t('otherStem')}</strong>
          ) : (
            <strong className="track-stem-icon" title={stemTitle(track.name)} aria-label={stemTitle(track.name)}><StemIcon size={18} /></strong>
          )}
        </div>
        <div className="toggle-row">
          <button className={track.muted ? 'active mute' : ''} onClick={() => onUpdate(track.id, { muted: !track.muted })}>M</button>
          <button className={track.soloed ? 'active solo' : ''} onClick={() => onUpdate(track.id, { soloed: !track.soloed })}>S</button>
          <button className="remove-stem-button" onClick={() => onRemove(track)} title={t('deleteAction', { name: track.name })} aria-label={t('deleteAction', { name: track.name })}><Trash2 size={12} /></button>
        </div>
        <label className="volume-control">VOL <input type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => onUpdate(track.id, { volume: Number(event.target.value) })} /> <span className="volume-tooltip">{Math.round(track.volume * 100)}%</span></label>
        <label className="pan-control">PAN <input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => { const next = Number(event.target.value); onUpdate(track.id, { pan: Math.abs(next) < 0.03 ? 0 : next }) }} style={{ '--pan-left': track.pan < 0 ? Math.abs(track.pan) * 0.55 + 0.1 : 0, '--pan-right': track.pan > 0 ? track.pan * 0.55 + 0.1 : 0 } as React.CSSProperties} /> {track.pan !== 0 && <span className="pan-tooltip">{Math.round(track.pan * 100)}%</span>}</label>
      </div>
      <WaveformDisplay buffer={track.buffer} color={colors[index % colors.length]} duration={duration} onSeek={onSeek} loopRange={loopRange} onRangeChange={onRangeChange} onRangeCommit={onRangeCommit} onClearRange={onClearRange} />
    </section>
  )
})
