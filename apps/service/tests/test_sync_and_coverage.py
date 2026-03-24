from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from xcpc_vp_gather.api.app import create_app
from xcpc_vp_gather.config import load_config
from xcpc_vp_gather.core.time import now_iso
from xcpc_vp_gather.db.connection import connect_db
from xcpc_vp_gather.providers.codeforces.provider import CodeforcesProvider
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

    coverage = client.get(f"/api/contests/{contest_id}/coverage")
    assert coverage.status_code == 200
    payload = coverage.json()

    assert payload["problem_count"] == 2
    assert payload["fresh_problem_count"] == 0
    assert payload["problems"][0]["members"][0]["status"] == "solved"
    assert payload["problems"][1]["members"][0]["status"] == "solved"
    assert payload["problems"][1]["members"][1]["status"] == "tried"
