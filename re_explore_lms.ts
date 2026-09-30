import pkg from 'pg';
const { Client } = pkg;

const connectionString = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji@13@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

async function explore() {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    console.log('--- TABLES ---');
    const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    `);
    console.log(tables.rows.map(r => r.table_name));

    await client.end();
}

explore();
