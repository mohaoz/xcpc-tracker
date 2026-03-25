from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from xcpc_vp_gather.api.app import create_app
from xcpc_vp_gather.config import load_config
from xcpc_vp_gather.core.time import now_iso
from xcpc_vp_gather.db.connection import connect_db
from xcpc_vp_gather.main import build_app
from xcpc_vp_gather.providers.codeforces.provider import CodeforcesProvider
from xcpc_vp_gather.services.config_io import import_contests
from xcpc_vp_gather.services.contest_summaries import refresh_all_contest_summaries
from xcpc_vp_gather.services.repository import Repository


class FakeApiClient:
    async def get(self, method: str, params: dict[str, object]):
        if method == "contest.standings":
            return {
                "contest": {"id": 615540, "name": "Sample Gym"},
                "problems": [
                    {"index": "A", "name": "Alpha"},
                    {"index": "B", "name": "Beta"},
                ],
            }
        if method == "user.status":
            handle = params["handle"]
            if handle == "tourist":
                return [
                    {"id": 10, "verdict": "OK", "problem": {"contestId": 615540, "index": "A"}},
                ]
            return [
                {"id": 11, "verdict": "WRONG_ANSWER", "problem": {"contestId": 615540, "index": "B"}},
            ]
        if method == "contest.status":
            return []
        raise AssertionError(method)


