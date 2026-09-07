import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeXml, sanitizeCdata, sanitizeColor } from '../src/lib/sanitize';

describe('sanitize helpers (digest/feed/badge XSS guards)', () => {
  it('escapeHtml neutralizes markup payloads', () => {
    expect(escapeHtml('"><script>alert(1)</script>')).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapeXml encodes XML metacharacters', () => {
    expect(escapeXml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });

  it('sanitizeCdata neutralizes CDATA breakout but leaves entities alone', () => {
    expect(sanitizeCdata('New Model ]]><script>alert(1)</script>')).toBe(
      'New Model ]] ><script>alert(1)</script>'
    );
    // Plain text (including <, >, &) passes through: CDATA is character data,
    // and entity-escaping inside CDATA would render literally in readers.
    expect(sanitizeCdata('A & B < C')).toBe('A & B < C');
    expect(sanitizeCdata('')).toBe('');
  });

  it('sanitizeColor rejects non-hex input', () => {
    expect(sanitizeColor('#38BDF8')).toBe('#38BDF8');
    expect(sanitizeColor('xyz!!!')).toBe('#4B5563');
    expect(sanitizeColor('#aabbccddeeff00')).toBe('#4B5563');
  });
});
