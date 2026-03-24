from __future__ import annotations

from pathlib import Path

from .api.app import create_app
from .config import load_config
from .db.init_db import ensure_database


def build_app():
    project_root = Path(__file__).resolve().parents[4]
    config = load_config(project_root)
    ensure_database(config)
    return create_app(config)


app = build_app()
