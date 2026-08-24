# Billing & Entitlements Lane

Do not build until `docs/state.json.phase` is `build`.

All paid tiers expose the same features. Entitlement changes only the maximum number of managed active Wix Bookings locations.

Target tiers:
- 1 location: $9.99/month
- up to 3: $19.99/month
- up to 10: $34.99/month
- 11+: $49.99/month

Implement only the Wix billing/instance mechanism validated by the Technical Contract. Define active billable location exactly and test edge cases. On downgrade/over-limit, preserve customer configuration; never delete it. Fail safely on unknown billing state and provide an explicit upgrade requirement rather than silently over-serving or corrupting state.
