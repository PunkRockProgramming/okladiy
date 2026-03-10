/**
 * Shared database access for agents
 */
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../db/showdb.sqlite');

export function getDb() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

/** Get latest run per venue */
export function getLatestRuns() {
    const db = getDb();
    const rows = db.prepare(`
        SELECT venue, status, show_count, started_at, error_message, duration_ms
        FROM scraper_runs
        WHERE id IN (SELECT MAX(id) FROM scraper_runs GROUP BY venue)
        ORDER BY venue
    `).all();
    db.close();
    return rows;
}

/** Get open anomalies */
export function getOpenAnomalies() {
    const db = getDb();
    const rows = db.prepare(`
        SELECT * FROM anomalies WHERE resolved = 0 ORDER BY detected_at DESC
    `).all();
    db.close();
    return rows;
}

/** Get pending tasks */
export function getPendingTasks() {
    const db = getDb();
    const rows = db.prepare(`
        SELECT * FROM agent_tasks WHERE status IN ('pending', 'running') ORDER BY created_at
    `).all();
    db.close();
    return rows;
}

/** Create a task */
export function createTask(assignedTo, assignedBy, task) {
    const db = getDb();
    const result = db.prepare(`
        INSERT INTO agent_tasks (created_at, assigned_to, assigned_by, task, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(new Date().toISOString(), assignedTo, assignedBy, task);
    db.close();
    return result.lastInsertRowid;
}

/** Update task status */
export function updateTask(id, status, result = null) {
    const db = getDb();
    const completedAt = (status === 'done' || status === 'failed') ? new Date().toISOString() : null;
    db.prepare(`
        UPDATE agent_tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?
    `).run(status, result, completedAt, id);
    db.close();
}
