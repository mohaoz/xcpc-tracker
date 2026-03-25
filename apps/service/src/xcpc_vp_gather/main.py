from __future__ import annotations

import os
from pathlib import Path

from .api.app import create_app
from .config import load_config
from .db.init_db import ensure_database
from .services.contest_summaries import refresh_missing_contest_summaries


def resolve_project_root() -> Path:
    override = os.environ.get("XVG_PROJECT_ROOT")
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[4]


def build_app():
    project_root = resolve_project_root()
    config = load_config(project_root)
    ensure_database(config)
    refresh_missing_contest_summaries(config)
    return create_app(config)


app = build_app()
