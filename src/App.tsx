import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio/AudioEngine'
import { TrackLane } from './components/daw/TrackLane'
import { Sidebar } from './components/layout/Sidebar'
import { TitleBar } from './components/layout/TitleBar'
import { TransportBar } from './components/layout/TransportBar'
import { encodeWav } from './components/stemsplitter/audio/wav'
import { decodeWithFfmpeg } from './components/stemsplitter/audio/ffmpeg'
import { useTranslation, LANGUAGES } from './i18n'
import { useSettingsStore } from './store/useSettingsStore'
import { useTransportStore } from './store/useTransportStore'
import { useDialogFocusTrap } from './hooks/useDialogFocusTrap'
import type { Song, TrackState } from './types/audio'
import type { StereoAudio } from './components/stemsplitter/types'

interface ConfirmData {
  title: string
  body: string
  action: () => Promise<void>
}

const THEMES = [
  { id: 'midnight', label: 'Midnight', swatch: '#a9a0ff' },
  { id: 'adwaita', label: 'Adwaita Dark', swatch: '#3584e4' },
  { id: 'ocean', label: 'Ocean', swatch: '#55b2ff' },
  { id: 'ember', label: 'Ember', swatch: '#ff9e64' },
  { id: 'aurora', label: 'Aurora', swatch: '#4fd88f' },
  { id: 'orchid', label: 'Orchid', swatch: '#f386d8' },
] as const

type ThemeId = (typeof THEMES)[number]['id']

const THEME_STORAGE_KEY = 'ramses-studio-theme'

const loadStoredTheme = (): ThemeId => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return THEMES.some((theme) => theme.id === stored) ? (stored as ThemeId) : 'midnight'
}

