from __future__ import annotations

import sqlite3

from ..config import ServiceConfig
from .init_db import ensure_database


def connect_db(config: ServiceConfig) -> sqlite3.Connection:
    ensure_database(config)
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
