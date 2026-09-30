import pkg from 'pg';
const { Client } = pkg;

const connectionString = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji@13@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

async function explore() {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    console.log('--- COLUMNS FOR leaves ---');
    const cols = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'leaves'
    `);
    console.log(cols.rows);

    await client.end();
}

explore();
