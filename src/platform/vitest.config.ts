import { defineConfig } from 'vitest/config';

/**
 * Credential-free unit test configuration (Technical Contract section 8).
 *
 * Lives inside the integration lane's owned path because the workflow shell
 * reserves the repository root; `npm run test:unit` points here explicitly via
 * `--config`. Requirements:
 * - runs with zero Wix credentials and no network access,
 * - node environment only; every clock/zone is injected via domain ports,
 * - deterministic: no global timers, no random seeds, no parallel-order coupling.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    reporters: ['default'],
    passWithNoTests: false,
    watch: false,
  },
});
