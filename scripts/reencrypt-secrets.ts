import { reencryptAllConnectorSecrets } from '../src/lib/db/queries';

async function main() {
  console.log('Starting connector secret re-encryption...');
  try {
    const result = await reencryptAllConnectorSecrets();
    console.log(`Re-encryption complete: ${result.reencrypted} re-encrypted, ${result.failed.length} failed`);
    if (result.failed.length > 0) {
      console.log('Failed:', result.failed);
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error('Re-encryption failed:', err);
    process.exit(1);
  }
}

main();