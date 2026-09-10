// R1 allowlist — the ONLY URL patterns the extension ever matches.
// No full browsing-history collection: anything outside this list is ignored.
export const ALLOWLIST = [
  /^https:\/\/openrouter\.ai\/models\/.+/,
  /^https:\/\/openai\.com\//,
  /^https:\/\/www\.anthropic\.com\//,
  /^https:\/\/ai\.google\.dev\//,
  /^https:\/\/chat\.openai\.com\//,
  /^https:\/\/claude\.ai\//,
  /^https:\/\/gemini\.google\.com\//,
];

export function isAllowedUrl(url) {
  return ALLOWLIST.some((re) => re.test(url));
}
