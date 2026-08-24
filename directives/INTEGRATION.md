# Integration Lane

Do not build until `docs/state.json.phase` is `build`.

Priority once build begins:
- establish the exact Wix CLI project scaffold validated by reconnaissance;
- implement typed Wix adapters and safe persistence boundaries;
- list/count relevant Wix Bookings locations and services;
- read the schedules/events needed for advanced availability;
- implement mutation planning with idempotency, rollback and no silent destruction;
- expose stable interfaces to the domain, dashboard and billing lanes;
- keep Preview-only APIs disabled from the publishable path.

Never fabricate `wix.config.json`, app IDs, project IDs or credentials. If account binding is required, leave the code/test harness complete and document the minimum external prerequisite.
