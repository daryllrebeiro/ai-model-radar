#!/usr/bin/env node

// Forward CLI calls to TypeScript runtime or compiled module
const path = require('node:path');

try {
  // If running in development or tsx is available
  require('tsx/cjs');
  const { executeCli } = require('../src/cli/index.ts');
  const args = process.argv.slice(2);
  executeCli(args)
    .then((out) => {
      console.log(out);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
} catch (e) {
  // Fallback direct execution
  const { executeCli } = require('../src/cli/index');
  const args = process.argv.slice(2);
  executeCli(args)
    .then((out) => {
      console.log(out);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
