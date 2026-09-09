import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { applyConfirmedRules } from '../../extensions/backend/runtime/schedule-mutation-runtime';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const token = await auth.getTokenInfo();
    if (!token?.instanceId) return json({ error: 'UNAUTHENTICATED' }, 401);

    const body = await request.json();
    const confirmedDiffHash = typeof body?.confirmedDiffHash === 'string' ? body.confirmedDiffHash.trim() : '';
    if (!confirmedDiffHash) return json({ error: 'CONFIRMATION_REQUIRED' }, 400);

    const summary = await applyConfirmedRules(token.instanceId, confirmedDiffHash);
    return json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'NO_DRAFT_RULESET') return json({ error: 'NO_SAVED_DRAFT' }, 409);
    if (message.startsWith('CONFIRMED_DIFF_MISMATCH:')) {
      return json({ error: 'CONFIRMED_DIFF_MISMATCH', currentDiffHash: message.slice('CONFIRMED_DIFF_MISMATCH:'.length) }, 409);
    }
    console.error('POST /api/apply-plan failed', error);
    return json({ error: 'APPLY_FAILED' }, 500);
  }
};
