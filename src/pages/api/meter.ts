import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { loadState } from '../../extensions/backend/runtime/state-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const GET: APIRoute = async () => {
  try {
    const token = await auth.getTokenInfo();
    if (!token?.instanceId) return json({ error: 'UNAUTHENTICATED' }, 401);
    const ruleSet =
      (await loadState<Record<string, any>>(token.instanceId, 'draft-ruleset')) ??
      (await loadState<Record<string, any>>(token.instanceId, 'active-ruleset'));
    const ids = Object.keys(ruleSet?.locationWindows ?? {}).sort();
    return json({
      meter: { count: ids.length, degraded: false },
      coverage: {
        allowedLocationIds: ids,
        overLimit: false,
        degraded: true,
        warning: 'Plan billing is not yet authoritative on this sandbox; booking-rule enforcement remains active for configured locations.',
      },
    });
  } catch (error) {
    console.error('GET /api/meter failed', error);
    return json({ error: 'METER_FAILED' }, 500);
  }
};
