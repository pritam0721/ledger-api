const pool = require('../config/db');
const AppError = require('../utils/AppError');

const ACCOUNT_COLUMNS = 'id, name, balance, created_at';

async function createAccount(name) {
  // balance is never taken from the client; the column default (0) is used.
  const { rows } = await pool.query(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING ${ACCOUNT_COLUMNS}`,
    [name]
  );
  return rows[0];
}

async function getAccount(id) {
  const { rows } = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [id]);
  if (rows.length === 0) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${id} not found`);
  }
  return rows[0];
}

async function getBalance(id) {
  const account = await getAccount(id);
  return { account_id: account.id, balance: account.balance };
}

module.exports = { createAccount, getAccount, getBalance };
