-- The shop of the demo, as a PostgreSQL database: prod (with the fault) and
-- staging (healthy). Runs once, as the admin, when the container starts.
--
-- The assistant never connects as the admin. It connects as `readonly`, a user
-- that can SELECT and nothing else: the database itself refuses a write.
CREATE ROLE readonly LOGIN PASSWORD 'readonly';
CREATE DATABASE shop_prod;
CREATE DATABASE shop_staging;

\connect shop_prod

CREATE TABLE orders (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  status      text NOT NULL,            -- awaiting_payment -> confirmed -> shipped
  total       numeric(10, 2) NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE TABLE payments (
  id            serial PRIMARY KEY,
  order_id      text NOT NULL REFERENCES orders (id),
  provider      text NOT NULL,
  provider_ref  text NOT NULL,
  status        text NOT NULL,          -- captured: the provider took the money
  amount        numeric(10, 2) NOT NULL,
  captured_at   timestamptz NOT NULL
);
-- What the provider sent to /hooks/acme-pay, and what the shop answered.
CREATE TABLE webhook_events (
  id         serial PRIMARY KEY,
  order_id   text NOT NULL REFERENCES orders (id),
  event      text NOT NULL,
  outcome    text NOT NULL,             -- handled | refused_503
  attempt    integer NOT NULL,
  at         timestamptz NOT NULL
);

INSERT INTO orders VALUES
  ('4509', 'u-205', 'confirmed',        24.50, '2026-10-07T09:20:01Z', '2026-10-07T09:20:05Z'),
  ('4510', 'u-077', 'confirmed',        61.00, '2026-10-07T09:31:40Z', '2026-10-07T09:31:44Z'),
  ('4511', 'u-312', 'confirmed',        15.90, '2026-10-07T09:40:00Z', '2026-10-07T09:40:02Z'),
  ('4512', 'u-881', 'awaiting_payment', 89.90, '2026-10-07T09:58:12Z', '2026-10-07T09:58:13Z'),
  ('4513', 'u-440', 'awaiting_payment', 42.00, '2026-10-07T10:00:30Z', '2026-10-07T10:00:31Z'),
  ('4514', 'u-129', 'awaiting_payment', 33.30, '2026-10-07T10:03:05Z', '2026-10-07T10:03:06Z');

-- The provider took the money for every order, the stuck ones included.
INSERT INTO payments (order_id, provider, provider_ref, status, amount, captured_at) VALUES
  ('4509', 'acme-pay', 'ps_3Aa1', 'captured', 24.50, '2026-10-07T09:20:03Z'),
  ('4510', 'acme-pay', 'ps_4Bb2', 'captured', 61.00, '2026-10-07T09:31:42Z'),
  ('4511', 'acme-pay', 'ps_5Cc3', 'captured', 15.90, '2026-10-07T09:40:01Z'),
  ('4512', 'acme-pay', 'ps_7Hq2', 'captured', 89.90, '2026-10-07T09:58:50Z'),
  ('4513', 'acme-pay', 'ps_8Jr4', 'captured', 42.00, '2026-10-07T10:00:38Z'),
  ('4514', 'acme-pay', 'ps_9Ks5', 'captured', 33.30, '2026-10-07T10:03:10Z');

-- The shop handled the webhooks until 10:00, then refused them.
INSERT INTO webhook_events (order_id, event, outcome, attempt, at) VALUES
  ('4509', 'payment.succeeded', 'handled',     1, '2026-10-07T09:20:04Z'),
  ('4510', 'payment.succeeded', 'handled',     1, '2026-10-07T09:31:43Z'),
  ('4511', 'payment.succeeded', 'handled',     1, '2026-10-07T09:40:02Z'),
  ('4512', 'payment.succeeded', 'refused_503', 1, '2026-10-07T10:00:02Z'),
  ('4512', 'payment.succeeded', 'refused_503', 2, '2026-10-07T10:02:02Z'),
  ('4513', 'payment.succeeded', 'refused_503', 1, '2026-10-07T10:00:41Z'),
  ('4514', 'payment.succeeded', 'refused_503', 1, '2026-10-07T10:03:12Z');

GRANT CONNECT ON DATABASE shop_prod TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;

\connect shop_staging

CREATE TABLE orders (
  id text PRIMARY KEY, user_id text NOT NULL, status text NOT NULL,
  total numeric(10, 2) NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE payments (
  id serial PRIMARY KEY, order_id text NOT NULL REFERENCES orders (id), provider text NOT NULL,
  provider_ref text NOT NULL, status text NOT NULL, amount numeric(10, 2) NOT NULL, captured_at timestamptz NOT NULL
);
CREATE TABLE webhook_events (
  id serial PRIMARY KEY, order_id text NOT NULL REFERENCES orders (id), event text NOT NULL,
  outcome text NOT NULL, attempt integer NOT NULL, at timestamptz NOT NULL
);

INSERT INTO orders VALUES ('88', 'u-test', 'confirmed', 12.00, '2026-10-07T09:58:20Z', '2026-10-07T09:58:26Z');
INSERT INTO payments (order_id, provider, provider_ref, status, amount, captured_at)
  VALUES ('88', 'acme-pay', 'ps_test1', 'captured', 12.00, '2026-10-07T09:58:23Z');
INSERT INTO webhook_events (order_id, event, outcome, attempt, at)
  VALUES ('88', 'payment.succeeded', 'handled', 1, '2026-10-07T09:58:25Z');

GRANT CONNECT ON DATABASE shop_staging TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
