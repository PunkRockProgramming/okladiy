-- OKDIY Agent System — Shared State Schema

-- Track every scraper execution
CREATE TABLE IF NOT EXISTS scraper_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue TEXT NOT NULL,              -- scraper name (e.g. 'beercity', 'opolis')
    started_at TEXT NOT NULL,         -- ISO 8601 timestamp
    finished_at TEXT,                 -- NULL if still running or crashed
    status TEXT NOT NULL DEFAULT 'running',  -- running | success | failure
    show_count INTEGER DEFAULT 0,    -- number of shows returned
    error_message TEXT,              -- NULL on success
    duration_ms INTEGER              -- wall clock time
);

-- Historical show data for comparison and anomaly detection
CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES scraper_runs(id),
    venue TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,               -- ISO date (YYYY-MM-DD)
    time TEXT,
    price TEXT,
    event_url TEXT,
    age_limit TEXT,
    description TEXT,
    hash TEXT NOT NULL,               -- dedup key: venue + date + normalized title
    first_seen_at TEXT NOT NULL,      -- when this show first appeared
    last_seen_at TEXT NOT NULL        -- updated each successful scrape
);

-- Anomalies flagged by scraper or validator agents
CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at TEXT NOT NULL,        -- ISO 8601 timestamp
    agent TEXT NOT NULL,              -- which agent flagged it
    type TEXT NOT NULL,               -- schema_violation | count_drop | stale_venue | duplicate | parse_failure
    venue TEXT,                       -- NULL for cross-venue anomalies
    severity TEXT NOT NULL DEFAULT 'warning',  -- info | warning | error
    message TEXT NOT NULL,            -- human-readable description
    data TEXT,                        -- JSON blob with details
    resolved INTEGER NOT NULL DEFAULT 0,  -- 0 = open, 1 = resolved
    resolved_at TEXT                  -- when marked resolved
);

-- Agent task log — what was delegated, what happened
CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    assigned_to TEXT NOT NULL,        -- agent name
    assigned_by TEXT NOT NULL,        -- 'pm', 'human', etc.
    task TEXT NOT NULL,               -- what to do
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    result TEXT,                      -- JSON blob with output
    completed_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_runs_venue ON scraper_runs(venue);
CREATE INDEX IF NOT EXISTS idx_runs_status ON scraper_runs(status);
CREATE INDEX IF NOT EXISTS idx_shows_hash ON shows(hash);
CREATE INDEX IF NOT EXISTS idx_shows_venue_date ON shows(venue, date);
CREATE INDEX IF NOT EXISTS idx_anomalies_open ON anomalies(resolved, type);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
