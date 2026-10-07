// Script to reset all maxWords to 0 (unlimited) in the database
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  try {
    const result = await pool.query(
      "SELECT rules FROM timesheet_validation_settings WHERE id = 'default'"
    );

    if (result.rows.length === 0) {
      console.log('No validation rules found in DB. Nothing to fix.');
      return;
    }

    const rules = result.rows[0].rules;

    // Reset maxWords for all text fields
    if (rules?.quantify) rules.quantify.maxWords = 0;
    if (rules?.achievements) rules.achievements.maxWords = 0;
    if (rules?.description) rules.description.maxWords = 0;

    await pool.query(
      `UPDATE timesheet_validation_settings SET rules = $1::jsonb, updated_at = NOW() WHERE id = 'default'`,
      [JSON.stringify(rules)]
    );

    console.log('✅ Fixed! All maxWords limits set to 0 (unlimited) in the database.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
