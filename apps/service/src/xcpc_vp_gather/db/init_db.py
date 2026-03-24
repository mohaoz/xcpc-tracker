from __future__ import annotations

import sqlite3
from pathlib import Path

from ..config import ServiceConfig


def _ensure_contest_columns(conn: sqlite3.Connection) -> None:
    columns = {
        row[1]
        for row in conn.execute("PRAGMA table_info(contest)").fetchall()
    }
    if "alias" not in columns:
        conn.execute("ALTER TABLE contest ADD COLUMN alias TEXT")
    if "tags_json" not in columns:
        conn.execute("ALTER TABLE contest ADD COLUMN tags_json TEXT")


def ensure_database(config: ServiceConfig) -> None:
    for path in (
        config.db_path.parent,
        config.artifact_root,
        config.browser_state_root,
        config.log_root,
    ):
        path.mkdir(parents=True, exist_ok=True)

    schema_path = Path(__file__).with_name("schema.sql")
    with sqlite3.connect(config.db_path) as conn:
        conn.executescript(schema_path.read_text(encoding="utf-8"))
        _ensure_contest_columns(conn)
        conn.commit()
