import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AudioLines,
  ClefBass,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Drum,
  FilePenLine,
  FilePlus2,
  GuitarElectric,
  HardDrive,
  HardDriveDownload,
  KeyboardMusic,
  MicVocal,
  Music,
  Search,
  Settings2,
  Trash2,
  Info,
  Check,
  ArrowUpDown,
  Filter,
  Wand2,
  Headphones,
  Cloud,
  Play,
} from "lucide-react";
import logo from "../../assets/logo.png";
import { useTranslation } from "../../i18n";
import { parseSongName, songDisplayName } from "../../utils/songName";
import type { Song } from "../../types/audio";

/** Stable hue derived from the song name so the gradient placeholder is consistent per song. */
function artHue(name: string): number {
  return [...name].reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) % 360,
    0,
  );
}

function initialsFor(artist: string | undefined, title: string): string {
  const letters = artist
    ? `${artist[0] ?? ""}${title[0] ?? ""}`
    : `${title[0] ?? ""}${title[1] ?? ""}`;
  return letters.toUpperCase();
}

const LEADING_ARTICLE = /^(the|los|las|les)-/i;
const songSortKey = (name: string) => name.replace(LEADING_ARTICLE, "");

const stemIcons: Record<string, typeof Music> = {
  drum: Drum,
  drums: Drum,
  bass: ClefBass,
  guitar: GuitarElectric,
  piano: KeyboardMusic,
  vocal: MicVocal,
  vocals: MicVocal,
  other: AudioLines,
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

interface RowProps {
  song: Song;
  active: boolean;
  /** True when the song is backed up on Google Drive. */
  synced: boolean;
  /** Ongoing on-demand download for this song (0..1), if any. */
  downloading?: number;
  selected: boolean;
  anySelected: boolean;
  onSelect: (song: Song) => void;
  onToggleSelect: (song: Song) => void;
  onMenu: (song: Song, x: number, y: number) => void;
  onInfo: (song: Song) => void;
}

const SongRow = memo(function SongRow({
  song,
  active,
  synced,
  downloading,
  selected,
  anySelected,
  onSelect,
  onToggleSelect,
  onMenu,
  onInfo,
}: RowProps) {
  const t = useTranslation();
  const [coverFailed, setCoverFailed] = useState(false);
  const { artist, title } = parseSongName(song.name);
  const hasCover = Boolean(song.cover) && !coverFailed;
  return (
    <div
      className={`song-row ${active ? "active" : ""} ${selected ? "selected" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(song, event.clientX, event.clientY);
      }}
    >
      <label
        className={`song-select ${anySelected || selected ? "visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(song)}
          aria-label={songDisplayName(song.name)}
        />
      </label>
      <button
        className="song-card"
        onClick={() => onSelect(song)}
        title={songDisplayName(song.name)}
      >
        <div className="song-card-cover-wrap">
          {hasCover ? (
            <img
              className="song-cover"
              src={song.cover}
              alt=""
              loading="lazy"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <span
              className="song-cover song-cover-fallback"
              style={{ "--art-hue": artHue(song.name) } as React.CSSProperties}
            >
              {initialsFor(artist, title)}
            </span>
          )}
          {downloading !== undefined ? (
            <span
              className="song-download"
              style={{ width: `${Math.round(downloading * 100)}%` }}
            />
          ) : null}
          {synced && !song.remoteOnly && (
            <span
              className="song-cover-badge song-cover-badge-sync"
              title={t("driveSynced")}
            >
              <Cloud size={10} />
            </span>
          )}
          {song.remoteOnly && (
            <span
              className="song-cover-badge song-cover-badge-remote"
              title={t("driveRemoteSong")}
            >
              <CloudDownload size={10} />
            </span>
          )}
        </div>
        <span className="song-card-meta">
          <strong title={title}>{title}</strong>
          {artist && (
            <small className="song-card-artist" title={artist}>
              {artist}
            </small>
          )}
        </span>
        <div className="song-card-actions">
          <button
            className="song-info-btn"
            onClick={(e) => {
              e.stopPropagation();
              onInfo(song);
            }}
            title={t("songDetails")}
            aria-label={t("songDetails")}
          >
            <Info size={13} />
          </button>
        </div>
      </button>
    </div>
  );
});

interface Props {
  songs: Song[];
  activeSong?: string;
  loading: boolean;
  importing: boolean;
  cancelling?: boolean;
  importProgress?: number;
  importStage?: string;
  /** Songs backed up on Google Drive (Drive badge on their cover). */
  syncedNames: Set<string>;
  /** Whether Google Drive is connected (Drive menu items appear only then). */
  driveConnected: boolean;
  /** On-demand download in progress, if any. */
  downloading?: { name: string; percent: number };
  /** Number of songs that live only on Drive (for the bulk download action). */
  remoteCount: number;
  /** Remove one song's Drive backup, keeping the local copy. */
  onDriveRemove: (song: Song) => void;
  /** Upload/reconcile one song on Drive right now. */
  onDriveSync: (song: Song) => void;
  /** Delete the local stems of a backed-up song (it re-downloads on open). */
  onEvict: (song: Song) => void;
  /** Download a remote-only song right now. */
  onDriveDownload: (song: Song) => void;
  /** Download every remote-only song. */
  onDownloadAll: () => void;
  onSelect: (song: Song) => void;
  onImport: () => void;
  onCancelImport?: () => void;
  onRename: (song: Song) => void;
  onDelete: (song: Song) => void;
  onBulkDelete: (songs: Song[]) => void;
  onBulkSync?: (songs: Song[]) => void;
  onBulkDownload?: (songs: Song[]) => void;
  onBulkEvict?: (songs: Song[]) => void;
  libraryManagerOpen: boolean;
  onToggleLibraryManager: () => void;
}

export const Sidebar = memo(function Sidebar({
  songs,
  activeSong,
  loading,
  importing,
  cancelling,
  importProgress,
  importStage,
  syncedNames,
  driveConnected,
  downloading,
  remoteCount,
  onDriveRemove,
  onDriveSync,
  onEvict,
  onDriveDownload,
  onDownloadAll,
  onSelect,
  onImport,
  onCancelImport,
  onRename,
  onDelete,
  onBulkDelete,
  onBulkSync,
  onBulkDownload,
  onBulkEvict,
  libraryManagerOpen,
  onToggleLibraryManager,
}: Props) {
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const [importHovered, setImportHovered] = useState(false);
  const [menu, setMenu] = useState<
    { song: Song; x: number; y: number } | undefined
  >();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Song | undefined>();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const normalizedQuery = useMemo(
    () => query.trim().toLocaleLowerCase(),
    [query],
  );

  const filtered = useMemo(
    () =>
      songs.filter((song) =>
        song.name.toLocaleLowerCase().includes(normalizedQuery),
      ),
    [songs, normalizedQuery],
  );

  const visibleSongs = useMemo(() => [...filtered], [filtered]);

  const anySelected = selected.size > 0;
  const selectedSongs = useMemo(
    () => songs.filter((s) => selected.has(s.name)),
    [songs, selected],
  );

  const openSongMenu = useCallback(
    (song: Song, x: number, y: number) => setMenu({ song, x, y }),
    [],
  );

  const toggleSelect = useCallback((song: Song) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(song.name)) next.delete(song.name);
      else next.add(song.name);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Dismiss on outside press, Escape, scroll of any ancestor and on window resize.
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(undefined);
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    menuRef.current?.focus();
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  useEffect(() => {
    if (!details) return;
    const dismiss = () => setDetails(undefined);
    const onPointerDown = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [details]);

  useLayoutEffect(() => {
    const menuElement = menuRef.current;
    if (!menu || !menuElement || !menuElement.offsetWidth) return;
    const x = Math.min(menu.x, window.innerWidth - menuElement.offsetWidth - 8);
    const y = Math.min(
      menu.y,
      window.innerHeight - menuElement.offsetHeight - 8,
    );
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu]);

  const formatDuration = (seconds?: number) => {
    if (!seconds || !Number.isFinite(seconds)) return "—";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt="Ramses Studio" />
      </div>

      {loading && (
        <div className="song-list skeleton-list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="song-row skeleton">
              <span className="song-cover skeleton-block" />
              <span className="song-meta">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-sub" />
              </span>
            </div>
          ))}
        </div>
      )}
      {!loading && songs.length === 0 && (
        <div className="empty-state onboarding-empty">
          <div className="onboarding-header">
            <h3>{t("emptyStateTitle")}</h3>
            <p>{t("emptyStateSubtitle")}</p>
          </div>
          <div className="onboarding-steps">
            <div className="onboarding-step">
              <span className="onboarding-step-icon">
                <Music size={18} />
              </span>
              <div>
                <strong>{t("onboardingStep1Title")}</strong>
                <span>{t("onboardingStep1Desc")}</span>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-icon">
                <Wand2 size={18} />
              </span>
              <div>
                <strong>{t("onboardingStep2Title")}</strong>
                <span>{t("onboardingStep2Desc")}</span>
              </div>
            </div>
            <div className="onboarding-step">
              <span className="onboarding-step-icon">
                <Headphones size={18} />
              </span>
              <div>
                <strong>{t("onboardingStep3Title")}</strong>
                <span>{t("onboardingStep3Desc")}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="sidebar-toolbar">
        {songs.length > 0 && (
          <label className="library-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchLibrary")}
              aria-label={t("searchLibraryAria")}
            />
          </label>
        )}
        {songs.length > 0 && (
          <button
            className="library-management-btn"
            onClick={onToggleLibraryManager}
            title={t("libraryManagement")}
          >
            <Settings2 size={14} />
          </button>
        )}
      </div>
      {!loading && songs.length > 0 && visibleSongs.length === 0 && (
        <p className="empty-state">{t("noMatchingSongs")}</p>
      )}
      {!loading && (
        <nav className="song-list">
          {visibleSongs.map((song) => (
            <SongRow
              key={song.name}
              song={song}
              active={song.name === activeSong}
              synced={syncedNames.has(song.name)}
              downloading={
                downloading?.name === song.name
                  ? downloading.percent
                  : undefined
              }
              selected={selected.has(song.name)}
              anySelected={anySelected}
              onSelect={onSelect}
              onToggleSelect={toggleSelect}
              onMenu={openSongMenu}
              onInfo={setDetails}
            />
          ))}
        </nav>
      )}

      {/* Bulk action bar */}
      {anySelected && (
        <div className="bulk-bar">
          <span className="bulk-count">
            {t("selectedCount", { count: selected.size })}
          </span>
          <div className="bulk-actions">
            {onBulkSync && (
              <button
                type="button"
                onClick={() => {
                  onBulkSync(selectedSongs);
                  clearSelection();
                }}
                title={t("driveSongSync")}
              >
                <CloudUpload size={13} />
              </button>
            )}
            {onBulkDownload && selectedSongs.some((s) => s.remoteOnly) && (
              <button
                type="button"
                onClick={() => {
                  onBulkDownload(selectedSongs);
                  clearSelection();
                }}
                title={t("driveDownloadSong")}
              >
                <CloudDownload size={13} />
              </button>
            )}
            {onBulkEvict &&
              selectedSongs.some(
                (s) => !s.remoteOnly && syncedNames.has(s.name),
              ) && (
                <button
                  type="button"
                  onClick={() => {
                    onBulkEvict(selectedSongs);
                    clearSelection();
                  }}
                  title={t("driveFreeSpace")}
                >
                  <HardDriveDownload size={13} />
                </button>
              )}
            <button
              type="button"
              className="danger"
              onClick={() => {
                onBulkDelete(selectedSongs);
                clearSelection();
              }}
              title={t("delete")}
            >
              <Trash2 size={13} />
            </button>
            <button type="button" onClick={clearSelection} title={t("cancel")}>
              ✕
            </button>
          </div>
        </div>
      )}

      <button
        className={`import-button${importing && importHovered && !cancelling ? " cancel" : ""}${cancelling ? " cancelling" : ""}`}
        onClick={importing && !cancelling ? () => onCancelImport?.() : onImport}
        disabled={cancelling}
        onMouseEnter={() => setImportHovered(true)}
        onMouseLeave={() => setImportHovered(false)}
      >
        {!importing ? <FilePlus2 size={15} /> : null}{" "}
        <span>
          {cancelling
            ? t("cancelling")
            : importing
              ? importHovered
                ? t("cancel")
                : (importStage ??
                  t("splittingPercent", {
                    percent: Math.round((importProgress ?? 0) * 100),
                  }))
              : t("importSong")}
        </span>
      </button>
      {importing && (
        <p className="import-fallback-message">{t("cpuInference")}</p>
      )}

      {menu
        ? createPortal(
            <div
              className="song-menu"
              ref={menuRef}
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              tabIndex={-1}
              aria-label={t("songLibrary")}
            >
              {syncedNames.has(menu.song.name) && !menu.song.remoteOnly && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(undefined);
                    onEvict(menu.song);
                  }}
                >
                  <HardDriveDownload size={14} /> {t("driveFreeSpace")}
                </button>
              )}
              {driveConnected &&
                (menu.song.remoteOnly ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      onDriveDownload(menu.song);
                    }}
                  >
                    <CloudDownload size={14} /> {t("driveDownloadSong")}
                  </button>
                ) : syncedNames.has(menu.song.name) ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      onDriveRemove(menu.song);
                    }}
                  >
                    <CloudOff size={14} /> {t("driveSongRemove")}
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      onDriveSync(menu.song);
                    }}
                  >
                    <CloudUpload size={14} /> {t("driveSongSync")}
                  </button>
                ))}
              {menu.song.remoteOnly && remoteCount > 1 && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(undefined);
                    onDownloadAll();
                  }}
                >
                  <CloudDownload size={14} />{" "}
                  {t("downloadAll", { count: remoteCount })}
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(undefined);
                  onRename(menu.song);
                }}
              >
                <FilePenLine size={14} /> {t("rename")}
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(undefined);
                  onDelete(menu.song);
                }}
              >
                <Trash2 size={14} /> {t("delete")}
              </button>
            </div>,
            document.body,
          )
        : null}

      {details
        ? createPortal(
            <div
              className="dialog-backdrop"
              role="presentation"
              onClick={() => setDetails(undefined)}
            >
              <div
                className="rename-dialog confirm-dialog details-dialog"
                ref={detailsRef}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="details-title"
              >
                <div className="details-body">
                  <div className="details-cover-wrap">
                    {details.cover ? (
                      <img
                        className="details-cover"
                        src={details.cover}
                        alt=""
                      />
                    ) : (
                      <span className="details-cover-fallback">
                        {parseSongName(details.name)
                          .title.slice(0, 2)
                          .toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="details-info">
                    <div className="details-song-name">
                      <strong>{parseSongName(details.name).title}</strong>
                      <small>{parseSongName(details.name).artist ?? "—"}</small>
                    </div>
                    <dl className="details-meta">
                      <dt>{t("duration")}</dt>
                      <dd>{formatDuration(details.duration)}</dd>
                      <dt>{t("songSize")}</dt>
                      <dd>{formatBytes(details.size ?? 0)}</dd>
                      <dt>{t("status")}</dt>
                      <dd>
                        <span
                          className={`details-status-badge ${details.remoteOnly ? "remote" : syncedNames.has(details.name) ? "synced" : "local"}`}
                        >
                          {details.remoteOnly
                            ? t("driveRemoteSong")
                            : syncedNames.has(details.name)
                              ? t("driveSynced")
                              : t("localOnlySong")}
                        </span>
                      </dd>
                      {details.lastOpened ? (
                        <>
                          <dt>{t("lastOpened")}</dt>
                          <dd>
                            {new Date(details.lastOpened).toLocaleString()}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                    <div className="details-stems-section">
                      <span className="details-stems-label">
                        {t("stemsCount", { count: details.stems.length })}
                      </span>
                      <span className="details-stems">
                        {details.stems.map((stem) => {
                          const StemIconComponent =
                            stemIcons[stem as keyof typeof stemIcons] || Music;
                          return (
                            <span key={stem} className="details-stem-chip">
                              <StemIconComponent
                                className="details-stem-chip-icon"
                                size={12}
                              />
                              {stem}
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
});

