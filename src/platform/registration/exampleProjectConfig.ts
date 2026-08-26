/**
 * Committed shape template for the unified-CLI project binding — INT-C6-R1.
 *
 * `wix.config.example.json` is the ONLY committable form of the project
 * binding: the real `wix.config.json` holds account-bound identifiers, is
 * generated exclusively by the authenticated one-time scaffold, and is
 * gitignored by policy (.gitignore; src/platform/registration/README.md).
 *
 * HONESTY ABOUT SHAPE (Contract §13 UQ4): the exact app-project field set is
 * UNVERIFIED until T-VP0 evidence exists. This template uses only fields that
 * appear in current official documentation — `projectType` (documented on the
 * headless config shape; `app` is this product's documented project kind,
 * Contract §1) and `appId` (the load-bearing binding identifier, recon §3).
 * Every VALUE is an explicit scaffold-pending placeholder, and the committed
 * file MUST classify as UNLINKED by src/platform/registration/projectConfig.ts
 * (test-enforced byte-equality + classification pin).
 *
 * Purity: no I/O; serialization is deterministic so tests can pin the
 * committed file against this module and detect drift in either direction.
 */

import { looksLikeScaffoldPlaceholder } from './projectConfig';

/** File name of the committed shape template. */
export const EXAMPLE_PROJECT_CONFIG_FILENAME = 'wix.config.example.json';

/**
 * The canonical placeholder for scaffold-generated identifier values.
 * Angle brackets make it invalid as a real identifier and the classifier
 * reports it as UNLINKED.
 */
export const SCAFFOLD_PLACEHOLDER_APP_ID = '<GENERATED-BY-AUTHENTICATED-SCAFFOLD>';

/** The exact object serialized into wix.config.example.json (frozen). */
export const EXAMPLE_PROJECT_CONFIG: Readonly<{
  projectType: string;
  appId: string;
}> = Object.freeze({
  projectType: 'app',
  appId: SCAFFOLD_PLACEHOLDER_APP_ID,
});

/**
 * Deterministic serialization of the committed template (2-space indent,
 * trailing newline). Tests pin the repository file byte-for-byte against this
 * output, so the template and the code cannot drift apart silently.
 */
export function serializeExampleProjectConfig(): string {
  return `${JSON.stringify(EXAMPLE_PROJECT_CONFIG, null, 2)}\n`;
}

/** Guard for documentation/tests: the template must never look linked. */
export function exampleProjectConfigIsUnlinkedByConstruction(): boolean {
  return looksLikeScaffoldPlaceholder(EXAMPLE_PROJECT_CONFIG.appId);
}
