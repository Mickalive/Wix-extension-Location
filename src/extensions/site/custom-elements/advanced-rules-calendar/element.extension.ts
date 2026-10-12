import { extensions } from '@wix/astro/builders';

export default extensions.customElement({
  id: 'f6343568-4fc5-42ef-a1e1-6ea37650d98f',
  name: 'Advanced Rules Calendar',
  tagName: 'advanced-rules-calendar',
  element: './extensions/site/custom-elements/advanced-rules-calendar/element.tsx',
  width: {
    defaultWidth: 980,
    stretchByDefault: true,
    allowStretch: true,
  },
  height: {
    defaultHeight: 720,
  },
  installation: {
    // @wix/astro 2.x still exposes autoAdd. Wix's current docs deprecate it in
    // favor of staticContainer, which requires the separate 3.x framework
    // migration. Keep the supported 2.x shape until that migration is done.
    autoAdd: true,
  },
  presets: [
    {
      id: 'd0a6f7bb-9d83-4c99-a588-25efb1d63b6a',
      name: 'Booking calendar',
      thumbnailUrl: '{{BASE_URL}}/public/advanced-rules-calendar-thumbnail.png',
    },
  ],
});
