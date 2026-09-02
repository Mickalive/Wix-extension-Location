import { app } from '@wix/astro/builders';

import advancedBookingRules from './extensions/dashboard/pages/advanced-booking-rules/advanced-booking-rules.extension.ts';

import advancedBookingRulesUsage from './extensions/dashboard/pages/advanced-booking-rules-usage/advanced-booking-rules-usage.extension.ts';

import diffConfirm from './extensions/dashboard/modals/diff-confirm/diff-confirm.extension.ts';

import bookingConfirmed from './extensions/backend/events/booking-confirmed/booking-confirmed.extension.ts';

import bookingCanceled from './extensions/backend/events/booking-canceled/booking-canceled.extension.ts';

export default app().use(advancedBookingRules).use(advancedBookingRulesUsage).use(diffConfirm).use(bookingConfirmed).use(bookingCanceled);