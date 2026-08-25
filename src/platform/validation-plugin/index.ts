/**
 * Booking-time enforcement wiring (INT-C3-1; Blueprint §4 flow 1; Technical
 * Contract §5.3/§7/§11). Pure, Wix-import-free modules — the real
 * `bookingsValidation.provideHandlers()` SDK adapter is deferred to the
 * authenticated scaffold (gate T-VP0) and MUST follow the wiring protocol in
 * ./README.md.
 */
export type {
  ValidationTarget,
} from './targets';
export { VALIDATION_TARGETS, isValidationTarget, semanticsOf } from './targets';
export type {
  MetadataIdentity,
  MetadataIdentityKind,
  ParsedSlotItem,
  ParsedValidationRequest,
} from './payload';
export { MAX_BULK_ITEMS, ownerBusinessLocationId, parseValidationRequest } from './payload';
export type { DegradationKind, DegradationRecord, DegradationSink } from './incidents';
export { InMemoryDegradationSink, safeRecord } from './incidents';
export type { CachedBookingCountGatewayOptions } from './counters';
export { CachedBookingCountGateway, DEFAULT_COUNTER_TTL_MS, countQueryKey } from './counters';
export type {
  EnforcementClaim,
  ExistingBookingsPort,
  IdentityPayloadPolicy,
  ItemDisposition,
  ValidationHandlerResult,
  ValidationHandlers,
  ValidationItemResult,
  ValidationPluginDeps,
  ValidationTargetHandler,
} from './handlers';
export {
  createValidationHandlers,
  DEFAULT_IDENTITY_PAYLOAD_POLICY,
  FAIL_CLOSED_CODE,
  FAIL_CLOSED_MESSAGE,
} from './handlers';
