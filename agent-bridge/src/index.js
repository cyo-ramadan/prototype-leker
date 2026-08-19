// Cloudflare Worker entrypoint for the read-only GitHub MCP bridge.
//
// The endpoint is protected by MCP_AUTH_TOKEN. Some MCP clients let you set an
// Authorization header and some only accept a URL, so the token is accepted
// either as a bearer header or as the last path segment.

import { createGithubReader, GithubReadError } from './github.js';
import { handleMcpPayload, SERVER_INFO } from './mcp.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id'
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extraHeaders }
  });
}

// Compares without leaking length or position through timing.
function secretsMatch(candidate, expected) {
  const a = String(candidate || '');
  const b = String(expected || '');
  if (!b) return false;
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= a.charCodeAt(index % (a.length || 1)) ^ b.charCodeAt(index % (b.length || 1));
  }
  return mismatch === 0;
}

function presentedToken(request, url) {
  const header = request.headers.get('authorization') || '';
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 1 && segments[0] === 'mcp') return segments[segments.length - 1];
  return '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, server: SERVER_INFO.name });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return json({
        server: SERVER_INFO,
        transport: 'streamable-http',
        endpoint: 'POST /mcp',
        access: 'read-only',
        note: 'Add this endpoint as a custom connector in claude.ai. Authentication is required.'
      });
    }

    if (!url.pathname.startsWith('/mcp')) {
      return json({ error: 'Not found' }, 404);
    }

    if (!env.MCP_AUTH_TOKEN) {
      return json({ error: 'Bridge is not configured: MCP_AUTH_TOKEN is unset' }, 500);
    }
    if (!secretsMatch(presentedToken(request, url), env.MCP_AUTH_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401, { 'www-authenticate': 'Bearer' });
    }

    if (request.method !== 'POST') {
      return json({ error: 'MCP requests must use POST' }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }, 400);
    }

    let reader;
    try {
      reader = createGithubReader({
        token: env.GITHUB_TOKEN,
        allowedRepos: env.ALLOWED_REPOS
      });
    } catch (error) {
      const status = error instanceof GithubReadError ? error.status : 500;
      return json({ error: error.message }, status);
    }

    const response = await handleMcpPayload(payload, reader);
    if (response === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(response);
  }
};
