import { items } from '@wix/data';
import { auth } from '@wix/essentials';

const COLLECTION_ID = '@mickaelvuilleumier/advanced-booking-rules/abr-state';

export type RuntimeStateKind = 'draft-ruleset' | 'active-ruleset' | 'mutation' | 'degradation';

export interface RuntimeStateItem<T = unknown> {
  _id: string;
  kind: RuntimeStateKind;
  instanceId: string;
  payload: T;
  updatedAt: string;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 120);
}

export function stateItemId(instanceId: string, key: string): string {
  return safeId(`${instanceId}-${key}`);
}

function isMissingItem(error: any): boolean {
  const code = error?.details?.applicationError?.code ?? error?.code;
  return code === 'ITEM_NOT_FOUND' || code === 'WDE0073';
}

export async function loadState<T>(instanceId: string, key: string): Promise<T | null> {
  const id = stateItemId(instanceId, key);
  const elevatedGet = auth.elevate(items.get);
  try {
    const item = await elevatedGet(COLLECTION_ID, id, { consistentRead: true });
    if (!item || typeof item !== 'object' || !('payload' in item)) return null;
    return (item as RuntimeStateItem<T>).payload ?? null;
  } catch (error: any) {
    if (isMissingItem(error)) return null;
    throw error;
  }
}

export async function saveState<T>(
  instanceId: string,
  key: string,
  kind: RuntimeStateKind,
  payload: T,
): Promise<T> {
  const item: RuntimeStateItem<T> = {
    _id: stateItemId(instanceId, key),
    kind,
    instanceId,
    payload,
    updatedAt: new Date().toISOString(),
  };
  const elevatedSave = auth.elevate(items.save);
  await elevatedSave(COLLECTION_ID, item);
  return payload;
}
