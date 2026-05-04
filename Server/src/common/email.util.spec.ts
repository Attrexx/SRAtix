import { normalizeEmail } from './email.util';

describe('normalizeEmail', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeEmail('  Ada.Lovelace@Example.COM  ')).toBe('ada.lovelace@example.com');
  });

  it('handles empty values consistently', () => {
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });
});
