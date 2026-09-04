// Minimal, dependency-free ZIP reader: lists entry paths from the central
// directory without decompressing. Handles ZIP64 for large archives.

const EOCD_SIG = 0x06054b50; // End of Central Directory record
const EOCD64_LOCATOR_SIG = 0x07064b50; // Zip64 EOCD locator
const EOCD64_SIG = 0x06064b50; // Zip64 EOCD record
const CDH_SIG = 0x02014b50; // Central Directory Header
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

async function sliceView(file, start, end) {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

function findSigBackwards(view, sig) {
  for (let i = view.byteLength - EOCD_MIN; i >= 0; i--) {
    if (view.getUint32(i, true) === sig) return i;
  }
  return -1;
}

async function centralDirectoryLocation(file) {
  const tailLen = Math.min(file.size, EOCD_MIN + MAX_COMMENT + 20);
  const tail = await sliceView(file, file.size - tailLen, file.size);

  const eocd = findSigBackwards(tail, EOCD_SIG);
  if (eocd === -1)
    throw new Error("not a valid zip (no end-of-central-directory record)");

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20; // Zip64 locator sits just before the EOCD
    if (loc < 0 || tail.getUint32(loc, true) !== EOCD64_LOCATOR_SIG) {
      throw new Error("zip64 archive but locator not found");
    }
    const z64Off = Number(tail.getBigUint64(loc + 8, true));
    const z64 = await sliceView(file, z64Off, z64Off + 56);
    if (z64.getUint32(0, true) !== EOCD64_SIG)
      throw new Error("bad zip64 record");
    count = Number(z64.getBigUint64(32, true));
    cdSize = Number(z64.getBigUint64(40, true));
    cdOffset = Number(z64.getBigUint64(48, true));
  }
  return { count, cdSize, cdOffset };
}

async function listZipEntries(file) {
  const { cdSize, cdOffset } = await centralDirectoryLocation(file);
  const cd = await sliceView(file, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder("utf-8");
  const names = [];
  let pos = 0;
  while (pos + 46 <= cd.byteLength && cd.getUint32(pos, true) === CDH_SIG) {
    const nameLen = cd.getUint16(pos + 28, true);
    const extraLen = cd.getUint16(pos + 30, true);
    const commentLen = cd.getUint16(pos + 32, true);
    const nameBytes = new Uint8Array(
      cd.buffer,
      cd.byteOffset + pos + 46,
      nameLen,
    );
    names.push(decoder.decode(nameBytes));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// Task folders are named ts<digit>-... and may sit at any depth, e.g.
//   <label>/<task>/<recording>/seed_*.safetensors
//   <label>/<model>/<task>/<recording>/seed_*.safetensors
// so we scan every path segment for one matching the task pattern.
const TASK_RE = /^ts\d-/;

function inferTasks(paths) {
  const tasks = new Set();
  for (const path of paths) {
    for (const seg of path.split("/")) {
      if (TASK_RE.test(seg)) tasks.add(seg);
    }
  }
  return [...tasks].sort();
}

export { listZipEntries, inferTasks };
