/**
 * Project-binding classifier + committed shape template (INT-C6-R1).
 *
 * Pins the truthful scaffold-state semantics of `wix.config.json`:
 *   - MISSING_FILE / UNPARSEABLE / UNLINKED / LINKED are mutually exclusive
 *     and demand POSITIVE evidence for LINKED;
 *   - placeholder-shaped values are UNLINKED, never "linked";
 *   - unknown fields are tolerated (UQ4 honesty; C4-style drift tolerance);
 *   - the committed wix.config.example.json is byte-identical to the module's
 *     serialization and classifies as UNLINKED by construction.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_CONFIG_FILENAME,
  classifyProjectBinding,
  looksLikeScaffoldPlaceholder,
} from '../../src/platform/registration/projectConfig';
import {
  EXAMPLE_PROJECT_CONFIG,
  EXAMPLE_PROJECT_CONFIG_FILENAME,
  SCAFFOLD_PLACEHOLDER_APP_ID,
  exampleProjectConfigIsUnlinkedByConstruction,
  serializeExampleProjectConfig,
} from '../../src/platform/registration/exampleProjectConfig';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('project binding classification', () => {
  it('uses the canonical unified-CLI file name', () => {
    expect(PROJECT_CONFIG_FILENAME).toBe('wix.config.json');
  });

  it('reports a missing file truthfully', () => {
    const linkage = classifyProjectBinding(null);
    expect(linkage.status).toBe('MISSING_FILE');
    if (linkage.status === 'MISSING_FILE') {
      expect(linkage.detail).toContain('never been');
      expect(linkage.detail).toContain('scaffolded/bound');
    }
  });

  it('reports unparseable JSON and non-object payloads without inventing state', () => {
    for (const contents of ['not json {', '[]', '42', '"string"', 'null']) {
      const linkage = classifyProjectBinding(contents);
      expect(linkage.status, `contents: ${contents}`).toBe('UNPARSEABLE');
    }
  });

  it('classifies an empty object as UNLINKED with an explicit missing-appId problem', () => {
    const linkage = classifyProjectBinding('{}');
    expect(linkage.status).toBe('UNLINKED');
    if (linkage.status === 'UNLINKED') {
      expect(linkage.problems[0]).toContain('appId');
      expect(linkage.detail).toContain('never derived or invented in CI');
    }
  });

  it('refuses non-string, empty and placeholder appIds as UNLINKED', () => {
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { appId: 42 },
      { appId: null },
      { appId: { nested: true } },
      { appId: '' },
      { appId: '   ' },
      { appId: '<GENERATED-BY-AUTHENTICATED-SCAFFOLD>' },
      { appId: '{{APP_ID}}' },
      { appId: '${APP_ID}' },
      { appId: 'REPLACE_ME' },
      { appId: 'your_app_id_here' },
      { appId: 'TODO' },
    ];
    for (const config of cases) {
      const linkage = classifyProjectBinding(JSON.stringify(config));
      expect(linkage.status, JSON.stringify(config)).toBe('UNLINKED');
    }
  });

  it('grants LINKED only to a real-looking string appId and trims it', () => {
    const linkage = classifyProjectBinding(JSON.stringify({ appId: '  linked-fixture-app-id  ' }));
    expect(linkage.status).toBe('LINKED');
    if (linkage.status === 'LINKED') {
      expect(linkage.appId).toBe('linked-fixture-app-id');
    }
  });

  it('tolerates unknown extra fields around a real appId (UQ4 drift discipline)', () => {
    const linkage = classifyProjectBinding(
      JSON.stringify({ projectType: 'app', appId: 'fixture-id', siteId: 'future-field', extra: [1, 2] }),
    );
    expect(linkage.status).toBe('LINKED');
    if (linkage.status === 'LINKED') {
      expect(linkage.config['siteId']).toBe('future-field');
    }
  });
});

describe('placeholder detection', () => {
  it('flags template shapes and marker tokens case-insensitively', () => {
    for (const value of ['', '   ', '<...>', '{{X}}', '${Y}', 'aREPLACEb', 'placeholder', 'tbd-value', 'YOUR_APP']) {
      expect(looksLikeScaffoldPlaceholder(value), value).toBe(true);
    }
  });

  it('accepts real-looking identifiers', () => {
    for (const value of ['app-id', 'a'.repeat(32), 'com.example.product']) {
      expect(looksLikeScaffoldPlaceholder(value), value).toBe(false);
    }
  });
});

describe('committed wix.config.example.json template', () => {
  it('is byte-identical to the module serialization (no drift in either direction)', () => {
    const committed = readFileSync(join(repoRoot, EXAMPLE_PROJECT_CONFIG_FILENAME), 'utf8');
    expect(committed).toBe(serializeExampleProjectConfig());
  });

  it('carries only the documented fields with scaffold-pending values', () => {
    expect(Object.keys(EXAMPLE_PROJECT_CONFIG).sort()).toEqual(['appId', 'projectType']);
    expect(EXAMPLE_PROJECT_CONFIG.projectType).toBe('app');
    expect(EXAMPLE_PROJECT_CONFIG.appId).toBe(SCAFFOLD_PLACEHOLDER_APP_ID);
    expect(exampleProjectConfigIsUnlinkedByConstruction()).toBe(true);
  });

  it('classifies as UNLINKED by the same loader used for real configs', () => {
    const linkage = classifyProjectBinding(readFileSync(join(repoRoot, EXAMPLE_PROJECT_CONFIG_FILENAME), 'utf8'));
    expect(linkage.status).toBe('UNLINKED');
    if (linkage.status === 'UNLINKED') {
      expect(linkage.problems.join(' ')).toContain('placeholder');
    }
  });

  it('serialization is deterministic across repeated calls', () => {
    expect(serializeExampleProjectConfig()).toBe(serializeExampleProjectConfig());
  });
});
