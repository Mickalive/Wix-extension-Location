# Authenticated Wix app binding

GitHub Actions authenticated with the protected Wix API key and bound the product to the explicitly selected existing Wix app **Advanced Booking Rules** (App ID: 3e9ec3af-001b-4684-a197-a5133677844d). No app was created by this run.

Wix generated a real wix.config.json for that exact app and a real `wix build` completed successfully before the binding was persisted. The create-new scaffold may emit a known auxiliary Wix agent-skills installation failure in CI; that failure is accepted only after validating the real appId/projectId/projectType and is not treated as product evidence. The subsequent real `wix build` remains mandatory.

Persisted wix.config.json fields: appId, projectId, projectType

No API key, account auth store, token, password, patched Wix package, or other credential was persisted.
