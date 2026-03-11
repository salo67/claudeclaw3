"""SQLite database connection and schema initialization for ClaudeClaw Control Center."""

from __future__ import annotations

import sqlite3
from collections.abc import Generator
from pathlib import Path
from typing import Any

DB_PATH: Path = Path(__file__).parent.parent / "store" / "claudeclaw.db"

_CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    phase       TEXT NOT NULL DEFAULT 'backlog',
    completed   INTEGER NOT NULL DEFAULT 0,
    autopilot   INTEGER NOT NULL DEFAULT 0,
    paused      INTEGER NOT NULL DEFAULT 0,
    priority    TEXT NOT NULL DEFAULT 'none',
    tags        TEXT DEFAULT '',
    color       TEXT DEFAULT '#f59e0b',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_phase ON projects(phase);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);

CREATE TABLE IF NOT EXISTS features (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    description TEXT NOT NULL,
    objective   TEXT DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    phase       TEXT NOT NULL DEFAULT 'backlog',
    autopilot   INTEGER NOT NULL DEFAULT 0,
    priority    TEXT NOT NULL DEFAULT 'none',
    completed   INTEGER NOT NULL DEFAULT 0,
    position    REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id);

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT,
    feature_id  TEXT,
    description TEXT NOT NULL,
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    completed   INTEGER NOT NULL DEFAULT 0,
    verification_status TEXT NOT NULL DEFAULT '',
    verification_output TEXT NOT NULL DEFAULT '',
    position    REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature_id);

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    url         TEXT DEFAULT '',
    file_path   TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

