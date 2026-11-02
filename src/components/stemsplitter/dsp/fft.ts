export class Radix2Fft {
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;

  public constructor(public readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new RangeError('FFT size must be a power of two greater than one.');
    }
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cos[i] = Math.cos(angle);
      this.sin[i] = Math.sin(angle);
    }
  }

  public forward(real: Float32Array, imaginary: Float32Array): void {
    this.transform(real, imaginary, false);
  }

  public inverse(real: Float32Array, imaginary: Float32Array): void {
    this.transform(real, imaginary, true);
    for (let i = 0; i < this.size; i++) {
      real[i] /= this.size;
      imaginary[i] /= this.size;
    }
  }

  private transform(real: Float32Array, imaginary: Float32Array, inverse: boolean): void {
    if (real.length !== this.size || imaginary.length !== this.size) {
      throw new RangeError(`Expected ${this.size} real and imaginary samples.`);
    }
    for (let i = 1, j = 0; i < this.size; i++) {
      let bit = this.size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
      }
    }

    for (let width = 2; width <= this.size; width <<= 1) {
      const half = width >> 1;
      const step = this.size / width;
      for (let offset = 0; offset < this.size; offset += width) {
        for (let j = 0; j < half; j++) {
          const index = j * step;
          const cos = this.cos[index];
          const sin = inverse ? -this.sin[index] : this.sin[index];
          const even = offset + j;
          const odd = even + half;
          const tr = real[odd] * cos - imaginary[odd] * sin;
          const ti = real[odd] * sin + imaginary[odd] * cos;
          real[odd] = real[even] - tr;
          imaginary[odd] = imaginary[even] - ti;
          real[even] += tr;
          imaginary[even] += ti;
        }
      }
    }
  }
}
