import { AppError } from './errors.js';

const API_ROOT = 'https://api.github.com';

async function githubRequest(path, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PR2PAY-Hackathon-App'
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { headers, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new AppError('Could not reach GitHub. Check your internet connection and try again.', 502, 'GITHUB_NETWORK_ERROR');
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || `GitHub returned HTTP ${response.status}.`;
    const friendly = response.status === 401 || response.status === 403
      ? `${message} If this is a private repository or you hit the API limit, add a read-only GITHUB_TOKEN in .env and restart.`
      : response.status === 404 ? 'GitHub could not find this repository, Issue, or Pull Request. Check the URL and your repository access.' : message;
    throw new AppError(friendly, response.status === 404 ? 404 : 502, 'GITHUB_API_ERROR', { githubStatus: response.status });
  }
  return data;
}

export async function verifyRepository(repo) {
  const data = await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`);
  const selectedBranch = repo.branch || data.default_branch;
  await githubRequest(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/branches/${encodeURIComponent(selectedBranch)}`);
  return {
    owner: data.owner.login,
    repo: data.name,
    fullName: data.full_name,
    private: Boolean(data.private),
    defaultBranch: data.default_branch,
    selectedBranch,
    htmlUrl: data.html_url,
    description: data.description || ''
  };
}

export async function fetchIssue(repo, issueNumber) {
  const issue = await githubRequest(`/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`);
  if (issue.pull_request) throw new AppError('That URL points to a Pull Request, not a task Issue. Use a GitHub Issue URL.', 422, 'URL_IS_PULL_REQUEST');
  if (issue.state !== 'open') throw new AppError('Only open GitHub Issues can be imported as active tasks.', 422, 'ISSUE_NOT_OPEN');
  return issue;
}

export async function fetchPullRequest(repo, pullNumber) {
  const pull = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}`);
  if (pull.base?.repo?.full_name?.toLowerCase() !== repo.fullName.toLowerCase()) {
    throw new AppError('The Pull Request base repository does not match the configured repository.', 422, 'PR_BASE_REPOSITORY_MISMATCH');
  }
  const files = [];
  for (let page = 1; page <= 3; page += 1) {
    const pageFiles = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`);
    if (!Array.isArray(pageFiles)) break;
    files.push(...pageFiles);
    if (pageFiles.length < 100) break;
  }

  let checks = { state: 'unavailable', items: [] };
  try {
    const checkData = await githubRequest(`/repos/${repo.owner}/${repo.repo}/commits/${pull.head.sha}/check-runs?per_page=100`);
    let commitStatus = null;
    try {
      const statusData = await githubRequest(`/repos/${repo.owner}/${repo.repo}/commits/${pull.head.sha}/status`);
      commitStatus = { state: statusData.state, contexts: (statusData.statuses || []).slice(0, 40).map(item => ({ context: item.context, state: item.state, description: item.description })) };
    } catch { /* Commit status API can be unavailable for repositories without status checks. */ }
    checks = {
      state: checkData.total_count || commitStatus?.contexts?.length ? 'available' : 'none',
      items: (checkData.check_runs || []).slice(0, 40).map(item => ({ name: item.name, status: item.status, conclusion: item.conclusion })),
      commitStatus
    };
  } catch { /* CI checks are useful context, but not required for reading a PR. */ }

  const maxPatchChars = 70000;
  let patchText = '';
  for (const file of files.slice(0, 120)) {
    const header = `\n\n### FILE: ${file.filename}\nSTATUS: ${file.status}; ADDITIONS: ${file.additions}; DELETIONS: ${file.deletions}\n`;
    const patch = file.patch || '[Patch unavailable or omitted by GitHub for this file.]';
    const remaining = maxPatchChars - patchText.length - header.length;
    if (remaining <= 0) break;
    patchText += header + patch.slice(0, Math.max(0, remaining));
  }

  return {
    number: pull.number,
    url: pull.html_url,
    title: pull.title,
    body: pull.body || '',
    author: pull.user?.login || 'unknown',
    state: pull.state,
    merged: Boolean(pull.merged),
    headSha: pull.head.sha,
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    changedFiles: files.length,
    additions: pull.additions,
    deletions: pull.deletions,
    draft: Boolean(pull.draft),
    checks,
    patchText: patchText || '[No patch content returned by GitHub.]'
  };
}

export async function getPullHeadSha(repo, pullNumber) {
  const pull = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}`);
  return pull.head.sha;
}
