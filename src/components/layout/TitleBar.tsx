import { Copy, Minus, Settings, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'

type WindowButton = 'minimize' | 'maximize' | 'close'

interface ButtonLayout {
  left: WindowButton[]
  right: WindowButton[]
}

const defaultLayout: ButtonLayout = { left: [], right: ['minimize', 'maximize', 'close'] }

interface TitleBarProps {
  onOpenSettings?: () => void
}

export function TitleBar({ onOpenSettings }: TitleBarProps) {
  const t = useTranslation()
  const [layout, setLayout] = useState<ButtonLayout>(defaultLayout)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.getWindowButtonLayout().then(setLayout)
  }, [])

  const toggleMaximize = () => {
    void window.api.toggleWindowMaximize().then(setMaximized)
  }

  const renderButton = (button: WindowButton) => {
    const config = {
      minimize: { label: t('minimize'), icon: <Minus size={16} />, action: () => { void window.api.minimizeWindow() } },
      maximize: { label: maximized ? t('restore') : t('maximize'), icon: maximized ? <Copy size={14} /> : <Square size={14} />, action: toggleMaximize },
      close: { label: t('close'), icon: <X size={17} />, action: () => { void window.api.closeWindow() } },
    }[button]

    return <button key={button} className={`titlebar-button titlebar-${button}`} type="button" aria-label={config.label} title={config.label} onClick={config.action}>{config.icon}</button>
  }

  const settingsButton = (
    <button
      key="settings"
      className="titlebar-button titlebar-settings"
      type="button"
      aria-label={t('settings')}
      title={t('settings')}
      onClick={onOpenSettings}
    >
      <Settings size={15} />
    </button>
  )

  const leftControls = [...layout.left]
  const rightControls = [...layout.right]

  // If window controls are on the right, put settings on the left (or vice versa).
  // If layout.left has buttons, put settings on the right, otherwise left.
  const hasLeftButtons = layout.left.length > 0

  return (
    <header className="titlebar">
      <div className="titlebar-window-controls">
        {hasLeftButtons ? leftControls.map(renderButton) : settingsButton}
      </div>
      <div className="titlebar-drag-region" onDoubleClick={toggleMaximize}>
        <span className="titlebar-name">Ramses Studio</span>
        <span className="titlebar-version">v{__APP_VERSION__}</span>
      </div>
      <div className="titlebar-window-controls">
        {hasLeftButtons ? settingsButton : rightControls.map(renderButton)}
      </div>
    </header>
  )
}
