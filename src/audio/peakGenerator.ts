export function generatePeaks(buffer: AudioBuffer, columns: number) {
  const data = buffer.getChannelData(0)
  const blockSize = Math.max(1, Math.floor(data.length / columns))
  return Array.from({ length: columns }, (_, column) => {
    let min = 1
    let max = -1
    const start = column * blockSize
    for (let index = start; index < Math.min(start + blockSize, data.length); index += 1) {
      const sample = data[index]
      min = Math.min(min, sample)
      max = Math.max(max, sample)
    }
    return { min, max }
  })
}
