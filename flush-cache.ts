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
    // Get an admin ID
    const result = await pool.query("SELECT id FROM employees WHERE role = 'admin' LIMIT 1");
    if (result.rows.length === 0) {
      console.log('No admin found');
      return;
    }
    const adminId = result.rows[0].id;
    console.log('Found adminId:', adminId);

    // Get current rules
    const rulesResult = await pool.query("SELECT rules FROM timesheet_validation_settings WHERE id = 'default'");
    let rules = rulesResult.rows[0]?.rules;
    
    if (!rules) {
        console.log('No rules found');
        return;
    }

    // Force flush cache by hitting the PUT endpoint
    console.log('Sending PUT request to timestrap.space to clear cache...');
    const response = await fetch('https://timestrap.space/api/timesheet-validation-rules', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        adminId: adminId,
        rules: rules
      })
    });

    if (response.ok) {
      console.log('✅ Success! Cache cleared on live server.');
      const data = await response.json();
      console.log('New live rules:', JSON.stringify(data.rules, null, 2));
    } else {
      console.error('❌ Failed to clear cache:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
