import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, nowIso, newId } from './lib/db.js';
import { AppError, safeError } from './lib/errors.js';
import { parseGitHubRepositoryUrl, parseGitHubIssueUrl, parseGitHubPullUrl } from './lib/repository.js';
import { parseRewardFromIssue, extractAcceptanceCriteria } from './lib/task-parser.js';
import { verifyRepository, fetchIssue, fetchPullRequest, getPullHeadSha } from './lib/github.js';
import { evaluatePullRequest } from './lib/openai.js';
import { createPayout, getPayoutBatch, isPayPalConfigured, normalizePayoutStatus, verifyPayPalWebhook } from './lib/paypal.js';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const hasBuiltClient = fs.existsSync(path.join(here, '../client/dist/index.html'));

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}
if (isProduction && (!process.env.MODERATOR_PIN || process.env.MODERATOR_PIN === 'change-this-to-a-long-pin')) {
  throw new Error('Set a unique MODERATOR_PIN before using PR2PAY in production.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '3mb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }));

const SESSION_COOKIE = 'pr2pay_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET || 'local-development-only-session-secret-change-before-sharing';

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function isValidSession(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (!constantTimeEqual(signature, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Date.now(); }
  catch { return false; }
}
function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const part of cookies) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function setSessionCookie(res, value) {
  const secure = process.env.COOKIE_SECURE === 'true';
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
}
function requireModerator(req, res, next) {
  if (!isValidSession(readCookie(req, SESSION_COOKIE))) return res.status(401).json({ error: 'Moderator login required.', code: 'UNAUTHORIZED' });
  next();
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function configuredRepo() {
  const url = getSetting('repository_url');
  if (!url || getSetting('repository_verified') !== 'true') {
    throw new AppError('Verify and connect the GitHub repository in Settings before importing tasks or reviewing PRs.', 409, 'REPOSITORY_NOT_CONFIGURED');
  }
  const parsed = parseGitHubRepositoryUrl(url);
  return {
    ...parsed,
    fullName: getSetting('repository_full_name') || parsed.fullName,
    branch: getSetting('repository_branch') || parsed.branch
  };
}
function taskFromRow(row) {
  return { ...row, criteria: JSON.parse(row.criteria_json) };
}
function evaluationFromRow(row) {
  return { ...row, result: JSON.parse(row.result_json) };
}
function paymentFromRow(row) {
  return row;
}
function emailIsValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()) && String(value).length <= 127;
}
function freshBatchId() {
  return `PR2PAY${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 30);
}
function getTask(taskId) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!row) throw new AppError('Task not found.', 404, 'TASK_NOT_FOUND');
  return row;
}
function getEvaluation(id) {
  const row = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!row) throw new AppError('Evaluation not found.', 404, 'EVALUATION_NOT_FOUND');
  return row;
}
function getPayment(id) {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!row) throw new AppError('Payment record not found.', 404, 'PAYMENT_NOT_FOUND');
  return row;
}
function mapPayPalStatus(batch) {
  const header = batch.batch_header || batch;
  const itemStatus = batch.items?.[0]?.transaction_status || batch.payout_items?.[0]?.transaction_status;
  const status = itemStatus || header.batch_status || header.payout_status;
  return { status: normalizePayoutStatus(status), paypalStatus: status || 'UNKNOWN' };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'PR2PAY',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
    paypalConfigured: isPayPalConfigured(),
    paypalMode: process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    webhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID)
  });
});

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const expected = process.env.MODERATOR_PIN;
  if (!expected) throw new AppError('Set MODERATOR_PIN in .env before logging in.', 503, 'MODERATOR_PIN_NOT_CONFIGURED');
  if (!constantTimeEqual(String(req.body?.pin || ''), expected)) throw new AppError('Incorrect moderator PIN.', 401, 'INVALID_PIN');
  setSessionCookie(res, createSession());
  res.json({ authenticated: true });
}));
app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res); res.json({ authenticated: false }); });
app.get('/api/auth/me', (req, res) => res.json({ authenticated: isValidSession(readCookie(req, SESSION_COOKIE)) }));

app.use('/api', (req, res, next) => {
  if (['/health', '/auth/login', '/auth/logout', '/auth/me', '/paypal/webhook'].includes(req.path)) return next();
  return requireModerator(req, res, next);
});

app.get('/api/repository', (req, res) => {
  const url = getSetting('repository_url');
  if (!url) return res.json({ configured: false, url: process.env.DEFAULT_GITHUB_REPO_URL || '' });
  const parsed = parseGitHubRepositoryUrl(url);
  res.json({
    configured: true,
    url,
    fullName: getSetting('repository_full_name') || parsed.fullName,
    branch: getSetting('repository_branch') || parsed.branch || '',
    private: getSetting('repository_private') === 'true',
    verified: getSetting('repository_verified') === 'true'
  });
});

app.post('/api/repository', asyncRoute(async (req, res) => {
  const parsed = parseGitHubRepositoryUrl(req.body?.url);
  const verified = await verifyRepository(parsed);
  const branch = verified.selectedBranch || parsed.branch || verified.defaultBranch;
  setSetting('repository_url', req.body.url.trim());
  setSetting('repository_full_name', verified.fullName);
  setSetting('repository_branch', branch);
  setSetting('repository_private', String(verified.private));
  setSetting('repository_verified', 'true');
  res.json({ configured: true, fullName: verified.fullName, branch, private: verified.private, htmlUrl: verified.htmlUrl, description: verified.description });
}));

app.get('/api/tasks', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  res.json(rows.map(taskFromRow));
});
app.post('/api/tasks/import', asyncRoute(async (req, res) => {
  const repo = configuredRepo();
  const target = parseGitHubIssueUrl(req.body?.issueUrl, repo);
  const issue = await fetchIssue(repo, target.issueNumber);
  const reward = parseRewardFromIssue(issue.body || '');
  const criteria = extractAcceptanceCriteria(issue.body || '');
  const time = nowIso();
  const existing = db.prepare('SELECT * FROM tasks WHERE issue_url = ?').get(issue.html_url);
  if (existing) return res.json(taskFromRow(existing));
  const id = newId();
  db.prepare(`INSERT INTO tasks(id, issue_number, issue_url, title, body, reward_amount, currency, criteria_json, created_at, updated_at)
    VALUES(@id, @issue_number, @issue_url, @title, @body, @reward_amount, @currency, @criteria_json, @created_at, @updated_at)`).run({
      id, issue_number: issue.number, issue_url: issue.html_url, title: issue.title, body: issue.body || '',
      reward_amount: reward.amount, currency: reward.currency, criteria_json: JSON.stringify(criteria), created_at: time, updated_at: time
    });
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(taskFromRow(row));
}));
app.get('/api/tasks/:id', (req, res) => res.json(taskFromRow(getTask(req.params.id))));

app.get('/api/evaluations', (req, res) => {
  const rows = db.prepare(`SELECT e.*, t.title AS task_title, t.reward_amount, t.currency
    FROM evaluations e JOIN tasks t ON t.id=e.task_id ORDER BY e.created_at DESC LIMIT 100`).all();
  res.json(rows.map(row => ({ ...row, result: JSON.parse(row.result_json) })));
});
app.post('/api/evaluations', asyncRoute(async (req, res) => {
  const task = getTask(String(req.body?.taskId || ''));
  const repo = configuredRepo();
  // A task imported before a repository switch must not be evaluated against another repository.
  parseGitHubIssueUrl(task.issue_url, repo);
  const target = parseGitHubPullUrl(req.body?.pullRequestUrl, repo);
  const recipientEmail = String(req.body?.recipientEmail || '').trim().toLowerCase();
  if (!emailIsValid(recipientEmail)) throw new AppError('Enter the contributor’s PayPal email address.', 422, 'INVALID_RECIPIENT_EMAIL');
  const pull = await fetchPullRequest(repo, target.pullNumber);
  if (pull.state !== 'open' || pull.merged) throw new AppError('Only open, unmerged Pull Requests can be evaluated.', 422, 'PR_NOT_OPEN');
  if (pull.baseRef !== repo.branch) throw new AppError(`This repository is configured for branch "${repo.branch}". The submitted Pull Request targets "${pull.baseRef}".`, 422, 'PR_TARGET_BRANCH_MISMATCH');
  if (pull.draft) throw new AppError('This Pull Request is still marked as a draft. Mark it ready for review before evaluating.', 422, 'PR_IS_DRAFT');

  const result = await evaluatePullRequest({ task, pull });
  const id = newId();
  const time = nowIso();
  const status = result.eligible ? 'eligible' : 'not_eligible';
  db.prepare(`INSERT INTO evaluations(id, task_id, pr_number, pr_url, pr_title, pr_author, recipient_email, head_sha, status, score, result_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, task.id, pull.number, pull.url, pull.title, pull.author, recipientEmail, pull.headSha,
      status, result.score, JSON.stringify(result), time, time
    );
  res.status(201).json({ ...evaluationFromRow(getEvaluation(id)), task_title: task.title, reward_amount: task.reward_amount, currency: task.currency });
}));

