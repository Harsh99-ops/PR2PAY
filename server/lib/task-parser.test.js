import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRewardFromIssue, extractAcceptanceCriteria } from './task-parser.js';
import { parseGitHubRepositoryUrl, parseGitHubIssueUrl, parseGitHubPullUrl } from './repository.js';

test('parses fixed reward from top of Issue body', () => {
  assert.deepEqual(parseRewardFromIssue('Reward: 25.00 USD\n\n## Task\nBuild it'), { amount: '25.00', currency: 'USD' });
});

test('does not accept reward when it is buried in the description', () => {
  assert.throws(() => parseRewardFromIssue(`## Task\nBuild it\n\nParagraph one.\nParagraph two.\nParagraph three.\nParagraph four.\nParagraph five.\nParagraph six.\nReward: 25.00 USD`), { code: 'REWARD_NOT_FOUND' });
});

test('extracts checkbox criteria in order', () => {
  const criteria = extractAcceptanceCriteria('Reward: 10 USD\n\n## Acceptance Criteria\n- [ ] Add validation\n- [x] Add tests');
  assert.deepEqual(criteria.map(item => item.description), ['Add validation', 'Add tests']);
});

test('parses repository branch from /tree URL', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/acme/tool/tree/release-candidate'), {
    owner: 'acme', repo: 'tool', branch: 'release-candidate', fullName: 'acme/tool', canonicalUrl: 'https://github.com/acme/tool'
  });
});

test('Issue and PR URLs must match configured repository', () => {
  const repo = { owner: 'acme', repo: 'tool', fullName: 'acme/tool' };
  assert.equal(parseGitHubIssueUrl('https://github.com/acme/tool/issues/12', repo).issueNumber, 12);
  assert.equal(parseGitHubPullUrl('https://github.com/acme/tool/pull/48', repo).pullNumber, 48);
  assert.throws(() => parseGitHubPullUrl('https://github.com/other/tool/pull/48', repo), { code: 'REPOSITORY_MISMATCH' });
});

import { scoreCriteria } from './scoring.js';

test('3 of 5 passed is eligible at exactly 60 percent', () => {
  const result = scoreCriteria(['passed', 'passed', 'passed', 'failed', 'inconclusive'].map(status => ({ status })));
  assert.equal(result.score, 60);
  assert.equal(result.eligible, true);
  assert.equal(result.passed, 3);
});

test('inconclusive criteria do not count as passed', () => {
  const result = scoreCriteria(['passed', 'failed', 'inconclusive', 'inconclusive', 'failed'].map(status => ({ status })));
  assert.equal(result.score, 20);
  assert.equal(result.eligible, false);
});