CREATE TABLE IF NOT EXISTS advisor_threads (
    id          TEXT PRIMARY KEY,
    title       TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS advisor_messages (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    agent_role  TEXT NOT NULL DEFAULT '',
    image_data  TEXT,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES advisor_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_advisor_msg_thread ON advisor_messages(thread_id);

CREATE TABLE IF NOT EXISTS autopilot_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      TEXT NOT NULL,
    feature_id   TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    task_desc    TEXT NOT NULL DEFAULT '',
    project_name TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    started_at   INTEGER,
    completed_at INTEGER,
    output       TEXT NOT NULL DEFAULT '',
    commit_sha   TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_autopilot_queue_status ON autopilot_queue(status, created_at);

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT DEFAULT '',
    project_id  TEXT,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned);

CREATE TABLE IF NOT EXISTS journal_entries (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL UNIQUE,
    content     TEXT NOT NULL DEFAULT '',
    mood        TEXT DEFAULT '',
    tags        TEXT DEFAULT '',
    bot_prompts TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);

CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL DEFAULT 'info',
    severity    TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    action      TEXT DEFAULT '',
    source      TEXT DEFAULT '',
    dismissed   INTEGER NOT NULL DEFAULT 0,
    executed    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON alerts(dismissed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

CREATE TABLE IF NOT EXISTS memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    topic_key   TEXT,
    content     TEXT NOT NULL,
    sector      TEXT NOT NULL DEFAULT 'semantic',
    salience    REAL NOT NULL DEFAULT 1.0,
    created_at  INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_sector ON memories(chat_id, sector);
"""

# FTS5 + triggers must run separately (executescript doesn't handle virtual tables well)
_FTS5_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
"""

# FTS5 for notes and journal entries
_NOTES_FTS5_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, tags,
    content='notes',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS journal_fts USING fts5(
    content, tags,
    content='journal_entries',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS journal_fts_insert AFTER INSERT ON journal_entries BEGIN
    INSERT INTO journal_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS journal_fts_delete AFTER DELETE ON journal_entries BEGIN
    INSERT INTO journal_fts(journal_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS journal_fts_update AFTER UPDATE ON journal_entries BEGIN
    INSERT INTO journal_fts(journal_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
    INSERT INTO journal_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;
"""


def _connect() -> sqlite3.Connection:
    """Create a new SQLite connection with WAL mode and foreign keys enabled."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.row_factory = sqlite3.Row
    return conn


_MIGRATIONS = [
    # Add phase column to features if missing
    (
        "features_phase",
        "ALTER TABLE features ADD COLUMN phase TEXT NOT NULL DEFAULT 'backlog';",
    ),
    # Quality gates: acceptance criteria and verification
    (
        "features_acceptance_criteria",
        "ALTER TABLE features ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';",
    ),
    (
        "tasks_acceptance_criteria",
        "ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';",
    ),
    (
        "tasks_verification_status",
        "ALTER TABLE tasks ADD COLUMN verification_status TEXT NOT NULL DEFAULT '';",
    ),
    (
        "tasks_verification_output",
        "ALTER TABLE tasks ADD COLUMN verification_output TEXT NOT NULL DEFAULT '';",
    ),
    (
        "advisor_messages_agent_role",
        "ALTER TABLE advisor_messages ADD COLUMN agent_role TEXT NOT NULL DEFAULT '';",
    ),
    (
        "advisor_messages_image_data",
        "ALTER TABLE advisor_messages ADD COLUMN image_data TEXT NOT NULL DEFAULT '';",
    ),
    (
        "advisor_messages_source",
        "ALTER TABLE advisor_messages ADD COLUMN source TEXT NOT NULL DEFAULT 'web';",
    ),
    (
        "features_wave",
        "ALTER TABLE features ADD COLUMN wave INTEGER NOT NULL DEFAULT 0;",
    ),
    (
        "autopilot_budget_table",
        """CREATE TABLE IF NOT EXISTS autopilot_budget (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id  TEXT NOT NULL,
            date        TEXT NOT NULL,
            cost_usd    REAL NOT NULL DEFAULT 0,
            cli_calls   INTEGER NOT NULL DEFAULT 0,
            UNIQUE(project_id, date)
        );""",
    ),
    # Notes: linked_task_ids for todo integration
    (
        "notes_linked_task_ids",
        "ALTER TABLE notes ADD COLUMN linked_task_ids TEXT NOT NULL DEFAULT '';",
    ),
    # Journal: linked_task_ids for todo integration
    (
        "journal_linked_task_ids",
        "ALTER TABLE journal_entries ADD COLUMN linked_task_ids TEXT NOT NULL DEFAULT '';",
    ),
    # Pulse modules: configurable widgets for Daily Business Pulse
    (
        "pulse_modules_table",
        """CREATE TABLE IF NOT EXISTS pulse_modules (
            id          TEXT PRIMARY KEY,
            key         TEXT NOT NULL UNIQUE,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category    TEXT NOT NULL DEFAULT 'business',
            enabled     INTEGER NOT NULL DEFAULT 1,
            config      TEXT NOT NULL DEFAULT '{}',
            icon        TEXT NOT NULL DEFAULT 'chart',
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );""",
    ),
    # Daily pulses: persisted snapshots of generated pulses
    (
        "daily_pulses_table",
        """CREATE TABLE IF NOT EXISTS daily_pulses (
            id          TEXT PRIMARY KEY,
            date        TEXT NOT NULL,
            snapshot    TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );""",
    ),
    (
        "daily_pulses_date_idx",
        "CREATE INDEX IF NOT EXISTS idx_daily_pulses_date ON daily_pulses(date);",
    ),
    # Discovery loop: autonomous advisor insight runs
    (
        "discovery_runs_table",
        """CREATE TABLE IF NOT EXISTS discovery_runs (
            id              TEXT PRIMARY KEY,
            triggered_by    TEXT NOT NULL DEFAULT 'manual',
            started_at      INTEGER NOT NULL,
            completed_at    INTEGER NOT NULL,
            advisors_run    TEXT NOT NULL DEFAULT '[]',
            total_findings  INTEGER NOT NULL DEFAULT 0,
            critical_count  INTEGER NOT NULL DEFAULT 0,
            warning_count   INTEGER NOT NULL DEFAULT 0,
            insight_count   INTEGER NOT NULL DEFAULT 0,
            cost_usd        REAL NOT NULL DEFAULT 0.0
        );""",
    ),
    (
        "discovery_findings_table",
        """CREATE TABLE IF NOT EXISTS discovery_findings (
            id                  TEXT PRIMARY KEY,
            run_id              TEXT NOT NULL,
            advisor_key         TEXT NOT NULL,
            severity            TEXT NOT NULL DEFAULT 'insight',
            title               TEXT NOT NULL,
            detail              TEXT NOT NULL DEFAULT '',
            data_sources_used   TEXT NOT NULL DEFAULT '[]',
            recommended_action  TEXT NOT NULL DEFAULT '',
            created_at          INTEGER NOT NULL,
            dismissed           INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (run_id) REFERENCES discovery_runs(id) ON DELETE CASCADE
        );""",
    ),
    (
        "discovery_findings_run_idx",
        "CREATE INDEX IF NOT EXISTS idx_discovery_findings_run ON discovery_findings(run_id);",
    ),
    (
        "discovery_findings_severity_idx",
        "CREATE INDEX IF NOT EXISTS idx_discovery_findings_severity ON discovery_findings(severity, dismissed);",
    ),
    # Model switching: thread-level default + per-message tracking
    (
        "advisor_threads_default_model",
        "ALTER TABLE advisor_threads ADD COLUMN default_model TEXT NOT NULL DEFAULT 'flash';",
    ),
    (
        "advisor_messages_model_used",
        "ALTER TABLE advisor_messages ADD COLUMN model_used TEXT NOT NULL DEFAULT '';",
    ),
    # Discovery findings: estimated impact field for proactive advisor proposals
    (
        "discovery_findings_estimated_impact",
        "ALTER TABLE discovery_findings ADD COLUMN estimated_impact TEXT NOT NULL DEFAULT '';",
    ),
    # Action Items: advisor-proposed business decisions with conversational review
    (
        "action_items_table",
        """CREATE TABLE IF NOT EXISTS action_items (
            id                TEXT PRIMARY KEY,
            advisor_key       TEXT NOT NULL DEFAULT '',
            finding_id        TEXT NOT NULL DEFAULT '',
            title             TEXT NOT NULL,
            detail            TEXT NOT NULL DEFAULT '',
            estimated_impact  TEXT NOT NULL DEFAULT '',
            category          TEXT NOT NULL DEFAULT 'general',
            priority          TEXT NOT NULL DEFAULT 'normal',
            status            TEXT NOT NULL DEFAULT 'proposed',
            approved_at       INTEGER,
            rejected_at       INTEGER,
            completed_at      INTEGER,
            created_at        INTEGER NOT NULL,
            updated_at        INTEGER NOT NULL
        );""",
    ),
    (
        "action_items_status_idx",
        "CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);",
    ),
    (
        "action_item_comments_table",
        """CREATE TABLE IF NOT EXISTS action_item_comments (
            id              TEXT PRIMARY KEY,
            action_item_id  TEXT NOT NULL,
            author          TEXT NOT NULL,
            content         TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE
        );""",
    ),
    (
        "action_item_comments_idx",
        "CREATE INDEX IF NOT EXISTS idx_action_item_comments_item ON action_item_comments(action_item_id);",
    ),
    # Research reports: deep research via Perplexity API
    (
        "research_reports_table",
        """CREATE TABLE IF NOT EXISTS research_reports (
            id              TEXT PRIMARY KEY,
            query           TEXT NOT NULL,
            model           TEXT NOT NULL DEFAULT 'sonar',
            status          TEXT NOT NULL DEFAULT 'running',
            content_md      TEXT NOT NULL DEFAULT '',
            sources         TEXT NOT NULL DEFAULT '[]',
            file_path       TEXT NOT NULL DEFAULT '',
            cost_usd        REAL NOT NULL DEFAULT 0.0,
            error           TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL,
            completed_at    INTEGER
        );""",
    ),
    (
        "research_reports_status_idx",
        "CREATE INDEX IF NOT EXISTS idx_research_reports_status ON research_reports(status);",
    ),
]


def init_db() -> None:
    """Create the control-center tables if they don't already exist.

    Only creates new tables. Existing data is preserved.
    Runs lightweight migrations for schema additions.
    """
    conn = _connect()
    try:
        conn.executescript(_CREATE_TABLES_SQL)
        # Run migrations
        for _name, sql in _MIGRATIONS:
            try:
                conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # column already exists
        # FTS5 virtual table + triggers (may already exist from TS bot)
        for fts_block in (_FTS5_SQL, _NOTES_FTS5_SQL):
            for stmt in fts_block.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    try:
                        conn.execute(stmt)
                    except sqlite3.OperationalError:
                        pass  # already exists
        # Populate notes FTS from existing data (idempotent)
        try:
            count = conn.execute("SELECT COUNT(*) FROM notes_fts").fetchone()[0]
            if count == 0:
                conn.execute("INSERT INTO notes_fts(rowid, title, content, tags) SELECT rowid, title, content, tags FROM notes")
        except sqlite3.OperationalError:
            pass
        # Populate journal FTS from existing data (idempotent)
        try:
            count = conn.execute("SELECT COUNT(*) FROM journal_fts").fetchone()[0]
            if count == 0:
                conn.execute("INSERT INTO journal_fts(rowid, content, tags) SELECT rowid, content, tags FROM journal_entries")
        except sqlite3.OperationalError:
            pass
        conn.commit()
    finally:
        conn.close()


_shared_conn: sqlite3.Connection | None = None


def _get_shared_conn() -> sqlite3.Connection:
    """Return a shared SQLite connection (thread-safe with WAL + check_same_thread=False)."""
    global _shared_conn
    if _shared_conn is None:
        _shared_conn = _connect()
    return _shared_conn


def get_db() -> Generator[sqlite3.Connection, Any, None]:
    """FastAPI dependency that yields the shared SQLite connection."""
    yield _get_shared_conn()
