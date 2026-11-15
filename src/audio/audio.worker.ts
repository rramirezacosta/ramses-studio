/// <reference lib="webworker" />

type PeakEntry = { min: number; max: number }

type DecodeRequest = {
  type: 'decode'
  id: number
  buffer: ArrayBuffer
}

type PeaksRequest = {
  type: 'peaks'
  id: number
  channels: Float32Array[]
  columns: number
}

type WorkerRequest = DecodeRequest | PeaksRequest

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  try {
    if (message.type === 'decode') {
      const context = new OfflineAudioContext(1, 1, 44100)
      const audioBuffer = await context.decodeAudioData(message.buffer.slice(0))
      const channels: Float32Array[] = []
      for (let index = 0; index < audioBuffer.numberOfChannels; index += 1) {
        channels.push(audioBuffer.getChannelData(index).slice())
      }
      self.postMessage(
        {
          type: 'decoded',
          id: message.id,
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
          duration: audioBuffer.duration,
          channels,
        },
        channels.map((channel) => channel.buffer),
      )
      return
    }

    if (message.type === 'peaks') {
      const { channels, columns } = message
      const safeColumns = Math.max(1, Math.floor(columns))
      const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0)
      const blockSize = Math.max(1, Math.floor(length / safeColumns))
      const peaks: PeakEntry[] = Array.from({ length: safeColumns }, (_, column) => {
        let min = 1
        let max = -1
        const start = column * blockSize
        const end = Math.min(start + blockSize, length)
        for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
          const data = channels[channelIndex]
          for (let index = start; index < end && index < data.length; index += 1) {
            const sample = data[index]
            if (sample < min) min = sample
            if (sample > max) max = sample
          }
        }
        if (min === 1 && max === -1) {
          min = 0
          max = 0
        }
        return { min, max }
      })
      self.postMessage({ type: 'peaks', id: message.id, peaks })
    }
  } catch (reason) {
    self.postMessage({
      type: 'error',
      id: message.id,
      error: reason instanceof Error ? reason.message : String(reason),
    })
  }
}
