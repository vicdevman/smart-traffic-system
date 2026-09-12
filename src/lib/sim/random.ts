/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Determinism matters here for a specific reason: the adaptive engine and the
 * fixed-timer baseline engine are seeded identically and stepped in lockstep,
 * so they receive *exactly* the same arrival stream. Any difference in the
 * measured results is therefore attributable to the control strategy alone,
 * which is what makes the side-by-side comparison a fair experiment rather
 * than an anecdote.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; 
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Draws from an exponential distribution with the given mean.
   * Vehicle headways in free-flowing traffic are exponentially distributed,
   * which is what makes arrivals a Poisson process.
   */
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  /** Picks one entry from a weighted table. */
  weighted<T extends string>(weights: Record<T, number>): T {
    const keys = Object.keys(weights) as T[];
    const total = keys.reduce((sum, k) => sum + weights[k], 0);
    let roll = this.next() * total;
    for (const k of keys) {
      roll -= weights[k];
      if (roll <= 0) return k;
    }
    return keys[keys.length - 1];
  }
}
