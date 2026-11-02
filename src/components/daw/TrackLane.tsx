import type { TrackState } from '../../types/audio'
import { WaveformDisplay } from './WaveformDisplay'

const colors = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#86efac', '#fcd34d', '#fb923c']

interface Props {
  track: TrackState
  index: number
  currentTime: number
  duration: number
  onUpdate: (patch: Partial<Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>) => void
  onSeek: (time: number) => void
  loopRange?: [number, number]
  onRangeChange: (range: [number, number]) => void
  onRangeCommit: (range: [number, number]) => void
  onClearRange: () => void
}

export function TrackLane({ track, index, currentTime, duration, onUpdate, onSeek, loopRange, onRangeChange, onRangeCommit, onClearRange }: Props) {
  return (
    <section className="track-lane">
      <div className="track-controls">
        <strong>{track.name.replace(/\.wav$/i, '')}</strong>
        <div className="toggle-row">
          <button className={track.muted ? 'active mute' : ''} onClick={() => onUpdate({ muted: !track.muted })}>M</button>
          <button className={track.soloed ? 'active solo' : ''} onClick={() => onUpdate({ soloed: !track.soloed })}>S</button>
        </div>
        <label>VOL <input type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => onUpdate({ volume: Number(event.target.value) })} /></label>
        <label>PAN <input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => onUpdate({ pan: Number(event.target.value) })} /></label>
      </div>
      <WaveformDisplay buffer={track.buffer} color={colors[index % colors.length]} currentTime={currentTime} duration={duration} onSeek={onSeek} loopRange={loopRange} onRangeChange={onRangeChange} onRangeCommit={onRangeCommit} onClearRange={onClearRange} />
    </section>
  )
}
