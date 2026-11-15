import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloudDownload, CloudOff, CloudUpload, FilePenLine, FilePlus2, HardDrive, HardDriveDownload, Search, Trash2, Info, ArrowUpDown, X, Music, CheckCheck } from 'lucide-react'
import { DriveLogo } from '../drive/DriveLogo'
import { useTranslation } from '../../i18n'
import { parseSongName, songDisplayName } from '../../utils/songName'
import type { Song } from '../../types/audio'

export interface LibraryManagerProps {
  songs: Song[]
  activeSong?: string
  loading: boolean
  importing: boolean
  cancelling?: boolean
  importProgress?: number
  importStage?: string
  syncedNames: Set<string>
  driveConnected: boolean
  downloading?: { name: string; percent: number }
  remoteCount: number
  onDriveRemove: (song: Song) => void
  onDriveSync: (song: Song) => void
  onEvict: (song: Song) => void
  onDriveDownload: (song: Song) => void
  onDownloadAll: () => void
  onCancelImport?: () => void
  onRename: (song: Song) => void
  onDelete: (song: Song) => void
  onBulkDelete: (songs: Song[]) => void
  onBulkSync?: (songs: Song[]) => void
  onBulkDownload?: (songs: Song[]) => void
  onBulkEvict?: (songs: Song[]) => void
  onClose?: () => void
}

function artHue(name: string): number {
  return [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0)
}

const LEADING_ARTICLE = /^(the|los|las|les)-/i
const songSortKey = (name: string) => name.replace(LEADING_ARTICLE, '')

type SortKey = 'name' | 'recent' | 'size'
type FilterKey = 'all' | 'local' | 'synced' | 'remote'

