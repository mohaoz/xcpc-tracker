/** Polls `predicate` until it holds, failing with `message` after four seconds. */
export async function until(predicate: () => unknown | Promise<unknown>, message: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

export type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

export function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** A Codeforces `user.status` reply for the given submissions. */
export const cfReply = (result: unknown[]) => ({ ok: true, json: async () => ({ status: "OK", result }) });

export const isAbortError = (error: unknown) => (error as { name?: string } | null)?.name === "AbortError";
