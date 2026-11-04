import { Download, Pause, Play, Repeat, RotateCcw, Square } from 'lucide-react'

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  masterVolume: number
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

export function TransportBar(props: Props) {
  return (
    <header className="transport">
      <div className="transport-controls">
        <button className="icon-button" onClick={props.onStop} title="Return to start"><Square size={16} /></button>
        <button className="play-button" onClick={props.onPlayPause} title="Play / pause">
          {props.isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <button className="icon-button" onClick={() => props.onSeek(0)} title="Return to start"><RotateCcw size={16} /></button>
        <button className={`icon-button loop-button ${props.looping ? 'active' : ''}`} onClick={props.onToggleLoop} disabled={!props.loopRange} title={props.loopRange ? 'Loop selected range' : 'Drag across a waveform to select a loop range'} aria-label="Loop selected range"><Repeat size={16} /></button>
      </div>
      <div className="time-readout">{formatTime(props.currentTime)} <span>/ {formatTime(props.duration)}</span></div>
      {props.loopRange && <div className="loop-readout">LOOP {formatTime(props.loopRange[0])}–{formatTime(props.loopRange[1])}</div>}
      <input className="seek" type="range" min="0" max={Math.max(props.duration, 0.01)} step="0.01" value={props.currentTime} onChange={(event) => props.onSeek(Number(event.target.value))} />
      <label className="master-volume">MASTER <input type="range" min="0" max="1" step="0.01" value={props.masterVolume} onChange={(event) => props.onMasterVolume(Number(event.target.value))} /></label>
      <button
        className="export-mix-button"
        onClick={props.onExportMix}
        disabled={!props.duration || props.exportingMix}
        title={props.duration ? 'Export the current stem mix as MP3' : 'Load a song to export its mix'}
        aria-label="Export current mix"
      >
        <Download size={14} /> {props.exportingMix ? 'Exporting...' : 'Export mix'}
      </button>
    </header>
  )
}
