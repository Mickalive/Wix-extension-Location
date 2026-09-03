import type { EditorDraft } from '../state/editorStore.js';

export interface RuntimeRuleSet {
  ruleSetId: string;
  revision: string;
  version: number;
  locationWindows: Record<string, Array<{ weekday: string; start: string; end: string }>>;
  serviceWindows: Record<string, Array<{ weekday: string; start: string; end: string }>>;
  exceptions: Array<Record<string, any>>;
  limits: Array<Record<string, any>>;
  [key: string]: any;
}

export interface EntitlementMeterDto {
  meter: { count: number | null; degraded: boolean };
  coverage: {
    allowedLocationIds: string[];
    overLimit: boolean;
    degraded: boolean;
    warning: string | null;
  };
}

export interface RuntimeServicesBridge {
  getActiveRuleSet(): Promise<RuntimeRuleSet | null>;
  saveRuleSet(ruleSet: RuntimeRuleSet): Promise<RuntimeRuleSet>;
  getEntitlementMeter(): Promise<EntitlementMeterDto | null>;
  requestApply(confirmedDiffHash: string): Promise<{ summary?: { planId?: string; [key: string]: any }; [key: string]: any }>;
  getMutationStatus(planId: string): Promise<any>;
  recover(scope: any): Promise<any>;
  request(path: string, options?: { method?: string; body?: unknown }): Promise<any>;
}

export function ruleSetDtoToDraft(ruleSet: RuntimeRuleSet | null | undefined): EditorDraft;
export function draftToRuleSetDto(draft: EditorDraft, previousRuleSet?: RuntimeRuleSet | null): RuntimeRuleSet;
export function createRuntimeServicesBridge(options?: Record<string, any>): RuntimeServicesBridge;
export function cloneDraft<T>(value: T): T;
