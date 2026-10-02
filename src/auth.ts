import { timingSafeEqual } from 'node:crypto';

/** Compare credentials without accepting arrays or leaking same-length byte matches. */
export function matchesApiKey(value: unknown, expectedKey: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || expectedKey.length === 0) return false;
  const actual = Buffer.from(value, 'utf8');
  const expected = Buffer.from(expectedKey, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
