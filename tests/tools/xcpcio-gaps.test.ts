import { describe, expect, it } from "vitest";
import { calculateBoardAwards } from "../../scripts/xcpcio-gap-awards.mjs";
import { readJson } from "../../scripts/source-import-lib.mjs";
import { latestAwardValue } from "../../scripts/catalog-award-review.mjs";

const config: any = {
  start_time: 0, end_time: 7200000, penalty: 1200, problems: [{ id: "A" }, { id: "B" }],
  options: { submission_timestamp_unit: "millisecond", calculation_of_penalty: "accumulate_in_seconds_and_finally_to_the_minute" },
};
const teams: any[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), group: ["official"] }));
teams.push({ id: "star", group: ["unofficial"] });
const runs: any[] = [
  { team_id: "0", problem_id: "A", timestamp: 1000, status: "COMPILATION_ERROR" },
  { team_id: "0", problem_id: "A", timestamp: 59000, status: "ACCEPTED" },
  { team_id: "0", problem_id: "B", timestamp: 61000, status: "ACCEPTED" },
  ...teams.filter((t) => !["0", "star"].includes(t.id)).map((t) => ({ team_id: t.id, problem_id: "A", timestamp: (120 + Number(t.id) * 60) * 1000, status: "ACCEPTED" })),
];
const unevenTeams: any[] = Array.from({ length: 82 }, (_, i) => ({ id: String(i), group: ["official"] }));
const unevenRuns = unevenTeams.map((t, i) => ({ team_id: t.id, problem_id: "A", timestamp: (i + 1) * 60000, status: "ACCEPTED" }));
const dividedTeams: any[] = unevenTeams.map((t) => ({ ...t, group: ["official", "undergraduate"] }));
dividedTeams.push(
  { id: "vocational", group: ["official", "vocational"] },
  { id: "star", group: ["undergraduate", "Stars"] },
  { id: "disqualified", group: ["official", "undergraduate"], official: false },
);
const dividedConfig = { ...config, group: { official: "正式队伍", undergraduate: "本科组", vocational: "专科组", Stars: "打星队伍" } };
const ranks = (result: any) => Object.values(result.cutoffs).map((c: any) => c.rank);

describe("XCPCIO gap awards: penalty calculation", () => {
  it("excludes CE from penalty and accumulates seconds before rounding to minutes", () => {
    const r = calculateBoardAwards(config, teams, runs);
    expect(r.cutoffs.gold.penalty).toBe(2);
    expect(r.eligibleTeamCount).toBe(10);
    expect(r.cutoffs.gold.solved).toBe(2);
    expect(calculateBoardAwards({ ...config, options: { submission_timestamp_unit: "millisecond" } }, teams, runs).cutoffs.gold.penalty).toBe(1);
  });

  it("rejects pending submissions and ignores is_ignore runs", () => {
    expect(() => calculateBoardAwards(config, teams, [{ ...runs[0], status: "PENDING" }])).toThrow();
    expect(calculateBoardAwards(config, teams, [{ team_id: "0", problem_id: "A", timestamp: 500, status: "REJECTED", is_ignore: true }, ...runs]))
      .toStrictEqual(calculateBoardAwards(config, teams, runs));
  });

  it("sorts accepted submissions first at identical timestamp/team", () => {
    expect(calculateBoardAwards(config, teams, [{ team_id: "0", problem_id: "A", timestamp: 59000, status: "REJECTED" }, ...runs]))
      .toStrictEqual(calculateBoardAwards(config, teams, runs));
  });

  it("floors millisecond timestamps to whole seconds before penalty sums", () => {
    const fractionalRuns = runs.map((r) => (r.status === "ACCEPTED" ? { ...r, timestamp: r.timestamp + 500 } : r));
    const secondsConfig = { ...config, options: { ...config.options, calculation_of_penalty: "in_seconds" } };
    expect(calculateBoardAwards(secondsConfig, teams, fractionalRuns)).toStrictEqual(calculateBoardAwards(secondsConfig, teams, runs));
  });

  it("normalizes INCORRECT/CE status aliases", () => {
    const wrongRuns = [{ team_id: "0", problem_id: "A", timestamp: 500, status: "INCORRECT" }, ...runs];
    expect(calculateBoardAwards(config, teams, wrongRuns))
      .toStrictEqual(calculateBoardAwards(config, teams, wrongRuns.map((r) => ({ ...r, status: r.status === "INCORRECT" ? "REJECTED" : r.status }))));
    expect(calculateBoardAwards(config, teams, runs.map((r) => ({ ...r, status: r.status === "COMPILATION_ERROR" ? "CE" : r.status }))))
      .toStrictEqual(calculateBoardAwards(config, teams, runs));
  });

  it("accepts epoch seconds, milliseconds and ISO contest timestamps and rejects invalid ones", () => {
    const epochConfig = { ...config, start_time: 1414285200, end_time: 1414303200 };
    expect(calculateBoardAwards(epochConfig, unevenTeams, unevenRuns))
      .toStrictEqual(calculateBoardAwards({ ...epochConfig, start_time: 1414285200000, end_time: 1414303200000 }, unevenTeams, unevenRuns));
    expect(calculateBoardAwards({ ...epochConfig, start_time: "2014-10-26T01:00:00Z", end_time: "2014-10-26T06:00:00Z" }, unevenTeams, unevenRuns))
      .toStrictEqual(calculateBoardAwards(epochConfig, unevenTeams, unevenRuns));
    expect(() => calculateBoardAwards({ ...config, start_time: "invalid" }, teams, runs)).toThrow(/Invalid contest timestamp/);
  });
});

