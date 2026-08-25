/**
 * In-memory fake adapters for every domain port (Blueprint §3; Contract §8.2).
 * These are reference implementations and the shared test harness for all four
 * lanes until real Wix-backed adapters exist (which requires human-owned
 * credentials — Contract §16). They contain no rule logic and no Wix imports.
 */
export { FakeClock } from './clock';
export { FakeRulesConfigStore } from './rulesConfigStore';
export { FakeScheduleGateway } from './scheduleGateway';
export { SimulatedProcessCrash } from './simulatedProcessCrash';
export { FakeAvailabilityGateway } from './availabilityGateway';
export { FakeBookingCountGateway } from './bookingCountGateway';
export type { SeededBooking } from './bookingCountGateway';
export { FakeEntitlementGate } from './entitlementGate';
export { FakeMutationJournalStore } from './mutationJournalStore';
export { FakeWebhookIngestionStore } from './webhookIngestionStore';
