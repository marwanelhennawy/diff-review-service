// Parses a unified diff into a list of per-file records:
// { path, addedLines: [{ line, text }], byteLength, raw }
// "path" is the new-file path (from the +++ header), stripped of a/ b/ prefixes.
// Only files with a recognizable +++ header are included.

const MAX_CHUNK_BYTES = 65536;

function stripPrefix(p) {
  if (!p) return p;
  if (p === '/dev/null') return p;
  return p.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(diffText) {
  if (!diffText || typeof diffText !== 'string' || !diffText.trim()) {
    return null; // caller treats as invalid
  }

  const lines = diffText.split('\n');
  const files = [];
  let current = null; // { path, addedLines, rawLines, newLine }
  let sawAnyFileHeader = false;

  const flush = () => {
    if (current) {
      const raw = current.rawLines.join('\n');
      files.push({
        path: current.path,
        addedLines: current.addedLines,
        byteLength: Buffer.byteLength(raw, 'utf8'),
        raw
      });
    }
    current = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      flush();
      current = { path: null, addedLines: [], rawLines: [line], newLine: 0 };
      i++;
      continue;
    }

    if (line.startsWith('--- ')) {
      if (!current) {
        current = { path: null, addedLines: [], rawLines: [], newLine: 0 };
      }
      current.rawLines.push(line);
      i++;
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (!current) {
        current = { path: null, addedLines: [], rawLines: [], newLine: 0 };
      }
      let p = line.slice(4).trim();
      p = p.split('\t')[0]; // drop trailing timestamp if present
      current.path = stripPrefix(p);
      current.rawLines.push(line);
      sawAnyFileHeader = true;
      i++;
      continue;
    }

    if (line.startsWith('@@')) {
      if (!current) {
        current = { path: null, addedLines: [], rawLines: [], newLine: 0 };
      }
      const m = /@@\s*-\d+(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/.exec(line);
      current.newLine = m ? parseInt(m[1], 10) : 1;
      current.rawLines.push(line);
      i++;
      continue;
    }

    if (current && current.path && current.newLine > 0 &&
        (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      current.rawLines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.addedLines.push({ line: current.newLine, text: line.slice(1) });
        current.newLine++;
      } else if (line.startsWith(' ')) {
        current.newLine++;
      }
      // '-' lines: old-file only, newLine untouched
      i++;
      continue;
    }

    // Any other line (e.g. "index abcd..1234 100644", "\ No newline at end of file",
    // blank separator lines): keep as raw context if we're inside a file block.
    if (current) {
      current.rawLines.push(line);
    }
    i++;
  }
  flush();

  if (!sawAnyFileHeader || files.length === 0) {
    return null;
  }

  return { files };
}

// Groups parsed files into chunks of at most MAX_CHUNK_BYTES, split only on
// file boundaries. A single file over the limit becomes its own chunk.
export function chunkFiles(files, maxBytes = MAX_CHUNK_BYTES) {
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;

  for (const file of files) {

    const fileSize = file.byteLength;

    if (
      currentSize + fileSize > maxBytes &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(file);
    currentSize += fileSize;
  }


  if(currentChunk.length > 0){
    chunks.push(currentChunk);
  }


  return chunks;
}

export { MAX_CHUNK_BYTES };
