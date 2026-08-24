/**
 * In-memory fake {@link Clock} (Blueprint §3; Contract §8.2).
 * Deterministic: test code sets the instant and zone explicitly.
 */
import type { Clock, Instant, IanaZone } from '../../contracts';

export class FakeClock implements Clock {
  private current: Instant;
  private currentZone: IanaZone;

  constructor(current: Instant = '2026-08-24T12:00:00.000Z', zone: IanaZone = 'UTC') {
    this.current = current;
    this.currentZone = zone;
  }

  now(): Instant {
    return this.current;
  }

  zone(): IanaZone {
    return this.currentZone;
  }

  set(now: Instant): this {
    this.current = now;
    return this;
  }

  setZone(zone: IanaZone): this {
    this.currentZone = zone;
    return this;
  }

  /** Advance by milliseconds (positive or negative). */
  advanceMs(ms: number): this {
    const next = new Date(Date.parse(this.current) + ms);
    if (Number.isNaN(next.getTime())) {
      throw new Error(`FakeClock.advanceMs: invalid base instant ${this.current}`);
    }
    this.current = next.toISOString();
    return this;
  }
}
