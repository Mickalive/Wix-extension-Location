import { extensions } from '@wix/astro/builders'

import abrStateCollection from './abr-state';

export default extensions.dataCollections({
  id: '7c29c6e9-2cb6-4e2b-b306-7775e72dd0ef',
  name: 'Data Collections',
  collections: [abrStateCollection],
});
