import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'

interface ImportDialogProps {
  youTubeUrl: string
  onYouTubeUrlChange: (value: string) => void
  onImportLocal: () => void
  onImportYouTube: () => void
  onCancel: () => void
}

/** Dialog for choosing import source: local file or YouTube URL. */
export function ImportDialog({ youTubeUrl, onYouTubeUrlChange, onImportLocal, onImportYouTube, onCancel }: ImportDialogProps) {
  const t = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useDialogFocusTrap(formRef, true)

  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>()
  const [hasSelection, setHasSelection] = useState(false)

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    const input = inputRef.current
    if (input) {
      const start = input.selectionStart ?? 0
      const end = input.selectionEnd ?? 0
      setHasSelection(start !== end)
    }
    setMenu({ x: event.clientX, y: event.clientY })
  }
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
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [menu])

  // Adjust position so the menu stays inside the viewport
  useEffect(() => {
    if (!menu) return
    const el = menuRef.current
    if (!el || !el.offsetWidth) return
    const x = Math.min(menu.x, window.innerWidth - el.offsetWidth - 8)
    const y = Math.min(menu.y, window.innerHeight - el.offsetHeight - 8)
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y })
  }, [menu])

  const executeCommand = async (command: 'cut' | 'copy' | 'paste' | 'selectAll') => {
    setMenu(undefined)
    inputRef.current?.focus()
    if (command === 'selectAll') {
      inputRef.current?.select()
      return
    }
    try {
      const clipboard = navigator.clipboard
      if (command === 'cut') {
        const input = inputRef.current
        if (input) {
          const start = input.selectionStart ?? 0
          const end = input.selectionEnd ?? 0
          const selected = youTubeUrl.slice(start, end)
          await clipboard.writeText(selected)
          onYouTubeUrlChange(youTubeUrl.slice(0, start) + youTubeUrl.slice(end))
          input.setSelectionRange(start, start)
        }
      } else if (command === 'copy') {
        const input = inputRef.current
        if (input) {
          const start = input.selectionStart ?? 0
          const end = input.selectionEnd ?? 0
          await clipboard.writeText(youTubeUrl.slice(start, end))
        }
      } else {
        const text = await clipboard.readText()
        const input = inputRef.current
        if (input) {
          const start = input.selectionStart ?? 0
          const end = input.selectionEnd ?? 0
          onYouTubeUrlChange(youTubeUrl.slice(0, start) + text + youTubeUrl.slice(end))
        }
      }
    } catch {
      // Fallback for older browsers or restricted contexts
      if (command === 'copy' || command === 'cut') {
        document.execCommand(command)
        if (command === 'cut') {
          const input = inputRef.current
          if (input) {
            const start = input.selectionStart ?? 0
            onYouTubeUrlChange(youTubeUrl.slice(0, start) + youTubeUrl.slice(input.selectionEnd ?? 0))
            input.setSelectionRange(start, start)
          }
        }
      }
    }
  }

  return (
    <>
    <div className="dialog-backdrop" role="presentation">
      <form className="rename-dialog import-source-dialog" ref={formRef} onSubmit={(event) => { event.preventDefault(); onImportYouTube() }} role="dialog" aria-modal="true" aria-labelledby="import-source-title">
        <div className="dialog-header"><h2 id="import-source-title">{t('importAudio')}</h2></div>
        <p>{t('importAudioDescription')}</p>
        <button type="button" className="source-option" onClick={onImportLocal}>{t('chooseLocalFile')}</button>
        <div className="source-option-divider">{t('or')}</div>
        <label htmlFor="youtube-url">{t('youTubeLink')}</label>
        <input ref={inputRef} id="youtube-url" type="url" value={youTubeUrl} onChange={(event) => onYouTubeUrlChange(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." onContextMenu={handleContextMenu} autoFocus />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="submit" className="primary-button" disabled={!youTubeUrl.trim()}>{t('import')}</button>
        </div>
      </form>
    </div>
    {menu && createPortal(
      <div
        className="input-context-menu"
        ref={menuRef}
        style={{ left: menu.x, top: menu.y }}
        role="menu"
        aria-label={t('importAudio')}
      >
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => executeCommand('cut')}>{t('cut')}</button>
        <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => executeCommand('copy')}>{t('copy')}</button>
        <button type="button" role="menuitem" onClick={() => executeCommand('paste')}>{t('paste')}</button>
        <div className="menu-separator" />
        <button type="button" role="menuitem" onClick={() => executeCommand('selectAll')}>{t('selectAll')}</button>
      </div>,
      document.body
    )}
    </>
  )
}