app.post('/api/evaluations/:id/approve', asyncRoute(async (req, res) => {
  const evaluation = getEvaluation(req.params.id);
  if (evaluation.status !== 'eligible') throw new AppError('Only evaluations scoring at least 60% can be approved for payment.', 409, 'EVALUATION_NOT_ELIGIBLE');
  const repo = configuredRepo();
  const currentSha = await getPullHeadSha(repo, evaluation.pr_number);
  if (currentSha !== evaluation.head_sha) {
    db.prepare('UPDATE evaluations SET status = ?, updated_at = ? WHERE id = ?').run('stale', nowIso(), evaluation.id);
    throw new AppError('The Pull Request changed after evaluation. Run verification again against the latest commit before approving.', 409, 'STALE_EVALUATION');
  }
  db.prepare('UPDATE evaluations SET status = ?, updated_at = ? WHERE id = ?').run('approved_by_moderator', nowIso(), evaluation.id);
  const task = getTask(evaluation.task_id);
  res.json({ ...evaluationFromRow(getEvaluation(evaluation.id)), task_title: task.title, reward_amount: task.reward_amount, currency: task.currency, message: 'Moderator approval recorded. Payment still requires a separate confirmation.' });
}));

app.get('/api/payments', (req, res) => {
  const rows = db.prepare(`SELECT p.*, e.pr_url, e.pr_number, e.pr_title, e.pr_author, t.title AS task_title
    FROM payments p JOIN evaluations e ON e.id=p.evaluation_id JOIN tasks t ON t.id=e.task_id
    ORDER BY p.created_at DESC LIMIT 100`).all();
  res.json(rows.map(paymentFromRow));
});

