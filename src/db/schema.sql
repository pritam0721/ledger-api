-- Transaction Ledger schema (idempotent: safe to run more than once)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  balance    NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id),
  type         TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount       NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  description  TEXT,
  reference_id TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  -- clock_timestamp() = real insert time (now() would be the transaction start time)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_account_reference UNIQUE (account_id, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_account_created
  ON transactions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_txn_account_type_created
  ON transactions (account_id, type, created_at DESC);

-- Immutability enforced at the database level: no UPDATE or DELETE on transactions.
CREATE OR REPLACE FUNCTION block_txn_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_txn_immutable ON transactions;
CREATE TRIGGER trg_txn_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION block_txn_changes();

-- Supabase exposes public tables through its REST API. This API connects directly
-- to Postgres, so block the public anon/authenticated roles with RLS (no policies).
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
