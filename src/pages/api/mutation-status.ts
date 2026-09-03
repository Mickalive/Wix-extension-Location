import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { loadState } from '../../extensions/backend/runtime/state-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const token = await auth.getTokenInfo();
    if (!token?.instanceId) return json({ error: 'UNAUTHENTICATED' }, 401);
    const planId = new URL(request.url).searchParams.get('planId')?.trim();
    if (!planId) return json({ error: 'PLAN_ID_REQUIRED' }, 400);
    const status = await loadState(token.instanceId, `mutation-${planId}`);
    if (!status) return json({ error: 'NOT_FOUND' }, 404);
    return json({ status });
  } catch (error) {
    console.error('GET /api/mutation-status failed', error);
    return json({ error: 'MUTATION_STATUS_FAILED' }, 500);
  }
};