export const LibraryManager = memo(function LibraryManager(props: LibraryManagerProps) {
  const t = useTranslation()
  const { onClose } = props
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ song: Song; x: number; y: number } | undefined>()
  const [details, setDetails] = useState<Song | undefined>()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const detailsRef = useRef<HTMLDivElement | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()

  const filtered = props.songs.filter((song) => {
    if (!song.name.toLocaleLowerCase().includes(normalizedQuery)) return false
    const synced = props.syncedNames.has(song.name)
    if (filter === 'local') return !song.remoteOnly
    if (filter === 'synced') return synced && !song.remoteOnly
    if (filter === 'remote') return song.remoteOnly || synced
    return true
  })

  const visibleSongs = [...filtered].sort((a, b) => {
    if (sort === 'recent') return (b.lastOpened ?? 0) - (a.lastOpened ?? 0)
    if (sort === 'size') return (b.size ?? 0) - (a.size ?? 0)
    return songSortKey(a.name).localeCompare(songSortKey(b.name)) || a.name.localeCompare(b.name)
  })

  const anySelected = selected.size > 0
  const selectedSongs = props.songs.filter((s) => selected.has(s.name))

  const toggleSelect = useCallback((song: Song) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(song.name)) next.delete(song.name)
      else next.add(song.name)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const allNames = new Set(visibleSongs.map((s) => s.name))
      const allVisibleSelected = visibleSongs.length > 0 && visibleSongs.every((s) => prev.has(s.name))
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const s of visibleSongs) next.delete(s.name)
        return next
      }
      const next = new Set(prev)
      for (const s of visibleSongs) next.add(s.name)
      return next
    })
  }, [visibleSongs])

  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(undefined)
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  useEffect(() => {
    if (!details) return
    const dismiss = () => setDetails(undefined)
    const onPointerDown = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) dismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [details])

  useLayoutEffect(() => {
    const menuElement = menuRef.current
    if (!menu || !menuElement || !menuElement.offsetWidth) return
    const x = Math.min(menu.x, window.innerWidth - menuElement.offsetWidth - 8)
    const y = Math.min(menu.y, window.innerHeight - menuElement.offsetHeight - 8)
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y })
  }, [menu])

  const progressPercent = props.importing ? (props.importProgress ?? 0) : (props.downloading?.percent ?? 0)

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds || !Number.isFinite(seconds)) return '—'
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="library-manager-inline" role="region" aria-labelledby="library-manager-title">
      <div className="library-manager-header">
        <h2 id="library-manager-title">{t('libraryManagement')}</h2>
        {onClose && (
          <button type="button" className="library-manager-close" onClick={onClose} aria-label={t('close')}><X size={18} /></button>
        )}
      </div>

      {(props.importing || props.downloading) && (
        <div className="library-progress-banner" role="status" aria-live="polite">
          <div className="library-progress-bar">
            <div
              className="library-progress-fill"
              style={{ width: `${Math.round(progressPercent * 100)}%` }}
            />
          </div>
          <span className="library-progress-label">
            {props.importing
              ? t('libraryImportProgress', { percent: Math.round((props.importProgress ?? 0) * 100) })
              : t('libraryDownloadProgress', { name: props.downloading?.name ?? '', percent: Math.round((props.downloading?.percent ?? 0) * 100) })}
            {props.importStage ? ` · ${props.importStage}` : ''}
          </span>
          {props.importing && props.onCancelImport && (
            <button type="button" className="library-progress-cancel" onClick={props.onCancelImport}>{t('cancel')}</button>
          )}
        </div>
      )}

      {!props.loading && props.songs.length > 0 && (
        <div className="library-summary" aria-label={t('libraryManagement')}>
          <span>{t('librarySummarySongs', { count: props.songs.length })}</span>
          <span>{t('librarySummarySize', { size: formatBytes(props.songs.reduce((sum, song) => sum + (song.size ?? 0), 0)) })}</span>
          <span>{props.remoteCount} {t('filterRemote').toLowerCase()}</span>
        </div>
      )}

      <div className="library-manager-toolbar">
        <label className="library-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchLibrary')} aria-label={t('searchLibraryAria')} />
        </label>
        <div className="library-filter-chips">
          {(['all', 'local', 'synced', 'remote'] as FilterKey[]).map((key) => (
            <button key={key} type="button" className={`filter-chip ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
              {key === 'all' ? t('filterAll') : key === 'local' ? t('filterLocal') : key === 'synced' ? t('filterSynced') : t('filterRemote')}
            </button>
          ))}
        </div>
        <label className="library-sort">
          <ArrowUpDown size={12} />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('sortBy')}>
            <option value="name">{t('sortByName')}</option>
            <option value="recent">{t('sortByRecent')}</option>
            <option value="size">{t('sortBySize')}</option>
          </select>
        </label>
        {visibleSongs.length > 0 && (
          <button type="button" className="library-select-all" onClick={toggleSelectAll} title={visibleSongs.every((s) => selected.has(s.name)) ? t('deselectAll') : t('selectAll')}>
            <CheckCheck size={14} />
          </button>
        )}
      </div>

      {props.loading ? (
        <div className="song-list skeleton-list" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="song-row skeleton">
              <span className="song-cover skeleton-block" />
              <span className="song-meta">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-sub" />
              </span>
            </div>
          ))}
        </div>
      ) : props.songs.length === 0 ? (
        <div className="empty-state library-empty-state">
          <div className="library-empty-header">
            <h3>{t('libraryEmptyTitle')}</h3>
            <p>{t('libraryEmptySubtitle')}</p>
          </div>
          <div className="library-empty-steps">
            <h4>{t('libraryEmptyHowItWorks')}</h4>
            <div className="library-empty-step">
              <span className="library-empty-step-number">1</span>
              <span>{t('libraryEmptyStep1')}</span>
            </div>
            <div className="library-empty-step">
              <span className="library-empty-step-number">2</span>
              <span>{t('libraryEmptyStep2')}</span>
            </div>
            <div className="library-empty-step">
              <span className="library-empty-step-number">3</span>
              <span>{t('libraryEmptyStep3')}</span>
            </div>
          </div>
        </div>
      ) : visibleSongs.length === 0 ? (
<div className="empty-state library-no-matches">
           <p>{t('noMatchingSongs')}</p>
           <button type="button" className="library-clear-filters" onClick={() => { setQuery(''); setFilter('all') }}>{t('clearFilters')}</button>
         </div>
      ) : (
        <div className="library-manager-grid">
          {visibleSongs.map((song) => {
            const synced = props.syncedNames.has(song.name)
            const selectedRow = selected.has(song.name)
            const driveButtons = props.driveConnected ? (
              song.remoteOnly ? (
                <button type="button" onClick={() => props.onDriveDownload(song)} title={t('driveDownloadSong')}><CloudDownload size={13} /></button>
              ) : synced ? (
                <>
                  <button type="button" onClick={() => props.onDriveRemove(song)} title={t('driveSongRemove')}><CloudOff size={13} /></button>
                  <button type="button" onClick={() => props.onEvict(song)} title={t('driveFreeSpace')}><HardDriveDownload size={13} /></button>
                </>
              ) : (
                <button type="button" onClick={() => props.onDriveSync(song)} title={t('driveSongSync')}><CloudUpload size={13} /></button>
              )
            ) : null
            return (
              <div key={song.name} className={`song-row ${song.name === props.activeSong ? 'active' : ''} ${selectedRow ? 'selected' : ''}`} aria-current={song.name === props.activeSong ? 'true' : undefined}>
                <label className="song-select visible" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedRow} onChange={() => toggleSelect(song)} aria-label={songDisplayName(song.name)} />
                </label>
                <button className="song-item" title={songDisplayName(song.name)}>
                  {song.cover ? (
                    <img className="song-cover" src={song.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="song-cover song-cover-fallback" style={{ '--art-hue': artHue(song.name) } as React.CSSProperties}>{song.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <span className={`sync-pill sync-pill-${song.remoteOnly ? 'remote' : synced ? 'synced' : 'local'}`}>
                    {song.remoteOnly ? t('syncPillRemote') : synced ? t('syncPillSynced') : t('syncPillLocal')}
                  </span>
                  <span className="song-meta">
                    <strong>{parseSongName(song.name).title}</strong>
                    <small>{parseSongName(song.name).artist ?? t('stemsCount', { count: song.stems.length })}</small>
                    <small className="song-meta-extra">{formatBytes(song.size ?? 0)} · {formatDuration(song.duration)}</small>
                  </span>
                </button>
                <div className="library-manage-actions">
                  <button type="button" onClick={() => setDetails(song)} title={t('songDetails')}><Info size={13} /></button>
                  {driveButtons}
                  <button type="button" onClick={() => props.onRename(song)} title={t('rename')}><FilePenLine size={13} /></button>
                  <button type="button" className="danger" onClick={() => props.onDelete(song)} title={t('delete')}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {anySelected && (
        <div className="bulk-bar">
          <span className="bulk-count">{t('selectedCount', { count: selected.size })}</span>
          <div className="bulk-actions">
            {props.onBulkSync && (
              <button type="button" onClick={() => { props.onBulkSync!(selectedSongs); clearSelection() }} title={t('driveSongSync')}><CloudUpload size={13} /></button>
            )}
            {props.onBulkDownload && selectedSongs.some((s) => s.remoteOnly) && (
              <button type="button" onClick={() => { props.onBulkDownload!(selectedSongs); clearSelection() }} title={t('driveDownloadSong')}><CloudDownload size={13} /></button>
            )}
            {props.onBulkEvict && selectedSongs.some((s) => !s.remoteOnly && props.syncedNames.has(s.name)) && (
              <button type="button" onClick={() => { props.onBulkEvict!(selectedSongs); clearSelection() }} title={t('driveFreeSpace')}><HardDriveDownload size={13} /></button>
            )}
            <button type="button" className="danger" onClick={() => { props.onBulkDelete(selectedSongs); clearSelection() }} title={t('delete')}><Trash2 size={13} /></button>
            <button type="button" onClick={clearSelection} title={t('cancel')}>✕</button>
          </div>
        </div>
      )}

      {menu && createPortal(
        <div className="song-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu" tabIndex={-1}>
          {props.syncedNames.has(menu.song.name) && !menu.song.remoteOnly && (
            <button role="menuitem" onClick={() => { setMenu(undefined); props.onEvict(menu.song) }}>
              <HardDriveDownload size={14} /> {t('driveFreeSpace')}
            </button>
          )}
          {props.driveConnected && (menu.song.remoteOnly ? (
            <button role="menuitem" onClick={() => { setMenu(undefined); props.onDriveDownload(menu.song) }}>
              <CloudDownload size={14} /> {t('driveDownloadSong')}
            </button>
          ) : props.syncedNames.has(menu.song.name) ? (
            <button role="menuitem" onClick={() => { setMenu(undefined); props.onDriveRemove(menu.song) }}>
              <CloudOff size={14} /> {t('driveSongRemove')}
            </button>
          ) : (
            <button role="menuitem" onClick={() => { setMenu(undefined); props.onDriveSync(menu.song) }}>
              <CloudUpload size={14} /> {t('driveSongSync')}
            </button>
          ))}
          <button role="menuitem" onClick={() => { setMenu(undefined); props.onRename(menu.song) }}>
            <FilePenLine size={14} /> {t('rename')}
          </button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(undefined); props.onDelete(menu.song) }}>
            <Trash2 size={14} /> {t('delete')}
          </button>
        </div>,
        document.body,
      )}

      {details && createPortal(
        <div className="dialog-backdrop" role="presentation" onClick={() => setDetails(undefined)}>
          <div className="rename-dialog confirm-dialog details-dialog" ref={detailsRef} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="dialog-header"><h2>{songDisplayName(details.name)}</h2><button type="button" className="dialog-close" onClick={() => setDetails(undefined)} aria-label={t('close')}>×</button></div>
            <div className="details-body">
              {details.cover && <img className="details-cover" src={details.cover} alt="" />}
              <dl>
                <dt>{t('artistName')}</dt><dd>{parseSongName(details.name).artist ?? '—'}</dd>
                <dt>{t('songTitle')}</dt><dd>{parseSongName(details.name).title}</dd>
                <dt>{t('stemsCount', { count: details.stems.length })}</dt><dd>{details.stems.join(', ')}</dd>
                <dt>{t('duration')}</dt><dd>{formatDuration(details.duration)}</dd>
                <dt>{t('songSize')}</dt><dd>{formatBytes(details.size ?? 0)}</dd>
                <dt>{t('status')}</dt><dd>{details.remoteOnly ? t('driveRemoteSong') : props.syncedNames.has(details.name) ? t('driveSynced') : t('localOnlySong')}</dd>
                {details.lastOpened ? <><dt>{t('lastOpened')}</dt><dd>{new Date(details.lastOpened).toLocaleString()}</dd></> : null}
              </dl>
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDetails(undefined)}>{t('close')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
})