from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from ..config import ServiceConfig
from ..core.time import now_iso
from ..db.connection import connect_db
from ..models import IdentityBindingRef, ProviderContestRef, ProviderContext
from ..providers.registry import build_provider_registry
from .repository import Repository


def build_provider_context(config: ServiceConfig, provider_key: str) -> ProviderContext:
    return ProviderContext(
        provider_key=provider_key,
        browser_state_dir=str(config.browser_state_root),
        artifact_root=str(config.artifact_root),
        now_iso=now_iso(),
    )


def parse_codeforces_contest_reference(contest_url: str) -> str:
    parsed = urlparse(contest_url)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0] == "gym":
        return parts[1]
    raise ValueError(f"Unsupported Codeforces contest URL: {contest_url}")


@dataclass(frozen=True)
class ContestSyncSummary:
    contest_id: str
    provider_key: str
    provider_contest_id: str
    problem_count: int


@dataclass(frozen=True)
class MemberSyncSummary:
    identity_binding_id: str
    provider_key: str
    local_member_key: str
    provider_handle: str
    status_count: int


async def sync_contest(
    config: ServiceConfig,
    *,
    provider_key: str,
    provider_contest_id: str | None = None,
    contest_url: str | None = None,
    alias: str | None = None,
    tags: list[str] | None = None,
) -> ContestSyncSummary:
    if provider_contest_id is None:
        if provider_key != "codeforces" or contest_url is None:
            raise ValueError("contest_url parsing is only implemented for Codeforces Gym")
        provider_contest_id = parse_codeforces_contest_reference(contest_url)

    provider = build_provider_registry(config)[provider_key]
    ctx = build_provider_context(config, provider_key)
    result = await provider.sync_contest(
        ctx,
        ProviderContestRef(
            provider_key=provider_key,
            provider_contest_id=provider_contest_id,
            contest_url=contest_url,
        ),
    )

    updated_at = now_iso()
    with connect_db(config) as conn:
        repo = Repository(conn)
        contest_id = repo.upsert_contest(
            provider_key=result.provider_key,
            provider_contest_id=result.provider_contest_id,
            alias=alias,
            tags=tags,
            title=result.title,
            official_url=result.official_url,
            start_time=result.start_time,
            end_time=result.end_time,
            timezone=result.timezone,
            source_payload=result.source_payload,
            updated_at=updated_at,
        )
        for problem in result.problems:
            repo.upsert_problem(
                provider_key=result.provider_key,
                provider_problem_id=problem.provider_problem_id,
                contest_id=contest_id,
                problem_code=problem.problem_code,
                ordinal=problem.ordinal,
                title=problem.title,
                official_url=problem.official_url,
                statement_url=problem.official_url,
                source_payload=problem.source_payload,
                updated_at=updated_at,
            )
        conn.commit()

    return ContestSyncSummary(
        contest_id=contest_id,
        provider_key=result.provider_key,
        provider_contest_id=result.provider_contest_id,
        problem_count=len(result.problems),
    )


async def sync_member_problem_status(
    config: ServiceConfig,
    *,
    provider_key: str,
    local_member_key: str,
    provider_handle: str,
    display_name: str | None = None,
) -> MemberSyncSummary:
    provider = build_provider_registry(config)[provider_key]
    ctx = build_provider_context(config, provider_key)
    binding_ref = IdentityBindingRef(
        provider_key=provider_key,
        local_member_key=local_member_key,
        provider_handle=provider_handle,
    )
    result = await provider.sync_member_problem_status(ctx, binding_ref)
    updated_at = now_iso()
    with connect_db(config) as conn:
        repo = Repository(conn)
        identity_binding_id = repo.upsert_identity_binding(
            provider_key=provider_key,
            local_member_key=local_member_key,
            provider_handle=provider_handle,
            display_name=display_name or local_member_key,
            updated_at=updated_at,
        )
        for item in result.statuses:
            repo.upsert_member_problem_status(
                provider_key=provider_key,
                local_member_key=local_member_key,
                identity_binding_id=identity_binding_id,
                provider_problem_id=item.provider_problem_id,
                status=item.status,
                source_url=item.source_url,
                source_payload=item.source_payload,
                first_seen_at=updated_at,
                updated_at=updated_at,
            )
        conn.commit()

    return MemberSyncSummary(
        identity_binding_id=identity_binding_id,
        provider_key=provider_key,
        local_member_key=local_member_key,
        provider_handle=provider_handle,
        status_count=len(result.statuses),
    )
