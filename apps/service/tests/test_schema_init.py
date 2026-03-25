from __future__ import annotations

import sqlite3
from pathlib import Path

from xcpc_vp_gather.config import load_config
from xcpc_vp_gather.db.init_db import ensure_database


def test_schema_initializes(tmp_path: Path) -> None:
    config = load_config(tmp_path)
    ensure_database(config)

    with sqlite3.connect(config.db_path) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        contest_summary_columns = {
            row[1]
            for row in conn.execute(
                "PRAGMA table_info(contest_coverage_summary)"
            ).fetchall()
        }

    assert "contest" in tables
    assert "contest_coverage_summary" in tables
    assert "member_problem_status" in tables
    assert "task_run" in tables
    assert "problem_states_json" in contest_summary_columns
