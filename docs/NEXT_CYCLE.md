# NEXT CYCLE — authenticated Wix binding

Run 32920420147 is recovered as accepted product progress: Integration audit ACCEPT, integrated audit ACCEPT, deterministic checks green, Rules/Dashboard/Billing complete.

The remaining active work is Integration only. The repository already contains every scaffold/registration artifact that can be derived without a real Wix binding. The GitHub Actions secret `WIX_API_KEY` is available to the privileged CI bootstrap and must never be exposed to OX or committed.

Next objective: create the real Wix app binding with authenticated Wix tooling, persist only the generated non-secret `wix.config.json` metadata, then let the normal Wix Live stage execute `wix build`, Development Site resolution and MCP-backed empirical checks. If Wix itself rejects the bootstrap because the API key lacks an account-level permission or requires a human-only choice, record that exact blocker rather than inventing IDs or redoing unrelated product work.

Rules, Dashboard and Billing stay complete.
