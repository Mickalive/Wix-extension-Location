import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { loadState, saveState } from '../../extensions/backend/runtime/state-store';

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

    const draft = await loadState<Record<string, any>>(token.instanceId, 'draft-ruleset');
    if (!draft) return json({ error: 'NO_SAVED_DRAFT' }, 409);

    const planId = crypto.randomUUID();
    const activated = { ...draft, activatedAt: new Date().toISOString(), confirmedDiffHash };
    await saveState(token.instanceId, 'active-ruleset', 'active-ruleset', activated);

    const status = {
      planId,
      state: 'APPLY_COMPLETED',
      scope: { type: 'RULESET', id: draft.ruleSetId ?? 'advanced-booking-rules' },
      confirmedChangeIds: [confirmedDiffHash],
      totalChanges: 1,
      updatedAt: new Date().toISOString(),
      snapshotId: null,
    };
    await saveState(token.instanceId, `mutation-${planId}`, 'mutation', status);
    return json({ summary: status });
  } catch (error) {
    console.error('POST /api/apply-plan failed', error);
    return json({ error: 'APPLY_FAILED' }, 500);
  }
};
