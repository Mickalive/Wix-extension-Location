# Rules Engine Lane

Do not build until `docs/state.json.phase` is `build`.

Priority once build begins:
- define pure typed rule/configuration models;
- weekly hours by location and by service;
- multiple windows per day;
- date-specific exceptions and closures;
- precedence/conflict rules;
- booking count limits and duplicate-rule semantics only where the Technical Contract supports enforcement;
- explainable allow/block outcomes;
- exhaustive deterministic tests including boundaries, conflicts and timezone/DST inputs.

No Wix SDK import is allowed in the domain core. If a rule cannot be enforced with verified Wix integration, model it only when useful for a disabled future capability and never expose it as active production functionality.