app.post('/api/evaluations/:id/pay', asyncRoute(async (req, res) => {
  const evaluation = getEvaluation(req.params.id);
  if (evaluation.status !== 'approved_by_moderator') throw new AppError('The moderator must approve this evaluation before payment.', 409, 'MODERATOR_APPROVAL_REQUIRED');
  if (!isPayPalConfigured()) throw new AppError('PayPal is not configured yet. Add Sandbox Client ID and Secret to .env.', 503, 'PAYPAL_NOT_CONFIGURED');
  const existing = db.prepare('SELECT id, status FROM payments WHERE evaluation_id = ? ORDER BY created_at DESC LIMIT 1').get(evaluation.id);
  if (existing) throw new AppError(`A payment record already exists for this evaluation (${existing.status}). Refresh or reconcile it instead of creating another payout.`, 409, 'PAYMENT_ALREADY_EXISTS');
  const repo = configuredRepo();
  const currentSha = await getPullHeadSha(repo, evaluation.pr_number);
  if (currentSha !== evaluation.head_sha) {
    db.prepare('UPDATE evaluations SET status = ?, updated_at = ? WHERE id = ?').run('stale', nowIso(), evaluation.id);
    throw new AppError('The Pull Request changed after approval. Re-evaluate it before paying.', 409, 'STALE_EVALUATION');
  }
  const task = getTask(evaluation.task_id);
  const priorPayment = db.prepare(`SELECT p.* FROM payments p JOIN evaluations e ON e.id=p.evaluation_id WHERE e.task_id=? AND e.pr_number=? ORDER BY p.created_at DESC LIMIT 1`).get(evaluation.task_id, evaluation.pr_number);
  if (priorPayment) throw new AppError(`A payment record already exists for this task and Pull Request (${priorPayment.status}). Refresh or retry that record instead of creating a second payout.`, 409, 'PR_ALREADY_HAS_PAYMENT', { paymentId: priorPayment.id, paymentStatus: priorPayment.status });
  const paymentId = newId();
  const batchId = freshBatchId();
  const time = nowIso();
  const dedupeKey = `${evaluation.task_id}:${evaluation.pr_number}`;
  try {
    db.prepare(`INSERT INTO payments(id, evaluation_id, dedupe_key, batch_id, amount, currency, recipient_email, status, retry_mode, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'submitting', 'none', 1, ?, ?)`).run(paymentId, evaluation.id, dedupeKey, batchId, task.reward_amount, task.currency, evaluation.recipient_email, time, time);
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) throw new AppError('A payout record already exists for this task and Pull Request. Refresh or retry that saved payment instead of submitting a second one.', 409, 'PR_ALREADY_HAS_PAYMENT');
    throw error;
  }
  try {
    const payout = await createPayout({ batchId, recipientEmail: evaluation.recipient_email, amount: task.reward_amount, currency: task.currency, evaluationId: evaluation.id, taskTitle: task.title });
    const payoutBatchId = payout.batch_header?.payout_batch_id || payout.payout_batch_id || null;
    const paypalStatus = payout.batch_header?.batch_status || payout.batch_status || 'ACKNOWLEDGED';
    const normalized = payoutBatchId ? normalizePayoutStatus(paypalStatus) : 'reconciliation_required';
    db.prepare(`UPDATE payments SET payout_batch_id=?, status=?, paypal_status=?, response_json=?, retry_mode=?, error_message=?, updated_at=? WHERE id=?`)
      .run(payoutBatchId, normalized, paypalStatus, JSON.stringify(payout), normalized === 'failed' ? 'new_batch_after_terminal' : 'none', payoutBatchId ? null : 'PayPal response did not include a payout batch ID. Reconcile this transaction in the PayPal dashboard.', nowIso(), paymentId);
  } catch (error) {
    const authFailedBeforePayout = String(error.code || '').startsWith('PAYPAL_AUTH_');
    const retryMode = error.paypalStatus >= 500 || authFailedBeforePayout ? 'same_batch_id' : error.paypalPayload?.name === 'USER_BUSINESS_ERROR' ? 'new_batch_after_paypal_instruction' : 'none';
    const status = error.code === 'PAYPAL_OUTCOME_UNKNOWN' || error.paypalStatus >= 500 ? 'reconciliation_required' : 'failed';
    db.prepare(`UPDATE payments SET status=?, error_message=?, response_json=?, retry_mode=?, updated_at=? WHERE id=?`)
      .run(status, error.message, JSON.stringify(error.paypalPayload || { code: error.code, details: error.details }), retryMode, nowIso(), paymentId);
    throw new AppError(`PayPal could not confirm the payout. ${error.message} Payment record ${paymentId} was saved; do not create a second payout.`, error.status || 502, 'PAYOUT_SUBMISSION_UNRESOLVED', { paymentId, paymentStatus: status, retryMode });
  }
  res.status(201).json(paymentFromRow(getPayment(paymentId)));
}));

