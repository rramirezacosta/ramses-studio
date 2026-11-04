import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { TrackLane } from './components/daw/TrackLane'
import { Sidebar } from './components/layout/Sidebar'
import { TitleBar } from './components/layout/TitleBar'
import { TransportBar } from './components/layout/TransportBar'
import { encodeWav } from './components/stemsplitter/audio/wav'
import { SIX_STEM_NAMES } from './components/stemsplitter/constants'
import { useTransportStore } from './store/useTransportStore'
import type { Song, TrackState } from './types/audio'
import type { StereoAudio } from './components/stemsplitter/types'

export default function App() {
  const engine = useRef(new AudioEngine()).current
  const [songs, setSongs] = useState<Song[]>([])
  const [activeSong, setActiveSong] = useState<string>()
  const [tracks, setTracks] = useState<TrackState[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [loadingSong, setLoadingSong] = useState<string>()
  const [error, setError] = useState<string>()
  const [loopRange, setLoopRange] = useState<[number, number]>()
  const [looping, setLooping] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<number>()
  const [cpuFallback, setCpuFallback] = useState(false)
  const [importStage, setImportStage] = useState<string>()
  const [importSourceOpen, setImportSourceOpen] = useState(false)
  const [youTubeUrl, setYouTubeUrl] = useState('')
  const [renamingSong, setRenamingSong] = useState<Song>()
  const [renameValue, setRenameValue] = useState('')
  const [draggedTrackId, setDraggedTrackId] = useState<string>()
  const transport = useTransportStore()

  useEffect(() => {
    if (!window.api) {
      setError('The Electron bridge is unavailable. Restart the application with npm run dev.')
      setLibraryLoading(false)
      return
    }
    const unsubscribe = window.api.onImportProgress(({ progress }) => setImportProgress(progress))
    const unsubscribeCpuFallback = window.api.onImportCpuFallback(() => setCpuFallback(true))
    const unsubscribeImportStage = window.api.onImportStage(setImportStage)
    void window.api.getSongs().then(setSongs).catch((reason) => {
      const message = reason instanceof Error ? reason.message : 'Unknown library error'
      setError(`Could not read the song library: ${message}`)
    }).finally(() => setLibraryLoading(false))
    return () => {
      unsubscribe()
      unsubscribeCpuFallback()
      unsubscribeImportStage()
      engine.destroy()
    }
  }, [engine])

  useEffect(() => {
    let frame = 0
    const update = () => {
      transport.setTransport({ currentTime: engine.position, isPlaying: engine.isPlaying })
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [engine, transport])

  const selectSong = useCallback(async (song: Song) => {
    setLoadingSong(song.name)
    setError(undefined)
    try {
      const loaded = await Promise.all(song.stems.map(async (name) => ({
        id: name,
        name,
        buffer: await engine.decode(await window.api.loadStemBuffer(song.name, name)),
        volume: 0.85,
        pan: 0,
        muted: false,
        soloed: false,
      })))
      engine.load(loaded)
      engine.setLoopRange()
      setTracks(loaded)
      setActiveSong(song.name)
      setLoopRange(undefined)
      setLooping(false)
      transport.setTransport({ currentTime: 0, duration: engine.duration, isPlaying: false })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown audio loading error'
      setError(`Could not load "${song.name}": ${message}`)
    } finally {
      setLoadingSong(undefined)
    }
  }, [engine, transport])

  const seek = (time: number) => {
    engine.seek(time)
    transport.setTransport({ currentTime: engine.position })
  }

  const updateLoopRange = (range: [number, number]) => {
    const validRange = range[1] - range[0] >= 0.05 ? range : undefined
    setLoopRange(validRange)
  }

  const startLoopRange = (range: [number, number]) => {
    engine.setLoopRange({ start: range[0], end: range[1] })
    engine.seek(range[0])
    if (!engine.isPlaying) engine.play()
    setLoopRange(range)
    setLooping(true)
    transport.setTransport({ currentTime: range[0], isPlaying: true })
  }

  const toggleLoop = () => {
    if (!loopRange) return
    const nextLooping = !looping
    setLooping(nextLooping)
    engine.setLoopRange(nextLooping ? { start: loopRange[0], end: loopRange[1] } : undefined)
  }

  const clearLoopRange = () => {
    engine.setLoopRange()
    setLoopRange(undefined)
    setLooping(false)
  }

  const importSong = async (prepareImport: () => Promise<{ sourceName: string; audio: StereoAudio } | null>) => {
    setImporting(true)
    setImportProgress(0)
    setCpuFallback(false)
    setImportStage(undefined)
    setError(undefined)
    try {
      const source = await prepareImport()
      if (!source) return
      let stems
      if (__CPU_ONLY__) {
        stems = await window.api.separateWithNative(source.audio, true)
      } else {
        try {
          const { WebGpuSeparator } = await import('./components/stemsplitter/webgpu-separator')
          const separator = await WebGpuSeparator.create({
            model: new Uint8Array(await window.api.loadWebGpuModel()),
            onProgress: ({ progress }) => setImportProgress(progress),
          })
          try {
            stems = await separator.separate(source.audio)
          } finally {
            await separator.dispose()
          }
        } catch (webGpuError) {
          console.warn('WebGPU stem separation is unavailable; using the native inference fallback.', webGpuError)
          stems = await window.api.separateWithNative(source.audio, false)
        }
      }
      const wavs: Record<string, Uint8Array> = {}
      for (const stem of SIX_STEM_NAMES) wavs[stem] = encodeWav(stems[stem])
      const song = await window.api.saveImportedStems(source.sourceName, wavs)
      setSongs(await window.api.getSongs())
      await selectSong(song)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown import error'
      setError(`Could not split the imported audio: ${message}`)
    } finally {
      setImporting(false)
      setImportProgress(undefined)
      setCpuFallback(false)
      setImportStage(undefined)
    }
  }

  const importLocalFile = () => {
    setImportSourceOpen(false)
    void importSong(() => window.api.prepareImport())
  }

  const importYouTubeAudio = () => {
    const url = youTubeUrl.trim()
    if (!url) return
    setImportSourceOpen(false)
    void importSong(() => window.api.prepareYouTubeImport(url))
  }

  const openRenameDialog = (song: Song) => {
    setRenamingSong(song)
    setRenameValue(song.name)
  }

  const renameSong = async () => {
    if (!renamingSong) return
    const newName = renameValue.trim()
    if (!newName || newName === renamingSong.name) {
      setRenamingSong(undefined)
      return
    }
    try {
      await window.api.renameSong(renamingSong.name, newName)
      setSongs(await window.api.getSongs())
      if (activeSong === renamingSong.name) setActiveSong(newName)
      setRenamingSong(undefined)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown rename error'
      setError(`Could not rename "${renamingSong.name}": ${message}`)
    }
  }

  const deleteSong = async (song: Song) => {
    if (!window.confirm(`Delete "${song.name}" and all of its stems? This cannot be undone.`)) return
    try {
      await window.api.deleteSong(song.name)
      setSongs(await window.api.getSongs())
      if (activeSong === song.name) {
        engine.stop()
        engine.setLoopRange()
        setActiveSong(undefined)
        setTracks([])
        setLoopRange(undefined)
        setLooping(false)
        transport.setTransport({ currentTime: 0, duration: 0, isPlaying: false })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown deletion error'
      setError(`Could not delete "${song.name}": ${message}`)
    }
  }

  const deleteStem = async (track: TrackState) => {
    if (!activeSong || !window.confirm(`Delete "${track.name}" from "${activeSong}"? This cannot be undone.`)) return
    try {
      await window.api.deleteStem(activeSong, track.name)
      const remainingTracks = tracks.filter((item) => item.id !== track.id)
      engine.removeTrack(track.id)
      setTracks(remainingTracks)
      setSongs(await window.api.getSongs())
      if (!remainingTracks.length) {
        engine.setLoopRange()
        setActiveSong(undefined)
        setLoopRange(undefined)
        setLooping(false)
        transport.setTransport({ currentTime: 0, duration: 0, isPlaying: false })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unknown stem deletion error'
      setError(`Could not delete "${track.name}": ${message}`)
    }
  }

  const reorderTracks = (targetId: string) => {
    if (!draggedTrackId || draggedTrackId === targetId) return
    setTracks((items) => {
      const sourceIndex = items.findIndex((item) => item.id === draggedTrackId)
      const targetIndex = items.findIndex((item) => item.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return items
      const reordered = [...items]
      const [source] = reordered.splice(sourceIndex, 1)
      reordered.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, source)
      return reordered
    })
    setDraggedTrackId(undefined)
  }

  return (
    <main className="app-shell">
      <TitleBar />
      <div className="app-content">
        <Sidebar songs={songs} activeSong={activeSong} loading={libraryLoading} importing={importing} importProgress={importProgress} cpuFallback={cpuFallback} importStage={importStage} onSelect={selectSong} onImport={() => setImportSourceOpen(true)} onRename={openRenameDialog} onDelete={deleteSong} />
        <div className="workspace">
        <div className="timeline-header"><span>TRACK</span><span>{activeSong ? activeSong.replaceAll('-', ' ') : 'Select a song from the library'}</span></div>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="tracks">
          {tracks.map((track, index) => (
            <TrackLane key={track.id} track={track} index={index} currentTime={transport.currentTime} duration={transport.duration}
              onSeek={seek}
              loopRange={loopRange}
              onRangeChange={updateLoopRange}
              onRangeCommit={startLoopRange}
              onClearRange={clearLoopRange}
              onRemove={() => { void deleteStem(track) }}
              dragging={draggedTrackId === track.id}
              onDragStart={() => setDraggedTrackId(track.id)}
              onDragEnd={() => setDraggedTrackId(undefined)}
              onDrop={() => reorderTracks(track.id)}
              onUpdate={(patch) => {
                engine.updateTrack(track.id, patch)
                setTracks((items) => items.map((item) => item.id === track.id ? { ...item, ...patch } : item))
              }}
            />
          ))}
          {!libraryLoading && !tracks.length && <div className="welcome"><h1>Multi-Stem Studio</h1><p>Choose a song to load its stems into the timeline.</p></div>}
        </div>
        <TransportBar
          {...transport}
          onPlayPause={() => { engine.isPlaying ? engine.pause() : engine.play(); transport.setTransport({ isPlaying: engine.isPlaying }) }}
          onStop={() => { engine.stop(); transport.setTransport({ currentTime: 0, isPlaying: false }) }}
          onSeek={seek}
          onMasterVolume={(masterVolume) => { engine.setMasterVolume(masterVolume); transport.setTransport({ masterVolume }) }}
          loopRange={loopRange}
          looping={looping}
          onToggleLoop={toggleLoop}
        />
        </div>
      </div>
      {renamingSong && (
        <div className="dialog-backdrop" role="presentation">
          <form className="rename-dialog" onSubmit={(event) => { event.preventDefault(); void renameSong() }} role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <h2 id="rename-title">Rename song</h2>
            <label htmlFor="song-name">Song folder name</label>
            <input id="song-name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
            <div className="dialog-actions">
              <button type="button" onClick={() => setRenamingSong(undefined)}>Cancel</button>
              <button type="submit" className="primary-button">Save</button>
            </div>
          </form>
        </div>
      )}
      {importSourceOpen && (
        <div className="dialog-backdrop" role="presentation">
          <form className="rename-dialog import-source-dialog" onSubmit={(event) => { event.preventDefault(); importYouTubeAudio() }} role="dialog" aria-modal="true" aria-labelledby="import-source-title">
            <h2 id="import-source-title">Import audio</h2>
            <p>Choose an audio file from your computer or extract audio from a YouTube video.</p>
            <button type="button" className="source-option" onClick={importLocalFile}>Choose local file</button>
            <div className="source-option-divider">OR</div>
            <label htmlFor="youtube-url">YouTube link</label>
            <input id="youtube-url" type="url" value={youTubeUrl} onChange={(event) => setYouTubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." autoFocus />
            <div className="dialog-actions">
              <button type="button" onClick={() => setImportSourceOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={!youTubeUrl.trim()}>Import</button>
            </div>
          </form>
        </div>
      )}
      {(libraryLoading || loadingSong) && (
        <div className="work-banner" role="status" aria-live="polite">
          <div className="work-spinner" />
          <div><strong>{loadingSong ? 'Loading song stems' : 'Loading library'}</strong><span>{loadingSong ? loadingSong.replaceAll('-', ' ') : 'Preparing your workspace'}</span></div>
        </div>
      )}
    </main>
  )
}