def test_sync_endpoints_and_coverage(tmp_path: Path, monkeypatch) -> None:
    config = load_config(tmp_path)

    def fake_registry(config=None):
        provider = CodeforcesProvider(api_client=FakeApiClient())
        return {provider.provider_key: provider}

    monkeypatch.setattr("xcpc_vp_gather.services.sync.build_provider_registry", fake_registry)

    app = create_app(config)
    client = TestClient(app)

    contest_response = client.post(
        "/api/contests/sync",
        json={"provider_key": "codeforces", "contest_url": "https://codeforces.com/gym/615540"},
    )
    assert contest_response.status_code == 200
    contest_id = contest_response.json()["contest_id"]

    member_one = client.post(
        "/api/members/problem-status/sync",
        json={
            "provider_key": "codeforces",
            "local_member_key": "alice",
            "provider_handle": "tourist",
        },
    )
    assert member_one.status_code == 200

    member_two = client.post(
        "/api/members/problem-status/sync",
        json={
            "provider_key": "codeforces",
            "local_member_key": "bob",
            "provider_handle": "second",
        },
    )
    assert member_two.status_code == 200

    with connect_db(config) as conn:
        repo = Repository(conn)
        updated_at = now_iso()
        qoj_contest_id = repo.upsert_contest(
            provider_key="qoj",
            provider_contest_id="mirror-1",
            title="Sample Gym",
            official_url="https://qoj.ac/contest/1",
            start_time=None,
            end_time=None,
            timezone="UTC",
            source_payload={},
            updated_at=updated_at,
        )
        repo.upsert_problem(
            provider_key="qoj",
            provider_problem_id="mirror-1:B",
            contest_id=qoj_contest_id,
            problem_code="B",
            ordinal="B",
            title="Beta",
            official_url="https://qoj.ac/contest/1/problem/2",
            statement_url=None,
            source_payload={},
            updated_at=updated_at,
        )
        qoj_binding_id = repo.upsert_identity_binding(
            provider_key="qoj",
            local_member_key="alice",
            provider_handle="alice_qoj",
            display_name="alice",
            updated_at=updated_at,
        )
        repo.upsert_member_problem_status(
            provider_key="qoj",
            local_member_key="alice",
            identity_binding_id=qoj_binding_id,
            provider_problem_id="mirror-1:B",
            status="solved",
            source_url="https://qoj.ac/submission/1",
            source_payload={},
            first_seen_at=updated_at,
            updated_at=updated_at,
        )
        conn.commit()
    refresh_all_contest_summaries(config)

    coverage = client.get(f"/api/contests/{contest_id}/coverage")
    assert coverage.status_code == 200
    payload = coverage.json()

    assert payload["problem_count"] == 2
    assert payload["fresh_problem_count"] == 0
    assert payload["problems"][0]["members"][0]["status"] == "solved"
    assert payload["problems"][1]["members"][0]["status"] == "solved"
    assert payload["problems"][1]["members"][1]["status"] == "tried"

    contests_response = client.get("/api/contests", params={"with_coverage": "true"})
    assert contests_response.status_code == 200
    contests_payload = contests_response.json()
    assert contests_payload["page"] == 1
    assert contests_payload["page_size"] == 20
    assert contests_payload["total_count"] == 2
    assert contests_payload["total_pages"] == 1
    assert contests_payload["contests"][0]["contest_id"] == contest_id
    assert contests_payload["contests"][0]["problem_count"] == 2
    assert contests_payload["contests"][0]["fresh_problem_count"] == 0
    assert contests_payload["contests"][0]["problem_states"] == [
        {"ordinal": "A", "status": "solved"},
        {"ordinal": "B", "status": "solved"},
    ]

    paged_response = client.get(
        "/api/contests",
        params={"with_coverage": "true", "page": 1, "page_size": 1},
    )
    assert paged_response.status_code == 200
    paged_payload = paged_response.json()
    assert len(paged_payload["contests"]) == 1
    assert paged_payload["total_count"] == 2
    assert paged_payload["total_pages"] == 2

    fresh_only_response = client.get(
        "/api/contests",
        params={"with_coverage": "true", "whole_contest_fresh_only": "true"},
    )
    assert fresh_only_response.status_code == 200
    fresh_only_payload = fresh_only_response.json()
    assert fresh_only_payload["total_count"] == 0
    assert fresh_only_payload["contests"] == []

    no_fresh_only_response = client.get(
        "/api/contests",
        params={"with_coverage": "true", "no_fresh_only": "true"},
    )
    assert no_fresh_only_response.status_code == 200
    no_fresh_only_payload = no_fresh_only_response.json()
    assert no_fresh_only_payload["total_count"] == 2
    assert {contest["contest_id"] for contest in no_fresh_only_payload["contests"]} == {
        contest_id,
        qoj_contest_id,
    }

    contest_detail_response = client.get(f"/api/contests/{contest_id}")
    assert contest_detail_response.status_code == 200
    contest_detail_payload = contest_detail_response.json()
    assert contest_detail_payload["contest_id"] == contest_id
    assert contest_detail_payload["provider_contest_id"] == "615540"
    assert contest_detail_payload["problem_count"] == 2

    annotate_response = client.post(
        "/api/contests/annotate",
        json={
            "contest_ref": contest_id,
            "alias": "sample-gym",
            "tags": ["2026", "demo"],
        },
    )
    assert annotate_response.status_code == 200
    annotate_payload = annotate_response.json()
    assert annotate_payload["alias"] == "sample-gym"
    assert annotate_payload["tags"] == ["2026", "demo"]

    tagged_response = client.get(
        "/api/contests",
        params=[("tag", "2026"), ("tag", "demo"), ("with_coverage", "true")],
    )
    assert tagged_response.status_code == 200
    tagged_payload = tagged_response.json()
    assert tagged_payload["total_count"] == 1
    assert tagged_payload["contests"][0]["contest_id"] == contest_id

    members_response = client.get("/api/members")
    assert members_response.status_code == 200
    members_payload = members_response.json()
    assert len(members_payload["members"]) == 3
    assert members_payload["members"][0]["local_member_key"] == "alice"
    assert len(members_payload["people"]) == 2
    assert members_payload["people"][0]["local_member_key"] == "alice"
    assert members_payload["people"][0]["binding_count"] == 2
    assert members_payload["people"][0]["solved_count"] == 2

    contest_export_response = client.get("/api/contests/export")
    assert contest_export_response.status_code == 200
    contest_export_payload = contest_export_response.json()
    assert contest_export_payload["export_kind"] == "contest_config_only"
    assert contest_export_payload["contests"][0]["alias"] == "sample-gym"

    config_export_response = client.get("/api/config/export")
    assert config_export_response.status_code == 200
    config_export_payload = config_export_response.json()
    assert config_export_payload["export_kind"] == "config_only"
    assert len(config_export_payload["members"]) == 3

    import_target = load_config(tmp_path / "api-import-target")
    import_app = create_app(import_target)
    import_client = TestClient(import_app)

    contest_import_response = import_client.post(
        "/api/contests/import",
        json={"payload": contest_export_payload, "sync": False},
    )
    assert contest_import_response.status_code == 200
    contest_import_payload = contest_import_response.json()
    assert contest_import_payload["imported_contest_count"] == 2

    config_import_response = import_client.post(
        "/api/config/import",
        json={"payload": config_export_payload},
    )
    assert config_import_response.status_code == 200
    config_import_payload = config_import_response.json()
    assert config_import_payload["imported_member_count"] == 3

    sync_missing_response = import_client.post("/api/contests/sync-missing")
    assert sync_missing_response.status_code == 200
    sync_missing_payload = sync_missing_response.json()
    assert sync_missing_payload["missing_contest_count"] == 2
    assert sync_missing_payload["synced_contest_count"] == 1
    assert sync_missing_payload["failed_contest_count"] == 1
    assert sync_missing_payload["failed_contests"][0]["provider_key"] == "qoj"


