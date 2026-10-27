const accountService = require('../services/accountService');
const schemas = require('../validators/schemas');

exports.create = async (req, res) => {
  const { name } = schemas.createAccount.parse(req.body ?? {});
  const account = await accountService.createAccount(name);
  res.status(201).json(account);
};

exports.get = async (req, res) => {
  const id = schemas.parseAccountId(req.params.id);
  res.json(await accountService.getAccount(id));
};

exports.balance = async (req, res) => {
  const id = schemas.parseAccountId(req.params.id);
  res.json(await accountService.getBalance(id));
};