describe("XCPCIO gap awards: official eligibility and medal configuration", () => {
  it("blocks unknown groups and prefers explicit award configuration", () => {
    expect(() => calculateBoardAwards(config, teams.map((t) => ({ ...t, group: ["TrackA"] })), runs)).toThrow();
    expect(calculateBoardAwards({ ...config, medal: { official: { gold: 1, silver: 2, bronze: 3 } } }, teams, runs).source).toBe("explicit");
  });

  it("uses floor 10/20/30% counts and rejects tied medal boundaries", () => {
    expect(ranks(calculateBoardAwards(config, unevenTeams, unevenRuns))).toStrictEqual([8, 24, 48]);
    const tiedRuns = structuredClone(unevenRuns);
    tiedRuns[8].timestamp = tiedRuns[7].timestamp;
    expect(() => calculateBoardAwards(config, unevenTeams, tiedRuns)).toThrow(/tied medal boundary/);
    expect(() => calculateBoardAwards({ ...config, medal: { official: { gold: 8, silver: 16, bronze: 24 } } }, unevenTeams, tiedRuns)).toThrow(/tied medal boundary/);
  });

  it("selects the verified highest group and rejects overlapping, missing or ambiguous groups", () => {
    const divided = calculateBoardAwards(dividedConfig, dividedTeams, unevenRuns);
    expect(divided.group).toBe("undergraduate");
    expect(divided.eligibleTeamCount).toBe(82);
    expect(() => calculateBoardAwards(dividedConfig, dividedTeams.map((t) => ({ ...t, group: [...(t.group ?? []), "vocational"] })), unevenRuns)).toThrow(/overlapping undergraduate/);
    expect(() => calculateBoardAwards({ ...config, group: { official: "正式队伍", vocational: "高职队伍" } }, unevenTeams, unevenRuns)).toThrow(/Highest group/);
    expect(() => calculateBoardAwards({ ...config, group: { first: "邀请赛 A", second: "邀请赛 B" } }, unevenTeams, unevenRuns)).toThrow(/Ambiguous highest/);
  });

  it("gives invitational precedence and validates award configuration", () => {
    const invitationalTeams = unevenTeams.map((t) => ({ ...t, group: ["participant", "undergraduate"] }));
    const invitationalConfig = { ...dividedConfig, group: { ...dividedConfig.group, participant: "邀请赛队伍" } };
    const invitation = calculateBoardAwards(invitationalConfig, invitationalTeams, unevenRuns);
    expect(invitation.group).toBe("participant");
    expect(invitation.eligibleTeamCount).toBe(82);
    expect(() => calculateBoardAwards({ ...invitationalConfig, medal: { official: { gold: 8, silver: 16, bronze: 24 } } }, invitationalTeams, unevenRuns)).toThrow(/Award configuration/);
    expect(() => calculateBoardAwards({ ...config, medal: { official: { gold: 8, silver: 16 } } }, unevenTeams, unevenRuns)).toThrow(/Award configuration/);
  });

  it("supports the CCPC preset and rejects unknown or group-ambiguous presets", () => {
    const ccpcPreset = calculateBoardAwards({ ...config, medal: "ccpc" }, [...unevenTeams, { id: "zero", group: ["official"] }], unevenRuns);
    expect(ccpcPreset.source).toBe("explicit");
    expect(ccpcPreset.eligibleTeamCount).toBe(83);
    expect(ranks(ccpcPreset)).toStrictEqual([9, 25, 50]);
    expect(() => calculateBoardAwards({ ...config, medal: "unknown" }, unevenTeams, unevenRuns)).toThrow(/Unsupported medal preset/);
    expect(() => calculateBoardAwards({ ...dividedConfig, medal: "ccpc" }, dividedTeams, unevenRuns)).toThrow(/CCPC preset/);
  });

  it("accepts legacy official/unofficial team flags and rejects boards without verified official teams", () => {
    const legacyTeams: any[] = unevenTeams.map((t, i) => ({ id: t.id, official: i % 2 ? true : 1 }));
    legacyTeams.push({ id: "not-official", official: false }, { id: "star", official: true, unofficial: 1 });
    expect(calculateBoardAwards(config, legacyTeams, unevenRuns)).toStrictEqual(calculateBoardAwards(config, unevenTeams, unevenRuns));
    expect(() => calculateBoardAwards(config, unevenTeams.map((t) => ({ id: t.id, group: "unofficial" })), unevenRuns)).toThrow(/No verified/);
  });
});

describe("XCPCIO gap awards: published evidence", () => {
  it("applied audit entries match the published catalog after later reviews", async () => {
    const catalog = await readJson("catalog/default-catalog.min.json");
    const review = await readJson("fixtures/imports/xcpcio-2026-gap-awards.json");
    const completion = await readJson("fixtures/imports/rankland/2026-10-01-completion.json");
    for (const entry of review.audit.filter((r: any) => r.status === "applied")) {
      const c = catalog.contests.find((c: any) => c.contestId === entry.contest_id);
      const field = entry.result.source === "explicit" ? "awardCutoffs" : "estimatedAwardCutoffs";
      const change = completion.changes.find((r: any) => r.contest_id === entry.contest_id && r.field === field);
      const removed = completion.removed.some((r: any) => r.contest_id === entry.contest_id && r.field === field);
      expect(c[field]).toStrictEqual(latestAwardValue(entry.contest_id, field, change?.value ?? (removed ? undefined : entry.result)));
    }
  });
});
