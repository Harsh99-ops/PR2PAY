import { AppError } from './errors.js';

export function parseGitHubRepositoryUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new AppError('Enter a valid GitHub repository URL.', 400, 'INVALID_REPOSITORY_URL'); }

  if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'http:'].includes(url.protocol)) {
    throw new AppError('The repository must be hosted on github.com.', 400, 'INVALID_REPOSITORY_HOST');
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) throw new AppError('Use a URL like https://github.com/owner/repository.', 400, 'INVALID_REPOSITORY_URL');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  let branch = null;
  if (parts[2] === 'tree' && parts.length >= 4) branch = parts.slice(3).join('/');
  if (parts[2] && !['tree', 'issues', 'pulls', 'actions', 'commits'].includes(parts[2])) {
    throw new AppError('Use the repository root or a /tree/branch URL.', 400, 'INVALID_REPOSITORY_URL');
  }
  return { owner, repo, branch, fullName: `${owner}/${repo}`, canonicalUrl: `https://github.com/${owner}/${repo}` };
}

export function parseGitHubIssueUrl(input, configuredRepo) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new AppError('Enter a valid GitHub Issue URL.', 400, 'INVALID_ISSUE_URL'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'github.com' || parts.length !== 4 || parts[2] !== 'issues' || !/^\d+$/.test(parts[3])) {
    throw new AppError('Use an Issue URL like https://github.com/owner/repo/issues/12.', 400, 'INVALID_ISSUE_URL');
  }
  assertSameRepository(parts[0], parts[1], configuredRepo);
  return { issueNumber: Number(parts[3]), url: `https://github.com/${parts[0]}/${parts[1]}/issues/${parts[3]}` };
}

export function parseGitHubPullUrl(input, configuredRepo) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw new AppError('Enter a valid GitHub Pull Request URL.', 400, 'INVALID_PR_URL'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'github.com' || parts.length !== 4 || parts[2] !== 'pull' || !/^\d+$/.test(parts[3])) {
    throw new AppError('Use a Pull Request URL like https://github.com/owner/repo/pull/42.', 400, 'INVALID_PR_URL');
  }
  assertSameRepository(parts[0], parts[1], configuredRepo);
  return { pullNumber: Number(parts[3]), url: `https://github.com/${parts[0]}/${parts[1]}/pull/${parts[3]}` };
}

function assertSameRepository(owner, repo, configuredRepo) {
  if (!configuredRepo || owner.toLowerCase() !== configuredRepo.owner.toLowerCase() || repo.toLowerCase() !== configuredRepo.repo.toLowerCase()) {
    throw new AppError(`This URL must belong to the configured repository ${configuredRepo?.fullName || ''}.`, 400, 'REPOSITORY_MISMATCH');
  }
}
