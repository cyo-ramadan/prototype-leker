// Read-only GitHub client for the agent bridge.
//
// Two invariants are enforced structurally rather than by convention, so a bug
// in a caller cannot turn this into a write path:
//
//   1. Every request is GET. The verb is hard-coded and never taken from input.
//   2. Every repository-scoped call passes through the allowlist first.
//
// Paths are always composed against GITHUB_API; callers cannot supply an
// absolute URL, so this client cannot be steered at another host.

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'leker-agent-bridge (read-only)';

export class GithubReadError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'GithubReadError';
    this.status = status;
  }
}

export function parseAllowedRepos(raw) {
  if (Array.isArray(raw)) {
    return raw.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
  }
  return String(raw || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function decodeBase64Content(base64) {
  const binary = atob(String(base64 || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.includes(0)) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function createGithubReader({ token, allowedRepos, fetchImpl = fetch } = {}) {
  const allowlist = parseAllowedRepos(allowedRepos);
  if (!allowlist.length) {
    throw new GithubReadError('ALLOWED_REPOS is empty; refusing to serve any repository', 500);
  }
  if (!token) {
    throw new GithubReadError('GITHUB_TOKEN is not configured', 500);
  }

  function assertRepoAllowed(owner, repo) {
    const full = `${String(owner || '').trim()}/${String(repo || '').trim()}`.toLowerCase();
    if (!allowlist.includes(full)) {
      throw new GithubReadError(
        `Repository "${full}" is outside this bridge's allowlist (${allowlist.join(', ')})`,
        403
      );
    }
    return full;
  }

  async function get(path, { searchParams = {}, accept = 'application/vnd.github+json' } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new GithubReadError('Internal error: GitHub path must be relative and start with "/"', 500);
    }
    const url = new URL(GITHUB_API + path);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'user-agent': USER_AGENT,
        'x-github-api-version': '2022-11-28'
      }
    });

    if (response.status === 404) {
      throw new GithubReadError(`Not found: ${path}`, 404);
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers?.get?.('x-ratelimit-remaining');
      throw new GithubReadError(
        remaining === '0'
          ? 'GitHub rate limit exhausted for this token; retry after the reset window'
          : 'GitHub refused the request (403). Check the token scopes.',
        403
      );
    }
    if (!response.ok) {
      throw new GithubReadError(`GitHub returned ${response.status} for ${path}`, 502);
    }

    if (accept.includes('json')) return response.json();
    return response.text();
  }

  return {
    allowlist,
    assertRepoAllowed,

    async getFile({ owner, repo, path, ref }) {
      assertRepoAllowed(owner, repo);
      const encoded = String(path || '')
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      const payload = await get(`/repos/${owner}/${repo}/contents/${encoded}`, { searchParams: { ref } });

      if (Array.isArray(payload)) {
        throw new GithubReadError(`"${path}" is a directory; use github_list_directory instead`, 400);
      }
      if (payload.type !== 'file') {
        throw new GithubReadError(`"${path}" is a ${payload.type}, not a readable file`, 400);
      }
      const text = payload.encoding === 'base64' ? decodeBase64Content(payload.content) : payload.content;
      return {
        path: payload.path,
        size: payload.size,
        sha: payload.sha,
        binary: text === null,
        content: text === null ? '[binary file omitted]' : text
      };
    },

    async listDirectory({ owner, repo, path = '', ref }) {
      assertRepoAllowed(owner, repo);
      const encoded = String(path || '')
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      const payload = await get(`/repos/${owner}/${repo}/contents/${encoded}`, { searchParams: { ref } });
      if (!Array.isArray(payload)) {
        throw new GithubReadError(`"${path}" is a file; use github_get_file instead`, 400);
      }
      return payload.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        size: entry.size
      }));
    },

    async searchCode({ owner, repo, query, perPage = 20 }) {
      const full = assertRepoAllowed(owner, repo);
      // The repo qualifier is appended by us, never taken from the caller's
      // query, so a crafted query cannot widen the search past the allowlist.
      const payload = await get('/search/code', {
        searchParams: { q: `${query} repo:${full}`, per_page: perPage }
      });
      return {
        total: payload.total_count,
        items: (payload.items || []).map(item => ({ path: item.path, url: item.html_url }))
      };
    },

    async listPullRequests({ owner, repo, state = 'open', perPage = 20 }) {
      assertRepoAllowed(owner, repo);
      const payload = await get(`/repos/${owner}/${repo}/pulls`, {
        searchParams: { state, per_page: perPage, sort: 'updated', direction: 'desc' }
      });
      return payload.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft,
        author: pr.user?.login,
        head: pr.head?.ref,
        base: pr.base?.ref,
        mergeable_state: pr.mergeable_state,
        updated_at: pr.updated_at,
        url: pr.html_url
      }));
    },

    async getPullRequest({ owner, repo, number, includeDiff = false }) {
      assertRepoAllowed(owner, repo);
      const pr = await get(`/repos/${owner}/${repo}/pulls/${Number(number)}`);
      const result = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        draft: pr.draft,
        merged: pr.merged,
        mergeable_state: pr.mergeable_state,
        author: pr.user?.login,
        head: pr.head?.ref,
        base: pr.base?.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        url: pr.html_url
      };
      if (includeDiff) {
        result.diff = await get(`/repos/${owner}/${repo}/pulls/${Number(number)}`, {
          accept: 'application/vnd.github.v3.diff'
        });
      }
      return result;
    },

    async listIssues({ owner, repo, state = 'open', perPage = 20 }) {
      assertRepoAllowed(owner, repo);
      const payload = await get(`/repos/${owner}/${repo}/issues`, {
        searchParams: { state, per_page: perPage, sort: 'updated', direction: 'desc' }
      });
      return payload
        .filter(issue => !issue.pull_request)
        .map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user?.login,
          labels: (issue.labels || []).map(label => label.name || label),
          comments: issue.comments,
          updated_at: issue.updated_at,
          url: issue.html_url
        }));
    },

    async getIssue({ owner, repo, number, includeComments = true }) {
      assertRepoAllowed(owner, repo);
      const issue = await get(`/repos/${owner}/${repo}/issues/${Number(number)}`);
      const result = {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        author: issue.user?.login,
        labels: (issue.labels || []).map(label => label.name || label),
        url: issue.html_url
      };
      if (includeComments && issue.comments > 0) {
        const comments = await get(`/repos/${owner}/${repo}/issues/${Number(number)}/comments`, {
          searchParams: { per_page: 50 }
        });
        result.comment_thread = comments.map(comment => ({
          author: comment.user?.login,
          created_at: comment.created_at,
          body: comment.body
        }));
      }
      return result;
    },

    async listCommits({ owner, repo, sha, path, perPage = 20 }) {
      assertRepoAllowed(owner, repo);
      const payload = await get(`/repos/${owner}/${repo}/commits`, {
        searchParams: { sha, path, per_page: perPage }
      });
      return payload.map(commit => ({
        sha: commit.sha,
        message: commit.commit?.message,
        author: commit.commit?.author?.name,
        date: commit.commit?.author?.date,
        url: commit.html_url
      }));
    },

    async getCommit({ owner, repo, sha, includeDiff = false }) {
      assertRepoAllowed(owner, repo);
      if (includeDiff) {
        return {
          sha,
          diff: await get(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`, {
            accept: 'application/vnd.github.v3.diff'
          })
        };
      }
      const commit = await get(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`);
      return {
        sha: commit.sha,
        message: commit.commit?.message,
        author: commit.commit?.author?.name,
        date: commit.commit?.author?.date,
        stats: commit.stats,
        files: (commit.files || []).map(file => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions
        })),
        url: commit.html_url
      };
    },

    async listBranches({ owner, repo, perPage = 50 }) {
      assertRepoAllowed(owner, repo);
      const payload = await get(`/repos/${owner}/${repo}/branches`, { searchParams: { per_page: perPage } });
      return payload.map(branch => ({
        name: branch.name,
        sha: branch.commit?.sha,
        protected: branch.protected
      }));
    },

    async listWorkflowRuns({ owner, repo, branch, perPage = 10 }) {
      assertRepoAllowed(owner, repo);
      const payload = await get(`/repos/${owner}/${repo}/actions/runs`, {
        searchParams: { branch, per_page: perPage }
      });
      return (payload.workflow_runs || []).map(run => ({
        id: run.id,
        name: run.name,
        branch: run.head_branch,
        sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        url: run.html_url
      }));
    }
  };
}
