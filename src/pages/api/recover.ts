import type { APIRoute } from 'astro';
import { auth } from '@wix/essentials';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export const POST: APIRoute = async () => {
  try {
    const token = await auth.getTokenInfo();
    if (!token?.instanceId) return json({ error: 'UNAUTHENTICATED' }, 401);
    // Activation is a single Wix Data upsert, so there is no partial schedule
    // mutation to roll back. A recovery request is therefore explicitly a no-op.
    return json({ recovery: null });
  } catch (error) {
    console.error('POST /api/recover failed', error);
    return json({ error: 'RECOVERY_FAILED' }, 500);
  }
};
