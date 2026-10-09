// Shared state and module doubles for the QOJ bridge fixture. This file must not
// import application modules: mock factories load it while those modules resolve.
// Test files register the doubles with:
//   vi.mock("../../src/lib/catalog-runtime", async () => (await import("./helpers/qoj-mocks")).catalogRuntimeMock());
//   vi.mock("../../src/lib/local-db", async (orig) => (await import("./helpers/qoj-mocks")).localDbMock(await orig()));
//   vi.mock("../../src/lib/member-events", ...memberEventsMock), vi.mock("vue-router", ...routerMock),
//   vi.mock("../../src/stores/feedback", ...feedbackMock)

export type BridgeRequest = { direction: string; method: string; request_id: string; params: { handle: string } };

export const fixtureProblems = [1, 2].map((id) => ({
  problemId: `fixture:${id}`, contestId: "fixture", ordinal: String(id), title: `Problem ${id}`,
  sources: [{ provider: "qoj", provider_problem_id: String(id) }, { provider: "codeforces", provider_problem_id: `123:${id}` }],
}));

const initialState = () => ({
  /** "hold" keeps sync requests pending; "success" or an error code answers immediately. */
  mode: "hold" as string,
  requests: [] as BridgeRequest[],
  held: [] as BridgeRequest[],
  holdHello: false,
  hellos: [] as BridgeRequest[],
  holdRecord: false,
  recordEntered: false,
  releaseRecord: null as null | (() => void),
  catalog: async (): Promise<unknown[]> => fixtureProblems,
  beforeLock: async (_name: string): Promise<void> => {},
});

export const qojState = initialState();
export const resetQojState = () => Object.assign(qojState, initialState());

export const feedback = {
  current: null as unknown,
  show(value: unknown) { this.current = value; },
};

export const catalogRuntimeMock = () => ({ listRuntimeCatalogProblemsForImport: () => qojState.catalog() });

/** Real local-db, with sync-record persistence that tests can hold open. */
export const localDbMock = <T extends { recordImportSyncAttempt: (input: any) => Promise<unknown> }>(actual: T): T => ({
  ...actual,
  recordImportSyncAttempt: async (input: any) => {
    if (qojState.holdRecord) {
      qojState.recordEntered = true;
      await new Promise<void>((resolve) => { qojState.releaseRecord = resolve; });
    }
    return actual.recordImportSyncAttempt(input);
  },
});

export const memberEventsMock = () => ({ emitMemberMutated() {} });
export const routerMock = () => ({ useRouter: () => ({ push() {} }) });
export const feedbackMock = () => ({ useFeedbackStore: () => feedback });
