import { describe, it, expect } from 'vitest';
import { addError, formError, isDirty, isValidEmail, normalizeEmail, toForm, toPayload, MAX_EMAILS } from './businessEmails.js';

const account = {
  id: 5, company_name: 'Test Co', unit_count: 3,
  billing_emails: ['a@example.com'],
  daily_report: { enabled: false, emails: [] },
  weekly_report: { enabled: true, emails: ['w@example.com'] },
};

describe('email helpers', () => {
  it('normalizes', () => {
    expect(normalizeEmail('  A@Example.COM ')).toBe('a@example.com');
  });
  it('validates', () => {
    expect(isValidEmail('x@example.com')).toBe(true);
    expect(isValidEmail('x@')).toBe(false);
    expect(isValidEmail('x example@a.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
  it('addError covers empty, invalid, duplicate and cap', () => {
    expect(addError([], '')).toMatch(/Enter an email/);
    expect(addError([], 'bad')).toMatch(/valid/);
    expect(addError(['a@example.com'], 'A@example.com ')).toMatch(/Already/);
    const full = Array.from({ length: MAX_EMAILS }, (_, i) => `u${i}@example.com`);
    expect(addError(full, 'new@example.com')).toMatch(/At most/);
    expect(addError([], 'ok@example.com')).toBeNull();
  });
});

describe('form', () => {
  it('requires a billing email', () => {
    expect(formError({ ...toForm(account), billing_emails: [] })).toMatch(/billing/);
  });
  it('requires a recipient for an enabled report', () => {
    const f = toForm(account);
    f.daily_report.enabled = true;
    expect(formError(f)).toMatch(/daily/);
    f.daily_report.emails.push('d@example.com');
    expect(formError(f)).toBeNull();
  });
  it('allows recipients on a disabled report', () => {
    const f = toForm(account);
    f.weekly_report.enabled = false;
    expect(formError(f)).toBeNull();
  });
  it('payload matches the API shape', () => {
    expect(toPayload(toForm(account))).toEqual({
      billing_emails: ['a@example.com'],
      daily_report: { enabled: false, emails: [] },
      weekly_report: { enabled: true, emails: ['w@example.com'] },
    });
  });
  it('toForm copies, so editing does not mutate the account', () => {
    const f = toForm(account);
    f.billing_emails.push('b@example.com');
    f.weekly_report.emails.length = 0;
    expect(account.billing_emails).toEqual(['a@example.com']);
    expect(account.weekly_report.emails).toEqual(['w@example.com']);
  });
  it('isDirty detects changes only', () => {
    const f = toForm(account);
    expect(isDirty(f, account)).toBe(false);
    f.daily_report.enabled = true;
    expect(isDirty(f, account)).toBe(true);
  });
});
