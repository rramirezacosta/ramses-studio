import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FilePenLine, FilePlus2, Search, Trash2 } from 'lucide-react'
import logo from '../../assets/logo.png'
import { useTranslation } from '../../i18n'
import { parseSongName, songDisplayName } from '../../utils/songName'
import type { Song } from '../../types/audio'

/** Stable hue derived from the song name so the gradient placeholder is consistent per song. */
function artHue(name: string): number {
  return [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0)
}

function initialsFor(artist: string | undefined, title: string): string {
  const letters = artist ? `${artist[0] ?? ''}${title[0] ?? ''}` : `${title[0] ?? ''}${title[1] ?? ''}`
  return letters.toUpperCase()
}

interface RowProps {
  song: Song
  active: boolean
  onSelect: (song: Song) => void
  /** Open the per-song context menu; screenX/screenY in CSS pixels. */
  onMenu: (song: Song, x: number, y: number) => void
}

const SongRow = memo(function SongRow({ song, active, onSelect, onMenu }: RowProps) {
  const t = useTranslation()
  const [coverFailed, setCoverFailed] = useState(false)
  const { artist, title } = parseSongName(song.name)
  const hasCover = Boolean(song.cover) && !coverFailed
  return (
    <div
      className={`song-row ${active ? 'active' : ''}`}
      onContextMenu={(event) => { event.preventDefault(); onMenu(song, event.clientX, event.clientY) }}
    >
      <button className="song-item" onClick={() => onSelect(song)} title={songDisplayName(song.name)}>
        {hasCover ? (
          <img className="song-cover" src={`ramses-cover://song/${encodeURIComponent(song.name)}`} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
        ) : (
          <span className="song-cover song-cover-fallback" style={{ '--art-hue': artHue(song.name) } as React.CSSProperties}>{initialsFor(artist, title)}</span>
        )}
        <span className="song-meta">
          <strong>{title}</strong>
          <small>{artist ?? t('stemsCount', { count: song.stems.length })}</small>
        </span>
      </button>
    </div>
  )
})

interface Props {
  songs: Song[]
  activeSong?: string
  loading: boolean
  importing: boolean
  cancelling?: boolean
  importProgress?: number
  importStage?: string
  onSelect: (song: Song) => void
  onImport: () => void
  onCancelImport?: () => void
  onRename: (song: Song) => void
  onDelete: (song: Song) => void
}

export const Sidebar = memo(function Sidebar({ songs, activeSong, loading, importing, cancelling, importProgress, importStage, onSelect, onImport, onCancelImport, onRename, onDelete }: Props) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [importHovered, setImportHovered] = useState(false)
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | undefined>()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSongs = songs.filter((song) => song.name.toLocaleLowerCase().includes(normalizedQuery))

  const openSongMenu = useCallback((song: Song, x: number, y: number) => setMenu({ song, x, y }), [])

  // Dismiss on outside press, Escape, scroll of any ancestor (the fixed menu must not
  // detach from rows scrolling underneath) and on window resize.
  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(undefined)
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    menuRef.current?.focus()
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  // Keep the menu clamped inside the viewport once it has rendered and can be measured.
  useLayoutEffect(() => {
    const menuElement = menuRef.current
    if (!menu || !menuElement || !menuElement.offsetWidth) return
    const x = Math.min(menu.x, window.innerWidth - menuElement.offsetWidth - 8)
    const y = Math.min(menu.y, window.innerHeight - menuElement.offsetHeight - 8)
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y })
  }, [menu])

  return (
    <aside className="sidebar">
      <div className="brand"><img src={logo} alt="Ramses Studio" /></div>
      <div className="library-title">{t('songLibrary')}</div>
      <button
        className={`import-button${importing && importHovered && !cancelling ? ' cancel' : ''}${cancelling ? ' cancelling' : ''}`}
        onClick={importing && !cancelling ? () => onCancelImport?.() : onImport}
        disabled={cancelling}
        onMouseEnter={() => setImportHovered(true)}
        onMouseLeave={() => setImportHovered(false)}
      >
        {!importing ? <FilePlus2 size={15} /> : null} <span>{cancelling ? t('cancelling') : importing ? (importHovered ? t('cancel') : importStage ?? t('splittingPercent', { percent: Math.round((importProgress ?? 0) * 100) })) : t('importSong')}</span>
      </button>
      {importing && <p className="import-fallback-message">{t('cpuInference')}</p>}
      {loading && <p className="empty-state">{t('loadingLibrary')}</p>}
      {!loading && songs.length === 0 && <p className="empty-state">{t('noSongs')}</p>}
      <nav className="song-list">
        {visibleSongs.map((song) => (
          <SongRow key={song.name} song={song} active={song.name === activeSong} onSelect={onSelect} onMenu={openSongMenu} />
        ))}
      </nav>
      {menu ? createPortal(
        // Portal to <body>: the sidebar's backdrop-filter makes it the containing block
        // for position:fixed children, which would offset the menu away from the cursor.
        <div className="song-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu" tabIndex={-1} aria-label={t('songLibrary')}>
          <button role="menuitem" onClick={() => { setMenu(undefined); onRename(menu.song) }}>
            <FilePenLine size={14} /> {t('rename')}
          </button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(undefined); onDelete(menu.song) }}>
            <Trash2 size={14} /> {t('delete')}
          </button>
        </div>,
        document.body,
      ) : null}
      <label className="library-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchLibrary')} aria-label={t('searchLibraryAria')} />
      </label>
    </aside>
  )
})