def test_import_contests_collects_failures(tmp_path: Path, monkeypatch) -> None:
    config = load_config(tmp_path)

    async def fake_sync_contest(config, *, provider_key, provider_contest_id=None, contest_url=None, alias=None, tags=None):
        if provider_contest_id == "bad":
            raise RuntimeError("boom")
        return type(
            "Summary",
            (),
            {
                "contest_id": f"contest-{provider_contest_id}",
                "problem_count": 2,
                "provider_key": provider_key,
                "provider_contest_id": provider_contest_id,
            },
        )()

    monkeypatch.setattr("xcpc_vp_gather.services.config_io.sync_contest", fake_sync_contest)

    payload = {
        "contests": [
            {
                "provider_key": "codeforces",
                "provider_contest_id": "1000",
                "title": "Good Contest",
                "official_url": "https://codeforces.com/gym/1000",
                "alias": None,
                "tags": ["demo"],
            },
            {
                "provider_key": "codeforces",
                "provider_contest_id": "bad",
                "title": "Bad Contest",
                "official_url": "https://codeforces.com/gym/bad",
                "alias": None,
                "tags": [],
            },
        ]
    }

    result = import_contests(config, payload, sync=True)
    assert result["imported_contest_count"] == 2
    assert result["synced_contest_count"] == 1
    assert result["failed_contest_count"] == 1
    assert result["failed_contests"][0]["provider_contest_id"] == "bad"
    assert result["failed_contests"][0]["error"] == "boom"


def test_build_app_backfills_missing_contest_summaries(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))
    config = load_config(tmp_path)
    updated_at = now_iso()

    with connect_db(config) as conn:
        repo = Repository(conn)
        contest_id = repo.upsert_contest(
            provider_key="codeforces",
            provider_contest_id="615540",
            title="Sample Gym",
            official_url="https://codeforces.com/gym/615540",
            start_time=None,
            end_time=None,
            timezone="UTC",
            source_payload={},
            updated_at=updated_at,
        )
        repo.upsert_problem(
            provider_key="codeforces",
            provider_problem_id="615540:A",
            contest_id=contest_id,
            problem_code="A",
            ordinal="A",
            title="Alpha",
            official_url="https://codeforces.com/gym/615540/problem/A",
            statement_url=None,
            source_payload={},
            updated_at=updated_at,
        )
        binding_id = repo.upsert_identity_binding(
            provider_key="codeforces",
            local_member_key="alice",
            provider_handle="tourist",
            display_name="alice",
            updated_at=updated_at,
        )
        repo.upsert_member_problem_status(
            provider_key="codeforces",
            local_member_key="alice",
            identity_binding_id=binding_id,
            provider_problem_id="615540:A",
            status="solved",
            source_url="https://codeforces.com/submission/1",
            source_payload={},
            first_seen_at=updated_at,
            updated_at=updated_at,
        )
        conn.commit()

    build_app()

    with connect_db(config) as conn:
        repo = Repository(conn)
        contests = repo.list_contests()

    assert contests[0]["summary_problem_count"] == 1
    assert contests[0]["summary_fresh_problem_count"] == 0
    assert contests[0]["summary_solved_problem_count"] == 1
    assert contests[0]["summary_problem_states_json"] == '[{"ordinal": "A", "status": "solved"}]'


def test_build_app_backfills_missing_problem_states_on_existing_summary(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))
    config = load_config(tmp_path)
    updated_at = now_iso()

    with connect_db(config) as conn:
        repo = Repository(conn)
        contest_id = repo.upsert_contest(
            provider_key="codeforces",
            provider_contest_id="615540",
            title="Sample Gym",
            official_url="https://codeforces.com/gym/615540",
            start_time=None,
            end_time=None,
            timezone="UTC",
            source_payload={},
            updated_at=updated_at,
        )
        repo.upsert_problem(
            provider_key="codeforces",
            provider_problem_id="615540:A",
            contest_id=contest_id,
            problem_code="A",
            ordinal="A",
            title="Alpha",
            official_url="https://codeforces.com/gym/615540/problem/A",
            statement_url=None,
            source_payload={},
            updated_at=updated_at,
        )
        binding_id = repo.upsert_identity_binding(
            provider_key="codeforces",
            local_member_key="alice",
            provider_handle="tourist",
            display_name="alice",
            updated_at=updated_at,
        )
        repo.upsert_member_problem_status(
            provider_key="codeforces",
            local_member_key="alice",
            identity_binding_id=binding_id,
            provider_problem_id="615540:A",
            status="solved",
            source_url="https://codeforces.com/submission/1",
            source_payload={},
            first_seen_at=updated_at,
            updated_at=updated_at,
        )
        conn.execute(
            """
            INSERT INTO contest_coverage_summary (
              contest_id, problem_count, fresh_problem_count, tried_problem_count, solved_problem_count, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (contest_id, 1, 0, 0, 1, updated_at),
        )
        conn.commit()

    build_app()

    with connect_db(config) as conn:
        repo = Repository(conn)
        contests = repo.list_contests()

    assert contests[0]["summary_problem_states_json"] == '[{"ordinal": "A", "status": "solved"}]'
