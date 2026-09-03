import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';
import { validateRuleSetStructure } from '../../platform/http/ruleSetEndpoints';
import { loadState, saveState } from '../../extensions/backend/runtime/state-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function instanceId(): Promise<string> {
  const info = await auth.getTokenInfo();
  if (!info?.instanceId) throw new Error('Missing authenticated Wix app instance.');
  return info.instanceId;
}

export const GET: APIRoute = async () => {
  try {
    const id = await instanceId();
    const draft = await loadState<Record<string, unknown>>(id, 'draft-ruleset');
    const active = draft ?? (await loadState<Record<string, unknown>>(id, 'active-ruleset'));
    return json({ ruleSet: active });
  } catch (error) {
    console.error('GET /api/ruleset failed', error);
    return json({ error: 'RULESET_READ_FAILED' }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const id = await instanceId();
    const body = await request.json();
    const proposed = body?.ruleSet;
    const expectedRevision = typeof body?.expectedRevision === 'string' ? body.expectedRevision : 'new';
    const issues = validateRuleSetStructure(proposed);
    if (issues.length > 0) return json({ error: 'VALIDATION_FAILED', issues }, 400);

    const previous =
      (await loadState<Record<string, any>>(id, 'draft-ruleset')) ??
      (await loadState<Record<string, any>>(id, 'active-ruleset'));
    if (previous && expectedRevision !== previous.revision) {
      return json({ error: 'REVISION_CONFLICT', currentRevision: previous.revision }, 409);
    }
    if (!previous && expectedRevision !== 'new') {
      return json({ error: 'REVISION_CONFLICT', currentRevision: null }, 409);
    }

    const saved = {
      ...proposed,
      revision: crypto.randomUUID(),
      version: Math.max(1, Number(proposed.version ?? 1)),
    };
    await saveState(id, 'draft-ruleset', 'draft-ruleset', saved);
    return json({ ruleSet: saved });
  } catch (error) {
    console.error('PUT /api/ruleset failed', error);
    return json({ error: 'RULESET_SAVE_FAILED' }, 500);
  }
};
