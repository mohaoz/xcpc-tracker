from __future__ import annotations

from ..config import ServiceConfig
from ..db.connection import connect_db
from .repository import Repository


STATUS_PRIORITY = {
    "unseen": 0,
    "tried": 1,
    "solved": 2,
}


def _normalize(value: str | None) -> str:
    return (value or "").strip().casefold()


def _merge_status(statuses: list[str]) -> str:
    best = "unseen"
    for status in statuses:
        if STATUS_PRIORITY[status] > STATUS_PRIORITY[best]:
            best = status
    return best


def _matches_problem(problem_row, status_row, contest_title: str) -> bool:
    if str(status_row["provider_problem_id"]) == str(problem_row["provider_problem_id"]):
        return True
    if _normalize(status_row["contest_title"]) != _normalize(contest_title):
        return False
    target_ordinal = _normalize(problem_row["ordinal"] or problem_row["problem_code"])
    other_ordinal = _normalize(status_row["problem_ordinal"] or status_row["problem_code"])
    if target_ordinal and other_ordinal and target_ordinal == other_ordinal:
        return True
    return _normalize(status_row["problem_title"]) == _normalize(problem_row["title"])


def get_contest_coverage(config: ServiceConfig, contest_id: str) -> dict:
    with connect_db(config) as conn:
        repo = Repository(conn)
        contest = repo.get_contest(contest_id)
        if contest is None:
            raise LookupError(f"Unknown contest: {contest_id}")
        problems = repo.list_contest_problems(contest_id)
        tracked_members = repo.list_tracked_members()
        member_rows = {
            str(member["local_member_key"]): repo.list_member_problem_status_rows(
                str(member["local_member_key"])
            )
            for member in tracked_members
        }

        problem_rows = []
        fresh_problem_ids = []
        for problem in problems:
            member_statuses = []
            any_seen = False
            for member in tracked_members:
                local_member_key = str(member["local_member_key"])
                candidate_rows = [
                    row
                    for row in member_rows[local_member_key]
                    if _matches_problem(problem, row, str(contest["title"]))
                ]
                status = _merge_status([str(row["status"]) for row in candidate_rows]) if candidate_rows else "unseen"
                if status != "unseen":
                    any_seen = True
                member_statuses.append(
                    {
                        "local_member_key": local_member_key,
                        "display_name": member["display_name"],
                        "status": status,
                    }
                )
            if not any_seen:
                fresh_problem_ids.append(str(problem["id"]))
            problem_rows.append(
                {
                    "problem_id": str(problem["id"]),
                    "provider_problem_id": str(problem["provider_problem_id"]),
                    "ordinal": problem["ordinal"],
                    "title": problem["title"],
                    "fresh_for_team": not any_seen,
                    "members": member_statuses,
                }
            )

        return {
            "contest": {
                "contest_id": str(contest["id"]),
                "provider_key": str(contest["provider_key"]),
                "provider_contest_id": str(contest["provider_contest_id"]),
                "title": str(contest["title"]),
            },
            "tracked_members": [
                {
                    "local_member_key": str(member["local_member_key"]),
                    "display_name": member["display_name"],
                }
                for member in tracked_members
            ],
            "problem_count": len(problem_rows),
            "fresh_problem_count": len(fresh_problem_ids),
            "problems": problem_rows,
        }
