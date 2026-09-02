import { extensions } from '@wix/astro/builders'

export default extensions.bookingsValidationProvider({
  id: 'e13bc3cb-956c-445f-a6f6-83b52e4fdc8b',
  name: 'booking-validation',
  source: './extensions/backend/service-plugins/booking-validation/booking-validation.ts',
  validationTargets: [
    { method: 'CREATE' },
    { method: 'CANCEL' },
    { method: 'RESCHEDULE' },
    { method: 'CREATE_MULTI_SERVICE' },
    { method: 'CANCEL_MULTI_SERVICE' },
    { method: 'RESCHEDULE_MULTI_SERVICE' },
  ],
});
