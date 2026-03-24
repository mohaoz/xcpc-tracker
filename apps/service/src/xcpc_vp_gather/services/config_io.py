from __future__ import annotations

from pathlib import Path
import asyncio

from ..config import ServiceConfig
from ..core.time import now_iso
from ..db.connection import connect_db
from .repository import Repository
from .sync import sync_contest


def _export_contests(repo: Repository) -> list[dict]:
    return [
        {
            "provider_key": str(row["provider_key"]),
            "provider_contest_id": str(row["provider_contest_id"]),
            "alias": row["alias"],
            "tags": [] if row["tags_json"] is None else __import__("json").loads(row["tags_json"]),
            "title": str(row["title"]),
            "official_url": row["official_url"],
        }
        for row in repo.list_contests()
    ]


def export_config(config: ServiceConfig) -> dict:
    with connect_db(config) as conn:
        repo = Repository(conn)
        contests = _export_contests(repo)
        members = [
            {
                "provider_key": str(row["provider_key"]),
                "local_member_key": str(row["local_member_key"]),
                "provider_handle": str(row["provider_handle"]),
                "display_name": row["display_name"],
                "binding_status": str(row["binding_status"]),
            }
            for row in repo.list_identity_bindings()
        ]
    return {
        "schema_version": 1,
        "export_kind": "config_only",
        "exported_at": now_iso(),
        "contests": contests,
        "members": members,
    }


def export_contests(config: ServiceConfig) -> dict:
    with connect_db(config) as conn:
        repo = Repository(conn)
        contests = _export_contests(repo)
    return {
        "schema_version": 1,
        "export_kind": "contest_config_only",
        "exported_at": now_iso(),
        "contests": contests,
    }


def import_config(config: ServiceConfig, payload: dict) -> dict:
    contests = payload.get("contests", [])
    members = payload.get("members", [])
    updated_at = now_iso()

    with connect_db(config) as conn:
        repo = Repository(conn)

        for contest in contests:
            repo.upsert_contest(
                provider_key=str(contest["provider_key"]),
                provider_contest_id=str(contest["provider_contest_id"]),
                alias=contest.get("alias"),
                tags=contest.get("tags"),
                title=str(contest["title"]),
                official_url=contest.get("official_url"),
                start_time=None,
                end_time=None,
                timezone="UTC",
                source_payload={"imported_from_config": True},
                updated_at=updated_at,
            )

        for member in members:
            repo.upsert_identity_binding(
                provider_key=str(member["provider_key"]),
                local_member_key=str(member["local_member_key"]),
                provider_handle=str(member["provider_handle"]),
                display_name=member.get("display_name"),
                updated_at=updated_at,
            )

        conn.commit()

    return {
        "imported_contest_count": len(contests),
        "imported_member_count": len(members),
    }


def import_contests(config: ServiceConfig, payload: dict, *, sync: bool = False) -> dict:
    contests = payload.get("contests", [])
    updated_at = now_iso()

    with connect_db(config) as conn:
        repo = Repository(conn)

        for contest in contests:
            repo.upsert_contest(
                provider_key=str(contest["provider_key"]),
                provider_contest_id=str(contest["provider_contest_id"]),
                alias=contest.get("alias"),
                tags=contest.get("tags"),
                title=str(contest["title"]),
                official_url=contest.get("official_url"),
                start_time=None,
                end_time=None,
                timezone="UTC",
                source_payload={"imported_from_contest_config": True},
                updated_at=updated_at,
            )

        conn.commit()

    synced = []
    if sync:
        for contest in contests:
            summary = asyncio.run(
                sync_contest(
                    config,
                    provider_key=str(contest["provider_key"]),
                    provider_contest_id=str(contest["provider_contest_id"]),
                    alias=contest.get("alias"),
                    tags=contest.get("tags"),
                )
            )
            synced.append(
                {
                    "provider_key": summary.provider_key,
                    "provider_contest_id": summary.provider_contest_id,
                    "contest_id": summary.contest_id,
                    "problem_count": summary.problem_count,
                }
            )

    result = {
        "imported_contest_count": len(contests),
    }
    if sync:
        result["synced_contest_count"] = len(synced)
        result["synced_contests"] = synced
    return result


def write_export_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(__import__("json").dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_import_file(path: Path) -> dict:
    return __import__("json").loads(path.read_text(encoding="utf-8"))
