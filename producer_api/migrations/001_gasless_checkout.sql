-- These tables are a coordination cache and a *rebuildable projection* of
-- on-chain truth, not the system of record. Settlement truth is the Sui
-- `agent_wallet::wallet::PaymentExecuted` event; audit evidence is the Walrus
-- blob. Terminal intent state (status / tx_digest / walrus_blob_id) can be
-- re-derived from chain via POST /v1/admin/reconcile or
-- scripts/reconcile_from_chain.mjs.

create table if not exists merchants (
    id text primary key,
    name text not null,
    api_key_hash text not null unique,
    payout_address text not null,
    webhook_url text,
    default_coin_type text not null,
    currency_symbol text not null default 'USDC',
    created_at_ms bigint not null,
    updated_at_ms bigint not null
);

create table if not exists agent_allowances (
    id text primary key,
    merchant_id text not null references merchants(id) on delete cascade,
    agent_address text not null,
    wallet_id text not null,
    session_cap_id text not null,
    coin_type text not null,
    status text not null check (status in ('active', 'paused', 'revoked')),
    created_at_ms bigint not null,
    updated_at_ms bigint not null,
    unique (merchant_id, agent_address, coin_type)
);

create table if not exists checkout_sessions (
    id text primary key,
    merchant_id text not null references merchants(id) on delete cascade,
    merchant_order_id text not null,
    intent_id text not null unique,
    status text not null check (status in ('created', 'claimed', 'executed', 'failed', 'expired', 'cancelled')),
    checkout_url text not null,
    recipient text not null,
    amount_atomic bigint not null,
    coin_type text not null,
    execution_rail text not null default 'sponsored_guard' check (execution_rail in ('sponsored_guard', 'native_gasless')),
    requires_sponsor boolean not null default true,
    sponsor_fee_atomic bigint not null default 0,
    sponsor_fee_recipient text,
    currency text not null,
    currency_symbol text not null,
    expires_at_ms bigint not null,
    tx_digest text,
    walrus_blob_id text,
    error_code text,
    error_message text,
    created_at_ms bigint not null,
    updated_at_ms bigint not null,
    unique (merchant_id, merchant_order_id)
);

create table if not exists payment_intents (
    id text primary key,
    checkout_session_id text references checkout_sessions(id) on delete set null,
    merchant_id text not null references merchants(id) on delete cascade,
    merchant_order_id text not null,
    agent_address text not null,
    wallet_id text,
    session_cap_id text,
    recipient text not null,
    amount_atomic bigint not null,
    amount_mist bigint not null,
    coin_type text not null,
    execution_rail text not null default 'sponsored_guard' check (execution_rail in ('sponsored_guard', 'native_gasless')),
    requires_sponsor boolean not null default true,
    sponsor_fee_atomic bigint not null default 0,
    sponsor_fee_recipient text,
    currency text not null,
    currency_symbol text not null,
    decimals integer not null default 6,
    reason text not null,
    metadata_json jsonb not null default '{}'::jsonb,
    expires_at_ms bigint not null,
    status text not null check (status in ('pending', 'claimed', 'executed', 'failed', 'expired', 'cancelled')),
    attempt_count integer not null default 0,
    signature text not null,
    ack_nonce text,
    claimed_at_ms bigint,
    tx_digest text,
    walrus_blob_id text,
    error_code text,
    error_message text,
    finished_at_ms bigint,
    created_at_ms bigint not null,
    updated_at_ms bigint not null,
    unique (merchant_id, merchant_order_id)
);

create index if not exists payment_intents_agent_status_created_idx
    on payment_intents(agent_address, status, created_at_ms);

create table if not exists sponsor_attempts (
    id text primary key,
    intent_id text not null references payment_intents(id) on delete cascade,
    agent_address text not null,
    gas_budget bigint not null,
    coin_type text,
    sponsor_fee_atomic bigint not null default 0,
    sponsor_fee_recipient text,
    status text not null check (status in ('sponsored', 'failed')),
    error_message text,
    created_at_ms bigint not null
);

alter table checkout_sessions
    add column if not exists execution_rail text not null default 'sponsored_guard',
    add column if not exists requires_sponsor boolean not null default true,
    add column if not exists sponsor_fee_atomic bigint not null default 0,
    add column if not exists sponsor_fee_recipient text;

alter table payment_intents
    add column if not exists execution_rail text not null default 'sponsored_guard',
    add column if not exists requires_sponsor boolean not null default true,
    add column if not exists sponsor_fee_atomic bigint not null default 0,
    add column if not exists sponsor_fee_recipient text,
    alter column wallet_id drop not null,
    alter column session_cap_id drop not null;

alter table sponsor_attempts
    add column if not exists coin_type text,
    add column if not exists sponsor_fee_atomic bigint not null default 0,
    add column if not exists sponsor_fee_recipient text;
