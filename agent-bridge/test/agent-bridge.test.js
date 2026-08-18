import test from 'node:test';
import assert from 'node:assert/strict';

import { createGithubReader, parseAllowedRepos, GithubReadError } from '../src/github.js';
import { handleMcpPayload, SUPPORTED_PROTOCOL_VERSIONS, JSON_RPC_ERRORS } from '../src/mcp.js';
import { TOOL_LIST, callTool } from '../src/tools.js';
import worker from '../src/index.js';

const ALLOWED = 'cyo-ramadan/prototype-leker';

// Records every outbound call so tests can assert on verb and URL, which is
// where the read-only guarantee actually lives.
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers });
    const key = Object.keys(routes).find(route => url.startsWith(route));
    if (!key) return new Response('not found', { status: 404 });
    const entry = routes[key];
    const body = typeof entry === 'string' ? entry : JSON.stringify(entry);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

function reader(routes) {
  return createGithubReader({ token: 'test-token', allowedRepos: ALLOWED, fetchImpl: stubFetch(routes) });
}

test('parseAllowedRepos normalises separators and casing', () => {
  assert.deepEqual(parseAllowedRepos(' Owner/Repo , other/thing ,, '), ['owner/repo', 'other/thing']);
  assert.deepEqual(parseAllowedRepos(['A/B']), ['a/b']);
  assert.deepEqual(parseAllowedRepos(''), []);
});

test('a reader refuses to exist without an allowlist or token', () => {
  assert.throws(() => createGithubReader({ token: 't', allowedRepos: '' }), GithubReadError);
  assert.throws(() => createGithubReader({ token: '', allowedRepos: ALLOWED }), GithubReadError);
});

test('repositories outside the allowlist are rejected before any network call', async () => {
  const fetchImpl = stubFetch({});
  const client = createGithubReader({ token: 't', allowedRepos: ALLOWED, fetchImpl });
  await assert.rejects(
    () => client.getFile({ owner: 'someone', repo: 'private-thing', path: 'README.md' }),
    error => error instanceof GithubReadError && error.status === 403
  );
  assert.equal(fetchImpl.calls.length, 0, 'no request should reach GitHub for a disallowed repo');
});

test('getFile decodes base64 content', async () => {
  const client = reader({
    'https://api.github.com/repos/cyo-ramadan/prototype-leker/contents/README.md': {
      type: 'file',
      path: 'README.md',
      size: 11,
      sha: 'abc123',
      encoding: 'base64',
      content: Buffer.from('Hello Leker').toString('base64')
    }
  });
  const file = await client.getFile({ owner: 'cyo-ramadan', repo: 'prototype-leker', path: 'README.md' });
  assert.equal(file.content, 'Hello Leker');
  assert.equal(file.binary, false);
});

test('getFile flags binary payloads instead of returning mojibake', async () => {
  const client = reader({
    'https://api.github.com/repos/cyo-ramadan/prototype-leker/contents/logo.png': {
      type: 'file',
      path: 'logo.png',
      encoding: 'base64',
      content: Buffer.from([0x89, 0x50, 0x00, 0x1a]).toString('base64')
    }
  });
  const file = await client.getFile({ owner: 'cyo-ramadan', repo: 'prototype-leker', path: 'logo.png' });
  assert.equal(file.binary, true);
  assert.match(file.content, /binary/);
});

test('every GitHub request is a GET', async () => {
  const fetchImpl = stubFetch({
    'https://api.github.com/repos/cyo-ramadan/prototype-leker/branches': [
      { name: 'main', commit: { sha: 'aaa' }, protected: true }
    ]
  });
  const client = createGithubReader({ token: 't', allowedRepos: ALLOWED, fetchImpl });
  await client.listBranches({ owner: 'cyo-ramadan', repo: 'prototype-leker' });
  assert.ok(fetchImpl.calls.length > 0);
  for (const call of fetchImpl.calls) {
    assert.equal(call.method, 'GET');
    assert.ok(call.url.startsWith('https://api.github.com/'), `unexpected host: ${call.url}`);
  }
});

test('code search pins the repo qualifier so a crafted query cannot widen scope', async () => {
  const fetchImpl = stubFetch({ 'https://api.github.com/search/code': { total_count: 0, items: [] } });
  const client = createGithubReader({ token: 't', allowedRepos: ALLOWED, fetchImpl });
  await client.searchCode({
    owner: 'cyo-ramadan',
    repo: 'prototype-leker',
    query: 'password repo:someone-else/secrets'
  });
  const requested = new URL(fetchImpl.calls[0].url);
  assert.ok(requested.searchParams.get('q').endsWith(`repo:${ALLOWED}`));
});

