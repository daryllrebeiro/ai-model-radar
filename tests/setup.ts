import fs from 'fs';
import path from 'path';

/**
 * P2-4 — test-hygiene setup. Removes per-worker JSON backends at startup so
 * every run starts from empty state ("green from empty" is the CI contract).
 * NEVER touches `.radar-data.json` — that file is local dev data, not test
 * state. Worker files are gitignored test residue by design.
 */
const root = process.cwd();
for (const f of fs.readdirSync(root)) {
  if (/^\.radar-data-worker-\d+\.json$/.test(f) || f === '.radar-data.json.tmp') {
    try {
      fs.unlinkSync(path.join(root, f));
    } catch {
      // Best-effort: a missing/locked file must not fail the suite.
    }
  }
}
