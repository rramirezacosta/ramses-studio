import type { TrackState } from '../types/audio'

type Channel = {
  gain: GainNode
  panner: StereoPannerNode
  source?: AudioBufferSourceNode
}

export class AudioEngine {
  private context?: AudioContext
  private master?: GainNode
  private channels = new Map<string, Channel>()
  private tracks: TrackState[] = []
  private startedAt = 0
  private offset = 0
  private playing = false
  private loopRange?: { start: number; end: number }

  async decode(data: ArrayBuffer) {
    const context = this.ensureContext()
    return context.decodeAudioData(data)
  }

  load(tracks: TrackState[]) {
    this.stop()
    this.tracks = tracks
    this.channels.clear()
    const context = this.ensureContext()
    const master = this.master!
    tracks.forEach((track) => {
      const gain = context.createGain()
      const panner = context.createStereoPanner()
      gain.connect(panner).connect(master)
      this.channels.set(track.id, { gain, panner })
    })
    this.applyMix()
  }

  play(offset = this.offset) {
    if (this.playing || !this.tracks.length) return
    const context = this.ensureContext()
    void context.resume()
    this.offset = Math.min(offset, this.duration)
    this.offset = this.normalizeLoopPosition(this.offset)
    this.startedAt = context.currentTime - this.offset
    this.tracks.forEach((track) => {
      const channel = this.channels.get(track.id)!
      const source = context.createBufferSource()
      source.buffer = track.buffer
      source.connect(channel.gain)
      if (this.loopRange) {
        source.loop = true
        source.loopStart = this.loopRange.start
        source.loopEnd = this.loopRange.end
      }
      source.onended = () => {
        if (!this.loopRange && channel.source === source && this.position >= this.duration) this.stop()
      }
      channel.source = source
      source.start(context.currentTime + 0.03, this.offset)
    })
    this.startedAt += 0.03
    this.playing = true
  }

  pause() {
    if (!this.playing) return
    this.offset = this.position
    this.stopSources()
    this.playing = false
  }

  stop() {
    this.stopSources()
    this.offset = 0
    this.playing = false
  }

  seek(time: number) {
    const target = Math.max(0, Math.min(time, this.duration))
    const wasPlaying = this.playing
    if (wasPlaying) this.pause()
    this.offset = target
    if (wasPlaying) this.play()
  }

  updateTrack(id: string, patch: Partial<Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>) {
    const track = this.tracks.find((item) => item.id === id)
    if (!track) return
    Object.assign(track, patch)
    this.applyMix()
  }

  removeTrack(id: string) {
    const channel = this.channels.get(id)
    if (!channel) return
    if (channel.source) {
      channel.source.onended = null
      channel.source.stop()
      channel.source.disconnect()
    }
    channel.gain.disconnect()
    channel.panner.disconnect()
    this.channels.delete(id)
    this.tracks = this.tracks.filter((track) => track.id !== id)
    if (!this.tracks.length) {
      this.stop()
      return
    }
    this.applyMix()
  }

  setMasterVolume(volume: number) {
    if (this.master) this.master.gain.setTargetAtTime(volume, this.ensureContext().currentTime, 0.01)
  }

  setLoopRange(range?: { start: number; end: number }) {
    const position = this.position
    this.loopRange = range && range.end - range.start >= 0.05 ? range : undefined
    if (!this.playing) return
    this.stopSources()
    this.playing = false
    this.offset = this.normalizeLoopPosition(position)
    this.play()
  }

  get position() {
    if (!this.playing) return this.offset
    const position = this.ensureContext().currentTime - this.startedAt
    if (this.loopRange && position >= this.loopRange.start) {
      return this.loopRange.start + ((position - this.loopRange.start) % (this.loopRange.end - this.loopRange.start))
    }
    return Math.min(position, this.duration)
  }

  get isPlaying() {
    return this.playing
  }

  get duration() {
    return Math.max(0, ...this.tracks.map((track) => track.buffer.duration))
  }

  destroy() {
    this.stop()
    void this.context?.close()
  }

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.connect(this.context.destination)
    }
    return this.context
  }

  private stopSources() {
    this.channels.forEach((channel) => {
      if (channel.source) {
        channel.source.onended = null
        channel.source.stop()
        channel.source.disconnect()
        channel.source = undefined
      }
    })
  }

  private applyMix() {
    const hasSolo = this.tracks.some((track) => track.soloed)
    const context = this.ensureContext()
    this.tracks.forEach((track) => {
      const channel = this.channels.get(track.id)
      if (!channel) return
      const audible = hasSolo ? track.soloed : !track.muted
      channel.gain.gain.setTargetAtTime(audible ? track.volume : 0, context.currentTime, 0.01)
      channel.panner.pan.setTargetAtTime(track.pan, context.currentTime, 0.01)
    })
  }

  private normalizeLoopPosition(position: number) {
    if (!this.loopRange || position < this.loopRange.end) return position
    return this.loopRange.start + ((position - this.loopRange.start) % (this.loopRange.end - this.loopRange.start))
  }
}
