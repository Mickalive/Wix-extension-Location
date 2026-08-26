/**
 * Unified Wix CLI project-binding classifier (`wix.config.json`) — INT-C6-R1.
 *
 * BINDING PLATFORM FACTS (reports/recon/PLATFORM.md §3, source S4; Technical
 * Contract §13 UQ4):
 * - `wix.config.json` "defines the identifiers that connect your local code to
 *   your Wix project. Don't edit this file." It is generated exclusively by
 *   the authenticated one-time scaffold (`npm create @wix/new@latest app`),
 *   which also registers the real app in the Custom Apps dashboard.
 * - The exact app-project field set is UNVERIFIED (UQ4) until T-VP0 evidence
 *   exists; the documented headless shape shows `projectType`, `appId`,
 *   `siteId`, and `appId` is the load-bearing binding identifier. This module
 *   therefore requires positive evidence of an `appId` and TOLERATES unknown
 *   extra fields (schema-drift discipline, Contract §11 C4 analog) instead of
 *   asserting a field set nobody has observed for app projects.
 *
 * ANTI-FABRICATION: nothing here generates, defaults or invents identifiers.
 * The classifier distinguishes MISSING_FILE / UNPARSEABLE / UNLINKED / LINKED
 * so tooling (including Wix Live QA) can report scaffold state truthfully:
 * a placeholder-filled template is UNLINKED, never "linked".
 *
 * Purity: no I/O, no Wix SDK imports — callers supply file contents.
 */

/** Canonical file name of the unified-CLI project binding. */
export const PROJECT_CONFIG_FILENAME = 'wix.config.json';

/** Raw parsed project config. Unknown fields are preserved, never rejected. */
export type RawProjectConfig = Readonly<Record<string, unknown>>;

/**
 * Truthful linkage classification of a `wix.config.json` occurrence.
 * `LINKED` requires positive evidence: a real (non-placeholder, non-empty)
 * string `appId`. Anything less is `UNLINKED` with explicit problems.
 */
export type ProjectLinkage =
  | { readonly status: 'MISSING_FILE'; readonly detail: string }
  | { readonly status: 'UNPARSEABLE'; readonly detail: string }
  | { readonly status: 'UNLINKED'; readonly detail: string; readonly problems: readonly string[] }
  | { readonly status: 'LINKED'; readonly appId: string; readonly config: RawProjectConfig };

/**
 * Placeholder marker tokens that mark a value as scaffold-pending rather than
 * a real identifier. Matched case-insensitively as substrings.
 */
const PLACEHOLDER_TOKENS: readonly string[] = [
  'GENERATED-BY',
  'REPLACE',
  'PLACEHOLDER',
  'TODO',
  'TBD',
  'YOUR_',
];

/** Structural placeholder shapes: <...>, {{...}}, ${...}. */
const PLACEHOLDER_SHAPES: readonly RegExp[] = [
  /^\s*<.*>\s*$/,
  /^\s*\{\{.*\}\}\s*$/,
  /^\s*\$\{.*\}\s*$/,
];

/**
 * True when a STRING value is unmistakably a template placeholder rather than
 * a real identifier (empty, <...>/{{...}}/${...}-shaped, or containing a
 * placeholder token). Non-string input is reported by the caller as a type
 * problem, not as a placeholder.
 */
export function looksLikeScaffoldPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (PLACEHOLDER_SHAPES.some((shape) => shape.test(trimmed))) return true;
  const upper = trimmed.toUpperCase();
  return PLACEHOLDER_TOKENS.some((token) => upper.includes(token));
}

/**
 * Validates the `appId` binding field into either a linkable identifier or an
 * explicit problem. This is the ONLY path to a LINKED verdict.
 */
function linkableAppId(
  config: RawProjectConfig,
): { ok: true; appId: string } | { ok: false; problem: string } {
  const field = config['appId'];
  if (field === undefined) {
    return {
      ok: false,
      problem: 'missing binding field: appId (generated only by the authenticated scaffold)',
    };
  }
  if (typeof field !== 'string') {
    return { ok: false, problem: 'appId must be a string' };
  }
  const trimmed = field.trim();
  if (looksLikeScaffoldPlaceholder(trimmed)) {
    return {
      ok: false,
      problem: `appId holds a scaffold placeholder, not a real identifier (${trimmed})`,
    };
  }
  return { ok: true, appId: trimmed };
}

/**
 * Classifies raw file contents of `wix.config.json`.
 *
 * @param contents exact file text, or null when the file does not exist.
 */
export function classifyProjectBinding(contents: string | null): ProjectLinkage {
  if (contents === null) {
    return {
      status: 'MISSING_FILE',
      detail:
        `${PROJECT_CONFIG_FILENAME} not found — the unified Wix CLI project has never been ` +
        'scaffolded/bound. See src/platform/registration/README.md and ' +
        'docs/runbooks/T_VP0_SCAFFOLD.md.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    return {
      status: 'UNPARSEABLE',
      detail: `${PROJECT_CONFIG_FILENAME} is not valid JSON (${(error as Error).message}).`,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      status: 'UNPARSEABLE',
      detail: `${PROJECT_CONFIG_FILENAME} must contain a top-level JSON object.`,
    };
  }
  const config = parsed as RawProjectConfig;
  const appId = linkableAppId(config);
  if (!appId.ok) {
    return {
      status: 'UNLINKED',
      detail:
        `${PROJECT_CONFIG_FILENAME} exists but does not bind a real Wix app. Identifiers are ` +
        'generated only by the authenticated one-time scaffold (Technical Contract §16, gate ' +
        'T-VP0); they are never derived or invented in CI.',
      problems: [appId.problem],
    };
  }
  return { status: 'LINKED', appId: appId.appId, config };
}
