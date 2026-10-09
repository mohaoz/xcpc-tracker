import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCatalogContestIndex, resetCatalogFetchCache } from "../../src/lib/catalog";

describe("static catalog fetch cache", () => {
  afterEach(() => resetCatalogFetchCache());

  it("retries failed requests and caches successful ones", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ contests: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCatalogContestIndex()).rejects.toThrow(/offline/);
    expect(await fetchCatalogContestIndex()).toEqual({ contests: [] });
    await fetchCatalogContestIndex();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
