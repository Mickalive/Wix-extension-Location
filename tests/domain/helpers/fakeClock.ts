/**
 * Deterministic fake Clock implementing the canonical domain port.
 * No real time is ever read by domain or unit tests (Contract §8.1).
 */
import type { Clock, Instant, IanaZone } from '../../../src/domain';

export class FakeClock implements Clock {
  private readonly instant: Instant;
  private readonly zoneId: IanaZone;

  constructor(instant: Instant, zoneId: IanaZone) {
    this.instant = instant;
    this.zoneId = zoneId;
  }

  now(): Instant {
    return this.instant;
  }

  zone(): IanaZone {
    return this.zoneId;
  }
}
