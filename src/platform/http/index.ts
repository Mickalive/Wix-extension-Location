/**
 * Token-verified HTTP endpoint handler layer (INT-C2-1 item b; Blueprint §4
 * flow 2; Technical Contract §6). Pure, Wix-import-free modules — the thin
 * `src/pages/api/*` adapters are deferred to the authenticated scaffold and
 * MUST follow the wiring protocol in ./README.md.
 */
export type {
  TokenVerifier,
  VerifiedCallerToken,
} from './tokenVerifier';
export {
  UnauthorizedRequestError,
  requireVerifiedCaller,
} from './auth';
export type { TokenFailureReason } from './auth';
export type {
  EndpointRequest,
  ErrorBody,
  HttpResponse,
} from './transport';
export { httpResponseForError } from './transport';
export type {
  GetActiveRuleSetEndpointDeps,
  PutRuleSetEndpointDeps,
  PutRuleSetRequestBody,
  RuleSetValidationIssue,
  RuleSetValidationSeam,
} from './ruleSetEndpoints';
export {
  getActiveRuleSet,
  putRuleSet,
  validateRuleSetStructure,
} from './ruleSetEndpoints';
export type {
  ApplyPlanEndpointDeps,
  ApplyPlanRequestBody,
  ApplyPlanExecutor,
  ConfirmedPlanLookup,
  ConfirmedPlanReference,
  MutationStatusEndpointDeps,
  MutationStatusProjection,
  RecoverEndpointDeps,
} from './mutationEndpoints';
export {
  getMutationStatus,
  postApplyPlan,
  postRecover,
} from './mutationEndpoints';
export type {
  EntitlementCoverageDTO,
  EntitlementMeterDTO,
  EntitlementMeterResponse,
  GetMeterEndpointDeps,
  MeterSourceGate,
} from './meterEndpoint';
export { getEntitlementMeter } from './meterEndpoint';
