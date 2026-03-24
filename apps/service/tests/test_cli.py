from __future__ import annotations

import json
from pathlib import Path

import httpx

from xcpc_vp_gather.cli import main
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
                {"id": 1, "verdict": "OK", "problem": {"contestId": 615540, "index": "A"}},
                {"id": 2, "verdict": "WRONG_ANSWER", "problem": {"contestId": 615540, "index": "B"}},
            ]
        if method == "contest.status":
            return []
        raise AssertionError(method)


def test_cli_happy_path(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))

    def fake_registry(config=None):
        provider = CodeforcesProvider(api_client=FakeApiClient())
        return {provider.provider_key: provider}

    monkeypatch.setattr("xcpc_vp_gather.services.sync.build_provider_registry", fake_registry)

    contest_exit = main(
        [
            "contest",
            "sync",
            "https://codeforces.com/gym/615540",
            "--alias",
            "ccinv25db",
            "--tag",
            "ccpc inv. 2025",
            "--tag",
            "dongbei",
            "--json",
        ]
    )
    assert contest_exit == 0
    contest_payload = json.loads(capsys.readouterr().out)
    assert contest_payload["alias"] == "ccinv25db"
    assert contest_payload["tags"] == ["ccpc inv. 2025", "dongbei"]

    member_exit = main(["member", "sync", "alice", "tourist", "--json"])
    assert member_exit == 0
    capsys.readouterr()

    coverage_exit = main(["coverage", contest_payload["contest_id"], "--json"])
    assert coverage_exit == 0
    coverage_payload = json.loads(capsys.readouterr().out)

    assert coverage_payload["problem_count"] == 2
    assert coverage_payload["problems"][0]["members"][0]["status"] == "solved"

    contest_list_exit = main(["contest", "list", "--json"])
    assert contest_list_exit == 0
    contest_list_payload = json.loads(capsys.readouterr().out)
    assert contest_list_payload["contests"][0]["provider_contest_id"] == "615540"
    assert contest_list_payload["contests"][0]["alias"] == "ccinv25db"

    contest_list_by_tag_exit = main(["contest", "list", "--tag", "dongbei", "--json"])
    assert contest_list_by_tag_exit == 0
    contest_list_by_tag_payload = json.loads(capsys.readouterr().out)
    assert len(contest_list_by_tag_payload["contests"]) == 1
    assert contest_list_by_tag_payload["contests"][0]["alias"] == "ccinv25db"

    contest_list_by_missing_tag_exit = main(["contest", "list", "--tag", "guizhou", "--json"])
    assert contest_list_by_missing_tag_exit == 0
    contest_list_by_missing_tag_payload = json.loads(capsys.readouterr().out)
    assert contest_list_by_missing_tag_payload["contests"] == []

    contest_list_with_coverage_exit = main(["contest", "list", "--with-coverage", "--json"])
    assert contest_list_with_coverage_exit == 0
    contest_list_with_coverage_payload = json.loads(capsys.readouterr().out)
    assert contest_list_with_coverage_payload["contests"][0]["problem_count"] == 2
    assert contest_list_with_coverage_payload["contests"][0]["solved_problem_count"] == 1
    assert contest_list_with_coverage_payload["contests"][0]["tried_problem_count"] == 1

    contest_export_path = tmp_path / "xvg-contests.json"
    contest_export_exit = main(["contest", "export", "--output", str(contest_export_path), "--json"])
    assert contest_export_exit == 0
    contest_export_payload = json.loads(capsys.readouterr().out)
    assert contest_export_payload["export_kind"] == "contest_config_only"
    assert contest_export_payload["contests"][0]["alias"] == "ccinv25db"
    assert contest_export_path.exists()

    list_exit = main(["member", "list", "--json"])
    assert list_exit == 0
    list_payload = json.loads(capsys.readouterr().out)
    assert list_payload["members"][0]["local_member_key"] == "alice"

    coverage_by_provider_id_exit = main(["coverage", "615540", "--json"])
    assert coverage_by_provider_id_exit == 0
    coverage_by_provider_id_payload = json.loads(capsys.readouterr().out)
    assert coverage_by_provider_id_payload["contest"]["provider_contest_id"] == "615540"

    coverage_by_title_exit = main(["coverage", "Sample Gym", "--json"])
    assert coverage_by_title_exit == 0
    coverage_by_title_payload = json.loads(capsys.readouterr().out)
    assert coverage_by_title_payload["contest"]["title"] == "Sample Gym"

    coverage_by_alias_exit = main(["coverage", "ccinv25db", "--json"])
    assert coverage_by_alias_exit == 0
    coverage_by_alias_payload = json.loads(capsys.readouterr().out)
    assert coverage_by_alias_payload["contest"]["provider_contest_id"] == "615540"

    export_path = tmp_path / "xvg-config.json"
    export_exit = main(["config", "export", "--output", str(export_path), "--json"])
    assert export_exit == 0
    export_payload = json.loads(capsys.readouterr().out)
    assert export_payload["export_kind"] == "config_only"
    assert export_payload["contests"][0]["alias"] == "ccinv25db"
    assert export_path.exists()

    fresh_root = tmp_path / "import-target"
    fresh_root.mkdir()
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(fresh_root))
    import_exit = main(["config", "import", str(export_path), "--json"])
    assert import_exit == 0
    import_payload = json.loads(capsys.readouterr().out)
    assert import_payload["imported_contest_count"] == 1
    assert import_payload["imported_member_count"] == 1

    imported_member_list_exit = main(["member", "list", "--json"])
    assert imported_member_list_exit == 0
    imported_member_list_payload = json.loads(capsys.readouterr().out)
    assert imported_member_list_payload["members"][0]["local_member_key"] == "alice"

    fresh_contest_root = tmp_path / "contest-import-target"
    fresh_contest_root.mkdir()
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(fresh_contest_root))
    contest_import_exit = main(["contest", "import", str(contest_export_path), "--json"])
    assert contest_import_exit == 0
    contest_import_payload = json.loads(capsys.readouterr().out)
    assert contest_import_payload["imported_contest_count"] == 1

    imported_contest_list_exit = main(["contest", "list", "--json"])
    assert imported_contest_list_exit == 0
    imported_contest_list_payload = json.loads(capsys.readouterr().out)
    assert imported_contest_list_payload["contests"][0]["alias"] == "ccinv25db"

    synced_contest_root = tmp_path / "contest-import-sync-target"
    synced_contest_root.mkdir()
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(synced_contest_root))
    contest_import_with_sync_exit = main(["contest", "import", str(contest_export_path), "--sync", "--json"])
    assert contest_import_with_sync_exit == 0
    contest_import_with_sync_payload = json.loads(capsys.readouterr().out)
    assert contest_import_with_sync_payload["imported_contest_count"] == 1
    assert contest_import_with_sync_payload["synced_contest_count"] == 1


