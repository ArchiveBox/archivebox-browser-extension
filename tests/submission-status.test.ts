import { expect, test } from '@playwright/test';
import { submissionAge, submissionMessage } from '../src/lib/submissionStatus';

test('submission wording omits depth zero and explains crawl hops', () => {
  expect(submissionMessage(0)).toBe('Submitted');
  expect(submissionMessage(1)).toBe('Submitted + will crawl URLs 1 hop out');
  expect(submissionMessage(2)).toBe('Submitted + will crawl URLs 2 hops out');
});

test('historical receipt uses local date and twelve-hour time without seconds', () => {
  expect(submissionAge(new Date(2025, 11, 3, 12, 53, 27).toISOString()))
    .toBe('Previously submitted on 2025-12-03 12:53pm');
  expect(submissionAge(new Date(2025, 11, 3, 0, 3, 59).toISOString()))
    .toBe('Previously submitted on 2025-12-03 12:03am');
});

test('receipt age uses compact seconds and singular minute wording', () => {
  const now = Date.now();
  expect(submissionAge(new Date(now - 1000).toISOString(), now)).toBe('Submitted 1s ago');
  expect(submissionAge(new Date(now - 2000).toISOString(), now)).toBe('Submitted 2s ago');
  expect(submissionAge(new Date(now - 60_000).toISOString(), now)).toBe('Submitted 1 minute ago');
  expect(submissionAge(new Date(now - 120_000).toISOString(), now)).toBe('Submitted 2 minutes ago');
});
