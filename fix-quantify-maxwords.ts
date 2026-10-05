// Quick script to reset quantify.maxWords to 0 (unlimited) in the database
// Run with: npx tsx fix-quantify-maxwords.ts

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Run with: DATABASE_URL=... npx tsx fix-quantify-maxwords.ts');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  try {
    // 1. Read current rules
    const result = await pool.query(
      "SELECT rules FROM timesheet_validation_settings WHERE id = 'default'"
    );

    if (result.rows.length === 0) {
      console.log('No validation rules found in DB. Nothing to fix.');
      return;
    }

    const rules = result.rows[0].rules;
    console.log('Current quantify rules:', JSON.stringify(rules?.quantify, null, 2));

    // 2. Remove/reset maxWords for quantify to 0 (unlimited)
    if (rules?.quantify) {
      rules.quantify.maxWords = 0;
    }

    // 3. Save back
    await pool.query(
      `UPDATE timesheet_validation_settings SET rules = $1::jsonb, updated_at = NOW() WHERE id = 'default'`,
      [JSON.stringify(rules)]
    );

    console.log('\n✅ Fixed! quantify.maxWords set to 0 (unlimited).');
    console.log('Updated quantify rules:', JSON.stringify(rules?.quantify, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
