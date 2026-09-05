/**
 * Escapes a string for safe interpolation into XML/SVG content.
 * Replaces characters that could break out of XML structure.
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escapes a string for safe interpolation into HTML content.
 * Prevents XSS by encoding characters that could form executable markup.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes a hex color string for safe use in SVG attributes.
 * Only allows characters valid in hex color values.
 */
export function sanitizeColor(color: string): string {
  if (!color) return '#4B5563';
  const cleaned = color.replace(/[^a-fA-F0-9]/g, '');
  if (cleaned.length === 0 || cleaned.length > 6) return '#4B5563';
  return `#${cleaned}`;
}
