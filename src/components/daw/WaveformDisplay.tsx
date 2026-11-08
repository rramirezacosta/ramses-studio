import { useEffect, useRef, type PointerEvent } from 'react'
import { generatePeaks } from '../../audio/peakGenerator'
import { useTranslation } from '../../i18n'

interface Props {
  buffer: AudioBuffer
  color: string
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  loopRange?: [number, number]
  onRangeChange: (range: [number, number]) => void
  onRangeCommit: (range: [number, number]) => void
  onClearRange: () => void
}

export function WaveformDisplay({ buffer, color, currentTime, duration, onSeek, loopRange, onRangeChange, onRangeCommit, onClearRange }: Props) {
  const t = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragStart = useRef<number>()

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const render = () => {
      const { width, height } = element.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      element.width = width * ratio
      element.height = height * ratio
      const context = element.getContext('2d')!
      context.scale(ratio, ratio)
      context.clearRect(0, 0, width, height)
      const peaks = generatePeaks(buffer, Math.ceil(width))
      const center = height / 2
      context.fillStyle = color
      peaks.forEach(({ min, max }, index) => {
        context.fillRect(index, center + min * center, 1, Math.max(1, (max - min) * center))
      })
    }
    render()
    const observer = new ResizeObserver(render)
    observer.observe(element)
    return () => observer.disconnect()
  }, [buffer, color])

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
    {duration > 0 && <div className="waveform-playhead" style={{ left: `${(currentTime / duration) * 100}%` }} />}
  </div>
}