def test_cli_reports_network_errors(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))

    class FailingApiClient:
        async def get(self, method: str, params: dict[str, object]):
            raise httpx.ConnectError("All connection attempts failed")

    def fake_registry(config=None):
        provider = CodeforcesProvider(api_client=FailingApiClient())
        return {provider.provider_key: provider}

    monkeypatch.setattr("xcpc_vp_gather.services.sync.build_provider_registry", fake_registry)

    exit_code = main(["contest", "sync", "https://codeforces.com/gym/615540"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "cannot reach the remote API" in captured.err


def test_cli_hides_unexpected_tracebacks_by_default(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))

    class FailingApiClient:
        async def get(self, method: str, params: dict[str, object]):
            raise RuntimeError("boom")

    def fake_registry(config=None):
        provider = CodeforcesProvider(api_client=FailingApiClient())
        return {provider.provider_key: provider}

    monkeypatch.setattr("xcpc_vp_gather.services.sync.build_provider_registry", fake_registry)

    exit_code = main(["contest", "sync", "https://codeforces.com/gym/615540"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "unexpected failure: boom" in captured.err


def test_cli_suggests_codeforces_credentials_on_http_400(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XVG_PROJECT_ROOT", str(tmp_path))

    class FailingApiClient:
        async def get(self, method: str, params: dict[str, object]):
            request = httpx.Request("GET", "https://codeforces.com/api/contest.standings")
            response = httpx.Response(400, request=request)
            raise httpx.HTTPStatusError("400 Bad Request", request=request, response=response)

    def fake_registry(config=None):
        provider = CodeforcesProvider(api_client=FailingApiClient())
        return {provider.provider_key: provider}

    monkeypatch.setattr("xcpc_vp_gather.services.sync.build_provider_registry", fake_registry)

    exit_code = main(["contest", "sync", "https://codeforces.com/gym/615540"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "XVG_CODEFORCES_API_KEY" in captured.err
