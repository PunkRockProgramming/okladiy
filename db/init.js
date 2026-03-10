import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'showdb.sqlite');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

export function getDb() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

export function initDb() {
    const db = getDb();
    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    console.log('Database initialized at', DB_PATH);
    db.close();
}

// Run directly to initialize
if (import.meta.url === `file://${process.argv[1]}`) {
    initDb();
}
