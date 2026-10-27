const transactionService = require('../services/transactionService');
const schemas = require('../validators/schemas');

exports.create = async (req, res) => {
  const accountId = schemas.parseAccountId(req.params.id);
  const input = schemas.createTransaction.parse(req.body ?? {});
  const result = await transactionService.addTransaction(accountId, input);

  if (result.duplicate) {
    return res.status(200).json({
      duplicate: true,
      message: 'Transaction with this reference_id already exists for this account; no changes made',
      transaction: result.transaction,
      balance: result.balance,
    });
  }
  return res.status(201).json({
    duplicate: false,
    message: 'Transaction created',
    transaction: result.transaction,
    balance: result.balance,
  });
};

exports.list = async (req, res) => {
  const accountId = schemas.parseAccountId(req.params.id);
  const query = schemas.parseHistoryQuery(req.query);
  res.json(await transactionService.getHistory(accountId, query));
};
