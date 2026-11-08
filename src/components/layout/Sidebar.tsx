import { FilePenLine, FilePlus2, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import logo from '../../assets/logo.png'
import { useTranslation } from '../../i18n'
import type { Song } from '../../types/audio'

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

export function Sidebar({ songs, activeSong, loading, importing, cancelling, importProgress, importStage, onSelect, onImport, onCancelImport, onRename, onDelete }: Props) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [importHovered, setImportHovered] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSongs = songs.filter((song) => song.name.toLocaleLowerCase().includes(normalizedQuery))

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
          <div key={song.name} className={`song-row ${song.name === activeSong ? 'active' : ''}`}>
            <button className="song-item" onClick={() => onSelect(song)}>
              <strong>{song.name.replaceAll('-', ' ')}</strong>
              <small>{t('stemsCount', { count: song.stems.length })}</small>
            </button>
            <div className="song-actions">
              <button onClick={() => onRename(song)} title={t('renameSongAction', { name: song.name })} aria-label={t('renameSongAction', { name: song.name })}><FilePenLine size={14} /></button>
              <button onClick={() => onDelete(song)} title={t('deleteAction', { name: song.name })} aria-label={t('deleteAction', { name: song.name })}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </nav>
      <label className="library-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchLibrary')} aria-label={t('searchLibraryAria')} />
      </label>
    </aside>
  )
}
