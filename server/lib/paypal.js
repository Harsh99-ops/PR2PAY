import { AppError } from './errors.js';

export function paypalBaseUrl() {
  return process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export function isPayPalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function fetchWithTimeout(url, options, timeout = 25000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

export async function getPayPalAccessToken() {
  if (!isPayPalConfigured()) throw new AppError('PayPal credentials are missing. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.', 503, 'PAYPAL_NOT_CONFIGURED');
  let response;
  try {
    response = await fetchWithTimeout(`${paypalBaseUrl()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    }, 15000);
  } catch {
    throw new AppError('Could not reach PayPal authentication. Check your connection and PayPal mode.', 502, 'PAYPAL_AUTH_NETWORK_ERROR');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(data.error_description || data.message || 'PayPal OAuth authentication failed.', 502, 'PAYPAL_AUTH_FAILED', { paypalStatus: response.status });
  return data.access_token;
}

async function paypalRequest(path, { method = 'GET', body, token } = {}) {
  const accessToken = token || await getPayPalAccessToken();
  let response;
  try {
    response = await fetchWithTimeout(`${paypalBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new AppError('The connection to PayPal failed or timed out. The payout outcome may be unknown; do not create a fresh payout until it is reconciled.', 504, 'PAYPAL_OUTCOME_UNKNOWN');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.details?.[0]?.description || `PayPal returned HTTP ${response.status}.`;
    const error = new AppError(message, response.status >= 500 ? 502 : 422, 'PAYPAL_API_ERROR', { paypalStatus: response.status, name: data.name, details: data.details || [] });
    error.paypalStatus = response.status;
    error.paypalPayload = data;
    throw error;
  }
  return data;
}

export async function createPayout({ batchId, recipientEmail, amount, currency, evaluationId, taskTitle }) {
  return paypalRequest('/v1/payments/payouts', {
    method: 'POST',
    body: {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'Your contribution reward is on its way',
        email_message: `Your contribution for "${String(taskTitle).slice(0, 160)}" has been approved through PR2PAY.`
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: amount, currency },
        receiver: recipientEmail,
        note: `PR2PAY approved contribution ${evaluationId}`,
        sender_item_id: `PR2PAY-${evaluationId}`.slice(0, 30)
      }]
    }
  });
}

export async function getPayoutBatch(payoutBatchId) {
  return paypalRequest(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
}

export async function verifyPayPalWebhook(headers, event) {
  if (!process.env.PAYPAL_WEBHOOK_ID) throw new AppError('PAYPAL_WEBHOOK_ID is not configured; webhook event was not trusted.', 503, 'PAYPAL_WEBHOOK_NOT_CONFIGURED');
  const token = await getPayPalAccessToken();
  const body = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event
  };
  const result = await paypalRequest('/v1/notifications/verify-webhook-signature', { method: 'POST', body, token });
  return result.verification_status === 'SUCCESS';
}

export function normalizePayoutStatus(status) {
  const value = String(status || '').toUpperCase();
  if (['SUCCESS', 'SUCCEEDED'].includes(value)) return 'completed';
  if (['DENIED', 'CANCELED', 'FAILED'].includes(value)) return 'failed';
  if (['PENDING', 'PROCESSING', 'ACKNOWLEDGED', 'NEW', 'UNCLAIMED', 'HELD', 'ONHOLD'].includes(value)) return 'processing';
  return 'reconciliation_required';
}
