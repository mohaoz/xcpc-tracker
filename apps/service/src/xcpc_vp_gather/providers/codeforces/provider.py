from __future__ import annotations

from typing import Iterable

from ...models import (
    ContestProblemItem,
    ContestSyncResult,
    IdentityBindingRef,
    MemberProblemStatusItem,
    MemberProblemStatusSyncResult,
    ProblemResourceBatchResult,
    ProviderContestRef,
    ProviderContext,
    ProviderProblemRef,
    SubmissionSyncResult,
)
from .api_client import CodeforcesApiClient


class CodeforcesProvider:
    provider_key = "codeforces"

    def __init__(self, api_client: CodeforcesApiClient | None = None) -> None:
        self.api_client = api_client or CodeforcesApiClient()

    async def sync_contest(
        self, ctx: ProviderContext, ref: ProviderContestRef
    ) -> ContestSyncResult:
        result = await self.api_client.get(
            "contest.standings",
            {
                "contestId": ref.provider_contest_id,
                "from": 1,
                "count": 1,
            },
        )
        contest = result["contest"]
        problems = [
            ContestProblemItem(
                provider_problem_id=f'{contest["id"]}:{item["index"]}',
                problem_code=item.get("index"),
                ordinal=item.get("index"),
                title=item["name"],
                official_url=f'https://codeforces.com/gym/{contest["id"]}/problem/{item["index"]}',
                source_payload=item,
            )
            for item in result.get("problems", [])
        ]
        return ContestSyncResult(
            provider_key=self.provider_key,
            provider_contest_id=str(contest["id"]),
            title=contest["name"],
            official_url=f'https://codeforces.com/gym/{contest["id"]}',
            start_time=str(contest.get("startTimeSeconds")) if contest.get("startTimeSeconds") else None,
            end_time=None,
            timezone="UTC",
            problems=problems,
            source_payload=result,
        )

    async def sync_member_problem_status(
        self, ctx: ProviderContext, binding: IdentityBindingRef
    ) -> MemberProblemStatusSyncResult:
        submissions = await self.api_client.get(
            "user.status",
            {
                "handle": binding.provider_handle,
            },
        )
        status_by_problem: dict[str, MemberProblemStatusItem] = {}
        for item in submissions:
            problem = item.get("problem", {})
            contest_id = problem.get("contestId")
            index = problem.get("index")
            if contest_id is None or index is None:
                continue
            provider_problem_id = f"{contest_id}:{index}"
            verdict = item.get("verdict")
            next_status = "solved" if verdict == "OK" else "tried"
            current = status_by_problem.get(provider_problem_id)
            if current is not None and current.status == "solved":
                continue
            status_by_problem[provider_problem_id] = MemberProblemStatusItem(
                provider_problem_id=provider_problem_id,
                status=next_status,
                source_url=f"https://codeforces.com/submission/{item['id']}",
                source_payload=item,
            )
        return MemberProblemStatusSyncResult(
            provider_key=self.provider_key,
            provider_handle=binding.provider_handle,
            statuses=list(status_by_problem.values()),
            source_payload={"submission_count": len(submissions)},
        )

    async def fetch_problem_resources(
        self, ctx: ProviderContext, problems: Iterable[ProviderProblemRef]
    ) -> ProblemResourceBatchResult:
        return ProblemResourceBatchResult(
            provider_key=self.provider_key,
            item_count=len(list(problems)),
        )

    async def sync_submissions(
        self, ctx: ProviderContext, contest: ProviderContestRef
    ) -> SubmissionSyncResult:
        result = await self.api_client.get(
            "contest.status",
            {
                "contestId": contest.provider_contest_id,
                "from": 1,
                "count": 1,
            },
        )
        return SubmissionSyncResult(
            provider_key=self.provider_key,
            provider_contest_id=contest.provider_contest_id,
            submission_count=len(result),
        )
