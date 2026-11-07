// Business email settings (GET/PUT /business/settings on api.navitag.net).
// Mirrors Services/BusinessEmailSettings::validate so the form refuses what
// the server would refuse; the server stays the authority.

export const MAX_EMAILS = 10;
export const REPORTS = ['daily', 'weekly'];

// Deliberately loose: one @, something on each side, a dot in the domain.
// The server runs FILTER_VALIDATE_EMAIL and has the last word.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidEmail(raw) {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= 255 && EMAIL_RE.test(e);
}

// Returns an error string for adding `raw` to `list`, or null when it can be added.
export function addError(list, raw) {
  const e = normalizeEmail(raw);
  if (!e) return 'Enter an email address.';
  if (!isValidEmail(e)) return 'Enter a valid email address.';
  if (list.includes(e)) return 'Already in the list.';
  if (list.length >= MAX_EMAILS) return `At most ${MAX_EMAILS} addresses.`;
  return null;
}

// Error string for the whole form, or null. `form` = API account shape.
export function formError(form) {
  if (!form.billing_emails?.length) return 'Add at least one billing email.';
  for (const r of REPORTS) {
    const block = form[`${r}_report`];
    if (block?.enabled && !block.emails?.length) {
      return `Add at least one ${r} report email or turn the ${r} report off.`;
    }
  }
  return null;
}

// PUT body from the form.
export function toPayload(form) {
  return {
    billing_emails: [...form.billing_emails],
    daily_report: { enabled: !!form.daily_report.enabled, emails: [...form.daily_report.emails] },
    weekly_report: { enabled: !!form.weekly_report.enabled, emails: [...form.weekly_report.emails] },
  };
}

// Deep copy of an API account for local editing.
export function toForm(account) {
  return {
    id: account.id,
    company_name: account.company_name,
    unit_count: account.unit_count ?? 0,
    billing_emails: [...(account.billing_emails || [])],
    daily_report: { enabled: !!account.daily_report?.enabled, emails: [...(account.daily_report?.emails || [])] },
    weekly_report: { enabled: !!account.weekly_report?.enabled, emails: [...(account.weekly_report?.emails || [])] },
  };
}

export function isDirty(form, account) {
  return JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(toForm(account)));
}
