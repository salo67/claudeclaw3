/**
 * Write competitor intelligence to hive_mind for A/B variant generation.
 * Called by scheduled competitor tracking tasks.
 *
 * Usage: node scripts/competitor_hive_writer.js '{"action":"price_change","summary":"...","artifacts":{...}}'
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

const input = process.argv[2];
if (!input) {
    console.error('Usage: node competitor_hive_writer.js \'{"action":"price_change","summary":"Competitor X dropped price 15%","artifacts":{"competitor":"X","old_price":89,"new_price":75}}\'');
    process.exit(1);
}

try {
    const data = JSON.parse(input);
    writeToHiveMind(
        data.agent_id || 'competitor-tracker',
        data.action || 'price_change',
        data.summary || '',
        data.artifacts || {}
    );
} catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
}