app.post('/api/payments/:id/refresh', asyncRoute(async (req, res) => {
  const payment = getPayment(req.params.id);
  if (!payment.payout_batch_id) throw new AppError('PayPal has not returned a payout batch ID. This payment needs manual reconciliation before another attempt.', 409, 'PAYOUT_BATCH_ID_MISSING');
  const batch = await getPayoutBatch(payment.payout_batch_id);
  const mapped = mapPayPalStatus(batch);
  db.prepare('UPDATE payments SET status=?, paypal_status=?, response_json=?, retry_mode=?, updated_at=? WHERE id=?')
    .run(mapped.status, mapped.paypalStatus, JSON.stringify(batch), mapped.status === 'failed' ? 'new_batch_after_terminal' : 'none', nowIso(), payment.id);
  res.json(paymentFromRow(getPayment(payment.id)));
}));

app.post('/api/payments/:id/retry', asyncRoute(async (req, res) => {
  const payment = getPayment(req.params.id);
  if (!['failed', 'reconciliation_required'].includes(payment.status)) throw new AppError('This payment is not in a retryable state.', 409, 'PAYMENT_NOT_RETRYABLE');
  let retryBatchId = payment.batch_id;
  if (payment.payout_batch_id) {
    const batch = await getPayoutBatch(payment.payout_batch_id);
    const current = mapPayPalStatus(batch);
    const paypalStatus = current.paypalStatus;
    if (current.status === 'completed' || current.status === 'processing') throw new AppError(`PayPal currently reports ${paypalStatus}. Do not retry while a payout is processing or completed.`, 409, 'PAYOUT_STILL_ACTIVE');
    if (current.status !== 'failed') throw new AppError(`PayPal status is ${paypalStatus || 'unknown'}. Follow up in PayPal before retrying.`, 409, 'PAYOUT_NOT_TERMINAL');
    retryBatchId = freshBatchId();
  } else if (payment.retry_mode === 'same_batch_id') {
    // PayPal documents same sender_batch_id retries for HTTP 5xx responses.
  } else if (payment.retry_mode === 'new_batch_after_paypal_instruction') {
    // PayPal's USER_BUSINESS_ERROR explicitly instructs the sender to try a new batch ID.
    retryBatchId = freshBatchId();
  } else {
    throw new AppError('There is no confirmed terminal PayPal result and PayPal did not authorize a safe retry. Reconcile this payout in the PayPal dashboard first.', 409, 'MANUAL_RECONCILIATION_REQUIRED');
  }
  const evaluation = getEvaluation(payment.evaluation_id);
  const task = getTask(evaluation.task_id);
  // Claim the retry atomically. A second moderator click/request must not submit
  // a second payout while the first retry is waiting on PayPal.
  const claim = db.prepare(`UPDATE payments SET status='submitting', updated_at=?
    WHERE id=? AND status IN ('failed', 'reconciliation_required')`).run(nowIso(), payment.id);
  if (claim.changes !== 1) {
    throw new AppError('This payment is already being retried or its status changed. Refresh the payment record before taking another action.', 409, 'PAYMENT_RETRY_ALREADY_CLAIMED');
  }
  try {
    const payout = await createPayout({ batchId: retryBatchId, recipientEmail: payment.recipient_email, amount: payment.amount, currency: payment.currency, evaluationId: evaluation.id, taskTitle: task.title });
    const payoutBatchId = payout.batch_header?.payout_batch_id || payout.payout_batch_id || null;
    const paypalStatus = payout.batch_header?.batch_status || payout.batch_status || 'ACKNOWLEDGED';
    const mapped = payoutBatchId ? normalizePayoutStatus(paypalStatus) : 'reconciliation_required';
    db.prepare(`UPDATE payments SET batch_id=?, payout_batch_id=?, status=?, paypal_status=?, attempts=attempts+1, response_json=?, error_message=?, retry_mode=?, updated_at=? WHERE id=?`)
      .run(retryBatchId, payoutBatchId, mapped, paypalStatus, JSON.stringify(payout), payoutBatchId ? null : 'PayPal response did not include a payout batch ID. Reconcile this transaction in the PayPal dashboard.', mapped === 'failed' ? 'new_batch_after_terminal' : 'none', nowIso(), payment.id);
  } catch (error) {
    const authFailedBeforePayout = String(error.code || '').startsWith('PAYPAL_AUTH_');
    const retryMode = error.paypalStatus >= 500 || authFailedBeforePayout ? 'same_batch_id' : error.paypalPayload?.name === 'USER_BUSINESS_ERROR' ? 'new_batch_after_paypal_instruction' : 'none';
    const retryStatus = error.code === 'PAYPAL_OUTCOME_UNKNOWN' || error.paypalStatus >= 500 ? 'reconciliation_required' : 'failed';
    db.prepare('UPDATE payments SET status=?, error_message=?, retry_mode=?, updated_at=? WHERE id=?')
      .run(retryStatus, error.message, retryMode, nowIso(), payment.id);
    throw new AppError(`PayPal did not confirm the retry. ${error.message}`, error.status || 502, 'PAYOUT_RETRY_UNRESOLVED', { paymentId: payment.id });
  }
  res.json(paymentFromRow(getPayment(payment.id)));
}));

