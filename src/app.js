const express = require('express');
const pool = require('./config/db');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.use(express.json({ limit: '100kb' }));

app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      name: 'Transaction Ledger API',
      status: 'running',
      health: '/health',
      endpoints: [
        'POST /accounts',
        'GET /accounts/:id',
        'GET /accounts/:id/balance',
        'POST /accounts/:id/transactions',
        'GET /accounts/:id/transactions',
        'POST /transfers',
      ],
      docs: 'See README.md and docs/API.md in the repository',
    });
  } catch (err) {
    res
      .status(503)
      .json({ status: 'unavailable', message: 'Database not reachable' });
  }
});

app.use(routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
