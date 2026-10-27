const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const account = require('../controllers/account.controller');
const transaction = require('../controllers/transaction.controller');
const transfer = require('../controllers/transfer.controller');

const router = express.Router();

// Accounts
router.post('/accounts', asyncHandler(account.create));
router.get('/accounts/:id', asyncHandler(account.get));
router.get('/accounts/:id/balance', asyncHandler(account.balance));

// Transactions (create + read only: no PUT/PATCH/DELETE exist by design)
router.post('/accounts/:id/transactions', asyncHandler(transaction.create));
router.get('/accounts/:id/transactions', asyncHandler(transaction.list));

// Transfers (bonus)
router.post('/transfers', asyncHandler(transfer.create));

module.exports = router;
