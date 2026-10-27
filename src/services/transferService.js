const withTransaction = require('../db/withTransaction');
const AppError = require('../utils/AppError');

const TXN_COLUMNS = 'id, account_id, type, amount, description, reference_id, created_at';

/**
 * Moves money between two accounts atomically.
 * - Both accounts are locked in id order (prevents deadlocks between opposite transfers).
 * - Debit row + credit row + both balance updates commit together or not at all.
 * - Idempotent on reference_id: stored as "<ref>:debit" (source) and "<ref>:credit" (destination).
 */
async function transfer({ from_account_id: fromId, to_account_id: toId, amount, description, reference_id: ref }) {
  if (fromId.toLowerCase() === toId.toLowerCase()) {
    throw new AppError(400, 'SAME_ACCOUNT_TRANSFER', 'Source and destination accounts must be different');
  }

  const debitRef = `${ref}:debit`;
  const creditRef = `${ref}:credit`;

  return withTransaction(async (client) => {
    const locked = await client.query(
      'SELECT id, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[fromId, toId]]
    );
    const foundIds = locked.rows.map((r) => r.id);
    if (!foundIds.includes(fromId.toLowerCase())) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Source account ${fromId} not found`);
    }
    if (!foundIds.includes(toId.toLowerCase())) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Destination account ${toId} not found`);
    }

    // Duplicate transfer: return the original rows, change nothing.
    const existing = await client.query(
      `SELECT ${TXN_COLUMNS} FROM transactions
       WHERE (account_id = $1 AND reference_id = $2) OR (account_id = $3 AND reference_id = $4)`,
      [fromId, debitRef, toId, creditRef]
    );
    if (existing.rowCount > 0) {
      const balances = await client.query('SELECT id, balance FROM accounts WHERE id = ANY($1::uuid[])', [[fromId, toId]]);
      const bal = Object.fromEntries(balances.rows.map((r) => [r.id, r.balance]));
      return {
        duplicate: true,
        debit_transaction: existing.rows.find((r) => r.type === 'debit') || null,
        credit_transaction: existing.rows.find((r) => r.type === 'credit') || null,
        from_balance: bal[fromId.toLowerCase()],
        to_balance: bal[toId.toLowerCase()],
      };
    }

    const debited = await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
      [amount, fromId]
    );
    if (debited.rowCount === 0) {
      const current = locked.rows.find((r) => r.id === fromId.toLowerCase());
      throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance in source account', {
        balance: current.balance,
        requested: amount,
      });
    }

    const credited = await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, toId]
    );

    const debitTxn = await client.query(
      `INSERT INTO transactions (account_id, type, amount, description, reference_id)
       VALUES ($1, 'debit', $2, $3, $4) RETURNING ${TXN_COLUMNS}`,
      [fromId, amount, description || `Transfer to ${toId}`, debitRef]
    );
    const creditTxn = await client.query(
      `INSERT INTO transactions (account_id, type, amount, description, reference_id)
       VALUES ($1, 'credit', $2, $3, $4) RETURNING ${TXN_COLUMNS}`,
      [toId, amount, description || `Transfer from ${fromId}`, creditRef]
    );

    return {
      duplicate: false,
      debit_transaction: debitTxn.rows[0],
      credit_transaction: creditTxn.rows[0],
      from_balance: debited.rows[0].balance,
      to_balance: credited.rows[0].balance,
    };
  });
}

module.exports = { transfer };
