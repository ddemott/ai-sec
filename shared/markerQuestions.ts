/**
 * Pure parser for the document-upload knowledge convention. An owner marks their
 * own Q&A with `**Q:` / `**A:` lines; everything else is prose the AI answers the
 * standard questions from. No I/O — fully unit-testable. (Spec: docs/superpowers/
 * specs/2026-06-30-document-upload-knowledge-prefill-design.md §2.)
 */
export interface MarkerQuestion {
  question: string;
  answer: string;
}

export interface MarkerParseResult {
  /** Well-formed `**Q:`/`**A:` pairs. */
  custom: MarkerQuestion[];
  /** Question text of any `**Q:` that never got a `**A:` — reported, not dropped. */
  malformed: string[];
  /** Everything outside a marker block, for the standard-question AI pass. */
  prose: string;
}

const Q_MARKER = /^\s*\*\*\s*q\s*:/i;
const A_MARKER = /^\s*\*\*\s*a\s*:/i;

/** Strip the leading `**Q:` / `**A:` marker, return the remainder trimmed. */
function afterMarker(line: string): string {
  return line.replace(/^\s*\*\*\s*[qa]\s*:/i, '').trim();
}

export function parseMarkerQuestions(text: string): MarkerParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const custom: MarkerQuestion[] = [];
  const malformed: string[] = [];
  const prose: string[] = [];

  // State machine: 'prose' | 'q' (collecting question) | 'a' (collecting answer).
  let state: 'prose' | 'q' | 'a' = 'prose';
  let qBuf: string[] = [];
  let aBuf: string[] = [];

  const commitPair = () => {
    const question = qBuf.join(' ').trim();
    const answer = aBuf.join('\n').trim();
    if (question) custom.push({ question, answer });
    qBuf = [];
    aBuf = [];
  };
  const commitOrphanQuestion = () => {
    const question = qBuf.join(' ').trim();
    if (question) malformed.push(question);
    qBuf = [];
  };

  for (const line of lines) {
    const isQ = Q_MARKER.test(line);
    const isA = A_MARKER.test(line);

    if (isQ) {
      // A new question starts. Close whatever came before.
      if (state === 'a') commitPair();
      else if (state === 'q') commitOrphanQuestion(); // previous **Q: never got a **A:
      state = 'q';
      qBuf = [afterMarker(line)];
      continue;
    }

    if (isA) {
      if (state === 'q') {
        state = 'a';
        aBuf = [afterMarker(line)];
      }
      // A stray **A: with no open **Q: is ignored (dropped, not prose).
      continue;
    }

    if (state === 'q') {
      // Multi-line question body continues until the **A: line.
      qBuf.push(line.trim());
      continue;
    }

    if (state === 'a') {
      // Answer is a continuous block; a blank line ends it.
      if (line.trim() === '') {
        commitPair();
        state = 'prose';
      } else {
        aBuf.push(line);
      }
      continue;
    }

    // state === 'prose'
    prose.push(line);
  }

  // Flush trailing state at EOF.
  if (state === 'a') commitPair();
  else if (state === 'q') commitOrphanQuestion();

  return { custom, malformed, prose: prose.join('\n') };
}
