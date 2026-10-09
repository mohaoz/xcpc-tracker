// A controllable stand-in for Dexie's liveQuery. Observers are retained after
// unsubscribe on purpose, so tests can deliver late values to closed views.
export type FakeObservation = {
  query: () => unknown;
  observer: { next: (value: any) => void; error: (error: unknown) => void };
  closed: boolean;
};

export function createFakeLiveQuery() {
  const subscriptions: FakeObservation[] = [];
  const liveQuery = (query: () => unknown) => ({
    subscribe(observer: FakeObservation["observer"]) {
      const entry: FakeObservation = { query, observer, closed: false };
      subscriptions.push(entry);
      return { unsubscribe() { entry.closed = true; } };
    },
  });
  return { subscriptions, liveQuery };
}
