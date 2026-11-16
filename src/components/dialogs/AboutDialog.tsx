import { useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import appIcon from "../../assets/app_512.png";

interface AboutDialogProps {
  onClose: () => void;
}

/** About dialog showing app version, description, and links. */
export function AboutDialog({ onClose }: AboutDialogProps) {
  const t = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, true);
  const [iconPulse, setIconPulse] = useState(false);

  const handleIconClick = () => {
    setIconPulse(true);
    setTimeout(() => setIconPulse(false), 600);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="rename-dialog about-dialog"
        ref={ref}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <div className="about-header">
          <div className="about-icon-wrapper" onClick={handleIconClick}>
            <img
              src={appIcon}
              alt=""
              className={`about-icon${iconPulse ? " about-icon-pulse" : ""}`}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <h2 id="about-title" className="about-title">
            Ramses Studio
          </h2>
          <span className="about-version-badge">
            {t("version")} {__APP_VERSION__}
          </span>
        </div>
        <div className="about-info-card">
          <p className="about-description">{t("aboutDescription")}</p>
          <p className="about-model">{t("aboutModel")}</p>
          <p className="about-license">{t("aboutLicense")}</p>
        </div>
        <div className="about-links-row">
          <a
            href="https://github.com/rramirezacosta/ramses-studio"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("aboutSource")}
          </a>
          <span className="about-links-separator">·</span>
          <a
            href="https://rramirezacosta.github.io/ramses-studio/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("aboutPrivacy")}
          </a>
          <span className="about-links-separator">·</span>
          <a
            href="https://rramirezacosta.github.io/ramses-studio/terms.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("aboutTerms")}
          </a>
        </div>
      </div>
    </div>
  );
}
