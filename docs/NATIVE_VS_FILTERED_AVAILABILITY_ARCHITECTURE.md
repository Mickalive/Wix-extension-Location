# Advanced Booking Rules — Native vs Filtered Availability Architecture

Date: 2026-10-10

## Problem discovered in the real Wix sandbox

The rules engine and Wix Bookings validation plugin correctly block bookings that violate an active rule. However, Wix's native booking calendar can still display a class session as bookable before the customer attempts to book it.

Concrete proof on Abr Ci Sandbox:
- Active rule: Restorative on Monday is allowed only from 12:00 to 13:00.
- Wix native class schedule still displayed the Monday 20:00 Restorative session with a Book button.
- A direct Create Booking attempt for that exact event was rejected by Wix with VALIDATION_FAILED.
- Therefore enforcement works, but discovery/display and enforcement can disagree.

This is unacceptable as the default customer experience.

## Core architectural rule

Do not promise that every Advanced Booking Rule can be represented inside Wix's native availability model.

Split rules into two execution paths:

1. Native-compatible rules
   - Translate the rule into Wix scheduling / booking-policy primitives when Wix provides an exact semantic equivalent.
   - The Wix native calendar then reflects the restriction before the visitor attempts to book.
   - Keep validation-plugin enforcement as defense in depth.

2. Advanced-only rules
   - Do not mutate Wix data into a semantically different concept merely to influence display.
   - Filter availability in an Advanced Booking Rules customer-facing schedule/calendar widget.
   - Keep validation-plugin enforcement as the final authoritative gate.
   - If a merchant chooses to keep using the native Wix calendar, label that mode explicitly as validation-only for advanced-only rules.

## Why service type alone is not the complete split

### Classes

A class availability item is an already-created Wix Calendar event/session.

A service weekly window such as "Monday 12:00–13:00 only" can make an existing Monday 20:00 class session invalid for new booking, but that does NOT mean:
- cancel the class,
- delete the event,
- move the class,
- notify existing participants,
- or otherwise change the session itself.

Using Calendar Cancel Event to hide such a session would conflate "do not accept new bookings under this advanced rule" with "the class no longer exists". That is destructive and semantically wrong.

Wix's Availability Time Slots Configuration service plugin supports appointment-based services, not class sessions. Class sessions are exposed through List Event Time Slots.

Therefore arbitrary class-session restrictions require a filtered visitor-facing surface if we want display and enforcement to agree.

### Appointments

Appointments are computed availability rather than pre-existing class events, but the Availability Time Slots Configuration service plugin does not provide arbitrary weekly service-opening windows. It configures duration, split interval, buffers, locations, and required resources.

Some advanced rules can nevertheless be represented through Wix schedules, locations, resources, staff working hours, or booking policies. Those rules should be mirrored only when the mapping is exact.

Service-specific weekly windows, arbitrary exceptions, and count-based restrictions may still have no exact native Wix representation. They therefore also need the filtered calendar for a fully coherent customer experience.

## Product architecture

### Layer 1 — Rule model

One canonical RuleSet remains the source of truth:
- location weekly windows
- service weekly windows
- dated exceptions
- booking limits
- duplicate protection / other validation families

The domain evaluator remains deterministic and service-type agnostic where the semantics are truly shared.

### Layer 2 — Native projection

At activation, classify every rule/change as one of:

- NATIVE_EXACT
  Exact Wix primitive exists. Safe to mirror.

- FILTER_REQUIRED
  No exact Wix primitive exists. Do not distort Wix state to simulate it.

- VALIDATION_ONLY_FALLBACK
  Used when the merchant has not installed/selected the Advanced Rules customer-facing schedule. The rule remains enforced at booking time, but the dashboard must warn that Wix's native calendar may still show blocked options.

Projection must be reversible and journaled.

### Layer 3 — Customer-facing availability

Create an Advanced Booking Rules site widget/custom element in the SAME Wix app.

