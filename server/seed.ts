import { Storage, genId } from './storage';
import { hashPin } from './credentials';
import { pool } from './db';

const REQUIRED_BOOTSTRAP_FIELDS = [
  'BOOTSTRAP_OWNER_USERNAME',
  'BOOTSTRAP_OWNER_PIN',
  'BOOTSTRAP_STORE_NAME',
  'BOOTSTRAP_STORE_CATEGORY',
] as const;

async function seed() {
  const missing = REQUIRED_BOOTSTRAP_FIELDS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Manual owner bootstrap requires: ${missing.join(', ')}.`);
  }

  const username = process.env.BOOTSTRAP_OWNER_USERNAME!.trim();
  const pin = process.env.BOOTSTRAP_OWNER_PIN!;
  const storeName = process.env.BOOTSTRAP_STORE_NAME!.trim();
  const storeCategory = process.env.BOOTSTRAP_STORE_CATEGORY!.trim();

  const existing = await Storage.getUserByUsername(username);
  if (existing) throw new Error('The requested bootstrap username already exists.');
  if (!storeName || !username) throw new Error('Bootstrap owner and store names cannot be blank.');
  if (!['grocery', 'medicine', 'clothing', 'electronics', 'restaurant', 'other'].includes(storeCategory)) {
    throw new Error('BOOTSTRAP_STORE_CATEGORY is not supported.');
  }

  await Storage.createUser({
    id: genId(),
    storeName,
    storeCategory,
    username,
    pin: await hashPin(pin),
    plan: 'free',
    subscriptionStatus: 'active',
    failedLoginAttempts: 0,
    isLocked: false,
  });
  console.log('Bootstrap owner account created.');
}

seed().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Owner bootstrap failed.');
  process.exitCode = 1;
}).finally(() => {
  void pool?.end();
});
