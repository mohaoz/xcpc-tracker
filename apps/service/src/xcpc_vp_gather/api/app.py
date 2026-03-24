from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI
from pydantic import BaseModel, Field

from ..config import ServiceConfig
from ..db.init_db import ensure_database
from ..services.coverage import get_contest_coverage
from ..services.sync import sync_contest, sync_member_problem_status


class ContestSyncRequest(BaseModel):
    provider_key: str = Field(default="codeforces")
    provider_contest_id: str | None = None
    contest_url: str | None = None


class MemberSyncRequest(BaseModel):
    provider_key: str = Field(default="codeforces")
    local_member_key: str
    provider_handle: str
    display_name: str | None = None


def create_app(config: ServiceConfig) -> FastAPI:
    ensure_database(config)
    app = FastAPI(title="xcpc-vp-gather local API", version="0.1.0")
    app.state.config = config

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/contests/sync")
    async def sync_contest_endpoint(payload: ContestSyncRequest) -> dict:
        result = await sync_contest(
            config,
            provider_key=payload.provider_key,
            provider_contest_id=payload.provider_contest_id,
            contest_url=payload.contest_url,
            alias=None,
            tags=None,
        )
        return {
            "contest_id": result.contest_id,
            "provider_key": result.provider_key,
            "provider_contest_id": result.provider_contest_id,
            "problem_count": result.problem_count,
        }

    @app.post("/api/members/problem-status/sync")
    async def sync_member_problem_status_endpoint(payload: MemberSyncRequest) -> dict:
        result = await sync_member_problem_status(
            config,
            provider_key=payload.provider_key,
            local_member_key=payload.local_member_key,
            provider_handle=payload.provider_handle,
            display_name=payload.display_name,
        )
        return {
            "identity_binding_id": result.identity_binding_id,
            "provider_key": result.provider_key,
            "local_member_key": result.local_member_key,
            "provider_handle": result.provider_handle,
            "status_count": result.status_count,
        }

    @app.get("/api/contests/{contest_id}/coverage")
    def contest_coverage_endpoint(contest_id: str) -> dict:
        return get_contest_coverage(config, contest_id)

    return app
