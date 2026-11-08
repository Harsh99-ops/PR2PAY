import { AppError } from './errors.js';

const SUPPORTED_REWARD_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'HKD', 'CHF', 'NZD']);

export function parseRewardFromIssue(body) {
  const topLines = String(body || '').split(/\r?\n/).slice(0, 8);
  const rewardLine = topLines.find(line => /^\s*(?:\*\*)?reward(?:\*\*)?\s*:/i.test(line));
  if (!rewardLine) {
    throw new AppError('Add a reward line near the top of the GitHub Issue, for example: Reward: 25.00 USD.', 422, 'REWARD_NOT_FOUND');
  }
  const match = rewardLine.match(/^\s*(?:\*\*)?reward(?:\*\*)?\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)\s+([A-Za-z]{3})\s*$/i);
  if (!match) throw new AppError('Reward format must be: Reward: 25.00 USD (amount followed by a three-letter currency).', 422, 'INVALID_REWARD_FORMAT');
  const amount = Number(match[1]);
  const currency = match[2].toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new AppError('Reward must be greater than zero and no more than 100,000.', 422, 'INVALID_REWARD_AMOUNT');
  if (!SUPPORTED_REWARD_CURRENCIES.has(currency)) throw new AppError(`Currency ${currency} is not enabled in this PR2PAY build.`, 422, 'UNSUPPORTED_REWARD_CURRENCY');
  if (currency === 'JPY' && !Number.isInteger(amount)) throw new AppError('JPY rewards must be whole numbers.', 422, 'INVALID_REWARD_PRECISION');
  return { amount: amount.toFixed(currency === 'JPY' ? 0 : 2), currency };
}

export function extractAcceptanceCriteria(body) {
  const text = String(body || '');
  const hasAcceptanceHeading = /^\s*#{1,6}\s*(?:acceptance criteria|requirements)\s*$/im.test(text);
  const sectionBullets = extractBulletsUnderAcceptanceHeading(text);
  const checkboxItems = [...text.matchAll(/^\s*[-*]\s+\[(?: |x|X)\]\s+(.+?)\s*$/gm)].map(match => match[1].trim());
  const source = hasAcceptanceHeading ? sectionBullets : checkboxItems;
  const unique = [...new Set(source.filter(item => item.length >= 4))];
  if (unique.length === 0) {
    throw new AppError('Add acceptance criteria to the Issue using checklist items such as - [ ] Add validation. The AI needs explicit criteria to evaluate.', 422, 'CRITERIA_NOT_FOUND');
  }
  if (unique.length > 25) throw new AppError('Keep the Issue to 25 or fewer acceptance criteria for a focused review.', 422, 'TOO_MANY_CRITERIA');
  return unique.map((description, index) => ({ id: `C${index + 1}`, description }));
}

function extractBulletsUnderAcceptanceHeading(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*#{1,6}\s*(?:acceptance criteria|requirements)\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s+/.test(line)) break;
    const match = line.match(/^\s*[-*+]\s+(?:\[(?: |x|X)\]\s+)?(.+?)\s*$/);
    if (match) out.push(match[1].trim());
  }
  return out;
}
