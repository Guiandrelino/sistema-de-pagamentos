CREATE TABLE merchants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  amount bigint NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  currency text NOT NULL CHECK (currency = 'BRL'),
  method text NOT NULL CHECK (method IN ('PIX', 'CARD')),
  scenario text NOT NULL CHECK (scenario IN ('APPROVED', 'DECLINED')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('payment.requested', 'refund.requested')),
  aggregate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  event_id uuid PRIMARY KEY REFERENCES outbox(id),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  operation text NOT NULL CHECK (operation IN ('PAYMENT', 'REFUND')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, operation)
);

CREATE TABLE ledger_postings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES journal_entries(id),
  account text NOT NULL CHECK (account IN ('provider_clearing', 'merchant_payable')),
  side text NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount bigint NOT NULL CHECK (amount > 0),
  UNIQUE (journal_id, account)
);

-- The journal must contain exactly two balanced postings at commit.
CREATE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  total numeric;
  posting_count integer;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSE
    target := NEW.journal_id;
  END IF;
  SELECT count(*), coalesce(sum(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END), 0)
    INTO posting_count, total FROM ledger_postings WHERE journal_id = target;
  IF posting_count <> 2 OR total <> 0 THEN
    RAISE EXCEPTION 'Unbalanced journal %', target;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();

CREATE FUNCTION deny_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger is append-only';
END;
$$;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE OR TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION deny_ledger_mutation();
CREATE TRIGGER immutable_postings BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_postings
  FOR EACH STATEMENT EXECUTE FUNCTION deny_ledger_mutation();

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
