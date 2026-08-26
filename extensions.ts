/**
 * Unified Wix CLI extension registration anchor (documented app-project
 * layout: reports/recon/PLATFORM.md §3, source S4; Blueprint §1 notes this
 * file is CLI-owned inside the unified-CLI project tree).
 *
 * INTENTIONALLY EMPTY (INT-C6-R1): there is nothing to register yet, because
 * every extension of this product is generated or configured at the
 * authenticated one-time scaffold (empirical gate T-VP0; Technical Contract
 * §15/§16). This file establishes the documented project-layout anchor
 * WITHOUT fabricating extension IDs or generated entries. The PLANNED
 * registration surface — each extension kind, its registration channel and
 * its status — is declared in src/platform/registration/extensionsManifest.ts.
 *
 * At scaffold time the unified CLI owns/regenerates the generated entries in
 * this file; merge per docs/runbooks/T_VP0_SCAFFOLD.md.
 */

/**
 * A real generated extension entry as produced by the unified Wix CLI.
 * `extensionId` originates ONLY from the authenticated scaffold — it must
 * never be hand-written, guessed or copied from documentation.
 */
export interface GeneratedExtensionEntry {
  readonly extensionId: string;
  readonly kind: string;
}

/**
 * Generated-extension registry. Empty by design until the authenticated
 * scaffold creates real extensions (gate T-VP0); frozen so nothing can be
 * appended without replacing this scaffold-owned file deliberately.
 */
export const EXTENSIONS: readonly GeneratedExtensionEntry[] = Object.freeze([]);
