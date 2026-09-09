// The multipart upload driver.
//
// `fetch` is replaced per test, so nothing leaves the process. A fake `File` stands in for
// the browser's: `slice` is all the driver uses, and it only ever reads `.size`.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUpload } from "../js/api/upload.js";

const PART_SIZE = 10;

// ─── FAKES ───────────────────────────────────────────────────────────────────

// Enough of a File for the driver: a size, and slices that report their own.
function fakeFile(size) {
  return {
    size,
    slice: (start, end) => ({ size: Math.min(end, size) - start }),
  };
}

function partUrls(...partNumbers) {
  return partNumbers.map((part_number) => ({
    part_number,
    url: `https://s3.test/part/${part_number}`,
  }));
}

// A fetch that answers every PUT with an ETag naming its part, and records what it saw.
function acceptingFetch({ failFor = new Map() } = {}) {
  const seen = [];

  const respond = vi.fn(async (url, options) => {
    const partNumber = Number(url.split("/").pop());
    seen.push(partNumber);

    const failures = failFor.get(partNumber) ?? 0;
    if (failures > 0) {
      failFor.set(partNumber, failures - 1);

      return { ok: false, status: 500, headers: new Headers() };
    }

    if (options.signal?.aborted) throw new Error("aborted");

    return {
      ok: true,
      status: 200,
      headers: new Headers({ etag: `"part-${partNumber}"` }),
    };
  });

  return { respond, seen };
}

function upload(overrides = {}) {
  return createUpload({
    file: fakeFile(PART_SIZE * 3),
    partSize: PART_SIZE,
    partCount: 3,
    partUrls: partUrls(1, 2, 3),
    ...overrides,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── SENDING ─────────────────────────────────────────────────────────────────

describe("createUpload", () => {
  it("sends every part and returns its receipts in order", async () => {
    const { respond } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const parts = await upload().send();

    expect(respond).toHaveBeenCalledTimes(3);
    expect(parts).toEqual([
      { part_number: 1, etag: '"part-1"' },
      { part_number: 2, etag: '"part-2"' },
      { part_number: 3, etag: '"part-3"' },
    ]);
  });

  it("skips the parts S3 already holds and keeps their receipts", async () => {
    const { respond, seen } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const parts = await upload({
      uploaded: [{ part_number: 1, etag: '"already"' }],
      partUrls: partUrls(2, 3),
    }).send();

    expect(seen).toEqual([2, 3]);
    expect(parts[0]).toEqual({ part_number: 1, etag: '"already"' });
    expect(parts).toHaveLength(3);
  });

  it("reports progress against the whole file, resumed bytes included", async () => {
    const { respond } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const progress = [];

    await upload({
      uploaded: [{ part_number: 1, etag: '"already"' }],
      partUrls: partUrls(2, 3),
      onProgress: (report) => progress.push(report),
    }).send();

    expect(progress.at(-1)).toEqual({ bytes: 30, total: 30 });
    expect(progress[0].bytes).toBe(20);
  });

  it("does not send anything when every part is already held", async () => {
    const { respond } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const parts = await upload({
      uploaded: partUrls(1, 2, 3).map(({ part_number }) => ({
        part_number,
        etag: `"held-${part_number}"`,
      })),
      partUrls: [],
    }).send();

    expect(respond).not.toHaveBeenCalled();
    expect(parts).toHaveLength(3);
  });

  // ─── FAILURE ───────────────────────────────────────────────────────────────

  it("retries a part that fails without re-sending the rest", async () => {
    const { respond, seen } = acceptingFetch({ failFor: new Map([[2, 2]]) });
    vi.stubGlobal("fetch", respond);

    const parts = await upload().send();

    expect(parts).toHaveLength(3);
    expect(seen.filter((part) => part === 2)).toHaveLength(3);
    expect(seen.filter((part) => part === 1)).toHaveLength(1);
  });

  it("gives up on a part that keeps failing", async () => {
    const { respond } = acceptingFetch({ failFor: new Map([[2, 99]]) });
    vi.stubGlobal("fetch", respond);

    await expect(upload().send()).rejects.toThrow(/Uploading part failed/);
  });

  it("fails at the part when the ETag is not readable", async () => {
    // A part that uploads fine but whose ETag the browser cannot see: the bucket is not
    // exposing the header. Completion would be impossible, so the driver stops here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, headers: new Headers() })),
    );

    await expect(upload().send()).rejects.toThrow(/readable ETag/);
  });

  // ─── EXPIRY ────────────────────────────────────────────────────────────────

  it("re-signs everything still owed, once, when signatures have expired", async () => {
    // Every original URL is expired and every fresh one works, which is what a stale batch
    // looks like: all three parts fail, and one request has to serve all of them.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url.includes("/part/")) {
          return { ok: false, status: 403, headers: new Headers() };
        }

        const partNumber = Number(url.split("/").pop());

        return {
          ok: true,
          status: 200,
          headers: new Headers({ etag: `"part-${partNumber}"` }),
        };
      }),
    );

    const resign = vi.fn(async (partNumbers) =>
      partNumbers.map((part_number) => ({
        part_number,
        url: `https://s3.test/fresh/${part_number}`,
      })),
    );

    const parts = await upload({ resign }).send();

    expect(parts).toHaveLength(3);

    // One request for the whole batch, not one per part.
    expect(resign).toHaveBeenCalledTimes(1);
    expect(resign.mock.calls[0][0]).toEqual([1, 2, 3]);
  });

  it("asks for a signature it was not given up front", async () => {
    const { respond } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const resign = vi.fn(async (partNumbers) =>
      partNumbers.map((part_number) => ({
        part_number,
        url: `https://s3.test/part/${part_number}`,
      })),
    );

    const parts = await upload({ partUrls: partUrls(1), resign }).send();

    expect(parts).toHaveLength(3);
    expect(resign).toHaveBeenCalledTimes(1);
  });

  it("fails rather than guessing when it has no way to re-sign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, headers: new Headers() })),
    );

    await expect(upload().send()).rejects.toThrow(/signature/);
  });

  // ─── ABORT ─────────────────────────────────────────────────────────────────

  it("stops sending once aborted", async () => {
    const driver = upload({ partCount: 20, file: fakeFile(PART_SIZE * 20) });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        driver.abort();

        if (options.signal?.aborted) throw new Error("aborted");

        return { ok: true, status: 200, headers: new Headers({ etag: '"x"' }) };
      }),
    );

    await expect(driver.send()).rejects.toThrow();
  });

  // ─── NO OBJECT STORE ───────────────────────────────────────────────────────

  it("invents receipts for the placeholder URLs a stubbed API answers with", async () => {
    const { respond } = acceptingFetch();
    vi.stubGlobal("fetch", respond);

    const parts = await upload({
      partUrls: [1, 2, 3].map((part_number) => ({
        part_number,
        url: `mock-s3://bucket/key?part=${part_number}`,
      })),
    }).send();

    expect(respond).not.toHaveBeenCalled();
    expect(parts).toHaveLength(3);
  });
});
