import { memo, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ensurePeaks, type PeakEntry } from '../../audio/peakCache'
import { useTranslation } from '../../i18n'
import { useTransportStore } from '../../store/useTransportStore'

interface Props {
  buffer: AudioBuffer
  color: string
  duration: number
  onSeek: (time: number) => void
  loopRange?: [number, number]
  onRangeChange: (range: [number, number]) => void
  onRangeCommit: (range: [number, number]) => void
  onClearRange: () => void
}

const Playhead = memo(function Playhead({ duration }: { duration: number }) {
  const currentTime = useTransportStore((store) => store.currentTime)
  if (duration <= 0) return null
  return <div className="waveform-playhead" style={{ left: `${(currentTime / duration) * 100}%` }} />
})

export const WaveformDisplay = memo(function WaveformDisplay({ buffer, color, duration, onSeek, loopRange, onRangeChange, onRangeCommit, onClearRange }: Props) {
  const t = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragStart = useRef<number>()
  const [width, setWidth] = useState(0)
  const [peaks, setPeaks] = useState<PeakEntry[] | null>(null)
  const [redrawTick, setRedrawTick] = useState(0)

  // Redraw the waveform when the tab becomes visible again after a long period
  // of inactivity — Chromium may lose the canvas 2D context while hidden.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') setRedrawTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const updateWidth = () => {
      const next = Math.max(1, Math.ceil(element.getBoundingClientRect().width))
      setWidth(next)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (width <= 0) return
    let cancelled = false
    void ensurePeaks(buffer, width).then((result) => {
      if (!cancelled) setPeaks(result)
    })
    return () => {
      cancelled = true
    }
  }, [buffer, width])

  useEffect(() => {
    const element = canvas.current
    if (!element || width <= 0) return
    const height = element.getBoundingClientRect().height
    const ratio = window.devicePixelRatio || 1
    // putImageData writes in device pixels and ignores the canvas transform,
    // so the ImageData must cover the full backing store, not the CSS box.
    // Otherwise on HiDPI screens only the top-left 1/ratio of the canvas is
    // painted and the waveform appears cropped to a fraction of its width.
    const pixelWidth = Math.max(1, Math.round(width * ratio))
    const pixelHeight = Math.max(1, Math.round(height * ratio))
    element.width = pixelWidth
    element.height = pixelHeight
    const context = element.getContext('2d')!
    if (!peaks) {
      context.clearRect(0, 0, pixelWidth, pixelHeight)
      return
    }
    const center = pixelHeight / 2

    // Compute loop range in CSS pixel coordinates for dimming
    let loopLeft = -1, loopRight = -1
    if (loopRange && duration > 0) {
      loopLeft = (loopRange[0] / duration) * width
      loopRight = (loopRange[1] / duration) * width
    }
    const hasLoop = loopLeft >= 0 && loopRight >= 0

    // Parse the waveform color into RGB components
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = 1
    tempCanvas.height = 1
    const tempCtx = tempCanvas.getContext('2d')!
    tempCtx.fillStyle = color
    tempCtx.fillRect(0, 0, 1, 1)
    const [r, g, b] = tempCtx.getImageData(0, 0, 1, 1).data

    // Build ImageData buffer for the entire waveform in a single pass
    const imageData = context.createImageData(pixelWidth, pixelHeight)
    const data = imageData.data

    // Fill background: transparent (already zeroed by createImageData)
    // Draw faint horizontal center line (~1 CSS pixel thick)
    const centerLineThickness = Math.max(1, Math.round(ratio))
    const centerY = Math.floor(center - centerLineThickness / 2)
    for (let x = 0; x < pixelWidth; x += 1) {
      for (let y = centerY; y < centerY + centerLineThickness; y += 1) {
        const idx = (y * pixelWidth + x) * 4
        data[idx] = 255
        data[idx + 1] = 255
        data[idx + 2] = 255
        data[idx + 3] = 15 // ~6% opacity
      }
    }

    // Draw waveform bars into the ImageData buffer. Peaks are computed per
    // CSS pixel column; spread each column across its device-pixel slice.
    const peakLen = peaks.length
    for (let index = 0; index < peakLen; index += 1) {
      const { min, max } = peaks[index]
      const yTop = Math.max(0, Math.floor(center + min * center))
      const yBottom = Math.min(pixelHeight - 1, Math.floor(center + max * center))

      const isDimmed = hasLoop && (index < loopLeft || index > loopRight)
      const alpha = isDimmed ? 77 : 255 // 0.3 * 255 ≈ 77 for dimmed

      const xStart = Math.floor((index / peakLen) * pixelWidth)
      const xEnd = Math.max(xStart + 1, Math.floor(((index + 1) / peakLen) * pixelWidth))
      for (let x = xStart; x < xEnd; x += 1) {
        for (let y = yTop; y <= yBottom; y += 1) {
          const idx = (y * pixelWidth + x) * 4
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = alpha
        }
      }
    }

    // Single canvas call to render the entire waveform
    context.putImageData(imageData, 0, 0)
  }, [buffer, color, width, peaks, loopRange, duration, redrawTick])

  const timeAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(((event.clientX - bounds.left) / bounds.width) * duration, duration))
  }

  const loopStyle = loopRange && duration > 0
    ? { left: `${(loopRange[0] / duration) * 100}%`, width: `${((loopRange[1] - loopRange[0]) / duration) * 100}%` }
    : undefined

  const finishRangeSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === undefined) return
    const end = timeAt(event)
    if (Math.abs(end - dragStart.current) < 0.05) {
      onSeek(end)
    } else {
      const range: [number, number] = [Math.min(dragStart.current, end), Math.max(dragStart.current, end)]
      onRangeChange(range)
      onRangeCommit(range)
    }
    dragStart.current = undefined
  }

  return <div className="waveform-container" title={t('dragToLoopRange')} onContextMenu={(event) => {
    event.preventDefault()
    onClearRange()
  }} onPointerDown={(event) => {
    if (event.button !== 0) return
    dragStart.current = timeAt(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={(event) => {
    if (dragStart.current === undefined) return
    const end = timeAt(event)
    onRangeChange([Math.min(dragStart.current, end), Math.max(dragStart.current, end)])
  }} onPointerUp={finishRangeSelection} onPointerCancel={finishRangeSelection}>
    <canvas ref={canvas} className="waveform" />
    {loopStyle && <div className="loop-selection" style={loopStyle} />}
    <Playhead duration={duration} />
  </div>
})
