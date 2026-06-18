import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
    const files = (await fs.readdir(migrationsDir))
        .filter((file) => file.endsWith('.sql'))
        .sort();

    for (const file of files) {
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        await pool.query(sql);
        console.log(`[migrate] applied ${file}`);
    }
} finally {
    await pool.end();
}
