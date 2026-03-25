from __future__ import annotations

import json

from ..config import ServiceConfig
from ..core.time import now_iso
from ..db.connection import connect_db
from .coverage import get_contest_coverage
from .repository import Repository


def _parse_tags(value: str | None) -> list[str]:
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


def add_coverage_summaries(config: ServiceConfig, contests: list[dict]) -> list[dict]:
    enriched = []
    for contest in contests:
        coverage = get_contest_coverage(config, contest["contest_id"])
        solved_problem_count = 0
        tried_problem_count = 0
        fresh_problem_count = coverage["fresh_problem_count"]

        for problem in coverage["problems"]:
            statuses = [member["status"] for member in problem["members"]]
            if any(status == "solved" for status in statuses):
                solved_problem_count += 1
            elif any(status == "tried" for status in statuses):
                tried_problem_count += 1

        enriched.append(
            {
                **contest,
                "problem_count": coverage["problem_count"],
                "fresh_problem_count": fresh_problem_count,
                "tried_problem_count": tried_problem_count,
                "solved_problem_count": solved_problem_count,
            }
        )
    return enriched


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
