const transferService = require('../services/transferService');
const schemas = require('../validators/schemas');

exports.create = async (req, res) => {
  const input = schemas.createTransfer.parse(req.body ?? {});
  const result = await transferService.transfer(input);

  if (result.duplicate) {
    return res.status(200).json({
      ...result,
      message: 'Transfer with this reference_id already exists; no changes made',
    });
  }
  return res.status(201).json({ ...result, message: 'Transfer completed' });
};
