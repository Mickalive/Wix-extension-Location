# Wix Technical Contract

Status: **UNVERIFIED — RECONNAISSANCE REQUIRED**

This file is intentionally a placeholder. The autonomous product builders must not infer production capabilities from it until `wix-recon-director` replaces it with an independently audited contract and advances `docs/state.json.phase` to `build`.

Known starting evidence to verify, not blindly trust:
- Use the current unified Wix CLI rather than deprecated Wix CLI for Apps.
- Wix dashboard extensions can provide the configuration UI.
- Wix Bookings integrates with Calendar schedules/events and staff working-hour schedules.
- Some newer Bookings service-plugin capabilities may be Developer Preview and therefore unsuitable for a production Marketplace path.
- Wix supports recurring app pricing and handles checkout, but entitlement enforcement remains app responsibility.
- CI authentication may require a Wix API key and account/app binding; account-specific identifiers must not be invented.

The recon team must replace this page with sourced, dated, feature-by-feature technical truth.
