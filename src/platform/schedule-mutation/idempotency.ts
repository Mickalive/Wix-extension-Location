/**
 * Deterministic UUIDv5 idempotency-key derivation for schedule mutations
 * (Contract §9.3: keys derived from (site, schedule, rule-version, weekday,
 * window); replay-safe).
 *
 * RFC 4122 §4.3 UUIDv5 over SHA-1, implemented on node:crypto so the platform
 * layer stays dependency-free. The namespace below is an APPLICATION-DEFINED
 * constant chosen once for this product — it is NOT a Wix identifier and MUST
 * never be changed (doing so would silently break replay detection for plans
 * applied before the change).
 */
import { createHash } from 'node:crypto';

/** Application-defined UUIDv5 namespace for all mutation idempotency keys. */
export const SCHEDULE_MUTATION_IDEMPOTENCY_NAMESPACE =
  '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function namespaceToBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid UUID namespace: ${namespace}`);
  }
  return Buffer.from(hex, 'hex');
}

/** RFC 4122 §4.3 name-based UUID (SHA-1, version 5). */
export function uuidV5(
  name: string,
  namespace: string = SCHEDULE_MUTATION_IDEMPOTENCY_NAMESPACE,
): string {
  const hash = createHash('sha1');
  hash.update(namespaceToBytes(namespace));
  hash.update(Buffer.from(name, 'utf8'));
  const digest = hash.digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50; // version 5
  digest[8] = (digest[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export interface IdempotencyKeyInput {
  /** Tenant/site identifier supplied by the caller at runtime; never fabricated. */
  siteId: string;
  scopeScheduleId: string;
  ruleVersion: number | string;
}

/**
 * Stable textual identity of a planned change within its plan context.
 * Same inputs => same key forever; any window/weekday/target difference =>
 * different key.
 */
export function describeChangeForIdempotency(change: PlannedChangeLike): string {
  switch (change.action) {
    case 'CREATE_MASTER':
      return [
        'create',
        change.weekday,
        change.startTime,
        change.endTime,
        `loc:${change.locationId ?? '-'}`,
      ].join('|');
    case 'UPDATE_MASTER':
      return [
        'update',
        change.eventId,
        change.startTime ?? '-',
        change.endTime ?? '-',
        `loc:${change.locationId ?? '-'}`,
      ].join('|');
    case 'CANCEL_EVENT':
      return ['cancel', change.eventId].join('|');
  }
}

interface PlannedChangeLike {
  action: 'CREATE_MASTER' | 'UPDATE_MASTER' | 'CANCEL_EVENT';
  weekday?: string;
  startTime?: string;
  endTime?: string;
  anchorDate?: string;
  locationId?: string | null;
  eventId?: string;
}

/** Derives the apply-path idempotency key for one planned change. */
export function deriveChangeIdempotencyKey(
  input: IdempotencyKeyInput,
  change: PlannedChangeLike,
): string {
  const parts = [
    'apply',
    input.siteId,
    input.scopeScheduleId,
    `rule-v${input.ruleVersion}`,
    describeChangeForIdempotency(change),
  ];
  return uuidV5(parts.join('::'));
}

/**
 * Rollback writes must use FRESH keys distinct from apply keys (Contract §9.6);
 * the snapshot id participates so each rollback attempt is independently
 * idempotent per snapshot.
 */
export function deriveRollbackIdempotencyKey(
  input: IdempotencyKeyInput,
  snapshotId: string,
  eventId: string,
): string {
  return uuidV5(['rollback', input.siteId, input.scopeScheduleId, snapshotId, eventId].join('::'));
}
