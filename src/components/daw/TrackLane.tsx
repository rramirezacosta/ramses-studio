import { AudioLines, Drum, Guitar, GripVertical, MicVocal, Music, Piano, Speaker, Trash2, type LucideIcon } from 'lucide-react'
import type { TrackState } from '../../types/audio'
import { WaveformDisplay } from './WaveformDisplay'

const colors = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#86efac', '#fcd34d', '#fb923c']

const stemIcons: Record<string, LucideIcon> = {
  drums: Drum,
  bass: Speaker,
  other: Music,
  vocals: MicVocal,
  guitar: Guitar,
  piano: Piano,
}

function stemTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

interface Props {
  track: TrackState
  index: number
  currentTime: number
  duration: number
  onUpdate: (patch: Partial<Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>) => void
  onRemove: () => void
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
  onSeek: (time: number) => void
  loopRange?: [number, number]
  onRangeChange: (range: [number, number]) => void
  onRangeCommit: (range: [number, number]) => void
  onClearRange: () => void
}

export function TrackLane({ track, index, currentTime, duration, onUpdate, onRemove, dragging, onDragStart, onDragEnd, onDrop, onSeek, loopRange, onRangeChange, onRangeCommit, onClearRange }: Props) {
  const stemName = track.name.replace(/\.[^.]+$/, '').trim().toLowerCase()
  const StemIcon = stemIcons[stemName] ?? AudioLines
  const isOther = stemName === 'other'
  return (
    <section className={`track-lane ${dragging ? 'dragging' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop() }}>
      <div className="track-controls">
        <div className="track-name">
          <span className="track-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder" aria-label="Drag to reorder"><GripVertical size={16} /></span>
          {isOther ? (
            <strong className="track-stem-label" title={stemTitle(track.name)}>Other</strong>
          ) : (
            <strong className="track-stem-icon" title={stemTitle(track.name)} aria-label={stemTitle(track.name)}><StemIcon size={18} /></strong>
          )}
        </div>
        <div className="toggle-row">
          <button className={track.muted ? 'active mute' : ''} onClick={() => onUpdate({ muted: !track.muted })}>M</button>
          <button className={track.soloed ? 'active solo' : ''} onClick={() => onUpdate({ soloed: !track.soloed })}>S</button>
          <button className="remove-stem-button" onClick={onRemove} title={`Delete ${track.name}`} aria-label={`Delete ${track.name}`}><Trash2 size={12} /></button>
        </div>
        <label>VOL <input type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => onUpdate({ volume: Number(event.target.value) })} /></label>
        <label>PAN <input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => onUpdate({ pan: Number(event.target.value) })} /></label>
      </div>
      <WaveformDisplay buffer={track.buffer} color={colors[index % colors.length]} currentTime={currentTime} duration={duration} onSeek={onSeek} loopRange={loopRange} onRangeChange={onRangeChange} onRangeCommit={onRangeCommit} onClearRange={onClearRange} />
    </section>
  )
}
