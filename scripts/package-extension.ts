import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * R1/R2 store packaging: validates manifests, typechecks the vscode
 * extension standalone, and zips both packages into dist/.
 * Requires `zip` on PATH (standard on CI runners; on Windows use
 * `Compress-Archive` on the same directories instead).
 */
/** Exported for tests: refuses over-broad manifests before any packaging. */
export function checkManifest(rootDir = process.cwd()): { matches: number } {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'extensions', 'browser', 'manifest.json'), 'utf-8')
  );
  const matches: string[] = manifest.content_scripts?.[0]?.matches || [];
  if (matches.length === 0) {
    throw new Error('Refusing to package: manifest has no content-script matches.');
  }
  if (matches.some((m) => m.includes('<all_urls>'))) {
    throw new Error('Refusing to package: manifest contains <all_urls>.');
  }
  if (!fs.existsSync(path.join(rootDir, 'extensions', 'browser', 'PRIVACY.md'))) {
    throw new Error('Refusing to package: extensions/browser/PRIVACY.md missing.');
  }
  console.log(`Browser manifest OK (${matches.length} match patterns, no <all_urls>).`);
  return { matches: matches.length };
}

function main() {
  checkManifest();
  // Standalone typecheck needs the extension's own devDeps; the root
  // install deliberately excludes them (extensions are separate packages).
  if (fs.existsSync(path.join(process.cwd(), 'node_modules', '@types', 'vscode'))) {
    execSync('npx tsc -p extensions/vscode/tsconfig.json --noEmit', { stdio: 'inherit' });
    console.log('VSCode extension typechecks standalone.');
  } else {
    console.log('Skipping vscode typecheck (@types/vscode not installed; run npm i inside extensions/vscode for the full check).');
  }
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
  execSync('zip -qr dist/ai-model-radar-browser.zip extensions/browser -x "*.DS_Store"', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  execSync('zip -qr dist/ai-model-radar-vscode.zip extensions/vscode -x "*.DS_Store" -x "extensions/vscode/out/*"', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  console.log('Packaged: dist/ai-model-radar-browser.zip, dist/ai-model-radar-vscode.zip');
}

// Only execute directly when run as CLI script (import-safe for tests).
if (require.main === module) {
  main();
}
