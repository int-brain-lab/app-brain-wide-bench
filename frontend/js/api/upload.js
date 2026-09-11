// Multipart upload driver: sends a file to S3 in parts, straight from the browser.
//
// Knows nothing about our API. It is given signed URLs and a way to ask for more, and
// hands back the receipts S3 needs to reassemble the file. The caller owns starting the
// upload, completing it, and abandoning it.
//
// A part number is inside its signed URL, so each part needs its own — they cannot be
// reused or reordered.

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const CONCURRENCY = 4;
const ATTEMPTS = 4;
const BACKOFF_MS = 500;

// S3 answers an expired signature with 403. The part is fine; the URL is not.
const EXPIRED = 403;

// The frontend never uploads in stub mode — the API answers with these instead of signed
// URLs when it has no object store — so the transfer is skipped and a receipt invented.
const MOCK_PREFIX = "mock-s3://";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isMockUrl(url) {
  return url.startsWith(MOCK_PREFIX);
}

// Deterministic, so a re-slice of the same file yields the same bytes for a part number.
function sliceFor(file, partNumber, partSize) {
  const start = (partNumber - 1) * partSize;

  return file.slice(start, Math.min(start + partSize, file.size));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── ONE PART ────────────────────────────────────────────────────────────────

// The ETag is only readable because the bucket's CORS config exposes it; without
// `ExposeHeaders: ETag` this is null and the upload cannot be completed.
async function putPart(url, blob, signal) {
  if (isMockUrl(url)) return `"mock-${blob.size}"`;

  const response = await fetch(url, { method: "PUT", body: blob, signal });

  if (response.status === EXPIRED) {
    const error = new Error("This upload's signature has expired.");
    error.expired = true;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Uploading part failed (${response.status})`);
  }

  const etag = response.headers.get("etag");

  // Null means the part arrived but the header is not readable from script, which is a
  // bucket CORS configuration rather than anything about this upload. Failing here names
  // it; carrying the null to the completion call fails much later as a schema error about
  // `parts[0].etag`.
  if (!etag) {
    throw new Error(
      "The storage service did not return a readable ETag — its CORS configuration must " +
        "expose that header.",
    );
  }

  return etag;
}

// ─── CONTROLLER ──────────────────────────────────────────────────────────────

/**
 * An upload of one file, in parts, to the URLs it is given.
 *
 * @param file        the `File` to send. Sliced lazily; never read whole.
 * @param partSize    bytes per part, as the API reported it.
 * @param partCount   parts the file comes to at that size.
 * @param partUrls    [{ part_number, url }] to start from.
 * @param uploaded    [{ part_number, etag }] S3 already holds. Omit for a fresh upload.
 * @param resign      async (partNumbers) => [{ part_number, url }], for expired
 *                    signatures. Omit to fail instead of re-signing.
 * @param onProgress  ({ bytes, total }) => void, after each part lands. Omit for none.
 *
 * @returns `{ send, abort }`. `send()` resolves to every [{ part_number, etag }] the
 *          completion call needs, the parts already held included.
 */
function createUpload({
  file,
  partSize,
  partCount,
  partUrls,
  uploaded = [],

  resign,
  onProgress,
}) {
  const controller = new AbortController();

  const urls = new Map(partUrls.map(({ part_number, url }) => [part_number, url]));
  const receipts = new Map(uploaded.map(({ part_number, etag }) => [part_number, etag]));

  // Only what S3 does not already have, smallest first so a resumed upload reports
  // progress in the order the file reads.
  const pending = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!receipts.has(partNumber)) pending.push(partNumber);
  }

  // The re-signing request in flight, shared by whoever needs a fresh URL next.
  let resigning = null;

  let bytes = uploaded.reduce(
    (total, { part_number }) => total + sliceFor(file, part_number, partSize).size,
    0,
  );

  // ─── SIGNATURES ────────────────────────────────────────────────────────────

  // Every part without a receipt, rather than what is left in the queue: by the time a
  // part fails, the others are already in flight and the queue is short or empty.
  function owed() {
    const partNumbers = [];

    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      if (!receipts.has(partNumber)) partNumbers.push(partNumber);
    }

    return partNumbers;
  }

  async function urlFor(partNumber) {
    if (!urls.has(partNumber)) await refreshUrls();

    return urls.get(partNumber);
  }

  // Signatures expire together, so concurrent callers share one request rather than each
  // asking for the same set.
  async function refreshUrls() {
    if (!resign) throw new Error("This upload's signatures have expired.");

    resigning ??= resign(owed()).finally(() => {
      resigning = null;
    });

    for (const { part_number, url } of await resigning) {
      urls.set(part_number, url);
    }
  }

  // ─── SENDING ───────────────────────────────────────────────────────────────

  async function sendPart(partNumber) {
    const blob = sliceFor(file, partNumber, partSize);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const etag = await putPart(await urlFor(partNumber), blob, controller.signal);

        receipts.set(partNumber, etag);
        bytes += blob.size;
        onProgress?.({ bytes, total: file.size });

        return;
      } catch (error) {
        // An abort is the caller's decision, not a failure to retry through.
        if (controller.signal.aborted) throw error;

        if (attempt === ATTEMPTS) throw error;

        // Signatures expire together, so re-sign everything still owed rather than one
        // part per round trip. A fresh URL is worth retrying immediately.
        if (error.expired) {
          await refreshUrls();
          continue;
        }

        await sleep(BACKOFF_MS * attempt);
      }
    }
  }

  // Workers share one queue rather than taking a slice each, so a slow part does not
  // leave the other workers idle at the end.
  async function worker() {
    for (let partNumber = pending.shift(); partNumber; partNumber = pending.shift()) {
      await sendPart(partNumber);
    }
  }

  async function send() {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    return [...receipts.entries()]
      .map(([part_number, etag]) => ({ part_number, etag }))
      .sort((a, b) => a.part_number - b.part_number);
  }

  function abort() {
    pending.length = 0;
    controller.abort();
  }

  return { send, abort };
}

export { createUpload };
