from __future__ import annotations

import json
import sqlite3

from ..core.ids import stable_id


class Repository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def upsert_contest(
        self,
        *,
        provider_key: str,
        provider_contest_id: str,
        alias: str | None = None,
        tags: list[str] | None = None,
        title: str,
        official_url: str | None,
        start_time: str | None,
        end_time: str | None,
        timezone: str | None,
        source_payload: dict,
        updated_at: str,
    ) -> str:
        contest_id = stable_id("contest", provider_key, provider_contest_id)
        self.conn.execute(
            """
            INSERT INTO contest (
              id, provider_key, provider_contest_id, slug, alias, tags_json, title, official_url,
              start_time, end_time, timezone, source_payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_key, provider_contest_id) DO UPDATE SET
              alias = COALESCE(excluded.alias, contest.alias),
              tags_json = COALESCE(excluded.tags_json, contest.tags_json),
              title = excluded.title,
              official_url = excluded.official_url,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              timezone = excluded.timezone,
              source_payload_json = excluded.source_payload_json,
              updated_at = excluded.updated_at
            """,
            (
                contest_id,
                provider_key,
                provider_contest_id,
                None,
                alias,
                None if tags is None else json.dumps(tags, ensure_ascii=False),
                title,
                official_url,
                start_time,
                end_time,
                timezone,
                json.dumps(source_payload),
                updated_at,
                updated_at,
            ),
        )
        return contest_id

    def update_contest_metadata(
        self,
        *,
        contest_id: str,
        alias: str | None = None,
        tags: list[str] | None = None,
        updated_at: str,
    ) -> None:
        sets = ["updated_at = ?"]
        params: list[object] = [updated_at]
        if alias is not None:
            sets.append("alias = ?")
            params.append(alias)
        if tags is not None:
            sets.append("tags_json = ?")
            params.append(json.dumps(tags, ensure_ascii=False))
        params.append(contest_id)
        self.conn.execute(
            f"UPDATE contest SET {', '.join(sets)} WHERE id = ?",
            params,
        )

    def upsert_problem(
        self,
        *,
        provider_key: str,
        provider_problem_id: str,
        contest_id: str,
        problem_code: str | None,
        ordinal: str | None,
        title: str,
        official_url: str | None,
        statement_url: str | None,
        source_payload: dict,
        updated_at: str,
    ) -> str:
        problem_id = stable_id("problem", provider_key, provider_problem_id)
        self.conn.execute(
            """
            INSERT INTO problem (
              id, provider_key, provider_problem_id, contest_id, problem_code, title,
              ordinal, official_url, statement_url, source_payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_key, provider_problem_id) DO UPDATE SET
              contest_id = excluded.contest_id,
              problem_code = excluded.problem_code,
              title = excluded.title,
              ordinal = excluded.ordinal,
              official_url = excluded.official_url,
              statement_url = excluded.statement_url,
              source_payload_json = excluded.source_payload_json,
              updated_at = excluded.updated_at
            """,
            (
                problem_id,
                provider_key,
                provider_problem_id,
                contest_id,
                problem_code,
                title,
                ordinal,
                official_url,
                statement_url,
                json.dumps(source_payload),
                updated_at,
                updated_at,
            ),
        )
        return problem_id

    def upsert_identity_binding(
        self,
        *,
        provider_key: str,
        local_member_key: str,
        provider_handle: str,
        display_name: str | None,
        updated_at: str,
    ) -> str:
        binding_id = stable_id("identity_binding", provider_key, local_member_key, provider_handle)
        self.conn.execute(
            """
            INSERT INTO identity_binding (
              id, provider_key, provider_user_id, provider_handle, local_member_key,
              display_name, binding_status, source_payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_key, local_member_key, provider_handle) DO UPDATE SET
              display_name = excluded.display_name,
              binding_status = excluded.binding_status,
              updated_at = excluded.updated_at
            """,
            (
                binding_id,
                provider_key,
                None,
                provider_handle,
                local_member_key,
                display_name,
                "active",
                "{}",
                updated_at,
                updated_at,
            ),
        )
        return binding_id

    def upsert_member_problem_status(
        self,
        *,
        provider_key: str,
        local_member_key: str,
        identity_binding_id: str,
        provider_problem_id: str,
        status: str,
        source_url: str | None,
        source_payload: dict,
        first_seen_at: str,
        updated_at: str,
    ) -> str:
        problem_id = self.lookup_problem_id(provider_key, provider_problem_id)
        row_id = stable_id("member_problem_status", provider_key, local_member_key, provider_problem_id)
        self.conn.execute(
            """
            INSERT INTO member_problem_status (
              id, provider_key, local_member_key, identity_binding_id, problem_id,
              provider_problem_id, status, last_source_kind, source_url, source_payload_json,
              first_seen_at, last_seen_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_key, local_member_key, provider_problem_id) DO UPDATE SET
              identity_binding_id = excluded.identity_binding_id,
              problem_id = excluded.problem_id,
              status = CASE
                WHEN member_problem_status.status = 'solved' THEN 'solved'
                WHEN excluded.status = 'solved' THEN 'solved'
                ELSE excluded.status
              END,
              last_source_kind = excluded.last_source_kind,
              source_url = excluded.source_url,
              source_payload_json = excluded.source_payload_json,
              last_seen_at = excluded.last_seen_at,
              updated_at = excluded.updated_at
            """,
            (
                row_id,
                provider_key,
                local_member_key,
                identity_binding_id,
                problem_id,
                provider_problem_id,
                status,
                "member_history",
                source_url,
                json.dumps(source_payload),
                first_seen_at,
                updated_at,
                updated_at,
            ),
        )
        return row_id

    def lookup_problem_id(self, provider_key: str, provider_problem_id: str) -> str | None:
        row = self.conn.execute(
            "SELECT id FROM problem WHERE provider_key = ? AND provider_problem_id = ?",
            (provider_key, provider_problem_id),
        ).fetchone()
        return None if row is None else str(row["id"])

    def list_active_bindings(self, provider_key: str) -> list[sqlite3.Row]:
        cursor = self.conn.execute(
            """
            SELECT *
            FROM identity_binding
            WHERE provider_key = ? AND binding_status = 'active'
            ORDER BY local_member_key ASC
            """,
            (provider_key,),
        )
        return cursor.fetchall()

    def list_identity_bindings(self, provider_key: str | None = None) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT *
                FROM identity_binding
                ORDER BY provider_key ASC, local_member_key ASC, provider_handle ASC
                """
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT *
            FROM identity_binding
            WHERE provider_key = ?
            ORDER BY local_member_key ASC, provider_handle ASC
            """,
            (provider_key,),
        )
        return cursor.fetchall()

    def list_member_status_counts(self, provider_key: str | None = None) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT
                  local_member_key,
                  SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved_count,
                  SUM(CASE WHEN status = 'tried' THEN 1 ELSE 0 END) AS tried_count
                FROM member_problem_status
                GROUP BY local_member_key
                ORDER BY local_member_key ASC
                """
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT
              local_member_key,
              SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved_count,
              SUM(CASE WHEN status = 'tried' THEN 1 ELSE 0 END) AS tried_count
            FROM member_problem_status
            WHERE provider_key = ?
            GROUP BY local_member_key
            ORDER BY local_member_key ASC
            """,
            (provider_key,),
        )
        return cursor.fetchall()

    def get_contest(self, contest_id: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM contest WHERE id = ?", (contest_id,)).fetchone()

    def get_contest_by_provider_ref(self, provider_key: str, provider_contest_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM contest WHERE provider_key = ? AND provider_contest_id = ?",
            (provider_key, provider_contest_id),
        ).fetchone()

    def find_contests_by_provider_contest_id(
        self, provider_contest_id: str, provider_key: str | None = None
    ) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT *
                FROM contest
                WHERE provider_contest_id = ?
                ORDER BY provider_key ASC, title ASC
                """,
                (provider_contest_id,),
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT *
            FROM contest
            WHERE provider_key = ? AND provider_contest_id = ?
            ORDER BY title ASC
            """,
            (provider_key, provider_contest_id),
        )
        return cursor.fetchall()

    def find_contests_by_title(self, title: str, provider_key: str | None = None) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT *
                FROM contest
                WHERE lower(title) = lower(?)
                ORDER BY provider_key ASC, provider_contest_id ASC
                """,
                (title,),
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT *
            FROM contest
            WHERE provider_key = ? AND lower(title) = lower(?)
            ORDER BY provider_contest_id ASC
            """,
            (provider_key, title),
        )
        return cursor.fetchall()

    def find_contests_by_alias(self, alias: str, provider_key: str | None = None) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT *
                FROM contest
                WHERE lower(alias) = lower(?)
                ORDER BY provider_key ASC, provider_contest_id ASC
                """,
                (alias,),
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT *
            FROM contest
            WHERE provider_key = ? AND lower(alias) = lower(?)
            ORDER BY provider_contest_id ASC
            """,
            (provider_key, alias),
        )
        return cursor.fetchall()

    def list_contests(self, provider_key: str | None = None) -> list[sqlite3.Row]:
        if provider_key is None:
            cursor = self.conn.execute(
                """
                SELECT *
                FROM contest
                ORDER BY updated_at DESC, provider_key ASC, provider_contest_id ASC
                """
            )
            return cursor.fetchall()
        cursor = self.conn.execute(
            """
            SELECT *
            FROM contest
            WHERE provider_key = ?
            ORDER BY updated_at DESC, provider_contest_id ASC
            """,
            (provider_key,),
        )
        return cursor.fetchall()

    def list_contest_problems(self, contest_id: str) -> list[sqlite3.Row]:
        cursor = self.conn.execute(
            """
            SELECT *
            FROM problem
            WHERE contest_id = ?
            ORDER BY ordinal ASC, title ASC
            """,
            (contest_id,),
        )
        return cursor.fetchall()

    def get_member_status_map(self, provider_key: str, local_member_key: str) -> dict[str, sqlite3.Row]:
        cursor = self.conn.execute(
            """
            SELECT *
            FROM member_problem_status
            WHERE provider_key = ? AND local_member_key = ?
            """,
            (provider_key, local_member_key),
        )
        return {str(row["provider_problem_id"]): row for row in cursor.fetchall()}

    def list_tracked_members(self) -> list[sqlite3.Row]:
        cursor = self.conn.execute(
            """
            SELECT
              local_member_key,
              MIN(display_name) AS display_name
            FROM identity_binding
            WHERE binding_status = 'active'
            GROUP BY local_member_key
            ORDER BY local_member_key ASC
            """
        )
        return cursor.fetchall()

    def list_member_problem_status_rows(self, local_member_key: str) -> list[sqlite3.Row]:
        cursor = self.conn.execute(
            """
            SELECT
              mps.*,
              p.title AS problem_title,
              p.ordinal AS problem_ordinal,
              p.problem_code AS problem_code,
              c.title AS contest_title
            FROM member_problem_status AS mps
            LEFT JOIN problem AS p ON p.id = mps.problem_id
            LEFT JOIN contest AS c ON c.id = p.contest_id
            WHERE mps.local_member_key = ?
            """,
            (local_member_key,),
        )
        return cursor.fetchall()
