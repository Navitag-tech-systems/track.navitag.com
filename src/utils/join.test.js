import { describe, it, expect } from 'vitest';
import { resolveLanding } from './join';

describe('resolveLanding', () => {
  it('defaults to login', () => {
    expect(resolveLanding(undefined, undefined)).toBe('login');
    expect(resolveLanding('', 'bogus')).toBe('login');
  });
  it('uses the link setting', () => {
    expect(resolveLanding(undefined, 'signup')).toBe('signup');
  });
  it('?start= overrides the link setting, case-insensitive', () => {
    expect(resolveLanding('signup', 'login')).toBe('signup');
    expect(resolveLanding('LOGIN', 'signup')).toBe('login');
    expect(resolveLanding('nope', 'signup')).toBe('signup');
  });
});
