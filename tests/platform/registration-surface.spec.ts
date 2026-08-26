/**
 * Registration surface integrity (INT-C6-R1).
 *
 * Adversarial pins over the whole registration surface:
 *   1. VALIDATION EXTENSION SHAPE — the documented Bookings Validation config
 *      derives its targets from the implemented handler matrix (no drift),
 *      accepts only sane deployment URIs, and round-trips as JSON.
 *   2. MANIFEST — every planned registration has a valid channel/kind/status,
 *      unique ids, and references only repo artifacts that exist.
 *   3. ANTI-FABRICATION — no identifier-shaped strings anywhere in the
 *      registration modules, the example template or extensions.ts; no SDK
 *      import shapes; the purity gate protects this directory.
 *   4. PREREQUISITES — every account-authenticated step records why CI cannot
 *      derive it, points at an existing runbook, and the blocker statement
 *      stays narrow and identifier-free.
 *   5. FILE BOUNDARY — .gitignore protects the future real wix.config.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlatformError } from '../../src/shared/errors';
import { VALIDATION_TARGETS } from '../../src/platform/validation-plugin/targets';
import {
  DEFAULT_VALIDATION_DEPLOYMENT_URI,
  buildBookingsValidationExtensionConfig,
  validateDeploymentUri,
} from '../../src/platform/registration/validationExtension';
import {
  EXTENSION_REGISTRATIONS,
  extensionRegistrationsByChannel,
} from '../../src/platform/registration/extensionsManifest';
import type { ExtensionKind, RegistrationChannel } from '../../src/platform/registration/extensionsManifest';
import {
  SCAFFOLD_COMMAND,
  SCAFFOLD_PREREQUISITES,
  externalBlockerStatement,
} from '../../src/platform/registration/scaffoldPrerequisites';
import { DEFAULT_PROTECTED_ROOTS } from '../../src/platform/purity/check-purity.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SDK_IMPORT_SHAPES = [/from\s+['"]@wix\//, /import\s*\(\s*['"]@wix\//, /require\s*\(\s*['"]@wix\//];

function listRegistrationSourceFiles(): string[] {
  const dir = join(repoRoot, 'src', 'platform', 'registration');
  return readdirSync(dir).filter((name) => name.endsWith('.ts')).map((name) => join(dir, name));
}

// ------------------------------------------------- 1. validation extension

describe('bookings validation extension registration shape', () => {
  it('defaults to the documented /api endpoint route derived from pages/api mapping', () => {
    expect(DEFAULT_VALIDATION_DEPLOYMENT_URI).toBe('/api/bookings-validation');
    expect(DEFAULT_VALIDATION_DEPLOYMENT_URI.startsWith('/api/')).toBe(true);
  });

  it('registers EXACTLY the six implemented validation targets, in canonical order', () => {
    const config = buildBookingsValidationExtensionConfig();
    expect(config.validationTargets).toHaveLength(6);
    expect([...config.validationTargets]).toEqual([...VALIDATION_TARGETS]);
  });

  it('emits a frozen, JSON-ready config that survives a round-trip unchanged', () => {
    const config = buildBookingsValidationExtensionConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.validationTargets)).toBe(true);
    const roundTrip = JSON.parse(JSON.stringify(config)) as typeof config;
    expect(roundTrip).toEqual({ deploymentUri: DEFAULT_VALIDATION_DEPLOYMENT_URI, validationTargets: [...VALIDATION_TARGETS] });
  });

  it('accepts custom /api-rooted paths and https URLs', () => {
    expect(buildBookingsValidationExtensionConfig({ deploymentUri: '/api/bookings-validation-v2' }).deploymentUri)
      .toBe('/api/bookings-validation-v2');
    expect(buildBookingsValidationExtensionConfig({ deploymentUri: 'https://example-host.invalid/hook' }).deploymentUri)
      .toBe('https://example-host.invalid/hook');
  });

  it('rejects malformed deployment URIs with INVALID_STATE instead of coercing', () => {
    const rejected = [
      '',
      '   ',
      '/not-api-rooted',
      'http://insecure.example/hook',
      'ftp://x',
      '/api/../secret',
      '/api/x?q=1',
      'https:///no-host',
      'relative/no-slash-prefix with space',
    ];
    for (const uri of rejected) {
      let thrown: unknown;
      try {
        buildBookingsValidationExtensionConfig({ deploymentUri: uri });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `uri: ${JSON.stringify(uri)}`).toBeInstanceOf(PlatformError);
      if (thrown instanceof PlatformError) {
        expect(thrown.code).toBe('INVALID_STATE');
      }
    }
  });

  it('validateDeploymentUri reports problems without throwing', () => {
    expect(validateDeploymentUri('/api/ok')).toBeNull();
    expect(validateDeploymentUri('https://host.example/x')).toBeNull();
    expect(validateDeploymentUri('/bad')).toContain('/api/');
    expect(validateDeploymentUri('')).toContain('non-empty');
  });
});

// ----------------------------------------------------------------- 2. manifest

describe('extension registration inventory', () => {
  const CHANNELS: readonly RegistrationChannel[] = [
    'UNIFIED_CLI_GENERATE',
    'APP_DASHBOARD_FALLBACK',
    'INTERACTIVE_CLI_MENU',
    'FILE_BASED_NO_REGISTRATION',
  ];
  const KINDS: readonly ExtensionKind[] = [
    'DASHBOARD_PAGE',
    'DASHBOARD_MODAL',
    'EVENT',
    'WEBHOOK_SUBSCRIPTION',
    'SERVICE_PLUGIN_BOOKINGS_VALIDATION',
    'DATA_COLLECTIONS',
    'HTTP_ENDPOINTS',
  ];

  it('is non-empty with unique ids and valid channel/kind/status values', () => {
    expect(EXTENSION_REGISTRATIONS.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(EXTENSION_REGISTRATIONS.map((entry) => entry.id));
    expect(ids.size).toBe(EXTENSION_REGISTRATIONS.length);
    for (const entry of EXTENSION_REGISTRATIONS) {
      expect(CHANNELS).toContain(entry.channel);
      expect(KINDS).toContain(entry.kind);
      expect(entry.status).toBe('PLANNED_UNTIL_T_VP0');
      expect(entry.notes.length).toBeGreaterThan(0);
    }
  });

  it('references only repo artifacts that actually exist', () => {
    for (const entry of EXTENSION_REGISTRATIONS) {
      if (entry.productSourcePath !== undefined) {
        expect(existsSync(join(repoRoot, entry.productSourcePath)), `${entry.id} -> ${entry.productSourcePath}`).toBe(true);
      }
    }
  });

  it('routes each surface through its contract-mandated channel', () => {
    const byId = new Map(EXTENSION_REGISTRATIONS.map((entry) => [entry.id, entry]));
    expect(byId.get('backend.bookings-validation.service-plugin')?.channel).toBe('APP_DASHBOARD_FALLBACK');
    expect(byId.get('backend.data-collections')?.channel).toBe('INTERACTIVE_CLI_MENU');
    expect(byId.get('backend.http-endpoints')?.channel).toBe('FILE_BASED_NO_REGISTRATION');
    expect(byId.get('dashboard.rules-editor.page')?.channel).toBe('UNIFIED_CLI_GENERATE');
    expect(extensionRegistrationsByChannel('FILE_BASED_NO_REGISTRATION')).toHaveLength(1);
  });

  it('documents the generate-menu uncertainty on the validation plugin (T-VP0 honesty)', () => {
    const plugin = EXTENSION_REGISTRATIONS.find((entry) => entry.id === 'backend.bookings-validation.service-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.notes.join(' ')).toContain('empirically unconfirmed until T-VP0');
  });
});

// -------------------------------------------------------- 3. anti-fabrication

describe('anti-fabrication guarantees across the scaffold surface', () => {
  const surfaceFiles = [
    ...listRegistrationSourceFiles(),
    join(repoRoot, 'extensions.ts'),
    join(repoRoot, 'wix.config.example.json'),
  ];

  it('contains no UUID-like or hex-blob identifier shapes', () => {
    const offenders: string[] = [];
    for (const file of surfaceFiles) {
      if (UUID_LIKE.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('contains no SDK import shapes even though documentation strings exist', () => {
    const offenders: string[] = [];
    for (const file of surfaceFiles) {
      const text = readFileSync(file, 'utf8');
      if (SDK_IMPORT_SHAPES.some((pattern) => pattern.test(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the registration directory under the purity gate protection', () => {
    expect(DEFAULT_PROTECTED_ROOTS).toContain('src/platform/registration');
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, 'src', 'platform', 'purity', 'check-purity.mjs')],
      { encoding: 'utf8' },
    );
    expect(stdout).toContain('Purity gate passed');
    expect(stdout).toContain('src/platform/registration');
  });

  it('gitignores the real project binding so it can never be committed by accident', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^wix\.config\.json$/m);
    expect(gitignore).toMatch(/wix\.config\.example\.json/m);
  });
});

// ------------------------------------------------------------ 4. prerequisites

describe('account-authenticated prerequisites record', () => {
  it('records every CI-underivable step with owner, gate and existing runbook anchor', () => {
    expect(SCAFFOLD_PREREQUISITES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(SCAFFOLD_PREREQUISITES.map((step) => step.id));
    expect(ids.size).toBe(SCAFFOLD_PREREQUISITES.length);
    for (const step of SCAFFOLD_PREREQUISITES) {
      expect(step.owner).toBe('HUMAN_ACCOUNT_OWNER');
      expect(step.whyNotDerivableInCi.length).toBeGreaterThan(20);
      expect(step.evidenceGate).toMatch(/T-VP0|Contract §16/);
      expect(existsSync(join(repoRoot, step.runbookPath)), step.runbookPath).toBe(true);
    }
  });

  it('names the exact scaffold command recorded in the runbook', () => {
    expect(SCAFFOLD_COMMAND).toBe('npm create @wix/new@latest app');
    const runbook = readFileSync(join(repoRoot, 'docs', 'runbooks', 'T_VP0_SCAFFOLD.md'), 'utf8');
    expect(runbook).toContain(SCAFFOLD_COMMAND);
  });

  it('composes a narrow blocker statement: actionable, evidenced, identifier-free', () => {
    const statement = externalBlockerStatement();
    expect(statement).toContain('wix.config.json');
    expect(statement).toContain(SCAFFOLD_COMMAND);
    expect(statement).toContain('T-VP0');
    expect(statement).toContain('fabricat');
    expect(statement).toContain('wix.config.example.json');
    expect(UUID_LIKE.test(statement)).toBe(false);
  });
});