The widget:
- reads Wix Bookings services and time slots;
- evaluates every returned appointment/class slot against the active RuleSet;
- hides slots that would be blocked;
- shows only visitor-bookable options;
- sends the chosen slot/session into the Wix booking flow;
- never treats a hidden class as a cancelled class;
- is responsive and visually compatible with Wix sites.

For classes:
- source = List Event Time Slots.
- filter returned event slots with the RuleSet.
- visitor never sees a Book action for an event the validation plugin will later reject.

For appointments:
- source = List Availability Time Slots.
- Wix-native scheduling restrictions apply first.
- Advanced-only rules filter the remaining slots.
- validator rechecks before creation.

### Layer 4 — Validation plugin

The existing Bookings Validation service plugin remains authoritative.

Why keep it when the widget filters first?
- visitors or integrations can bypass the widget;
- native Wix pages may remain present;
- direct API calls are possible;
- stale UI data is possible;
- race conditions and booking counts must be checked at create time.

The widget improves UX. The validator provides integrity.

## Merchant modes

### Recommended: Advanced Rules Calendar

Dashboard status:
"Visitors see only slots allowed by your advanced rules."

Merchant adds the Advanced Booking Rules schedule widget/page and uses it as the booking calendar entry point.

This is the full product experience.

### Compatibility: Native Wix Calendar

Dashboard status:
"Bookings are protected, but Wix may still display some options that Advanced Booking Rules will reject."

This is a fallback, not the recommended finished state.

Never describe this mode simply as "rules active" without the display caveat.

## Dashboard UX changes

The dashboard must stop presenting all service windows identically.

For each selected service show its type and effect:

APPOINTMENT
"Control calculated appointment availability."
Then indicate whether each configured rule is:
- reflected in Wix;
- filtered by Advanced Rules Calendar;
- validation-only in native-calendar compatibility mode.

CLASS
"Control which existing class sessions customers may book."
Do not call this "opening hours" without explanation. A class session already exists.
Use language such as:
"Allow bookings for sessions occurring during these times."

When the Advanced Rules Calendar widget is not installed/configured, show a clear setup state:
"Your rules are enforced, but the native Wix class calendar can still display blocked sessions. Add the Advanced Rules Calendar to hide them before customers click Book."

## Error / state communication rule

Every warning or error shown in the dashboard must explain:
1. what happened;
2. where it happened;
3. what effect it has;
4. what the merchant should do.

No internal IDs, rule paths, mutation states, or implementation jargon in normal UI.

## What must NOT be done

- Do not cancel class events merely to make them disappear from availability.
- Do not delete or recreate Bookings sessions to simulate a booking rule.
- Do not claim the native Wix calendar is filtered when only validation is active.
- Do not silently fall back from full filtering to validation-only.
- Do not maintain two independent rule engines for dashboard/widget/plugin.
- Do not remove the validation plugin once the widget exists.

## Recommended implementation order

1. Make dashboard service-type aware and expose native-vs-filtered enforcement status.
2. Add a read-only backend availability endpoint that returns Wix slots plus the canonical rule decision for each slot.
3. Build the Advanced Rules Calendar custom-element site widget in the current Wix CLI app.
4. Implement class display filtering first (current sandbox is all CLASS, giving a strong end-to-end fixture).
5. Route selected allowed class sessions into the Wix booking flow.
6. Add appointment support.
7. Add widget/install-state detection and onboarding.
8. Only then consider deeper native projection for additional rule families where Wix offers exact primitives.

## Acceptance test

For the current sandbox:

Given:
- Restorative Monday allowed only 12:00–13:00.
- Wix Calendar contains Restorative Monday 20:00.

Native compatibility mode:
- native Wix page may show 20:00;
- booking attempt is rejected;
- dashboard explicitly says native display is not filtered.

Advanced Rules Calendar mode:
- 20:00 does not appear at all;
- allowed sessions appear;
- any direct attempt to bypass the widget is still rejected by validation.

This is the target product contract.
