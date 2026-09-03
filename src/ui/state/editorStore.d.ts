export interface EditorDraft {
  locationWindows: Record<string, Record<string, Array<{ start: string; end: string }>>>;
  serviceWindows: Record<string, Record<string, Array<{ start: string; end: string }>>>;
  exceptions: Array<Record<string, any>>;
  limits: Array<Record<string, any>>;
}

export interface EditorState {
  savedRuleSet: EditorDraft | null;
  draft: EditorDraft;
  locations: Array<{ id: string; label: string }>;
  services: Array<{ id: string; label: string }>;
  issues: Array<any>;
  diffPreview: { open: boolean; renderedHash: string | null };
  confirmedHash: string | null;
  notice: any;
  saveStatus: string;
  applyStatus: string;
  recoverStatus: string;
  [key: string]: any;
}

export interface EditorStore {
  getState(): EditorState;
  subscribe(listener: (state: EditorState) => void): () => void;
  dispatch(action: Record<string, any>): void;
  currentDiff(): any;
  canConfirmDiff(): boolean;
  canApply(): boolean;
}

export function emptyDraft(): EditorDraft;
export function createEditorStore(input?: {
  savedRuleSet?: EditorDraft | null;
  draft?: EditorDraft;
  locations?: Array<{ id: string; label: string }>;
  services?: Array<{ id: string; label: string }>;
}): EditorStore;
export function describeBridgeFailure(error: unknown, action?: string): string;
