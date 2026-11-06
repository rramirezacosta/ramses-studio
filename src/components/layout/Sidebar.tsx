import { FilePenLine, FilePlus2, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import logo from '../../assets/logo.png'
import type { Song } from '../../types/audio'

interface Props {
  songs: Song[]
  activeSong?: string
  loading: boolean
  importing: boolean
  importProgress?: number
  importStage?: string
  onSelect: (song: Song) => void
  onImport: () => void
  onRename: (song: Song) => void
  onDelete: (song: Song) => void
}

export function Sidebar({ songs, activeSong, loading, importing, importProgress, importStage, onSelect, onImport, onRename, onDelete }: Props) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSongs = songs.filter((song) => song.name.toLocaleLowerCase().includes(normalizedQuery))

  return (
    <aside className="sidebar">
      <div className="brand"><img src={logo} alt="Ramses Studio" /></div>
      <div className="library-title">SONG LIBRARY</div>
      <button className="import-button" onClick={onImport} disabled={importing}>
        <FilePlus2 size={15} /> {importing ? `Splitting ${Math.round((importProgress ?? 0) * 100)}%` : 'Import Song'}
      </button>
      {importing && importStage && <p className="import-stage-message">{importStage}</p>}
      {importing && <p className="import-fallback-message">Using CPU for inference, it may take a while.</p>}
      {loading && <p className="empty-state">Loading library...</p>}
      {!loading && songs.length === 0 && <p className="empty-state">No songs in your library</p>}
      <nav className="song-list">
        {visibleSongs.map((song) => (
          <div key={song.name} className={`song-row ${song.name === activeSong ? 'active' : ''}`}>
            <button className="song-item" onClick={() => onSelect(song)}>
              <strong>{song.name.replaceAll('-', ' ')}</strong>
              <small>{song.stems.length} stems</small>
            </button>
            <div className="song-actions">
              <button onClick={() => onRename(song)} title={`Rename ${song.name}`} aria-label={`Rename ${song.name}`}><FilePenLine size={14} /></button>
              <button onClick={() => onDelete(song)} title={`Delete ${song.name}`} aria-label={`Delete ${song.name}`}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </nav>
      <label className="library-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search library" aria-label="Search song library" />
      </label>
    </aside>
  )
}
