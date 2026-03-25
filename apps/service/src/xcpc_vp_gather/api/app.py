from __future__ import annotations

from typing import Annotated

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..config import ServiceConfig
from ..db.init_db import ensure_database
from ..services.config_io import export_config, export_contests, import_config, import_contests_async
from ..services.contests import (
    add_coverage_summaries,
    annotate_contest,
    get_contest_detail,
    list_contests_filtered,
    paginate_contests,
)
from ..services.coverage import get_contest_coverage
from ..services.members import list_member_people, list_members
from ..services.sync import sync_contest, sync_member_problem_status, sync_missing_contests


class ContestSyncRequest(BaseModel):
    provider_key: str = Field(default="codeforces")
    provider_contest_id: str | None = None
    contest_url: str | None = None


class MemberSyncRequest(BaseModel):
    provider_key: str = Field(default="codeforces")
    local_member_key: str
    provider_handle: str
    display_name: str | None = None


class ContestAnnotateRequest(BaseModel):
    contest_ref: str
    provider_key: str | None = None
    alias: str | None = None
    tags: list[str] | None = None


class ContestImportRequest(BaseModel):
    payload: dict
    sync: bool = False


class ConfigImportRequest(BaseModel):
    payload: dict


def create_app(config: ServiceConfig) -> FastAPI:
    ensure_database(config)
    app = FastAPI(title="xcpc-vp-gather local API", version="0.1.1")
    app.state.config = config
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/contests")
    def list_contests_endpoint(
        provider: str | None = None,
        tag: Annotated[list[str] | None, Query()] = None,
        with_coverage: bool = False,
        whole_contest_fresh_only: bool = False,
        no_fresh_only: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        contests = list_contests_filtered(
            config,
            provider_key=provider,
            tags=tag,
        )
        if with_coverage:
            contests = add_coverage_summaries(config, contests)
        if whole_contest_fresh_only:
            contests = [
                contest
                for contest in contests
                if (contest.get("problem_count") or 0) > 0
                and contest.get("fresh_problem_count") == contest.get("problem_count")
            ]
        if no_fresh_only:
            contests = [
                contest
                for contest in contests
                if (contest.get("problem_count") or 0) > 0
                and (contest.get("fresh_problem_count") or 0) < (contest.get("problem_count") or 0)
            ]
        paged = paginate_contests(contests, page=page, page_size=min(max(page_size, 1), 100))
        return paged

    @app.post("/api/contests/annotate")
    def annotate_contest_endpoint(payload: ContestAnnotateRequest) -> dict:
        return annotate_contest(
            config,
            payload.contest_ref,
            provider_key=payload.provider_key,
            alias=payload.alias,
            tags=payload.tags,
        )

    @app.get("/api/contests/export")
    def export_contests_endpoint() -> dict:
        return export_contests(config)

    @app.post("/api/contests/import")
    async def import_contests_endpoint(payload: ContestImportRequest) -> dict:
        return await import_contests_async(config, payload.payload, sync=payload.sync)

    @app.get("/api/contests/{contest_id}")
    def get_contest_detail_endpoint(contest_id: str) -> dict:
        return get_contest_detail(config, contest_id)

    @app.get("/api/members")
    def list_members_endpoint(provider: str | None = None) -> dict:
        return {
            "members": list_members(config, provider_key=provider),
            "people": list_member_people(config, provider_key=provider),
        }

    @app.get("/api/config/export")
    def export_config_endpoint() -> dict:
        return export_config(config)

    @app.post("/api/config/import")
    def import_config_endpoint(payload: ConfigImportRequest) -> dict:
        return import_config(config, payload.payload)

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

    @app.post("/api/contests/sync-missing")
    async def sync_missing_contests_endpoint() -> dict:
        return await sync_missing_contests(config)

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
