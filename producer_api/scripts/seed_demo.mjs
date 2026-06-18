import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
    DEFAULT_COIN_TYPE,
    DEFAULT_CURRENCY_SYMBOL,
    hashApiKey,
} from '../server.mjs';

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
}

const required = ['DEMO_PAYOUT_ADDRESS', 'DEMO_AGENT_ADDRESS', 'DEMO_WALLET_ID', 'DEMO_SESSION_CAP_ID'];
for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`${key} is required.`);
    }
}

const merchantId = process.env.DEMO_MERCHANT_ID ?? 'merchant_demo';
const merchantName = process.env.DEMO_MERCHANT_NAME ?? 'Demo Merchant';
const apiKey = process.env.DEMO_MERCHANT_API_KEY ?? `sf_demo_${randomUUID().replaceAll('-', '')}`;
const allowanceId = process.env.DEMO_ALLOWANCE_ID ?? 'allowance_demo';
const coinType = process.env.DEFAULT_COIN_TYPE ?? DEFAULT_COIN_TYPE;
const now = Date.now();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
    await pool.query(
        `insert into merchants
            (id, name, api_key_hash, payout_address, webhook_url, default_coin_type,
             currency_symbol, created_at_ms, updated_at_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         on conflict (id) do update set
            name = excluded.name,
            api_key_hash = excluded.api_key_hash,
            payout_address = excluded.payout_address,
            webhook_url = excluded.webhook_url,
            default_coin_type = excluded.default_coin_type,
            currency_symbol = excluded.currency_symbol,
            updated_at_ms = excluded.updated_at_ms`,
        [
            merchantId,
            merchantName,
            hashApiKey(apiKey),
            process.env.DEMO_PAYOUT_ADDRESS,
            process.env.DEMO_WEBHOOK_URL ?? null,
            coinType,
            process.env.DEFAULT_CURRENCY_SYMBOL ?? DEFAULT_CURRENCY_SYMBOL,
            now,
        ],
    );

    await pool.query(
        `insert into agent_allowances
            (id, merchant_id, agent_address, wallet_id, session_cap_id, coin_type,
             status, created_at_ms, updated_at_ms)
         values ($1, $2, $3, $4, $5, $6, 'active', $7, $7)
         on conflict (merchant_id, agent_address, coin_type) do update set
            wallet_id = excluded.wallet_id,
            session_cap_id = excluded.session_cap_id,
            status = 'active',
            updated_at_ms = excluded.updated_at_ms`,
        [
            allowanceId,
            merchantId,
            process.env.DEMO_AGENT_ADDRESS,
            process.env.DEMO_WALLET_ID,
            process.env.DEMO_SESSION_CAP_ID,
            coinType,
            now,
        ],
    );

    console.log(JSON.stringify({
        merchantId,
        merchantName,
        apiKey,
        agentAddress: process.env.DEMO_AGENT_ADDRESS,
        walletId: process.env.DEMO_WALLET_ID,
        sessionCapId: process.env.DEMO_SESSION_CAP_ID,
        coinType,
    }, null, 2));
} finally {
    await pool.end();
}
