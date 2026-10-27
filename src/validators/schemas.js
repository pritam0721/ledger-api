const { z } = require('zod');
const AppError = require('../utils/AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d{1,15}(\.\d{1,2})?$/;

const TYPES = ['credit', 'debit'];

const uuid = (field) =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} must be a string` })
    .regex(UUID_RE, `${field} must be a valid UUID`);

// Money is kept as a string end-to-end (never a float). Max 2 decimal places.
const amount = z
  .union([z.number(), z.string()], {
    errorMap: () => ({ message: 'amount is required and must be a number' }),
  })
  .transform((v) => String(v).trim())
  .refine((v) => AMOUNT_RE.test(v), 'amount must be a positive number with at most 2 decimal places')
  .refine((v) => !AMOUNT_RE.test(v) || Number(v) > 0, 'amount must be greater than 0');

const referenceId = z
  .string({ required_error: 'reference_id is required', invalid_type_error: 'reference_id must be a string' })
  .trim()
  .min(1, 'reference_id is required')
  .max(100, 'reference_id must be at most 100 characters');

const description = z
  .string({ invalid_type_error: 'description must be a string' })
  .trim()
  .max(500, 'description must be at most 500 characters')
  .nullish()
  .transform((v) => (v ? v : null));

const createAccount = z
  .object({
    name: z
      .string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
      .trim()
      .min(1, 'name is required')
      .max(100, 'name must be at most 100 characters'),
  })
  .strict({ message: 'Unknown field(s) in request body (balance cannot be set by the client)' });

const createTransaction = z
  .object({
    type: z.enum(TYPES, {
      errorMap: () => ({ message: 'type must be either "credit" or "debit"' }),
    }),
    amount,
    description,
    reference_id: referenceId,
  })
  .strict({ message: 'Unknown field(s) in request body' });

const createTransfer = z
  .object({
    from_account_id: uuid('from_account_id'),
    to_account_id: uuid('to_account_id'),
    amount,
    description,
    reference_id: referenceId,
  })
  .strict({ message: 'Unknown field(s) in request body' });

function parseAccountId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new AppError(400, 'INVALID_ACCOUNT_ID', 'Account ID must be a valid UUID');
  }
  return value;
}

function parseHistoryQuery(query) {
  const { type, page = '1', limit = '10' } = query;

  if (type !== undefined && !TYPES.includes(type)) {
    throw new AppError(400, 'INVALID_TRANSACTION_TYPE', 'type must be either "credit" or "debit"');
  }

  const pageStr = String(page);
  const limitStr = String(limit);
  if (!/^\d+$/.test(pageStr) || Number(pageStr) < 1) {
    throw new AppError(400, 'INVALID_PAGINATION', 'page must be an integer >= 1');
  }
  if (!/^\d+$/.test(limitStr) || Number(limitStr) < 1 || Number(limitStr) > 100) {
    throw new AppError(400, 'INVALID_PAGINATION', 'limit must be an integer between 1 and 100');
  }

  return { type, page: Number(pageStr), limit: Number(limitStr) };
}

module.exports = {
  createAccount,
  createTransaction,
  createTransfer,
  parseAccountId,
  parseHistoryQuery,
};