export default function App() {
  const engine = useRef(new AudioEngine()).current
  const t = useTranslation()
  const renameDialogRef = useRef<HTMLFormElement>(null)
  const confirmDialogRef = useRef<HTMLDivElement>(null)
  const importSourceRef = useRef<HTMLFormElement>(null)
  const settingsDialogRef = useRef<HTMLDivElement>(null)
  const language = useSettingsStore((store) => store.language)
  const setLanguage = useSettingsStore((store) => store.setLanguage)
  const [songs, setSongs] = useState<Song[]>([])
  const [activeSong, setActiveSong] = useState<string>()
  const [tracks, setTracks] = useState<TrackState[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [loadingSong, setLoadingSong] = useState<string>()
  const [error, setError] = useState<string>()
  const [loopRange, setLoopRange] = useState<[number, number]>()
  const [looping, setLooping] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [importProgress, setImportProgress] = useState<number>()
  const [importStage, setImportStage] = useState<string>()
  const importAbortRef = useRef<AbortController | null>(null)
  const [importSourceOpen, setImportSourceOpen] = useState(false)
  const [youTubeUrl, setYouTubeUrl] = useState('')
  const [renamingSong, setRenamingSong] = useState<Song>()
  const [renameValue, setRenameValue] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<ConfirmData>()
  const [draggedTrackId, setDraggedTrackId] = useState<string>()
  const [exportingMix, setExportingMix] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(loadStoredTheme)
  const setTransport = useTransportStore((store) => store.setTransport)

  useDialogFocusTrap(renameDialogRef, Boolean(renamingSong))
  useDialogFocusTrap(confirmDialogRef, Boolean(confirmDialog))
  useDialogFocusTrap(importSourceRef, importSourceOpen)
  useDialogFocusTrap(settingsDialogRef, settingsOpen)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!window.api) {
      setError(t('electronBridgeError'))
      setLibraryLoading(false)
      return
    }
    const unsubscribe = window.api.onImportProgress(({ progress }) => {
      setImportProgress(progress)
      setImportStage(undefined)
    })
    const unsubscribeImportStage = window.api.onImportStage(setImportStage)
    void window.api.getSongs().then(setSongs).catch((reason) => {
      const message = reason instanceof Error ? reason.message : t('unknownLibraryError')
      setError(t('readingLibraryFailed', { message }))
    }).finally(() => setLibraryLoading(false))
    return () => {
      unsubscribe()
      unsubscribeImportStage()
      engine.destroy()
    }
  }, [engine])

  useEffect(() => {
    let frame = 0
    let lastTime = -1
    let lastPlaying: boolean | null = null
    const update = () => {
      const position = engine.position
      const isPlaying = engine.isPlaying
      if (position !== lastTime || isPlaying !== lastPlaying) {
        lastTime = position
        lastPlaying = isPlaying
        setTransport({ currentTime: position, isPlaying })
      }
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [engine, setTransport])

  const selectSong = useCallback(async (song: Song) => {
    setLoadingSong(song.name)
    setError(undefined)
    setNotice(undefined)
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
      setTransport({ currentTime: 0, duration: engine.duration, isPlaying: false })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('unknownAudioLoadingError')
      setError(t('loadSongFailed', { name: song.name, message }))
    } finally {
      setLoadingSong(undefined)
    }
  }, [engine, setTransport])

  const seek = useCallback((time: number) => {
    engine.seek(time)
    setTransport({ currentTime: engine.position })
  }, [engine, setTransport])

  const updateLoopRange = useCallback((range: [number, number]) => {
    const validRange = range[1] - range[0] >= 0.05 ? range : undefined
    setLoopRange(validRange)
  }, [])

  const startLoopRange = useCallback((range: [number, number]) => {
    engine.setLoopRange({ start: range[0], end: range[1] })
    engine.seek(range[0])
    if (!engine.isPlaying) engine.play()
    setLoopRange(range)
    setLooping(true)
    setTransport({ currentTime: range[0], isPlaying: true })
  }, [engine, setTransport])

  const toggleLoop = useCallback(() => {
    if (!loopRange) return
    const nextLooping = !looping
    setLooping(nextLooping)
    engine.setLoopRange(nextLooping ? { start: loopRange[0], end: loopRange[1] } : undefined)
  }, [loopRange, looping, engine])

  const clearLoopRange = useCallback(() => {
    engine.setLoopRange()
    setLoopRange(undefined)
    setLooping(false)
  }, [engine])

  const togglePlayback = useCallback(() => {
    engine.isPlaying ? engine.pause() : engine.play()
    setTransport({ isPlaying: engine.isPlaying })
  }, [engine, setTransport])

  const stopPlayback = useCallback(() => {
    engine.stop()
    setTransport({ currentTime: 0, isPlaying: false })
  }, [engine, setTransport])

  const setMasterVolume = useCallback((masterVolume: number) => {
    engine.setMasterVolume(masterVolume)
    setTransport({ masterVolume })
  }, [engine, setTransport])

  const importSong = useCallback(async (prepareImport: () => Promise<{ sourceName: string } | null>) => {
    const controller = new AbortController()
    importAbortRef.current = controller
    setImporting(true)
    setImportProgress(0)
    setImportStage(undefined)
    setError(undefined)
    try {
      const prepared = await prepareImport()
      if (!prepared || controller.signal.aborted) return
      setImportStage(t('decodingAudio'))
      const buffer = await window.api.readFileBuffer(prepared.sourceName)
      const audio = await decodeWithFfmpeg(buffer, undefined, controller.signal, true)
      if (controller.signal.aborted) return
      const source = { sourceName: prepared.sourceName, audio }
      const song = await window.api.separateWithNative(source.sourceName, source.audio)
      if (controller.signal.aborted) return
      setSongs(await window.api.getSongs())
      await selectSong(song)
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) return
      const message = reason instanceof Error ? reason.message : t('unknownImportError')
      setError(t('importFailed', { message }))
    } finally {
      importAbortRef.current = null
      setImporting(false)
      setImportProgress(undefined)
      setImportStage(undefined)
      setCancelling(false)
    }
  }, [selectSong, t])

  const cancelImport = useCallback(() => {
    if (cancelling) return
    setCancelling(true)
    importAbortRef.current?.abort()
    void window.api.cancelImport?.()
  }, [cancelling])

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

  const openRenameDialog = useCallback((song: Song) => {
    setRenamingSong(song)
    setRenameValue(song.name)
  }, [])

  const openImportSource = useCallback(() => setImportSourceOpen(true), [])

  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const renameSong = useCallback(async () => {
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
      const message = reason instanceof Error ? reason.message : t('unknownRenameError')
      setError(t('renameFailed', { name: renamingSong.name, message }))
    }
  }, [activeSong, renameValue, renamingSong, t])

  const deleteSong = useCallback((song: Song) => {
    setConfirmDialog({
      title: t('deleteSongTitle'),
      body: t('deleteSongBody', { name: song.name.replaceAll('-', ' ') }),
      action: async () => {
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
            setTransport({ currentTime: 0, duration: 0, isPlaying: false })
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : t('unknownDeletionError')
          setError(t('deleteSongFailed', { name: song.name, message }))
        }
      },
    })
  }, [activeSong, engine, setTransport, t])

  const deleteStem = useCallback((track: TrackState) => {
    if (!track || !activeSong) return
    const stemTitle = track.name.replace(/\.[^.]+$/, '')
    setConfirmDialog({
      title: t('deleteStemTitle'),
      body: t('deleteStemBody', { stem: stemTitle, song: activeSong.replaceAll('-', ' ') }),
      action: async () => {
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
            setTransport({ currentTime: 0, duration: 0, isPlaying: false })
          }
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : t('unknownStemDeletionError')
          setError(t('deleteStemFailed', { stem: track.name, message }))
        }
      },
    })
  }, [activeSong, engine, setTransport, t])

  const exportMix = useCallback(async () => {
    if (!activeSong || !tracks.length || exportingMix) return
    setExportingMix(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const mix = await engine.renderMix()
      if (!mix) return
      const wav = encodeWav(mix)
      const savedPath = await window.api.exportMix(activeSong, wav)
      if (savedPath) setNotice(t('mixExported', { path: savedPath }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('unknownExportError')
      setError(t('exportFailed', { message }))
    } finally {
      setExportingMix(false)
    }
  }, [activeSong, tracks, exportingMix, engine, t])

  const handleExportMix = useCallback(() => { void exportMix() }, [exportMix])

  const updateTrack = useCallback((trackId: string, patch: Partial<Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>) => {
    engine.updateTrack(trackId, patch)
    setTracks((items) => items.map((item) => item.id === trackId ? { ...item, ...patch } : item))
  }, [engine])

  const endTrackDrag = useCallback(() => setDraggedTrackId(undefined), [])

  const reorderTracks = useCallback((targetId: string) => {
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
  }, [draggedTrackId])

  useEffect(() => {
    const dialogOpen = Boolean(renamingSong || confirmDialog || importSourceOpen || settingsOpen)
    const handleKeyDown = (event: KeyboardEvent) => {
      const onControl = event.target instanceof HTMLElement && Boolean(event.target.closest('input, textarea, select, button, a, [contenteditable="true"]'))

      if (event.key === 'Escape') {
        if (renamingSong) setRenamingSong(undefined)
        else if (confirmDialog) setConfirmDialog(undefined)
        else if (importSourceOpen) setImportSourceOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (draggedTrackId) setDraggedTrackId(undefined)
        return
      }
      if (dialogOpen || onControl) return

      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.5 : 5)
        seek(Math.min(Math.max(engine.position + delta, 0), engine.duration))
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        void exportMix()
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        if (!importing) setImportSourceOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [renamingSong, confirmDialog, importSourceOpen, settingsOpen, draggedTrackId, importing, togglePlayback, seek, exportMix, engine])

  return (
    <main className="app-shell">
      <TitleBar onOpenSettings={openSettings} />
      <div className="app-content">
        <Sidebar songs={songs} activeSong={activeSong} loading={libraryLoading} importing={importing} cancelling={cancelling} importProgress={importProgress} importStage={importStage} onSelect={selectSong} onImport={openImportSource} onCancelImport={cancelImport} onRename={openRenameDialog} onDelete={deleteSong} />
        <div className="workspace">
        <div className="timeline-header"><span>TRACK</span><span>{activeSong ? activeSong.replaceAll('-', ' ') : t('selectSongHint')}</span></div>
        {error && <div className="error-message" role="alert">{error}</div>}
        {notice && <div className="status-message" role="status">{notice}</div>}
        <div className="tracks">
          {tracks.map((track, index) => (
            <TrackLane key={track.id} track={track} index={index}
              onSeek={seek}
              loopRange={loopRange}
              onRangeChange={updateLoopRange}
              onRangeCommit={startLoopRange}
              onClearRange={clearLoopRange}
              onRemove={deleteStem}
              dragging={draggedTrackId === track.id}
              onDragStart={setDraggedTrackId}
              onDragEnd={endTrackDrag}
              onDrop={reorderTracks}
              onUpdate={updateTrack}
            />
          ))}
          {!libraryLoading && !tracks.length && <div className="welcome"><h1>{t('welcomeTitle')}</h1><p>{t('welcomeBody')}</p></div>}
        </div>
        <TransportBar
          onPlayPause={togglePlayback}
          onStop={stopPlayback}
          onSeek={seek}
          onMasterVolume={setMasterVolume}
          loopRange={loopRange}
          looping={looping}
          onToggleLoop={toggleLoop}
          exportingMix={exportingMix}
          onExportMix={handleExportMix}
        />
        </div>
      </div>
      {renamingSong && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setRenamingSong(undefined)}>
          <form className="rename-dialog" ref={renameDialogRef} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void renameSong() }} role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <h2 id="rename-title">{t('renameSong')}</h2>
            <label htmlFor="song-name">{t('songFolderName')}</label>
            <input id="song-name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
            <div className="dialog-actions">
              <button type="button" onClick={() => setRenamingSong(undefined)}>{t('cancel')}</button>
              <button type="submit" className="primary-button">{t('save')}</button>
            </div>
          </form>
        </div>
      )}
      {confirmDialog && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirmDialog(undefined)}>
          <div className="rename-dialog confirm-dialog" ref={confirmDialogRef} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
            <h2 id="confirm-title">{confirmDialog.title}</h2>
            <p id="confirm-body">{confirmDialog.body}</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setConfirmDialog(undefined)}>{t('cancel')}</button>
              <button type="button" autoFocus className="primary-button danger" onClick={() => { const dialog = confirmDialog; setConfirmDialog(undefined); void dialog.action() }}>{t('delete')}</button>
            </div>
          </div>
        </div>
      )}
      {importSourceOpen && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setImportSourceOpen(false)}>
          <form className="rename-dialog import-source-dialog" ref={importSourceRef} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); importYouTubeAudio() }} role="dialog" aria-modal="true" aria-labelledby="import-source-title">
            <h2 id="import-source-title">{t('importAudio')}</h2>
            <p>{t('importAudioDescription')}</p>
            <button type="button" className="source-option" onClick={importLocalFile}>{t('chooseLocalFile')}</button>
            <div className="source-option-divider">{t('or')}</div>
            <label htmlFor="youtube-url">{t('youTubeLink')}</label>
            <input id="youtube-url" type="url" value={youTubeUrl} onChange={(event) => setYouTubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." autoFocus />
            <div className="dialog-actions">
              <button type="button" onClick={() => setImportSourceOpen(false)}>{t('cancel')}</button>
              <button type="submit" className="primary-button" disabled={!youTubeUrl.trim()}>{t('import')}</button>
            </div>
          </form>
        </div>
      )}
      {settingsOpen && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div className="rename-dialog confirm-dialog" ref={settingsDialogRef} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <h2 id="settings-title">{t('settings')}</h2>
            <div className="settings-section" role="group" aria-label={t('theme')}>
              <span className="settings-section-label">{t('theme')}</span>
              <div className="theme-grid">
                {THEMES.map((item) => (
                  <button key={item.id} type="button" aria-pressed={theme === item.id} className={`theme-option${theme === item.id ? ' active' : ''}`} onClick={() => setTheme(item.id)}>
                    <span className="theme-swatch" style={{ background: item.swatch }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section" role="group" aria-label={t('language')}>
              <span className="settings-section-label">{t('language')}</span>
              <div className="language-grid">
                {LANGUAGES.map((item) => (
                  <button key={item.id} type="button" aria-pressed={language === item.id} className={`theme-option${language === item.id ? ' active' : ''}`} onClick={() => setLanguage(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" autoFocus onClick={() => setSettingsOpen(false)} className="primary-button">{t('close')}</button>
            </div>
          </div>
        </div>
      )}
      {(libraryLoading || loadingSong) && (
        <div className="work-banner" role="status" aria-live="polite">
          <div className="work-spinner" />
          <div><strong>{loadingSong ? t('loadingSongStems') : t('loadingLibrary')}</strong><span>{loadingSong ? loadingSong.replaceAll('-', ' ') : t('preparingWorkspace')}</span></div>
        </div>
      )}
    </main>
  )
}
