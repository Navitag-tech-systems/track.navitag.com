import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const send = vi.fn();
vi.mock('@/utils/http', () => ({ request: { send: (...a) => send(...a) } }));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({ idToken: 'tok' }) }));
vi.mock('@/utils/variables', () => ({ baseUrl: 'https://api.test/v1' }));

import BusinessEmailSettings from './BusinessEmailSettings.vue';

const ACCOUNT = {
  id: 5, company_name: 'Test Co', unit_count: 3,
  billing_emails: ['main@example.com', 'cc@example.com'],
  daily_report: { enabled: false, emails: [] },
  weekly_report: { enabled: true, emails: ['w@example.com'] },
};

async function mountWith(getResult) {
  send.mockReset();
  if (getResult instanceof Error) send.mockRejectedValueOnce(getResult);
  else send.mockResolvedValueOnce(getResult);
  const w = mount(BusinessEmailSettings);
  await flushPromises();
  return w;
}

const saveButton = (w) => w.findAll('button').find((b) => b.text().includes('Save Business Emails'));

describe('BusinessEmailSettings', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('renders nothing for a non-owner', async () => {
    const w = await mountWith({ accounts: [] });
    expect(w.text()).toBe('');
    expect(send).toHaveBeenCalledWith({ url: 'https://api.test/v1/business/settings', token: 'tok' });
  });

  it('renders nothing when the fetch fails', async () => {
    const w = await mountWith(new Error('HTTP 500'));
    expect(w.text()).toBe('');
  });

  it('renders the account with its lists and switches', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    expect(w.text()).toContain('Business emails');
    expect(w.text()).toContain('Test Co · 3 business units');
    expect(w.text()).toContain('main@example.com');
    expect(w.text()).toContain('w@example.com');
    const toggles = w.findAll('button[aria-pressed]');
    expect(toggles.map((t) => t.attributes('aria-pressed'))).toEqual(['false', 'true']);
    expect(saveButton(w).attributes('disabled')).toBeDefined(); // nothing changed yet
  });

  it('adds, validates and removes addresses', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    const forms = w.findAll('form');
    const billingInput = forms[0].find('input');

    await billingInput.setValue('not-an-email');
    await forms[0].trigger('submit');
    expect(w.text()).toContain('Enter a valid email address.');

    await billingInput.setValue('  New@Example.com ');
    await forms[0].trigger('submit');
    expect(w.text()).toContain('new@example.com');
    expect(saveButton(w).attributes('disabled')).toBeUndefined();

    await billingInput.setValue('NEW@example.com');
    await forms[0].trigger('submit');
    expect(w.text()).toContain('Already in the list.');

    await w.find('button[aria-label="Remove cc@example.com"]').trigger('click');
    expect(w.text()).not.toContain('cc@example.com');
  });

  it('refuses to save an enabled report with no recipients, without calling the API', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    await w.findAll('button[aria-pressed]')[0].trigger('click'); // daily on, no emails
    await saveButton(w).trigger('click');
    expect(w.text()).toContain('Add at least one daily report email or turn the daily report off.');
    expect(send).toHaveBeenCalledTimes(1); // only the GET
  });

  it('refuses to save with no billing email', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    await w.find('button[aria-label="Remove main@example.com"]').trigger('click');
    await w.find('button[aria-label="Remove cc@example.com"]').trigger('click');
    await saveButton(w).trigger('click');
    expect(w.text()).toContain('Add at least one billing email.');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('PUTs the edited settings and shows the server copy', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    await w.findAll('button[aria-pressed]')[1].trigger('click'); // weekly off
    const saved = { ...ACCOUNT, weekly_report: { enabled: false, emails: ['w@example.com'] } };
    send.mockResolvedValueOnce({ account: saved });
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith({
      url: 'https://api.test/v1/business/settings/5',
      method: 'PUT',
      token: 'tok',
      data: {
        billing_emails: ['main@example.com', 'cc@example.com'],
        daily_report: { enabled: false, emails: [] },
        weekly_report: { enabled: false, emails: ['w@example.com'] },
      },
    });
    expect(w.text()).toContain('Saved.');
    expect(saveButton(w).attributes('disabled')).toBeDefined();
  });

  it('shows the API error on a failed save', async () => {
    const w = await mountWith({ accounts: [ACCOUNT] });
    await w.findAll('button[aria-pressed]')[1].trigger('click');
    send.mockRejectedValueOnce(new Error('Business account not found'));
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Business account not found');
  });
});
