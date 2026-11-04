import * as ort from 'onnxruntime-web'
import { SIX_STEM_NAMES, TRAINING_SAMPLES } from './constants.js'
import { chunkCount, createHannWindow, iterateChunks, OverlapAccumulator } from './dsp/chunker.js'
import type { ProgressInfo, SeparationResult, StereoAudio, StemName } from './types.js'

export interface WebGpuSeparatorOptions {
  model: Uint8Array
  overlap?: number
  onProgress?: (info: ProgressInfo) => void
  signal?: AbortSignal
}

export class WebGpuSeparator {
  private disposed = false

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly options: WebGpuSeparatorOptions,
  ) {}

  public static async create(options: WebGpuSeparatorOptions): Promise<WebGpuSeparator> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is unavailable.')
    const session = await ort.InferenceSession.create(options.model, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all',
    })
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) {
      await session.release()
      throw new Error('The WebGPU model has an unsupported I/O signature.')
    }
    return new WebGpuSeparator(session, options)
  }

  public async separate(audio: StereoAudio): Promise<SeparationResult<StemName>> {
    this.assertReady()
    if (audio.sampleRate !== 44_100) throw new RangeError('Input audio must be sampled at 44100 Hz. Resample before calling separate().')
    if (!audio.left.length) throw new RangeError('Input audio is empty.')
    const right = audio.right ?? audio.left
    if (right.length !== audio.left.length) throw new RangeError('Stereo channels must have equal lengths.')

    const overlap = this.options.overlap ?? 0.25
    const accumulator = new OverlapAccumulator(audio.left.length, createHannWindow(TRAINING_SAMPLES))
    const totalSegments = chunkCount(audio.left.length, overlap)
    let currentSegment = 0
    for (const chunk of iterateChunks(audio.left, right, overlap)) {
      this.throwIfAborted()
      const input = new Float32Array(TRAINING_SAMPLES * 2)
      input.set(chunk.left)
      input.set(chunk.right, TRAINING_SAMPLES)
      const output = await this.runSegment(input)
      for (let stemIndex = 0; stemIndex < SIX_STEM_NAMES.length; stemIndex++) {
        const offset = stemIndex * TRAINING_SAMPLES * 2
        accumulator.add(SIX_STEM_NAMES[stemIndex], chunk.start, output.subarray(offset, offset + TRAINING_SAMPLES * 2))
      }
      currentSegment += 1
      this.options.onProgress?.({ progress: currentSegment / totalSegments, currentSegment, totalSegments })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    const result = {} as SeparationResult<StemName>
    for (const [stem, [left, rightChannel]] of accumulator.finalize()) {
      result[stem as StemName] = { left, right: rightChannel, sampleRate: audio.sampleRate }
    }
    return result
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return
    await this.session.release()
    this.disposed = true
  }

  private async runSegment(input: Float32Array): Promise<Float32Array> {
    const tensor = new ort.Tensor('float32', input, [1, 2, TRAINING_SAMPLES])
    let outputs: Record<string, ort.Tensor> | undefined
    try {
      outputs = await this.session.run({ [this.session.inputNames[0]]: tensor })
      const output = outputs[this.session.outputNames[0]]
      if (!output) throw new Error('The WebGPU model did not return a stem tensor.')
      const data = await output.getData(true)
      if (!(data instanceof Float32Array) || data.length !== SIX_STEM_NAMES.length * TRAINING_SAMPLES * 2) {
        throw new Error('The WebGPU model returned an unexpected stem tensor.')
      }
      return data
    } finally {
      tensor.dispose()
      if (outputs) for (const output of Object.values(outputs)) output.dispose()
    }
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted) throw this.options.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
  }

  private assertReady(): void {
    if (this.disposed) throw new Error('Separator has been disposed.')
  }
}
