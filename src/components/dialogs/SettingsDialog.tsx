import { useRef, useState } from "react";
import { DriveLogo } from "../drive/DriveLogo";
import { useTranslation } from "../../i18n";
import { useSyncStore } from "../../store/useSyncStore";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { LANGUAGES } from "../../i18n";
import { useSettingsStore } from "../../store/useSettingsStore";

interface SettingsDialogProps {
  storage: { usage: number; quota: number } | undefined;
  theme: string;
  onThemeChange: (theme: string) => void;
  onConnectDrive: () => void;
  onClose: () => void;
}

const THEMES = [
  { id: "midnight", label: "Midnight", swatch: "#a9a0ff" },
  { id: "adwaita", label: "Adwaita Dark", swatch: "#3584e4" },
  { id: "ocean", label: "Ocean", swatch: "#55b2ff" },
  { id: "ember", label: "Ember", swatch: "#ff9e64" },
  { id: "aurora", label: "Aurora", swatch: "#4fd88f" },
  { id: "orchid", label: "Orchid", swatch: "#f386d8" },
] as const;

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

/** Settings dialog: theme, language, Google Drive, and storage. */
export function SettingsDialog({
  storage,
  theme,
  onThemeChange,
  onConnectDrive,
  onClose,
}: SettingsDialogProps) {
  const t = useTranslation();
  const sync = useSyncStore();
  const language = useSettingsStore((store) => store.language);
  const setLanguage = useSettingsStore((store) => store.setLanguage);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, true);
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="rename-dialog confirm-dialog settings-dialog"
        ref={ref}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="settings-dialog-title">{t("settings")}</h2>
        <div className="settings-section settings-section-entrance" role="group" aria-label={t("theme")} style={{ animationDelay: "0.05s" }}>
          <span className="settings-section-label">{t("theme")}</span>
          <div className="theme-grid">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={theme === item.id}
                className={`theme-option${theme === item.id ? " active" : ""}${previewTheme === item.id ? " preview" : ""}`}
                onClick={() => onThemeChange(item.id)}
                onMouseEnter={() => setPreviewTheme(item.id)}
                onMouseLeave={() => setPreviewTheme(null)}
              >
                <span
                  className="theme-swatch"
                  style={{ background: item.swatch }}
                />
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="settings-section settings-section-entrance"
          role="group"
          aria-label={t("language")}
          style={{ animationDelay: "0.1s" }}
        >
          <span className="settings-section-label">{t("language")}</span>
          <div className="language-grid">
            {LANGUAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={language === item.id}
                className={`theme-option${language === item.id ? " active" : ""}`}
                onClick={() => setLanguage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="settings-section settings-section-entrance"
          role="group"
          aria-label={t("driveSync")}
          style={{ animationDelay: "0.15s" }}
        >
          <span className="settings-section-label">{t("driveSync")}</span>
          {sync.connected ? (
            <div className="drive-card connected">
              <div className="drive-head">
                <DriveLogo className="drive-logo" />
                <span className="drive-status-dot" aria-hidden="true" />
                <div className="drive-who">
                  <strong>{sync.account}</strong>
                  <small>
                    {sync.syncing
                      ? t("driveSyncing")
                      : sync.lastSyncedAt
                        ? t("driveLastSynced", {
                            time: new Date(sync.lastSyncedAt).toLocaleString(),
                          })
                        : t("driveNeverSynced")}
                  </small>
                </div>
              </div>
              <div className="drive-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={sync.syncing}
                  onClick={() => {
                    void sync.syncNow();
                  }}
                >
                  {sync.syncing ? (
                    <>
                      <span className="drive-spinner" aria-hidden="true" />{" "}
                      {t("driveSyncing")}
                    </>
                  ) : (
                    t("driveSyncNow")
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void sync.disconnect();
                  }}
                >
                  {t("driveDisconnect")}
                </button>
              </div>
            </div>
          ) : (
            <div className="drive-card">
              <div className="drive-head">
                <DriveLogo className="drive-logo muted" />
                <div className="drive-who">
                  <strong>{t("driveSync")}</strong>
                  <small>{t("driveNotConnected")}</small>
                </div>
              </div>
              <div className="drive-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={onConnectDrive}
                >
                  {t("driveConnect")}
                </button>
              </div>
            </div>
          )}
          {sync.error && (
            <small className="drive-error" role="alert">
              {t("driveSyncFailed", { message: sync.error })}
            </small>
          )}
          {sync.pendingChanges > 0 && (
            <small className="storage-usage">
              {t("pendingChanges", { count: sync.pendingChanges })}
            </small>
          )}
        </div>
        <div
          className="settings-section settings-section-entrance"
          role="group"
          aria-label={t("storage")}
          style={{ animationDelay: "0.2s" }}
        >
          <span className="settings-section-label">{t("storage")}</span>
          {storage && storage.usage / storage.quota >= 0.8 && (
            <small className="storage-warning" role="alert">
              {t("storageWarning", {
                percent: Math.round((storage.usage / storage.quota) * 100),
              })}
            </small>
          )}
          {storage ? (() => {
            const storagePercent = Math.min(100, (storage.usage / storage.quota) * 100);
            const storageLevel = storagePercent >= 80 ? "high" : storagePercent >= 50 ? "medium" : "low";
            return (
              <>
                <div className="storage-bar">
                  <div
                    className={`storage-bar-fill ${storageLevel}`}
                    style={{
                      width: `${storagePercent}%`,
                    }}
                  />
                </div>
                <small className="storage-usage">
                  {t("storageUsage", {
                    used: formatBytes(storage.usage),
                    total: formatBytes(storage.quota),
                  })}
                </small>
              </>
            );
          })() : (
            <small className="storage-usage">
              {t("storageUsage", { used: "—", total: "—" })}
            </small>
          )}
        </div>
      </div>
    </div>
  );
}
