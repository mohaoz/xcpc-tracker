from __future__ import annotations

import json

from ..config import ServiceConfig
from ..core.time import now_iso
from ..db.connection import connect_db
from .repository import Repository


def _parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return list(json.loads(value))


def _parse_problem_states(value: str | None) -> list[dict[str, str]]:
    if not value:
        return []
    return list(json.loads(value))


def list_contests(config: ServiceConfig, provider_key: str | None = None) -> list[dict]:
    with connect_db(config) as conn:
        repo = Repository(conn)
        rows = repo.list_contests(provider_key)
        contests = [
            {
                "contest_id": str(row["id"]),
                "provider_key": str(row["provider_key"]),
                "provider_contest_id": str(row["provider_contest_id"]),
                "alias": row["alias"],
                "tags": _parse_tags(row["tags_json"]),
                "title": str(row["title"]),
                "official_url": row["official_url"],
                "updated_at": str(row["updated_at"]),
                "problem_count": row["summary_problem_count"],
                "fresh_problem_count": row["summary_fresh_problem_count"],
                "tried_problem_count": row["summary_tried_problem_count"],
                "solved_problem_count": row["summary_solved_problem_count"],
                "problem_states": _parse_problem_states(row["summary_problem_states_json"]),
                "summary_updated_at": row["summary_updated_at"],
            }
            for row in rows
        ]
        return contests


def get_contest_detail(config: ServiceConfig, contest_id: str) -> dict:
    with connect_db(config) as conn:
        repo = Repository(conn)
        row = repo.get_contest(contest_id)
        if row is None:
            raise LookupError(f"Unknown contest: {contest_id}")
        problems = repo.list_contest_problems(contest_id)
        return {
            "contest_id": str(row["id"]),
            "provider_key": str(row["provider_key"]),
            "provider_contest_id": str(row["provider_contest_id"]),
            "alias": row["alias"],
            "tags": _parse_tags(row["tags_json"]),
            "title": str(row["title"]),
            "official_url": row["official_url"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "timezone": row["timezone"],
            "problem_count": len(problems),
            "updated_at": str(row["updated_at"]),
        }


def list_contests_filtered(
    config: ServiceConfig,
    *,
    provider_key: str | None = None,
    tags: list[str] | None = None,
) -> list[dict]:
    contests = list_contests(config, provider_key=provider_key)
    if not tags:
        return contests

    required = {tag.casefold() for tag in tags}
    return [
        contest
        for contest in contests
        if required.issubset({tag.casefold() for tag in contest["tags"]})
    ]


def paginate_contests(
    contests: list[dict],
    *,
    page: int,
    page_size: int,
) -> dict:
    normalized_page = max(page, 1)
    normalized_page_size = max(1, page_size)
    total_count = len(contests)
    total_pages = max(1, (total_count + normalized_page_size - 1) // normalized_page_size)
    current_page = min(normalized_page, total_pages)
    start = (current_page - 1) * normalized_page_size
    end = start + normalized_page_size
    return {
        "contests": contests[start:end],
        "page": current_page,
        "page_size": normalized_page_size,
        "total_count": total_count,
        "total_pages": total_pages,
    }


def add_coverage_summaries(config: ServiceConfig, contests: list[dict]) -> list[dict]:
    return contests


def resolve_contest_id(
    config: ServiceConfig, contest_ref: str, provider_key: str | None = None
) -> str:
    with connect_db(config) as conn:
        repo = Repository(conn)

        contest = repo.get_contest(contest_ref)
        if contest is not None:
            return str(contest["id"])

        by_alias = repo.find_contests_by_alias(contest_ref, provider_key)
        if len(by_alias) == 1:
            return str(by_alias[0]["id"])
        if len(by_alias) > 1:
            raise ValueError(
                f"Contest alias '{contest_ref}' matches multiple contests; pass --provider or internal contest id"
            )

        by_provider_id = repo.find_contests_by_provider_contest_id(contest_ref, provider_key)
        if len(by_provider_id) == 1:
            return str(by_provider_id[0]["id"])
        if len(by_provider_id) > 1:
            raise ValueError(
                f"Contest reference '{contest_ref}' matches multiple provider contest ids; pass --provider or internal contest id"
            )

        by_title = repo.find_contests_by_title(contest_ref, provider_key)
        if len(by_title) == 1:
            return str(by_title[0]["id"])
        if len(by_title) > 1:
            raise ValueError(
                f"Contest title '{contest_ref}' matches multiple contests; pass --provider or internal contest id"
            )

    raise LookupError(f"Unknown contest reference: {contest_ref}")


def annotate_contest(
    config: ServiceConfig,
    contest_ref: str,
    *,
    provider_key: str | None = None,
    alias: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    contest_id = resolve_contest_id(config, contest_ref, provider_key=provider_key)
    updated_at = now_iso()
    with connect_db(config) as conn:
        repo = Repository(conn)
        repo.update_contest_metadata(
            contest_id=contest_id,
            alias=alias,
            tags=tags,
            updated_at=updated_at,
        )
        contest = repo.get_contest(contest_id)
        conn.commit()
    return {
        "contest_id": contest_id,
        "alias": None if contest is None else contest["alias"],
        "tags": [] if contest is None else _parse_tags(contest["tags_json"]),
    }
