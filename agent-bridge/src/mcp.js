// Minimal MCP server over JSON-RPC 2.0, shaped for the Streamable HTTP
// transport: the client POSTs a request and gets a plain JSON response.
// Notifications carry no id and get no body, only HTTP 202.

import { GithubReadError } from './github.js';
import { TOOL_LIST, callTool } from './tools.js';

export const SERVER_INFO = { name: 'leker-agent-bridge', version: '1.0.0' };
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const JSON_RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603
};

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function fail(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
}

async function handleSingleMessage(message, reader) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 message');
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (typeof method !== 'string') {
    return isNotification ? null : fail(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing "method"');
  }

  // Notifications never get a response body, whatever they are.
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Read-only GitHub access for allowlisted repositories. Every tool is a read; this bridge cannot commit, push, comment, or merge.'
      });

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOL_LIST });

    case 'tools/call': {
      const name = params?.name;
      if (typeof name !== 'string') {
        return fail(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'tools/call requires a "name"');
      }
      try {
        const text = await callTool(reader, name, params?.arguments);
        return ok(id, { content: [{ type: 'text', text }], isError: false });
      } catch (error) {
        // Tool-level failures are reported inside the result so the model can
        // read and recover from them, per the MCP tool-error convention.
        const message =
          error instanceof GithubReadError ? error.message : `Unexpected bridge error: ${error.message}`;
        return ok(id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }

    default:
      return isNotification ? null : fail(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method "${method}"`);
  }
}

// Returns null when the payload was entirely notifications, meaning the caller
// should answer 202 with no body.
export async function handleMcpPayload(payload, reader) {
  if (Array.isArray(payload)) {
    if (!payload.length) {
      return fail(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Empty batch');
    }
    const responses = [];
    for (const message of payload) {
      const response = await handleSingleMessage(message, reader);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleSingleMessage(payload, reader);
}
