#!/usr/bin/env node
import readline from 'node:readline';

const API_KEY = process.env.WIX_API_KEY || '';
const SITE_ID = process.env.WIX_SITE_ID || '';
const BASE = 'https://www.wixapis.com';
const MAX_BODY = 12000;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function textContent(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

const allowed = new Map([
  ['POST /_api/bookings/v2/services/query', { defaultBody: { query: { paging: { limit: 1 } } } }],
  ['POST /_api/bookings/v2/services/count', { defaultBody: {} }],
]);

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return '';
  const value = endpoint.trim();
  try {
    if (/^https?:\/\//i.test(value)) {
      const u = new URL(value);
      if (u.hostname !== 'www.wixapis.com') return '';
      return `${u.pathname}${u.search}`;
    }
  } catch {}
  return value.startsWith('/') ? value : `/${value}`;
}

async function callWixSiteApi(args = {}) {
  if (!API_KEY || !SITE_ID) {
    return textContent('Wix CI bridge is missing WIX_API_KEY or WIX_SITE_ID.', true);
  }
  const method = String(args.method || 'POST').toUpperCase();
  const endpoint = normalizeEndpoint(args.endpoint || '/_api/bookings/v2/services/query');
  const key = `${method} ${endpoint.split('?')[0]}`;
  const rule = allowed.get(key);
  if (!rule) {
    return textContent(`Denied by read-only Wix CI policy: ${key}.`, true);
  }
  const body = args.body ?? rule.defaultBody;
  let response;
  try {
    response = await fetch(`${BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: API_KEY,
        'wix-site-id': SITE_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return textContent(`Wix API transport failure: ${e?.message || String(e)}`, true);
  }
  const raw = await response.text();
  const clipped = raw.length > MAX_BODY ? `${raw.slice(0, MAX_BODY)}…` : raw;
  const summary = JSON.stringify({
    siteId: SITE_ID,
    method,
    endpoint,
    status: response.status,
    ok: response.ok,
    response: clipped,
  }, null, 2);
  return textContent(summary, !response.ok);
}

const tools = [
  {
    name: 'CallWixSiteAPI',
    description: 'Read-only Wix site API bridge for CI. Only whitelisted Wix Bookings query/count endpoints are allowed. Never exposes credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['POST'], default: 'POST' },
        endpoint: { type: 'string', enum: ['/_api/bookings/v2/services/query', '/_api/bookings/v2/services/count'], default: '/_api/bookings/v2/services/query' },
        body: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'WixLiveProbe',
    description: 'Verify that the configured development site is reachable through Wix Bookings using API-key site-level authentication.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params } = message;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'wix-ci-readonly', version: '1.0.0' },
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'ping') {
    if (id !== undefined) result(id, {});
    return;
  }
  if (method === 'tools/list') {
    result(id, { tools });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    if (name === 'CallWixSiteAPI') {
      result(id, await callWixSiteApi(params?.arguments || {}));
      return;
    }
    if (name === 'WixLiveProbe') {
      result(id, await callWixSiteApi({ method: 'POST', endpoint: '/_api/bookings/v2/services/query', body: { query: { paging: { limit: 1 } } } }));
      return;
    }
    error(id, -32601, `Unknown tool: ${name}`);
    return;
  }
  if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try { message = JSON.parse(trimmed); }
  catch { return; }
  Promise.resolve(handle(message)).catch((e) => {
    if (message?.id !== undefined) error(message.id, -32603, e?.message || String(e));
  });
});