test('the tool surface is read-only and has no escape hatch', () => {
  const names = TOOL_LIST.map(tool => tool.name);
  assert.ok(names.length >= 10);
  for (const name of names) {
    assert.match(name, /^github_(get|list|search)_/, `${name} is not a read verb`);
  }
  for (const tool of TOOL_LIST) {
    assert.ok(tool.description, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('unknown tools are rejected', async () => {
  await assert.rejects(() => callTool(reader({}), 'github_delete_everything', {}), GithubReadError);
});

test('initialize negotiates a supported protocol version', async () => {
  const response = await handleMcpPayload(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    reader({})
  );
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.equal(response.result.serverInfo.name, 'leker-agent-bridge');

  const fallback = await handleMcpPayload(
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    reader({})
  );
  assert.equal(fallback.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

test('tools/list is served over JSON-RPC', async () => {
  const response = await handleMcpPayload({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, reader({}));
  assert.equal(response.result.tools.length, TOOL_LIST.length);
});

test('notifications get no response body', async () => {
  const response = await handleMcpPayload(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    reader({})
  );
  assert.equal(response, null);
});

test('unknown methods return method-not-found', async () => {
  const response = await handleMcpPayload({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, reader({}));
  assert.equal(response.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
});

test('tool failures come back as readable tool errors, not transport errors', async () => {
  const response = await handleMcpPayload(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'github_get_file', arguments: { owner: 'nope', repo: 'nope', path: 'x' } }
    },
    reader({})
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /allowlist/);
  assert.equal(response.error, undefined);
});

test('a batch drops notifications and keeps real responses', async () => {
  const response = await handleMcpPayload(
    [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 6, method: 'ping' }
    ],
    reader({})
  );
  assert.equal(response.length, 1);
  assert.equal(response[0].id, 6);
});

// --- Worker HTTP surface -----------------------------------------------------

const ENV = {
  MCP_AUTH_TOKEN: 'super-secret-token',
  GITHUB_TOKEN: 'gh-token',
  ALLOWED_REPOS: ALLOWED
};

function post(path, body, headers = {}) {
  return worker.fetch(
    new Request(`https://bridge.example.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    ENV
  );
}

test('MCP endpoint rejects a missing or wrong token', async () => {
  assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  assert.equal(
    (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer wrong' })).status,
    401
  );
  assert.equal((await post('/mcp/wrong-token', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
});

test('MCP endpoint accepts the token as a bearer header or a path segment', async () => {
  const viaHeader = await post(
    '/mcp',
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { authorization: `Bearer ${ENV.MCP_AUTH_TOKEN}` }
  );
  assert.equal(viaHeader.status, 200);

  const viaPath = await post(`/mcp/${ENV.MCP_AUTH_TOKEN}`, { jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.equal(viaPath.status, 200);
});

test('an unconfigured bridge fails closed rather than serving anonymously', async () => {
  const response = await worker.fetch(
    new Request('https://bridge.example.com/mcp', { method: 'POST', body: '{}' }),
    { GITHUB_TOKEN: 'x', ALLOWED_REPOS: ALLOWED }
  );
  assert.equal(response.status, 500);
});

test('health and root need no token and leak no secrets', async () => {
  const health = await worker.fetch(new Request('https://bridge.example.com/health'), ENV);
  assert.equal(health.status, 200);

  const root = await worker.fetch(new Request('https://bridge.example.com/'), ENV);
  const body = await root.text();
  assert.equal(root.status, 200);
  assert.ok(!body.includes(ENV.MCP_AUTH_TOKEN));
  assert.ok(!body.includes(ENV.GITHUB_TOKEN));
});

test('notifications over HTTP answer 202 with no body', async () => {
  const response = await post(
    '/mcp',
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { authorization: `Bearer ${ENV.MCP_AUTH_TOKEN}` }
  );
  assert.equal(response.status, 202);
});

test('non-POST verbs are refused on the MCP endpoint', async () => {
  const response = await worker.fetch(
    new Request(`https://bridge.example.com/mcp/${ENV.MCP_AUTH_TOKEN}`, { method: 'GET' }),
    ENV
  );
  assert.equal(response.status, 405);
});
