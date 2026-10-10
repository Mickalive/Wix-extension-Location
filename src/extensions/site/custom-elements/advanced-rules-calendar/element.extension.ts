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
    autoAdd: true,
  },
});
