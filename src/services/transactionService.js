const pool = require('../config/db');
const withTransaction = require('../db/withTransaction');
const AppError = require('../utils/AppError');
const accountService = require('./accountService');

const TXN_COLUMNS = 'id, account_id, type, amount, description, reference_id, created_at';

async function findByReference(db, accountId, referenceId) {
  const { rows } = await db.query(
    `SELECT ${TXN_COLUMNS} FROM transactions WHERE account_id = $1 AND reference_id = $2`,
    [accountId, referenceId]
  );
  return rows[0];
}

/**
 * Adds a credit/debit to an account.
 * - One DB transaction: account row is locked (FOR UPDATE), balance updated and
 *   the transaction row inserted together, or nothing is persisted.
 * - Idempotent per (account_id, reference_id): a repeat returns the existing
 *   transaction with duplicate=true and does not touch the balance.
 */
async function addTransaction(accountId, { type, amount, description, reference_id: referenceId }) {
  try {
    return await withTransaction(async (client) => {
      // Lock the account row so concurrent requests on the same account are serialized.
      const locked = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (locked.rowCount === 0) {
        throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`);
      }

      // Duplicate check (safe from races because we hold the account lock).
      const existing = await findByReference(client, accountId, referenceId);
      if (existing) {
        const bal = await client.query('SELECT balance FROM accounts WHERE id = $1', [accountId]);
        return { duplicate: true, transaction: existing, balance: bal.rows[0].balance };
      }

      let updated;
      if (type === 'credit') {
        updated = await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2 RETURNING balance',
          [amount, accountId]
        );
      } else {
        // Only succeeds when funds are sufficient; checked atomically in SQL.
        updated = await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
          [amount, accountId]
        );
        if (updated.rowCount === 0) {
          const bal = await client.query('SELECT balance FROM accounts WHERE id = $1', [accountId]);
          throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit', {
            balance: bal.rows[0].balance,
            requested: amount,
          });
        }
      }

      const inserted = await client.query(
        `INSERT INTO transactions (account_id, type, amount, description, reference_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${TXN_COLUMNS}`,
        [accountId, type, amount, description, referenceId]
      );

      return { duplicate: false, transaction: inserted.rows[0], balance: updated.rows[0].balance };
    });
  } catch (err) {
    // Safety net: unique constraint hit (e.g. a race that bypassed the lock).
    if (err.code === '23505' && err.constraint === 'uq_account_reference') {
      const existing = await findByReference(pool, accountId, referenceId);
      const account = await accountService.getAccount(accountId);
      return { duplicate: true, transaction: existing, balance: account.balance };
    }
    throw err;
  }
}

/**
 * Paginated, filterable history, newest first.
 */
async function getHistory(accountId, { type, page, limit }) {
  await accountService.getAccount(accountId); // 404 if the account does not exist

  const params = [accountId];
  let where = 'account_id = $1';
  if (type) {
    params.push(type);
    where += ` AND type = $${params.length}`;
  }

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM transactions WHERE ${where}`, params);
  const total = countResult.rows[0].total;

  const offset = (page - 1) * limit;
  const dataResult = await pool.query(
    `SELECT ${TXN_COLUMNS} FROM transactions
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total_records: total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

module.exports = { addTransaction, getHistory };
