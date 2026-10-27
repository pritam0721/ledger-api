const { ZodError } = require('zod');
const AppError = require('../utils/AppError');

// Specific codes for the fields the assignment calls out by name.
const FIELD_CODES = {
  type: 'INVALID_TRANSACTION_TYPE',
  amount: 'INVALID_AMOUNT',
};

function notFound(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }));
    const first = err.issues[0];
    let code = 'VALIDATION_ERROR';
    if (first.path.length === 0) code = 'INVALID_REQUEST_BODY';
    else if (FIELD_CODES[first.path[0]]) code = FIELD_CODES[first.path[0]];
    return res.status(400).json({
      error: { code, message: first.message, details: issues },
    });
  }

  if (err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST_BODY', message: 'Request body is not valid JSON' },
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
  }

  // Database trigger blocking UPDATE/DELETE on transactions
  if (err.message && err.message.includes('transactions are immutable')) {
    return res.status(405).json({
      error: { code: 'TRANSACTION_IMMUTABLE', message: 'Transactions cannot be modified or deleted' },
    });
  }

  console.error(err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' },
  });
}

module.exports = { notFound, errorHandler };
