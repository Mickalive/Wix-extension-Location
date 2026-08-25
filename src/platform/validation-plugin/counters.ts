/**
 * Short-TTL cache over the {@link BookingCountGateway} port
 * (INT-C3-1 item f; Blueprint §4 flows 1/4; Contract §5.3 "respond as fast as
 * possible ... design for cached counters and minimal reads").
 *
 * - Cache key is a canonical serialization of the UTC-bounded CountQuery.
 * - TTL is short (default 2000 ms) and injected-clock driven, so tests stay
 *   deterministic and stale entries cannot outlive the validation deadline.
 * - The gateway port contract is preserved: `count` THROWS on infrastructure
 *   failure. The enforcement path converts failures into cap degradation +
 *   COUNT_GATEWAY_FAILURE incidents (see handlers.ts) — never silent, never
 *   a thrown error into the booking decision.
 *
 * Purity: no Wix imports; the wrapped gateway and clock are injected ports.
 */

import type { BookingCountGateway, Clock, CountQuery } from '../../domain';

/** Default short TTL keeping counters fresh within one validation exchange. */
export const DEFAULT_COUNTER_TTL_MS = 2000;

/** Canonical, order-stable cache key for a CountQuery. */
export function countQueryKey(query: CountQuery): string {
  return JSON.stringify([
    query.fromUtc,
    query.toUtc,
    query.serviceId ?? null,
    query.locationId ?? null,
    [...query.includedStatuses].sort(),
  ]);
}

export interface CachedBookingCountGatewayOptions {
  gateway: BookingCountGateway;
  clock: Clock;
  ttlMs?: number;
}

interface CacheEntry {
  value: number;
  expiresAtMs: number;
}

export class CachedBookingCountGateway implements BookingCountGateway {
  private readonly inner: BookingCountGateway;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: CachedBookingCountGatewayOptions) {
    this.inner = options.gateway;
    this.clock = options.clock;
    this.ttlMs = options.ttlMs ?? DEFAULT_COUNTER_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) {
      throw new Error('CachedBookingCountGateway: ttlMs must be a non-negative finite number');
    }
  }

  async count(query: CountQuery): Promise<number> {
    const key = countQueryKey(query);
    const nowMs = Date.parse(this.clock.now());
    const cached = this.entries.get(key);
    if (cached !== undefined && cached.expiresAtMs > nowMs) {
      return cached.value;
    }
    const value = await this.inner.count(query);
    this.entries.set(key, { value, expiresAtMs: nowMs + this.ttlMs });
    return value;
  }

  /** Test/diagnostic knob: drop every cached entry (next count re-fetches). */
  invalidateAll(): void {
    this.entries.clear();
  }
}
