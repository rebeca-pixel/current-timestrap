import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pmsPool = new Pool({
    connectionString: process.env.PMS_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkKeySteps() {
    try {
        console.log(`Checking connection...`);
        const now = await pmsPool.query('SELECT NOW()');
        console.log('Connected! Server time:', now.rows[0].now);

        console.log(`\nChecking projects...`);
        const projectsResult = await pmsPool.query('SELECT id, title, project_code FROM projects');

        const project = projectsResult.rows.find(p => p.title === 'PMS Software');
        if (!project) {
            console.log('\nProject "PMS Software" not found.');
            return;
        }

        console.log(`\nFound project:`, project);

        console.log(`\nChecking key_steps by project_code (as done in routes.ts): "${project.project_code}"`);
        const query = `
        SELECT ks.id, ks.title AS name
        FROM key_steps ks
        INNER JOIN projects p ON ks.project_id = p.id
        WHERE p.project_code = $1
        ORDER BY ks.title
    `;
        const result = await pmsPool.query(query, [project.project_code]);

        if (result.rows.length > 0) {
            console.log('Key steps found:');
            result.rows.forEach(ks => console.log(`- ID: ${ks.id}, Name: ${ks.name}`));
        } else {
            console.log('No key steps found for this project_code.');
        }

    } catch (error) {
        console.error('Error checking database:', error);
    } finally {
        await pmsPool.end();
    }
}

checkKeySteps();
