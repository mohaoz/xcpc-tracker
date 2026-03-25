from __future__ import annotations

import sqlite3

from ..config import ServiceConfig
from ..core.time import now_iso
from ..db.connection import connect_db
from .coverage import get_contest_coverage
from .repository import Repository


def _problem_summary_status(statuses: list[str]) -> str:
    if any(status == "solved" for status in statuses):
        return "solved"
    if any(status == "tried" for status in statuses):
        return "tried"
    return "unseen"


def summarize_coverage_payload(payload: dict) -> dict[str, int]:
    solved_problem_count = 0
    tried_problem_count = 0
    problem_states: list[dict[str, str]] = []

    for problem in payload["problems"]:
        statuses = [member["status"] for member in problem["members"]]
        summary_status = _problem_summary_status(statuses)
        problem_states.append(
            {
                "ordinal": str(problem["ordinal"]),
                "status": summary_status,
            }
        )
        if summary_status == "solved":
            solved_problem_count += 1
        elif summary_status == "tried":
            tried_problem_count += 1

    return {
        "problem_count": int(payload["problem_count"]),
        "fresh_problem_count": int(payload["fresh_problem_count"]),
        "tried_problem_count": tried_problem_count,
        "solved_problem_count": solved_problem_count,
        "problem_states": problem_states,
    }


def refresh_contest_summary(config: ServiceConfig, contest_id: str) -> None:
    payload = get_contest_coverage(config, contest_id)
    summary = summarize_coverage_payload(payload)
    with connect_db(config) as conn:
        repo = Repository(conn)
        repo.replace_contest_coverage_summary(
            contest_id=contest_id,
            updated_at=now_iso(),
            **summary,
        )
        conn.commit()


def refresh_all_contest_summaries(config: ServiceConfig) -> None:
    with connect_db(config) as conn:
        repo = Repository(conn)
        contest_ids = repo.list_contest_ids()

    for contest_id in contest_ids:
        refresh_contest_summary(config, contest_id)


def refresh_contest_summary_in_conn(conn: sqlite3.Connection, contest_id: str) -> None:
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

    solved_problem_count = 0
    tried_problem_count = 0
    fresh_problem_count = 0
    problem_states: list[dict[str, str]] = []

    from .coverage import _matches_problem, _merge_status  # local import to avoid circular import

    for problem in problems:
        any_seen = False
        any_solved = False
        any_tried = False
        for member in tracked_members:
            local_member_key = str(member["local_member_key"])
            candidate_rows = [
                row
                for row in member_rows[local_member_key]
                if _matches_problem(problem, row, str(contest["title"]))
            ]
            status = _merge_status([str(row["status"]) for row in candidate_rows]) if candidate_rows else "unseen"
            if status == "solved":
                any_seen = True
                any_solved = True
            elif status == "tried":
                any_seen = True
                any_tried = True
        summary_status = "unseen"
        if not any_seen:
            fresh_problem_count += 1
        elif any_solved:
            solved_problem_count += 1
            summary_status = "solved"
        elif any_tried:
            tried_problem_count += 1
            summary_status = "tried"
        problem_states.append(
            {
                "ordinal": str(problem["ordinal"] or problem["problem_code"] or "?"),
                "status": summary_status,
            }
        )

    repo.replace_contest_coverage_summary(
        contest_id=contest_id,
        problem_count=len(problems),
        fresh_problem_count=fresh_problem_count,
        tried_problem_count=tried_problem_count,
        solved_problem_count=solved_problem_count,
        problem_states=problem_states,
        updated_at=now_iso(),
    )


def refresh_all_contest_summaries_in_conn(conn: sqlite3.Connection) -> None:
    repo = Repository(conn)
    for contest_id in repo.list_contest_ids():
        refresh_contest_summary_in_conn(conn, contest_id)


def refresh_missing_contest_summaries(config: ServiceConfig) -> None:
    with connect_db(config) as conn:
        refresh_missing_contest_summaries_in_conn(conn)
        conn.commit()


def refresh_missing_contest_summaries_in_conn(conn: sqlite3.Connection) -> None:
    repo = Repository(conn)
    for contest_id in repo.list_contest_ids_missing_summary():
        refresh_contest_summary_in_conn(conn, contest_id)
