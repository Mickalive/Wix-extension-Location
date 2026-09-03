import type { DataCollection } from '@wix/astro/builders';

export const collectionIdSuffix = 'abr-state';

export default {
  idSuffix: collectionIdSuffix,
  displayName: 'Advanced Booking Rules State',
  fields: [
    { type: 'TEXT', displayName: 'Kind', key: 'kind' },
    { type: 'TEXT', displayName: 'Instance ID', key: 'instanceId' },
    {
      type: 'OBJECT',
      displayName: 'Payload',
      key: 'payload',
      objectOptions: { fields: [] },
    },
    { type: 'DATETIME', displayName: 'Updated At', key: 'updatedAt' },
  ],
  displayField: 'kind',
  dataPermissions: {
    itemInsert: 'PRIVILEGED',
    itemRead: 'PRIVILEGED',
    itemRemove: 'PRIVILEGED',
    itemUpdate: 'PRIVILEGED',
  },
  indexes: [
    { fields: [{ path: 'instanceId', order: 'ASC' }] },
    { fields: [{ path: 'kind', order: 'ASC' }] },
  ],
  initialData: [],
} satisfies DataCollection;
