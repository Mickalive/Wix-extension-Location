import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import type { ScheduleScope } from '../../domain/ports';
import { recoverScheduleScope } from '../../extensions/backend/runtime/schedule-mutation-runtime';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function parseScope(value: unknown): ScheduleScope | null {
  if (!value || typeof value !== 'object') return null;
  const scope = value as Record<string, unknown>;
  if (typeof scope.scheduleId !== 'string' || !scope.scheduleId.trim()) return null;
  if (scope.ownerType !== 'STAFF' && scope.ownerType !== 'BUSINESS') return null;
  if (typeof scope.ownerId !== 'string' || !scope.ownerId.trim()) return null;
  return {
    scheduleId: scope.scheduleId,
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const token = await auth.getTokenInfo();
    if (!token?.instanceId) return json({ error: 'UNAUTHENTICATED' }, 401);
    const body = await request.json();
    const scope = parseScope(body?.scope);
    if (!scope) return json({ error: 'SCOPE_REQUIRED' }, 400);

    const recovery = await recoverScheduleScope(token.instanceId, scope);
    return json({ recovery });
  } catch (error) {
    console.error('POST /api/recover failed', error);
    return json({ error: 'RECOVERY_FAILED' }, 500);
  }
};
