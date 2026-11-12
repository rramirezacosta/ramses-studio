import * as ort from 'onnxruntime-node';
import { STEM_NAMES, TRAINING_SAMPLES } from './constants.js';
import { chunkCount, createTriangularWindow, iterateChunks, OverlapAccumulator } from './dsp/chunker.js';
import { denormalizeStereo, normalizeStereo, Normalization } from './dsp/normalize.js';
import { stft } from './dsp/stft.js';
import { createSession, releaseSessions, type LoadedSession } from './model/session-pool.js';
import type { ModelBag, SeparationResult, SeparatorOptions, StereoAudio, StemName } from './types.js';

export class Separator {
  private readonly sessions = new Map<string, LoadedSession>();
  private disposed = false;
  private initializing = false;

  private constructor(private readonly options: SeparatorOptions) {}

  public static async create(options: SeparatorOptions): Promise<Separator> {
    const separator = new Separator(options);
    if (options.lazy) return separator;
    await separator.initialize();
    return separator;
  }

  public async separate(audio: StereoAudio): Promise<SeparationResult> {
    this.assertReady();
    if (!this.sessions.size && !this.initializing) {
      this.initializing = true;
      await this.initialize();
      this.initializing = false;
    }
    if (audio.sampleRate !== 44_100) throw new RangeError('Input audio must be sampled at 44100 Hz. Resample before calling separate().');
    if (!audio.left.length) throw new RangeError('Input audio is empty.');
    const right = audio.right ?? audio.left;
    if (right.length !== audio.left.length) throw new RangeError('Stereo channels must have equal lengths.');

    const requested = this.requestedStems();
    const overlap = this.options.overlap ?? 0.25;
    const totalSegments = chunkCount(audio.left.length, overlap);
    const accumulator = new OverlapAccumulator(audio.left.length, createTriangularWindow(TRAINING_SAMPLES));

    // Global normalization: compute mean and scale from the full input audio once,
    // matching the reference Demucs behavior (api.py lines 267-290).
    const planarInput = new Float32Array(audio.left.length * 2);
    planarInput.set(audio.left);
    planarInput.set(right, audio.left.length);
    const globalNorm = normalizeStereo(planarInput);

    let currentSegment = 0;
    for (const chunk of iterateChunks(audio.left, right, overlap)) {
      this.throwIfAborted();
      currentSegment += 1;
      const planar = new Float32Array(TRAINING_SAMPLES * 2);
      planar.set(chunk.left);
      planar.set(chunk.right, TRAINING_SAMPLES);
      // Normalize this chunk with the SAME global stats used for the full audio.
      normalizeStereo(planar, planar, globalNorm);
      for (const [name, loaded] of this.sessions) {
        const outputs = await this.runSegment(loaded, planar, globalNorm);
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

  private async runSegment(loaded: LoadedSession, input: Float32Array, globalNorm: Normalization): Promise<Float32Array> {
    const { io, session } = loaded;
    let mixTensor: ort.Tensor | undefined;
    let specTensor: ort.Tensor | undefined;
    let outputs: Record<string, ort.Tensor> | undefined;
    try {
      if (io.contract === 'in-graph-stft') {
        // Input is already normalized with global stats in separate().
        mixTensor = new ort.Tensor('float32', input, [1, 2, TRAINING_SAMPLES]);
        outputs = await session.run({ [io.mixInput]: mixTensor });
        const rawOutput = new Float32Array(outputs[io.waveformOutput].data as Float32Array);
        denormalizeStereo(rawOutput, globalNorm);
        return rawOutput;
      }
      // Input is already normalized with global stats in separate().
      // Re-normalize here for the STFT contract path to ensure the tensor
      // matches the model's expected distribution using the same global stats.
      const normalized = new Float32Array(input.length);
      normalizeStereo(input, normalized, globalNorm);
      mixTensor = new ort.Tensor('float32', normalized, [1, 2, TRAINING_SAMPLES]);
      specTensor = new ort.Tensor('float32', stft(normalized), [1, 4, 2048, 336]);
      outputs = await session.run({ [io.mixInput]: mixTensor, [io.specInput!]: specTensor });
      // Reference-faithful output: the waveform head IS the answer (demucs.apply() takes
      // the model's wave output directly). Do NOT add istft(spectrogramOutput) on top —
      // summing heads with mismatched conventions attenuates/distorts the stems.
      const wave = new Float32Array(outputs[io.waveformOutput].data as Float32Array);
      denormalizeStereo(wave, globalNorm);
      return wave;
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
    if (!this.sessions.size && !this.options.lazy) throw new Error('Separator has no loaded sessions.');
  }
}
