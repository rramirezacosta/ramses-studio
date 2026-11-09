import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.offsetParent !== null)
}

/**
 * Keep keyboard focus inside an open dialog: focuses the first focusable element
 * on open (unless the dialog already focused something, e.g. via autoFocus),
 * cycles Tab/Shift+Tab within the dialog, and returns focus to the previously
 * focused element on close.
 */
export function useDialogFocusTrap(container: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const element = container.current
    if (!active || !element) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = focusableElements(element)
    if (focusables.length && !element.contains(document.activeElement)) focusables[0].focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusableElements(element)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (event.shiftKey && (current === first || !element.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !element.contains(current))) {
        event.preventDefault()
        first.focus()
      }
    }

    element.addEventListener('keydown', handleKeyDown)
    return () => {
      element.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [container, active])
}
