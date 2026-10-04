import type { State, Inspector, CommandResult } from '../shared/contracts.js';
import { element } from './dom.js';
const token = element<HTMLMetaElement>('meta[name="operator-token"]').content;
async function json<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    location.replace('/');
    throw new Error('Your owner session has expired. Sign in again.');
  }
  const data = (await response.json()) as T & { detail?: string };
  if (!response.ok)
    throw new Error(
      typeof data.detail === 'string' ? data.detail : 'Check the entered values and try again.',
    );
  return data;
}
export const getState = () => fetch('/api/state', { cache: 'no-store' }).then(json<State>);
export const getInspector = () =>
  fetch('/api/inspector', { cache: 'no-store' }).then(json<Inspector>);
export function command(
  path: string,
  body: unknown = {},
  method = 'POST',
  key: string = crypto.randomUUID(),
) {
  return fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-Token': token,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  }).then(json<CommandResult>);
}
export const money = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);
export const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const date = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export function minor(value: unknown) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error('Enter a positive dollar amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.'),
    amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large.');
  return amount;
}
