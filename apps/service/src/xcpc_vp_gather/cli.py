from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

from .config import load_config
from .providers.codeforces.api_client import CodeforcesApiError
from .services.coverage import get_contest_coverage
from .services.config_io import (
    export_config,
    export_contests,
    import_config,
    import_contests,
    read_import_file,
    write_export_file,
)
from .services.contests import (
    add_coverage_summaries,
    annotate_contest,
    list_contests_filtered,
    resolve_contest_id,
)
from .services.members import list_members
from .services.sync import (
    parse_codeforces_contest_reference,
    sync_contest,
    sync_member_problem_status,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="xvg", description="xcpc-vp-gather local CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    contest_parser = subparsers.add_parser("contest", help="Contest operations")
    contest_subparsers = contest_parser.add_subparsers(dest="contest_command", required=True)
    contest_sync = contest_subparsers.add_parser("sync", help="Sync a Codeforces Gym contest")
    contest_sync.add_argument("contest_url", help="Contest URL, e.g. https://codeforces.com/gym/615540")
    contest_sync.add_argument("--provider", default="codeforces")
    contest_sync.add_argument("--alias", default=None)
    contest_sync.add_argument("--tag", action="append", dest="tags", default=None)
    contest_sync.add_argument("--json", action="store_true", dest="as_json")

    contest_list = contest_subparsers.add_parser("list", help="List synced contests")
    contest_list.add_argument("--provider", default=None)
    contest_list.add_argument("--tag", action="append", dest="tags", default=None)
    contest_list.add_argument("--with-coverage", action="store_true", dest="with_coverage")
    contest_list.add_argument("--json", action="store_true", dest="as_json")

    contest_annotate = contest_subparsers.add_parser("annotate", help="Set alias or tags for a contest")
    contest_annotate.add_argument("contest_ref")
    contest_annotate.add_argument("--provider", default=None)
    contest_annotate.add_argument("--alias", default=None)
    contest_annotate.add_argument("--tag", action="append", dest="tags", default=None)
    contest_annotate.add_argument("--json", action="store_true", dest="as_json")

    contest_export = contest_subparsers.add_parser("export", help="Export contests as JSON")
    contest_export.add_argument("--output", default=None)
    contest_export.add_argument("--json", action="store_true", dest="as_json")

    contest_import = contest_subparsers.add_parser("import", help="Import contests from JSON")
    contest_import.add_argument("input_path")
    contest_import.add_argument("--sync", action="store_true", dest="sync_after_import")
    contest_import.add_argument("--json", action="store_true", dest="as_json")

    member_parser = subparsers.add_parser("member", help="Tracked member operations")
    member_subparsers = member_parser.add_subparsers(dest="member_command", required=True)
    member_sync = member_subparsers.add_parser("sync", help="Sync one member problem history")
    member_sync.add_argument("local_member_key")
    member_sync.add_argument("provider_handle")
    member_sync.add_argument("--provider", default="codeforces")
    member_sync.add_argument("--display-name")
    member_sync.add_argument("--json", action="store_true", dest="as_json")

    member_list = member_subparsers.add_parser("list", help="List tracked members")
    member_list.add_argument("--provider", default=None)
    member_list.add_argument("--json", action="store_true", dest="as_json")

    coverage_parser = subparsers.add_parser("coverage", help="Read contest coverage")
    coverage_parser.add_argument("contest_ref", help="Contest internal id, provider contest id, or exact title")
    coverage_parser.add_argument("--provider", default=None)
    coverage_parser.add_argument("--json", action="store_true", dest="as_json")

    config_parser = subparsers.add_parser("config", help="Import or export local config")
    config_subparsers = config_parser.add_subparsers(dest="config_command", required=True)
    config_export = config_subparsers.add_parser("export", help="Export contests and members as JSON")
    config_export.add_argument("--output", default=None)
    config_export.add_argument("--json", action="store_true", dest="as_json")

    config_import = config_subparsers.add_parser("import", help="Import contests and members from JSON")
    config_import.add_argument("input_path")
    config_import.add_argument("--json", action="store_true", dest="as_json")

    return parser


def resolve_project_root() -> Path:
    override = os.environ.get("XVG_PROJECT_ROOT")
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[4]


def print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def print_coverage_table(payload: dict) -> None:
    contest = payload["contest"]
    members = payload["tracked_members"]
    print(f'Contest: {contest["title"]} ({contest["provider_key"]}:{contest["provider_contest_id"]})')
    print(
        f'Problems: {payload["problem_count"]} | Fresh for team: {payload["fresh_problem_count"]}'
    )
    print("")

    header = ["Problem", "Fresh"] + [member["local_member_key"] for member in members]
    print("\t".join(header))
    for problem in payload["problems"]:
        row = [
            str(problem["ordinal"] or problem["provider_problem_id"]),
            "yes" if problem["fresh_for_team"] else "no",
        ]
        row.extend(member["status"] for member in problem["members"])
        print("\t".join(row))


def command_contest_sync(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    result = asyncio.run(
        sync_contest(
            config,
            provider_key=args.provider,
            contest_url=args.contest_url,
            alias=args.alias,
            tags=args.tags,
        )
    )
    payload = {
        "contest_id": result.contest_id,
        "provider_key": result.provider_key,
        "provider_contest_id": result.provider_contest_id,
        "problem_count": result.problem_count,
        "alias": args.alias,
        "tags": args.tags or [],
    }
    if args.as_json:
        print_json(payload)
    else:
        print(
            f"synced contest {payload['provider_key']}:{payload['provider_contest_id']} "
            f"-> {payload['contest_id']} ({payload['problem_count']} problems)"
        )
    return 0


def command_contest_list(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    contests = list_contests_filtered(
        config,
        provider_key=args.provider,
        tags=args.tags,
    )
    if args.with_coverage:
        contests = add_coverage_summaries(config, contests)
    payload = {"contests": contests}
    if args.as_json:
        print_json(payload)
    else:
        if not payload["contests"]:
            print("no synced contests")
            return 0
        if args.with_coverage:
            print(
                "contest_id\tprovider\tprovider_contest_id\talias\ttags\tproblems\tfresh\ttried\tsolved\ttitle"
            )
        else:
            print("contest_id\tprovider\tprovider_contest_id\talias\ttags\ttitle")
        for contest in payload["contests"]:
            row = [
                contest["contest_id"],
                contest["provider_key"],
                contest["provider_contest_id"],
                contest["alias"] or "",
                ",".join(contest["tags"]),
            ]
            if args.with_coverage:
                row.extend(
                    [
                        str(contest["problem_count"]),
                        str(contest["fresh_problem_count"]),
                        str(contest["tried_problem_count"]),
                        str(contest["solved_problem_count"]),
                    ]
                )
            row.append(contest["title"])
            print("\t".join(row))
    return 0


def command_contest_annotate(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = annotate_contest(
        config,
        args.contest_ref,
        provider_key=args.provider,
        alias=args.alias,
        tags=args.tags,
    )
    if args.as_json:
        print_json(payload)
    else:
        print(
            f"updated contest {payload['contest_id']} alias={payload['alias'] or '-'} "
            f"tags={','.join(payload['tags']) if payload['tags'] else '-'}"
        )
    return 0


def command_contest_export(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = export_contests(config)
    if args.output:
        write_export_file(Path(args.output), payload)
    if args.as_json or not args.output:
        print_json(payload)
    else:
        print(f"exported {len(payload['contests'])} contests to {args.output}")
    return 0


def command_contest_import(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = read_import_file(Path(args.input_path))
    if args.sync_after_import and not args.as_json:
        contests = payload.get("contests", [])
        print(
            f"importing {len(contests)} contests from {args.input_path} and syncing one by one..."
        )
        updated_payload = {
            **payload,
            "contests": [],
        }
        imported = 0
        synced = []
        failed = []
        for index, contest in enumerate(contests, start=1):
            provider_key = str(contest["provider_key"])
            provider_contest_id = str(contest["provider_contest_id"])
            title = str(contest.get("title", ""))
            print(f"[{index}/{len(contests)}] syncing {provider_key}:{provider_contest_id} {title}")
            partial_payload = {"contests": [contest]}
            partial_result = import_contests(config, partial_payload, sync=True)
            imported += partial_result["imported_contest_count"]
            synced.extend(partial_result.get("synced_contests", []))
            failed.extend(partial_result.get("failed_contests", []))

        print(
            f"imported {imported} contests from {args.input_path}; "
            f"synced {len(synced)} contests; failed {len(failed)} contests"
        )
        if failed:
            print("")
            print("failed contests:")
            for item in failed:
                print(
                    f"- {item['provider_key']}:{item['provider_contest_id']} "
                    f"{item['title']} -> {item['error']}"
                )
        return 0

    result = import_contests(config, payload, sync=args.sync_after_import)
    if args.as_json:
        print_json(result)
    else:
        message = f"imported {result['imported_contest_count']} contests from {args.input_path}"
        if args.sync_after_import:
            message += (
                f"; synced {result['synced_contest_count']} contests"
                f"; failed {result['failed_contest_count']} contests"
            )
        print(message)
    return 0


def command_member_sync(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    result = asyncio.run(
        sync_member_problem_status(
            config,
            provider_key=args.provider,
            local_member_key=args.local_member_key,
            provider_handle=args.provider_handle,
            display_name=args.display_name,
        )
    )
    payload = {
        "identity_binding_id": result.identity_binding_id,
        "provider_key": result.provider_key,
        "local_member_key": result.local_member_key,
        "provider_handle": result.provider_handle,
        "status_count": result.status_count,
    }
    if args.as_json:
        print_json(payload)
    else:
        print(
            f"synced member {payload['local_member_key']} ({payload['provider_handle']}) "
            f"with {payload['status_count']} problem states"
        )
    return 0


def command_member_list(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = {
        "members": list_members(config, provider_key=args.provider),
    }
    if args.as_json:
        print_json(payload)
    else:
        if not payload["members"]:
            print("no tracked members")
            return 0
        print("local_member_key\tprovider\tprovider_handle\tstatus")
        for member in payload["members"]:
            print(
                "\t".join(
                    [
                        member["local_member_key"],
                        member["provider_key"],
                        member["provider_handle"],
                        member["binding_status"],
                    ]
                )
            )
    return 0


def command_coverage(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    contest_ref = args.contest_ref
    if contest_ref.startswith("http://") or contest_ref.startswith("https://"):
        if args.provider not in (None, "codeforces"):
            raise ValueError("URL-based coverage lookup is only supported for Codeforces right now")
        contest_ref = parse_codeforces_contest_reference(contest_ref)
        provider_key = "codeforces"
    else:
        provider_key = args.provider

    contest_id = resolve_contest_id(config, contest_ref, provider_key=provider_key)

    payload = get_contest_coverage(config, contest_id)
    if args.as_json:
        print_json(payload)
    else:
        print_coverage_table(payload)
    return 0


def command_config_export(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = export_config(config)
    if args.output:
        write_export_file(Path(args.output), payload)
    if args.as_json or not args.output:
        print_json(payload)
    else:
        print(
            f"exported config with {len(payload['contests'])} contests and "
            f"{len(payload['members'])} members to {args.output}"
        )
    return 0


def command_config_import(args: argparse.Namespace) -> int:
    config = load_config(resolve_project_root())
    payload = read_import_file(Path(args.input_path))
    result = import_config(config, payload)
    if args.as_json:
        print_json(result)
    else:
        print(
            f"imported {result['imported_contest_count']} contests and "
            f"{result['imported_member_count']} members from {args.input_path}"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)

        if args.command == "contest" and args.contest_command == "sync":
            return command_contest_sync(args)
        if args.command == "contest" and args.contest_command == "list":
            return command_contest_list(args)
        if args.command == "contest" and args.contest_command == "annotate":
            return command_contest_annotate(args)
        if args.command == "contest" and args.contest_command == "export":
            return command_contest_export(args)
        if args.command == "contest" and args.contest_command == "import":
            return command_contest_import(args)
        if args.command == "member" and args.member_command == "sync":
            return command_member_sync(args)
        if args.command == "member" and args.member_command == "list":
            return command_member_list(args)
        if args.command == "coverage":
            return command_coverage(args)
        if args.command == "config" and args.config_command == "export":
            return command_config_export(args)
        if args.command == "config" and args.config_command == "import":
            return command_config_import(args)

        parser.error("unsupported command")
        return 2
    except httpx.ConnectError:
        print(
            "error: cannot reach the remote API. check your network, proxy settings, or whether the current environment blocks outbound HTTP.",
            file=sys.stderr,
        )
        return 1
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 400:
            print(
                "error: remote API returned 400 Bad Request. if this is a Codeforces request, try configuring XVG_CODEFORCES_API_KEY and XVG_CODEFORCES_API_SECRET.",
                file=sys.stderr,
            )
        else:
            print(
                f"error: remote API returned HTTP {status_code}.",
                file=sys.stderr,
            )
        return 1
    except CodeforcesApiError as exc:
        print(f"error: codeforces api returned an error: {exc}", file=sys.stderr)
        return 1
    except LookupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"error: unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
