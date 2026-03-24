from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class ServiceConfig:
    app_name: str
    db_path: Path
    artifact_root: Path
    browser_state_root: Path
    log_root: Path
    codeforces_api_key: str | None
    codeforces_api_secret: str | None


def load_config(project_root: Path) -> ServiceConfig:
    var_root = project_root / "var"
    return ServiceConfig(
        app_name="xcpc-vp-gather-service",
        db_path=var_root / "sqlite" / "app.db",
        artifact_root=var_root / "artifacts",
        browser_state_root=var_root / "browser-state",
        log_root=var_root / "logs",
        codeforces_api_key=os.environ.get("XVG_CODEFORCES_API_KEY"),
        codeforces_api_secret=os.environ.get("XVG_CODEFORCES_API_SECRET"),
    )
