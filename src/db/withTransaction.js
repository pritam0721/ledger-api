const pool = require('../config/db');

/**
 * Runs `fn(client)` inside a single database transaction.
 * COMMIT on success, ROLLBACK (and rethrow) on any error, so a transaction
 * row and its balance update are always persisted together or not at all.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = withTransaction;
