# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credit/debit transactions, read balances and history, and (bonus) transfer money between accounts atomically.

**Stack:** Node.js (>= 18), Express, PostgreSQL (Supabase), `pg` (raw SQL), `zod` (validation).

Full endpoint documentation: [docs/API.md](docs/API.md)

---

## Run locally

### 1. Prerequisites
- Node.js 18 or newer
- A Postgres database. This project is set up for **Supabase**, but any Postgres works.

### 2. Install
```bash
npm install
```

### 3. Configure the database
Copy the example env file and fill it in:
```bash
cp .env.example .env
```
In Supabase: **Connect** (top of dashboard) -> **Session pooler** -> copy the URI into `DATABASE_URL`, replacing `[YOUR-PASSWORD]` with your database password (URL-encode special characters, e.g. `@` -> `%40`).

> Use the **Session pooler** string. The direct connection is IPv6-only on Supabase's free tier and often fails from IPv4 networks and from Render.

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
PORT=3000
```

### 4. Create the tables
```bash
npm run migrate
```
This runs `src/db/schema.sql` (safe to run repeatedly). You should now see `accounts` and `transactions` in the Supabase Table Editor.

### 5. Start the server
```bash
npm run dev      # auto-reload (development)
npm start        # production
```
Check it: `curl http://localhost:3000/health` -> `{"status":"ok"}`

### 6. Run the smoke tests (optional but recommended)
With the server running in another terminal:
```bash
npm run smoke
# or against a deployed URL:
BASE_URL=https://your-app.onrender.com npm run smoke
```
The script exercises every rule in the assignment: balances, duplicates, overdraft, validation, pagination, parallel debits, transfers and deadlock safety.

---

## Deploy to Render

1. Push the repo to GitHub.
2. Render -> **New** -> **Web Service** -> pick the repo.
3. Build command: `npm install` | Start command: `npm start`
4. Environment variable: `DATABASE_URL` = your Supabase **Session pooler** string. (Render sets `PORT` itself.)
5. Run `npm run migrate` once from your machine (it uses the same database), or use build command `npm install && npm run migrate`.

> Supabase free projects pause after about a week of inactivity. If the API returns database errors after a long idle period, restore the project from the Supabase dashboard. Render free web services also spin down when idle, so the first request can take ~30-60 seconds.

---

## Project structure

```
src/
  server.js                 starts the HTTP server, graceful shutdown
  app.js                    express app: JSON parsing, /health, routes, error handling
  config/db.js              pg connection pool (SSL for Supabase)
  db/
    schema.sql              tables, constraints, indexes, immutability trigger
    migrate.js              applies schema.sql
    withTransaction.js      BEGIN / COMMIT / ROLLBACK helper
  routes/index.js           route definitions
  controllers/              request parsing + response shaping
  services/                 business logic and all SQL
  validators/schemas.js     zod schemas, UUID and pagination validation
  middleware/error.js       one consistent error format + 404 handler
  utils/                    AppError, asyncHandler
scripts/smoke-test.js       end-to-end checks
docs/API.md                 API documentation
```

---

## How the data-integrity requirements are met

| Requirement | How |
|---|---|
| Unique account id, system-generated `created_at` | UUID primary key with `gen_random_uuid()`, `created_at` defaults to `now()` |
| Initial balance is always 0 | Insert never sets `balance`; column defaults to 0. A request containing `balance` is rejected with 400 |
| Balance never negative | `CHECK (balance >= 0)` plus an atomic `UPDATE ... WHERE balance >= amount` for debits |
| Atomic transaction + balance update | Both statements run in one DB transaction (`withTransaction`); any error rolls back everything |
| No lost updates under concurrency | The account row is locked with `SELECT ... FOR UPDATE` for the duration of the DB transaction |
| Duplicate `reference_id` per account | `UNIQUE (account_id, reference_id)` constraint, plus a check under the account lock. The same reference can be used on different accounts |
| Immutability | No PUT/PATCH/DELETE routes **and** a database trigger that rejects `UPDATE`/`DELETE` on `transactions` |
| Amount > 0, type is credit/debit | Validated in the API and enforced by `CHECK` constraints |
| Money precision | `NUMERIC(20,2)` in the database; amounts travel as strings, never floats |
| Transfers are all-or-nothing | One DB transaction: debit row, credit row and both balance updates commit together or not at all. Accounts are locked in id order to avoid deadlocks |
| Latest-first history | `ORDER BY created_at DESC` (with `id` as tie-breaker); `created_at` uses `clock_timestamp()` so it reflects the real insert time |

### Error format
Every error uses the same shape:
```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit", "details": { } } }
```

| Situation | Status | Code |
|---|---|---|
| Invalid body / JSON / missing field | 400 | `VALIDATION_ERROR`, `INVALID_REQUEST_BODY` |
| Invalid transaction type | 400 | `INVALID_TRANSACTION_TYPE` |
| Invalid amount | 400 | `INVALID_AMOUNT` |
| Invalid account id format | 400 | `INVALID_ACCOUNT_ID` |
| Invalid pagination | 400 | `INVALID_PAGINATION` |
| Transfer to the same account | 400 | `SAME_ACCOUNT_TRANSFER` |
| Account not found | 404 | `ACCOUNT_NOT_FOUND` |
| Insufficient balance | 422 | `INSUFFICIENT_BALANCE` |
| Duplicate `reference_id` | 200 | (success body with `"duplicate": true`) |

---

## Assumptions

1. **Single currency.** Amounts are decimal numbers with at most 2 decimal places (max 15 integer digits).
2. **Duplicate = idempotent success.** A repeated `reference_id` on the same account returns **200** with `"duplicate": true` and the original transaction. No new row is created and the balance does not change. (Returning 200 rather than an error makes client retries safe.) The comparison is by `reference_id` only; if the repeated request has a different amount or type, the original transaction is still returned unchanged.
3. **Account ids and transaction ids are UUIDs.**
4. **`reference_id` is a client-supplied string** (max 100 characters), trimmed of surrounding whitespace.
5. **Balance cannot be set by the client.** A `balance` field in `POST /accounts` is rejected with 400 rather than silently ignored.
6. **No authentication.** The assignment does not require it; every endpoint is open.
7. **Transfers** require a `reference_id`. It is stored on the two ledger rows as `<reference_id>:debit` (source account) and `<reference_id>:credit` (destination account), which makes transfers idempotent too. Transfers appear in each account's normal transaction history as a debit and a credit.
8. **Account deletion is not supported**, since ledger history must be preserved.
9. **History default page size is 10**, maximum 100.
10. **Timestamps** are stored as `timestamptz` and returned in ISO 8601 UTC.

---

## Notes

- `npm audit` may report an advisory for `zod` (oversized constrained arrays). This API validates no array fields and caps request bodies at 100 KB, so it is not reachable here.
- Never commit your `.env`. It is in `.gitignore`.