app.post('/api/paypal/webhook', asyncRoute(async (req, res) => {
  const valid = await verifyPayPalWebhook(req.headers, req.body);
  if (!valid) throw new AppError('PayPal webhook signature verification failed.', 400, 'INVALID_PAYPAL_WEBHOOK_SIGNATURE');
  const event = req.body || {};
  const eventId = String(event.id || '');
  if (!eventId) return res.status(200).json({ received: true, processed: false });
  const alreadySeen = db.prepare('SELECT id FROM webhook_events WHERE id = ?').get(eventId);
  if (alreadySeen) return res.status(200).json({ received: true, duplicate: true });
  const resource = event.resource || {};
  const batchId = resource.payout_batch_id || resource.batch_header?.payout_batch_id || resource.batch_id || null;
  db.prepare('INSERT INTO webhook_events(id, event_type, payout_batch_id, payload_json, received_at) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, event.event_type || 'UNKNOWN', batchId, JSON.stringify(event), nowIso());
  if (batchId) {
    const payment = db.prepare('SELECT * FROM payments WHERE payout_batch_id = ?').get(batchId);
    if (payment) {
      const eventType = String(event.event_type || '');
      const status = eventType.endsWith('.SUCCESS') || eventType.endsWith('.SUCCEEDED') ? 'completed'
        : eventType.endsWith('.DENIED') || eventType.endsWith('.FAILED') || eventType.endsWith('.CANCELED') ? 'failed'
        : eventType.endsWith('.BLOCKED') ? 'reconciliation_required'
        : eventType.endsWith('.PROCESSING') || eventType.endsWith('.HELD') || eventType.endsWith('.UNCLAIMED') ? 'processing'
        : eventType.endsWith('.RETURNED') || eventType.endsWith('.REFUNDED') ? 'failed'
        : payment.status;
      const retryMode = status === 'failed' ? 'new_batch_after_terminal' : 'none';
      db.prepare('UPDATE payments SET status=?, paypal_status=?, response_json=?, retry_mode=?, updated_at=? WHERE id=?')
        .run(status, eventType, JSON.stringify(event), retryMode, nowIso(), payment.id);
    }
  }
  res.status(200).json({ received: true, processed: true });
}));

app.get('/api/overview', (req, res) => {
  const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
  const evalCount = db.prepare('SELECT COUNT(*) AS count FROM evaluations').get().count;
  const eligibleCount = db.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE status IN ('eligible','approved_by_moderator')").get().count;
  const completedPayments = db.prepare("SELECT COUNT(*) AS count FROM payments WHERE status='completed'").get().count;
  const pendingPayments = db.prepare("SELECT COUNT(*) AS count FROM payments WHERE status IN ('processing','submitting','reconciliation_required')").get().count;
  const latestEvaluations = db.prepare(`SELECT e.*, t.title AS task_title, t.reward_amount, t.currency
    FROM evaluations e JOIN tasks t ON t.id=e.task_id ORDER BY e.created_at DESC LIMIT 5`).all()
    .map(row => ({ ...row, result: JSON.parse(row.result_json) }));
  res.json({ taskCount, evalCount, eligibleCount, completedPayments, pendingPayments, latestEvaluations });
});

const clientDist = path.resolve(here, '../client/dist');
if (isProduction || hasBuiltClient) {
  app.use(express.static(clientDist));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((error, req, res, next) => {
  const result = safeError(error);
  if (result.status >= 500) console.error(`[PR2PAY] ${error.code || error.name || 'ERROR'}: ${error.message}`);
  res.status(result.status).json(result.body);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\nPR2PAY is running at http://127.0.0.1:${PORT}`);
  console.log(`PayPal mode: ${process.env.PAYPAL_MODE === 'live' ? 'LIVE' : 'SANDBOX'}`);
  console.log('GitHub access is read-only. Payouts require moderator approval.\n');
});
