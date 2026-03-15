/**
 * Write A/B autoresearch results to hive_mind table.
 * Called by the PIM autoresearch loop after each run.
 *
 * Usage: node scripts/ab_hive_writer.js '{"action":"ab_optimization_result","summary":"...","artifacts":{...}}'
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'store', 'claudeclaw.db');

function writeToHiveMind(agentId, action, summary, artifacts) {
    const db = new Database(DB_PATH);
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
        'INSERT INTO hive_mind (agent_id, chat_id, action, summary, artifacts, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(agentId, 'system', action, summary, JSON.stringify(artifacts), now);

    db.close();
    console.log(`Hive mind: ${action} written by ${agentId}`);
}

// Parse CLI args
const input = process.argv[2];
if (!input) {
    console.error('Usage: node ab_hive_writer.js \'{"action":"...","summary":"...","artifacts":{...}}\'');
    process.exit(1);
}

try {
    const data = JSON.parse(input);
    writeToHiveMind(
        data.agent_id || 'ab-optimizer',
        data.action || 'ab_optimization_result',
        data.summary || '',
        data.artifacts || {}
    );
} catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
}
