import { app } from '@wix/astro/builders';

import advancedBookingRules from './extensions/dashboard/pages/advanced-booking-rules/advanced-booking-rules.extension.ts';
import advancedBookingRulesUsage from './extensions/dashboard/pages/advanced-booking-rules-usage/advanced-booking-rules-usage.extension.ts';
import diffConfirm from './extensions/dashboard/modals/diff-confirm/diff-confirm.extension.ts';
import dataCollections from './extensions/backend/data-collections/data-collections.extension.ts';
import bookingValidation from './extensions/backend/service-plugins/booking-validation/booking-validation.extension.ts';

export default app()
  .use(advancedBookingRules)
  .use(advancedBookingRulesUsage)
  .use(diffConfirm)
  .use(dataCollections)
  .use(bookingValidation);
