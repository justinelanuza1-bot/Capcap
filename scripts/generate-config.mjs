import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const configPath = join(root, 'js', 'config.js');

function parseEnv(content) {
    const env = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function requireEnv(env, key) {
    const value = env[key];
    if (!value || value.includes('YOUR_PROJECT') || value.includes('your-anon')) {
        console.error(`\n❌ Missing or placeholder value for ${key} in .env`);
        console.error('   Copy .env.example to .env and add your Supabase credentials.\n');
        process.exit(1);
    }
    return value;
}

if (!existsSync(envPath)) {
    console.error('\n❌ .env file not found.');
    console.error('   Run: copy .env.example .env   (Windows)');
    console.error('   Or:  cp .env.example .env      (Mac/Linux)\n');
    process.exit(1);
}

const env = parseEnv(readFileSync(envPath, 'utf8'));

const SUPABASE_URL = requireEnv(env, 'SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv(env, 'SUPABASE_ANON_KEY');
const WEEKLY_REPORT_LIMIT = parseInt(env.WEEKLY_REPORT_LIMIT || '3', 10);
const APP_ENV = env.APP_ENV || 'development';

const config = `// Auto-generated from .env — do not edit manually
// Run: npm run config  (or npm run dev, which runs this automatically)

export const SUPABASE_URL = '${SUPABASE_URL}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';

export const WEEKLY_REPORT_LIMIT = ${WEEKLY_REPORT_LIMIT};
export const APP_ENV = '${APP_ENV}';
`;

writeFileSync(configPath, config, 'utf8');
console.log('✅ js/config.js generated from .env');
