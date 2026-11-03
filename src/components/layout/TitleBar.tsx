import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type WindowButton = 'minimize' | 'maximize' | 'close'

interface ButtonLayout {
  left: WindowButton[]
  right: WindowButton[]
}

const defaultLayout: ButtonLayout = { left: [], right: ['minimize', 'maximize', 'close'] }

export function TitleBar() {
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
      minimize: { label: 'Minimize', icon: <Minus size={16} />, action: () => { void window.api.minimizeWindow() } },
      maximize: { label: maximized ? 'Restore' : 'Maximize', icon: maximized ? <Copy size={14} /> : <Square size={14} />, action: toggleMaximize },
      close: { label: 'Close', icon: <X size={17} />, action: () => { void window.api.closeWindow() } },
    }[button]

    return <button key={button} className={`titlebar-button titlebar-${button}`} type="button" aria-label={config.label} title={config.label} onClick={config.action}>{config.icon}</button>
  }

  return (
    <header className="titlebar">
      <div className="titlebar-window-controls">{layout.left.map(renderButton)}</div>
      <div className="titlebar-drag-region" onDoubleClick={toggleMaximize}>
        <span className="titlebar-name">Ramses Studio</span>
      </div>
      <div className="titlebar-window-controls">{layout.right.map(renderButton)}</div>
    </header>
  )
}
