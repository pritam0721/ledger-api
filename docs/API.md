# API Documentation

Base URL: `` (local) or your Render URL.
All requests and responses are JSON (`Content-Type: application/json`).
Money values are returned as **strings** with 2 decimals (e.g. `"100.00"`). In requests, `amount` may be a number or a string.

## Error format

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this debit",
    "details": { "balance": "100.00", "requested": "500" }
  }
}
```
`details` is present only when it adds information (validation field list, balances).

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_REQUEST_BODY`, `INVALID_TRANSACTION_TYPE`, `INVALID_AMOUNT`, `INVALID_ACCOUNT_ID`, `INVALID_PAGINATION`, `SAME_ACCOUNT_TRANSFER` |
| 404 | `ACCOUNT_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `INSUFFICIENT_BALANCE` |
| 500 | `INTERNAL_ERROR` |

---

## Health

`GET /health` -> `200 {"status":"ok"}` (or `503` if the database is unreachable)

---

## 1. Create account

`POST /accounts`

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, 1-100 chars. No other fields allowed (`balance` is rejected) |

```bash
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice"}'
```

**201 Created**
```json
{
  "id": "6a320222-7294-476b-924a-214cfa477b7a",
  "name": "Alice",
  "balance": "0.00",
  "created_at": "2026-10-27T11:34:15.167Z"
}
```
Errors: `400` missing/empty name, or a `balance` field supplied.

---

## 2. Get account

`GET /accounts/:id` -> `200` with the account object (same shape as above).
Errors: `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

---

## 3. Get balance

`GET /accounts/:id/balance`

```bash
curl http://localhost:3000/accounts/6a320222-7294-476b-924a-214cfa477b7a/balance
```

**200 OK**
```json
{ "account_id": "6a320222-7294-476b-924a-214cfa477b7a", "balance": "100.00" }
```
Errors: `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

---

## 4. Add transaction

`POST /accounts/:id/transactions`

| Field | Type | Rules |
|---|---|---|
| `type` | string | required, `"credit"` or `"debit"` |
| `amount` | number or string | required, > 0, max 2 decimal places |
| `reference_id` | string | required, 1-100 chars, unique per account |
| `description` | string | optional, max 500 chars |

```bash
curl -X POST http://localhost:3000/accounts/$ID/transactions \
  -H "Content-Type: application/json" \
  -d '{"type":"credit","amount":100,"reference_id":"ref-1","description":"Salary"}'
```

**201 Created** (new transaction)
```json
{
  "duplicate": false,
  "message": "Transaction created",
  "transaction": {
    "id": "67d59dff-3a08-44db-af8c-eb3fcbe728d0",
    "account_id": "6a320222-7294-476b-924a-214cfa477b7a",
    "type": "credit",
    "amount": "100.00",
    "description": "Salary",
    "reference_id": "ref-1",
    "created_at": "2026-10-27T11:34:15.235Z"
  },
  "balance": "100.00"
}
```

**200 OK** (duplicate `reference_id` on the same account: nothing is created, balance unchanged)
```json
{
  "duplicate": true,
  "message": "Transaction with this reference_id already exists for this account; no changes made",
  "transaction": { "...the original transaction..." },
  "balance": "100.00"
}
```

**422 Unprocessable** (debit larger than balance; nothing is changed)
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this debit",
    "details": { "balance": "100.00", "requested": "500" }
  }
}
```

**400 Bad Request** (validation; example with several invalid fields)
```json
{
  "error": {
    "code": "INVALID_TRANSACTION_TYPE",
    "message": "type must be either \"credit\" or \"debit\"",
    "details": [
      { "field": "type", "message": "type must be either \"credit\" or \"debit\"" },
      { "field": "amount", "message": "amount must be a positive number with at most 2 decimal places" },
      { "field": "reference_id", "message": "reference_id is required" }
    ]
  }
}
```
Other errors: `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

Transactions are **immutable**: there are no update or delete endpoints, and the database rejects `UPDATE`/`DELETE` on the `transactions` table.

---

## 5. Transaction history

`GET /accounts/:id/transactions`

| Query param | Default | Rules |
|---|---|---|
| `type` | (both) | `credit` or `debit` |
| `page` | `1` | integer >= 1 |
| `limit` | `10` | integer 1-100 |

Results are sorted **latest first** by `created_at`.

```bash
curl "http://localhost:3000/accounts/$ID/transactions?type=debit&page=1&limit=5"
```

**200 OK**
```json
{
  "data": [
    {
      "id": "...",
      "account_id": "...",
      "type": "debit",
      "amount": "30.00",
      "description": null,
      "reference_id": "r3",
      "created_at": "2026-10-27T11:40:02.118Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total_records": 2,
    "total_pages": 1
  }
}
```
Errors: `400 INVALID_PAGINATION`, `400 INVALID_TRANSACTION_TYPE`, `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.
A page beyond the last returns `200` with an empty `data` array.

---

## 6. Transfer money (bonus)

`POST /transfers`

| Field | Type | Rules |
|---|---|---|
| `from_account_id` | UUID | required, must exist |
| `to_account_id` | UUID | required, must exist, different from source |
| `amount` | number or string | required, > 0, max 2 decimal places |
| `reference_id` | string | required, unique per transfer (makes retries safe) |
| `description` | string | optional |

```bash
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id":"'$A'","to_account_id":"'$B'","amount":30,"reference_id":"transfer-1"}'
```

**201 Created**
```json
{
  "duplicate": false,
  "debit_transaction":  { "account_id": "<A>", "type": "debit",  "amount": "30.00", "reference_id": "transfer-1:debit",  "...": "..." },
  "credit_transaction": { "account_id": "<B>", "type": "credit", "amount": "30.00", "reference_id": "transfer-1:credit", "...": "..." },
  "from_balance": "70.00",
  "to_balance": "80.00",
  "message": "Transfer completed"
}
```

- Repeating the same `reference_id` returns **200** with `"duplicate": true` and the original rows; balances do not change.
- Insufficient funds -> `422 INSUFFICIENT_BALANCE`; either account missing -> `404 ACCOUNT_NOT_FOUND`; same account -> `400 SAME_ACCOUNT_TRANSFER`. In every failure case **neither** account changes.
- The debit, the credit and both balance updates happen in one database transaction.

---

## Endpoint summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + DB check |
| POST | `/accounts` | Create account |
| GET | `/accounts/:id` | Get account |
| GET | `/accounts/:id/balance` | Get balance |
| POST | `/accounts/:id/transactions` | Add credit/debit |
| GET | `/accounts/:id/transactions` | History (filter, pagination, latest first) |
| POST | `/transfers` | Transfer between accounts |
