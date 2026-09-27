import { TEST_USER } from './fixtures';

export default async function globalTeardown() {
  try {
    await fetch('http://localhost:4000/api/__test/seed-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    console.log(`[e2e] Cleaned up test user: ${TEST_USER.email}`);
  } catch (err) {
    console.warn('[e2e] teardown skipped:', err);
  }
}
