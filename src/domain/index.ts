/**
 * Rules-domain public API barrel.
 *
 * Everything reachable here is pure, deterministic TypeScript with zero Wix
 * SDK imports (enforced by the CI purity gate) and no I/O: all clocks, zones,
 * counters and entitlement signals arrive via ports or evaluation deps.
 */

export * from './ports';
export * from '../shared/types';
export * from '../shared/errors';
export * from './model/primitives';
export * from './time/intlZone';
export * from './time/wallClock';
export * from './windows/weeklyWindows';
export * from './exceptions/exceptions';
export * from './limits/limits';
export * from './duplicates/duplicates';
export * from './explain/explain';
export * from './validate';
export * from './evaluate';
