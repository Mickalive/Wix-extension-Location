import { extensions } from '@wix/astro/builders'
import config from './diff-confirm.config.ts';

export default extensions.dashboardModal({
  id: '99986b6c-de1f-4345-b063-fadf65fda76f',
  title: config.title,
  width: config.width,
  height: config.height,
  component: './extensions/dashboard/modals/diff-confirm/diff-confirm.tsx',
});
