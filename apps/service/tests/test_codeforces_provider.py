from __future__ import annotations

import asyncio

from xcpc_vp_gather.providers.codeforces.api_client import CodeforcesApiClient
from xcpc_vp_gather.models import IdentityBindingRef, ProviderContestRef, ProviderContext
from xcpc_vp_gather.providers.codeforces.provider import CodeforcesProvider


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
            return [
                {
                    "id": 1,
                    "verdict": "WRONG_ANSWER",
                    "problem": {"contestId": 615540, "index": "A"},
                },
                {
                    "id": 2,
                    "verdict": "OK",
                    "problem": {"contestId": 615540, "index": "A"},
                },
                {
                    "id": 3,
                    "verdict": "TIME_LIMIT_EXCEEDED",
                    "problem": {"contestId": 615540, "index": "B"},
                },
            ]
        if method == "contest.status":
            return [{"id": 1}]
        raise AssertionError(method)


def build_ctx() -> ProviderContext:
    return ProviderContext(
        provider_key="codeforces",
        browser_state_dir="var/browser-state",
        artifact_root="var/artifacts",
        now_iso="2026-03-24T00:00:00Z",
    )


def test_sync_contest_maps_problem_ids() -> None:
    provider = CodeforcesProvider(api_client=FakeApiClient())

    result = asyncio.run(
        provider.sync_contest(
            build_ctx(),
            ProviderContestRef(provider_key="codeforces", provider_contest_id="615540"),
        )
    )

    assert result.provider_contest_id == "615540"
    assert [item.provider_problem_id for item in result.problems] == [
        "615540:A",
        "615540:B",
    ]


def test_sync_member_problem_status_prefers_solved() -> None:
    provider = CodeforcesProvider(api_client=FakeApiClient())

    result = asyncio.run(
        provider.sync_member_problem_status(
            build_ctx(),
            IdentityBindingRef(
                provider_key="codeforces",
                local_member_key="alice",
                provider_handle="tourist",
            ),
        )
    )

    status_map = {item.provider_problem_id: item.status for item in result.statuses}

    assert status_map["615540:A"] == "solved"
    assert status_map["615540:B"] == "tried"


def test_codeforces_api_client_adds_signed_params_when_credentials_present(monkeypatch) -> None:
    monkeypatch.setattr("time.time", lambda: 1700000000)
    monkeypatch.setattr("random.randint", lambda a, b: 123456)

    client = CodeforcesApiClient(api_key="key123", api_secret="secret456")
    params = client._build_params({"contestId": "615540", "from": 1, "count": 1})

    assert params["apiKey"] == "key123"
    assert params["time"] == 1700000000
    assert params["apiSig"].startswith("123456")
