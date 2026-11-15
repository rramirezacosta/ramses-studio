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
    element.width = width * ratio
    element.height = height * ratio
    const context = element.getContext('2d')!
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    if (!peaks) return
    const center = height / 2
    context.fillStyle = color
    peaks.forEach(({ min, max }, index) => {
      context.fillRect(index, center + min * center, 1, Math.max(1, (max - min) * center))
    })
  }, [buffer, color, width, peaks])

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
