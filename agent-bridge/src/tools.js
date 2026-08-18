// MCP tool surface for the agent bridge.
//
// Every tool here is a read. There is deliberately no create/update/delete tool
// and no generic "call this GitHub endpoint" escape hatch, so the surface a
// chat client can reach is exactly the list below.

import { GithubReadError } from './github.js';

const repoProps = {
  owner: { type: 'string', description: 'Repository owner, e.g. "cyo-ramadan".' },
  repo: { type: 'string', description: 'Repository name, e.g. "prototype-leker".' }
};

export const TOOL_DEFINITIONS = [
  {
    name: 'github_get_file',
    description:
      'Read one file from an allowlisted repository at an optional ref (branch, tag, or commit SHA). Returns decoded UTF-8 text.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        path: { type: 'string', description: 'File path relative to the repository root, e.g. "src/index.js".' },
        ref: { type: 'string', description: 'Optional branch, tag, or commit SHA. Defaults to the default branch.' }
      },
      required: ['owner', 'repo', 'path']
    },
    handler: (reader, args) => reader.getFile(args)
  },
  {
    name: 'github_list_directory',
    description: 'List the entries in a repository directory. Pass an empty path for the repository root.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        path: { type: 'string', description: 'Directory path. Omit or pass "" for the repository root.' },
        ref: { type: 'string', description: 'Optional branch, tag, or commit SHA.' }
      },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listDirectory(args)
  },
  {
    name: 'github_search_code',
    description:
      'Search code inside one allowlisted repository. The repository qualifier is applied by the bridge; the query is matched against file contents.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        query: { type: 'string', description: 'Search terms, e.g. "handleCashierDrawerApi".' },
        perPage: { type: 'number', description: 'Maximum results, 1-100. Defaults to 20.' }
      },
      required: ['owner', 'repo', 'query']
    },
    handler: (reader, args) => reader.searchCode(args)
  },
  {
    name: 'github_list_pull_requests',
    description: 'List pull requests, most recently updated first.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to "open".' },
        perPage: { type: 'number', description: 'Maximum results, 1-100. Defaults to 20.' }
      },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listPullRequests(args)
  },
  {
    name: 'github_get_pull_request',
    description: 'Get one pull request, optionally including its full unified diff.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        number: { type: 'number', description: 'Pull request number.' },
        includeDiff: { type: 'boolean', description: 'Set true to include the unified diff. Defaults to false.' }
      },
      required: ['owner', 'repo', 'number']
    },
    handler: (reader, args) => reader.getPullRequest(args)
  },
  {
    name: 'github_list_issues',
    description: 'List issues, most recently updated first. Pull requests are excluded.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to "open".' },
        perPage: { type: 'number', description: 'Maximum results, 1-100. Defaults to 20.' }
      },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listIssues(args)
  },
  {
    name: 'github_get_issue',
    description: 'Get one issue including its comment thread.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        number: { type: 'number', description: 'Issue number.' },
        includeComments: { type: 'boolean', description: 'Defaults to true.' }
      },
      required: ['owner', 'repo', 'number']
    },
    handler: (reader, args) => reader.getIssue(args)
  },
  {
    name: 'github_list_commits',
    description: 'List commits on a branch, optionally filtered to one file path.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        sha: { type: 'string', description: 'Branch name or commit SHA to start from.' },
        path: { type: 'string', description: 'Optional file path filter.' },
        perPage: { type: 'number', description: 'Maximum results, 1-100. Defaults to 20.' }
      },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listCommits(args)
  },
  {
    name: 'github_get_commit',
    description: 'Get one commit with its changed-file summary, or its full diff.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        sha: { type: 'string', description: 'Commit SHA.' },
        includeDiff: { type: 'boolean', description: 'Set true to return the unified diff instead of the summary.' }
      },
      required: ['owner', 'repo', 'sha']
    },
    handler: (reader, args) => reader.getCommit(args)
  },
  {
    name: 'github_list_branches',
    description: 'List branches in the repository.',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, perPage: { type: 'number', description: 'Defaults to 50.' } },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listBranches(args)
  },
  {
    name: 'github_list_workflow_runs',
    description: 'List recent GitHub Actions workflow runs with their status and conclusion. Use this to check CI health.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        branch: { type: 'string', description: 'Optional branch filter.' },
        perPage: { type: 'number', description: 'Defaults to 10.' }
      },
      required: ['owner', 'repo']
    },
    handler: (reader, args) => reader.listWorkflowRuns(args)
  }
];

export const TOOL_LIST = TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema
}));

const TOOLS_BY_NAME = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));

export async function callTool(reader, name, args = {}) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    throw new GithubReadError(`Unknown tool "${name}"`, 400);
  }
  const result = await tool.handler(reader, args || {});
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}
