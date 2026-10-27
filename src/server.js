const app = require('./app');
const pool = require('./config/db');

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Ledger API listening on port ${PORT}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
