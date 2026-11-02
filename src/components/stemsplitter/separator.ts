import * as ort from 'onnxruntime-node';
import { STEM_NAMES, TRAINING_SAMPLES } from './constants.js';
import { chunkCount, createHannWindow, iterateChunks, OverlapAccumulator } from './dsp/chunker.js';
import { denormalizeStereo, normalizeStereo } from './dsp/normalize.js';
import { istft, stft } from './dsp/stft.js';
import { createSession, releaseSessions, type LoadedSession } from './model/session-pool.js';
import type { ModelBag, SeparationResult, SeparatorOptions, StereoAudio, StemName } from './types.js';

export class Separator {
  private readonly sessions = new Map<string, LoadedSession>();
  private disposed = false;

  private constructor(private readonly options: SeparatorOptions) {}

  public static async create(options: SeparatorOptions): Promise<Separator> {
    const separator = new Separator(options);
    await separator.initialize();
    return separator;
  }

  public async separate(audio: StereoAudio): Promise<SeparationResult> {
    this.assertReady();
    if (audio.sampleRate !== 44_100) throw new RangeError('Input audio must be sampled at 44100 Hz. Resample before calling separate().');
    if (!audio.left.length) throw new RangeError('Input audio is empty.');
    const right = audio.right ?? audio.left;
    if (right.length !== audio.left.length) throw new RangeError('Stereo channels must have equal lengths.');

    const requested = this.requestedStems();
    const overlap = this.options.overlap ?? 0.25;
    const totalSegments = chunkCount(audio.left.length, overlap);
    const accumulator = new OverlapAccumulator(audio.left.length, createHannWindow(TRAINING_SAMPLES));
    let currentSegment = 0;
    for (const chunk of iterateChunks(audio.left, right, overlap)) {
      this.throwIfAborted();
      currentSegment += 1;
      const planar = new Float32Array(TRAINING_SAMPLES * 2);
      planar.set(chunk.left);
      planar.set(chunk.right, TRAINING_SAMPLES);
      for (const [name, loaded] of this.sessions) {
        const outputs = await this.runSegment(loaded, planar);
        if (name === 'main') {
          for (const stem of requested) {
            const stemIndex = this.availableStems(loaded).indexOf(stem);
            if (stemIndex >= 0) {
              const offset = stemIndex * TRAINING_SAMPLES * 2;
              accumulator.add(stem, chunk.start, outputs.subarray(offset, offset + TRAINING_SAMPLES * 2));
            }
          }
        } else {
          accumulator.add(name, chunk.start, outputs.subarray(0, TRAINING_SAMPLES * 2));
        }
      }
      this.options.onProgress?.({ progress: currentSegment / totalSegments, currentSegment, totalSegments });
    }

    const result = {} as SeparationResult;
    for (const [stem, [left, rightChannel]] of accumulator.finalize()) result[stem as keyof SeparationResult] = { left, right: rightChannel, sampleRate: audio.sampleRate };
    return result;
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    await releaseSessions(this.sessions.values());
    this.sessions.clear();
    this.disposed = true;
  }

  private async initialize(): Promise<void> {
    const source = this.options.modelPath;
    if (typeof source === 'string' || source instanceof Uint8Array) {
      this.sessions.set('main', await createSession(source, this.options));
      return;
    }
    const bag = source as ModelBag;
    const requested = this.requestedStems().filter((stem): stem is (typeof STEM_NAMES)[number] => STEM_NAMES.includes(stem as (typeof STEM_NAMES)[number]));
    for (const stem of requested) {
      const model = bag[stem];
      if (!model) throw new Error(`No model was provided for requested stem "${stem}".`);
      this.sessions.set(stem, await createSession(model, this.options));
    }
  }

  private async runSegment(loaded: LoadedSession, input: Float32Array): Promise<Float32Array> {
    const { io, session } = loaded;
    let mixTensor: ort.Tensor | undefined;
    let specTensor: ort.Tensor | undefined;
    let outputs: Record<string, ort.Tensor> | undefined;
    try {
      if (io.contract === 'in-graph-stft') {
        mixTensor = new ort.Tensor('float32', input, [1, 2, TRAINING_SAMPLES]);
        outputs = await session.run({ [io.mixInput]: mixTensor });
        return new Float32Array(outputs[io.waveformOutput].data as Float32Array);
      }
      const normalized = new Float32Array(input.length);
      const normalization = normalizeStereo(input, normalized);
      mixTensor = new ort.Tensor('float32', normalized, [1, 2, TRAINING_SAMPLES]);
      specTensor = new ort.Tensor('float32', stft(normalized), [1, 4, 2048, 336]);
      outputs = await session.run({ [io.mixInput]: mixTensor, [io.specInput!]: specTensor });
      const wave = outputs[io.waveformOutput].data as Float32Array;
      const spec = outputs[io.spectrogramOutput!].data as Float32Array;
      const stemCount = wave.length / (TRAINING_SAMPLES * 2);
      const reconstructed = new Float32Array(wave.length);
      for (let stem = 0; stem < stemCount; stem++) {
        const frequency = istft(spec, stem);
        const offset = stem * TRAINING_SAMPLES * 2;
        for (let i = 0; i < frequency.length; i++) reconstructed[offset + i] = frequency[i] + wave[offset + i];
      }
      denormalizeStereo(reconstructed, normalization);
      return reconstructed;
    } finally {
      mixTensor?.dispose();
      specTensor?.dispose();
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }

  private availableStems(loaded: LoadedSession): StemName[] {
    const outputIndex = loaded.session.outputNames.indexOf(loaded.io.waveformOutput);
    const metadata = outputIndex >= 0 ? loaded.session.outputMetadata[outputIndex] : undefined;
    const stemCount = metadata?.isTensor ? metadata.shape[1] : undefined;
    return stemCount === 6 ? [...STEM_NAMES, 'guitar', 'piano'] as StemName[] : [...STEM_NAMES];
  }

  private requestedStems(): StemName[] {
    return this.options.targetStems?.length ? this.options.targetStems : [...STEM_NAMES];
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted) throw this.options.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }

  private assertReady(): void {
    if (this.disposed) throw new Error('Separator has been disposed.');
    if (!this.sessions.size) throw new Error('Separator has no loaded sessions.');
  }
}
