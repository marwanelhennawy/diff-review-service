// Deterministic mock provider. Operates per-file on the list of added lines
// ({ line, text }) produced by diffParser. Returns Finding[] for that file
// (unsorted - caller sorts/dedupes globally).

const CRED_RE = /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i;
const SQL_KEYWORD_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
const NULL_CMP_RE = /[=!]=\s*null\b/;
const INJ_RE = /(ignore previous instructions|disregard all prior|you are now)/i;

function isSqlStringConcat(text) {
  if (!SQL_KEYWORD_RE.test(text)) return false;
  if (!text.includes('+')) return false;
  // Heuristic: an SQL keyword appears inside a quoted literal, and the line
  // also concatenates with '+' (string built via `"...SELECT..." + x` or
  // `x + "...SELECT..."`).
  const quoted = text.match(/(['"])(?:(?!\1).)*\1/g) || [];
  const keywordInQuote = quoted.some((q) => SQL_KEYWORD_RE.test(q));
  return keywordInQuote;
}

function mkFinding(ruleId, severity, category, title, path, line, evidence) {
  return {
    id: `${ruleId}:${path}:${line}`,
    ruleId,
    path,
    line,
    severity,
    category,
    title,
    evidence
  };
}

// MOCK-004 needs lookahead across consecutive added lines within a file to
// detect an empty catch block. We scan the file's added lines in order,
// grouping by contiguous run (they may not be contiguous in the source, but
// since we only see added lines, we treat the added-line sequence itself as
// our search space - this matches "may span lines" for freshly-added code).
function findEmptyCatchBlocks(addedLines, path) {
  const findings = [];
  const catchLineRe = /\bcatch\s*\(/;

  for (let idx = 0; idx < addedLines.length; idx++) {
    const { line, text } = addedLines[idx];
    const catchMatch = catchLineRe.exec(text);
    if (!catchMatch) continue;

    // Only consider text from the "catch" keyword onward on its own line -
    // anything before it (e.g. the "}" closing the preceding try block) must
    // not be counted toward the catch block's own brace depth.
    const firstLineTail = text.slice(catchMatch.index);

    let braceOpenIdx = idx;
    let openTail = firstLineTail;
    let sawOpenBrace = openTail.includes('{');
    while (!sawOpenBrace && braceOpenIdx + 1 < addedLines.length) {
      braceOpenIdx++;
      openTail = addedLines[braceOpenIdx].text;
      if (openTail.includes('{')) sawOpenBrace = true;
      else if (openTail.trim() !== '') break;
    }
    if (!sawOpenBrace) continue;

    // Walk forward collecting body content until the matching close brace,
    // tracking brace depth starting from the open brace line (using only the
    // tail from "catch" onward on that first line).
    let depth = 0;
    let bodyIsEmpty = true;
    let closed = false;
    for (let j = braceOpenIdx; j < addedLines.length; j++) {
      const t = j === braceOpenIdx ? openTail : addedLines[j].text;
      for (const ch of t) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { closed = true; break; }
        }
      }
      if (j > braceOpenIdx && depth > 0) {
        const trimmed = t.trim();
        const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
        if (trimmed !== '' && !isComment) bodyIsEmpty = false;
      }
      if (closed) break;
    }

    if (closed && bodyIsEmpty) {
      findings.push(mkFinding('MOCK-004', 'high', 'correctness', 'swallowed exception', path, line, text.trim()));
    }
  }
  return findings;
}

export function reviewFileMock(file) {
  const { path, addedLines } = file;
  const findings = [];

  for (const { line, text } of addedLines) {
    if (text.includes('eval(')) {
      findings.push(mkFinding('MOCK-001', 'critical', 'security', 'eval usage', path, line, text.trim()));
    }
    if (CRED_RE.test(text)) {
      findings.push(mkFinding('MOCK-002', 'critical', 'security', 'hardcoded credential', path, line, text.trim()));
    }
    if (isSqlStringConcat(text)) {
      findings.push(mkFinding('MOCK-003', 'high', 'security', 'SQL string concatenation', path, line, text.trim()));
    }
    if (NULL_CMP_RE.test(text)) {
      findings.push(mkFinding('MOCK-005', 'medium', 'correctness', 'loose null comparison', path, line, text.trim()));
    }
    if (text.includes('JSON.parse(JSON.stringify(')) {
      findings.push(mkFinding('MOCK-006', 'medium', 'performance', 'deep-clone via JSON', path, line, text.trim()));
    }
    if (text.includes('console.log(')) {
      findings.push(mkFinding('MOCK-007', 'low', 'style', 'console.log left in', path, line, text.trim()));
    }
    if (text.includes('TODO') || text.includes('FIXME')) {
      findings.push(mkFinding('MOCK-008', 'low', 'style', 'unresolved marker', path, line, text.trim()));
    }
    if (INJ_RE.test(text)) {
      findings.push(mkFinding('MOCK-INJ', 'critical', 'security', 'prompt-injection content', path, line, text.trim()));
    }
  }

  findings.push(...findEmptyCatchBlocks(addedLines, path));
  return findings;
}
