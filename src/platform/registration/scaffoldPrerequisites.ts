/**
 * Account-authenticated scaffold prerequisites — INT-C6-R1.
 *
 * Machine-readable record of the values and steps that CANNOT be derived in
 * CI, so tooling (including Wix Live QA) can report a NARROW external
 * prerequisite instead of a vague failure — and so no builder is ever tempted
 * to invent the missing values (directives/INTEGRATION.md; Technical Contract
 * §16; AGENTS.md global prohibitions).
 *
 * Each entry names: what is missing, why CI cannot derive it, who owns it,
 * the empirical gate it feeds, and where the execution runbook lives.
 *
 * Purity: data + one pure statement builder. The scaffold command below is a
 * documentation string, not an import — the purity scanner only flags
 * import-shaped occurrences, and this directory stays free of SDK imports.
 */

/** File name of the real project binding this module reasons about. */
export const PROJECT_CONFIG_FILE = 'wix.config.json';

/**
 * The documented one-time scaffold/bind command (Technical Contract §1/§16;
 * runbook §1). Documentation string only — never executed by product code.
 */
export const SCAFFOLD_COMMAND = 'npm create @wix/new@latest app';

/** Who can resolve a prerequisite. Every entry is human-owned. */
export type PrerequisiteOwner = 'HUMAN_ACCOUNT_OWNER';

/** One account-authenticated step that CI cannot derive. */
export interface ScaffoldPrerequisite {
  readonly id: string;
  readonly title: string;
  /** Why no autonomous run can produce this value/step. */
  readonly whyNotDerivableInCi: string;
  readonly owner: PrerequisiteOwner;
  /** Empirical gate the step feeds (Technical Contract §15). */
  readonly evidenceGate: string;
  /** Repo-relative runbook path (existence test-enforced). */
  readonly runbookPath: string;
  /** Section anchor inside the runbook. */
  readonly runbookSection: string;
}

function prerequisite(record: ScaffoldPrerequisite): ScaffoldPrerequisite {
  return Object.freeze(record);
}

export const SCAFFOLD_PREREQUISITES: readonly ScaffoldPrerequisite[] = Object.freeze([
  prerequisite({
    id: 'WIX_ACCOUNT_CLI_AUTHORIZATION',
    title: 'A Wix account authorizing the unified CLI (owner/co-owner for the API Keys Manager).',
    whyNotDerivableInCi:
      'Account credentials are human-owned; agents must never request, read, print or store secrets, and no account identifier may be invented.',
    owner: 'HUMAN_ACCOUNT_OWNER',
    evidenceGate: 'T-VP0 step 1',
    runbookPath: 'docs/runbooks/T_VP0_SCAFFOLD.md',
    runbookSection: '§1 commands 1',
  }),
  prerequisite({
    id: 'ONE_TIME_SCAFFOLD_BIND',
    title:
      'Run the one-time scaffold/bind choosing the immutable namespace and code identifier; this registers the real app in the Custom Apps dashboard and generates the real project binding plus generated extension entries.',
    whyNotDerivableInCi:
      'Produces account-bound identifiers (appId, namespace, code identifier). Fabricating any of them is forbidden; CI has no authenticated tooling, and the binding file is generated exclusively by this command.',
    owner: 'HUMAN_ACCOUNT_OWNER',
    evidenceGate: 'T-VP0 step 2',
    runbookPath: 'docs/runbooks/T_VP0_SCAFFOLD.md',
    runbookSection: '§1 command 2',
  }),
  prerequisite({
    id: 'DEV_SITE_BINDING_AND_CONSENT',
    title:
      'Create/select a development site and complete the one-time interactive install consent; pin the site for automation.',
    whyNotDerivableInCi:
      'Install consent is human-in-the-loop even under API-key authentication; dev-site identifiers are account-bound; selection-storage mechanics stay quarantined as UQ1 until the first authenticated run records them.',
    owner: 'HUMAN_ACCOUNT_OWNER',
    evidenceGate: 'T-VP0 steps 3 and 5 (evidence E5)',
    runbookPath: 'docs/runbooks/T_VP0_SCAFFOLD.md',
    runbookSection: '§1 commands 3',
  }),
  prerequisite({
    id: 'CI_API_KEY_AS_SECRET',
    title:
      'An owner/co-owner API key created in the API Keys Manager and stored ONLY as a CI secret for authenticated CLI commands.',
    whyNotDerivableInCi:
      'Secret material must never enter the repository, prompts, artifacts or agent context; creation requires account owner/co-owner rights.',
    owner: 'HUMAN_ACCOUNT_OWNER',
    evidenceGate: 'T-VP0 step 1 (automation variant)',
    runbookPath: 'docs/runbooks/T_VP0_SCAFFOLD.md',
    runbookSection: '§0 ground rule 4',
  }),
  prerequisite({
    id: 'RELEASE_AND_MARKETPLACE_APPROVALS',
    title:
      'Release approvals, payout account setup and App Market submission remain human actions on the release path.',
    whyNotDerivableInCi:
      'Publishing/releasing/submitting an app is prohibited for agents regardless of credentials (global prohibitions); payout onboarding is account-owned.',
    owner: 'HUMAN_ACCOUNT_OWNER',
    evidenceGate: 'post-T-VP* release path (Contract §16 items 5–6)',
    runbookPath: 'docs/runbooks/T_VP0_SCAFFOLD.md',
    runbookSection: '§4 after T-VP0',
  }),
]);

/**
 * The narrow, evidence-backed external-prerequisite statement for the current
 * scaffold state. Composed ONLY from committed facts and contract references;
 * contains no identifiers because none legitimately exist.
 */
export function externalBlockerStatement(): string {
  return [
    `No linked Wix CLI project exists: ${PROJECT_CONFIG_FILE} is generated exclusively by the ` +
      `authenticated one-time scaffold ("${SCAFFOLD_COMMAND}") under a human-owned Wix account, ` +
      'which also registers the app and generates its real identifiers ' +
      '(Technical Contract §16 items 1–3; empirical gate T-VP0; runbook docs/runbooks/T_VP0_SCAFFOLD.md).',
    'None of the account-authenticated values (appId, namespace/code identifier, dev-site binding, ' +
      'API key) can be derived in CI without fabricating them, which governance forbids.',
    'Every legitimately derivable scaffold artifact is committed: wix.config.example.json (shape ' +
      'template, classified UNLINKED by src/platform/registration/projectConfig.ts), the registration ' +
      'modules under src/platform/registration/, the empty-by-design extensions.ts anchor, and the ' +
      'gitignore rule protecting the future real binding.',
    'Until a human owner performs the scaffold/bind (runbook steps 1–3), the truthful live-QA ' +
      'disposition is a narrowly evidenced external prerequisite on those exact steps — not a ' +
      'missing-product defect.',
  ].join(' ');
}
