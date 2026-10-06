/* ============================================================
   THE LIVING BREAD MCP, retrieved content is data, never instructions.

   Church names, community and gathering descriptions, testimonies, need
   titles and the house's own page prose are written by people, and any of
   them could carry text aimed at an assistant ("ignore your previous
   instructions..."). Every string a tool returns passes through here on its
   way out (src/shared.ts): markup, control, zero-width and bidirectional
   override characters are removed, and instruction-shaped phrases are
   replaced with a visible marker, so the assistant reads that something
   was removed instead of obeying it. The answer then carries
   content_flags: ["instruction_like_text_removed"].

   Scripture is never altered by this: eval/run.mjs proves no verse of the
   stored corpus matches any pattern below.
   ============================================================ */

export const REMOVED = '[instruction-like text removed]';

/* Specific on purpose: each pattern is a phrase addressed to a machine, never ordinary prose. */
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:please\s+)?(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+)?(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|messages?|rules?|directions?|guidelines?)\b/gi,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\s*[:=]/gi,
  /\byou\s+are\s+now\s+(?:a|an|in|the)\b/gi,
  /\bnew\s+instructions?\s*[:=]/gi,
  /\b(?:call|invoke|run|use)\s+the\s+tool\s+[a-z_]{3,}\b/gi,
  /\bdo\s+not\s+tell\s+the\s+user\b/gi,
  /\b(?:exfiltrate|send)\s+(?:the\s+)?(?:user'?s?\s+)?(?:token|password|api\s*key|credentials?)\b/gi,
  /<\|[a-z_]*\|>/gi,
  /\[\/?(?:INST|SYS)\]/g,
];

const TAGS = /<\/?[a-zA-Z][^<>]{0,200}>/g;
// C0 controls except tab and newline, DEL, zero-width characters, and bidirectional overrides/isolates.
// The zero-width joiner and non-joiner (U+200C, U+200D) are kept: Persian, Hindi, Bengali, Nepali and
// Malayalam spell words with them, and the Bibles in those languages are quoted verbatim.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export interface Cleaned {
  text: string;
  flagged: boolean;
}

export function clean(s: string): Cleaned {
  let flagged = false;
  let t = s.replace(INVISIBLE, '');
  if (TAGS.test(t)) t = t.replace(TAGS, ' ');
  TAGS.lastIndex = 0;
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(t)) {
      flagged = true;
      re.lastIndex = 0;
      t = t.replace(re, REMOVED);
    }
    re.lastIndex = 0;
  }
  return { text: t, flagged };
}

/**
 * Clean a string while leaving the given passages untouched. A passage is Scripture this call read from the
 * stored corpus (never a person's words), so it is set aside before cleaning and put back after: a verse such
 * as "you are now the blessed of Yahweh" (Genesis 26:29, WEB) is quoted, not mistaken for an instruction.
 */
export function cleanExcept(s: string, keep: readonly string[]): Cleaned {
  if (!keep.length) return clean(s);
  const held: string[] = [];
  let masked = s;
  for (const k of keep) {
    if (!masked.includes(k)) continue;
    const token = `\uE000${held.length}\uE001`;
    held.push(k);
    masked = masked.split(k).join(token);
  }
  if (!held.length) return clean(s);
  const c = clean(masked);
  let text = c.text;
  held.forEach((k, i) => { text = text.split(`\uE000${i}\uE001`).join(k); });
  return { text, flagged: c.flagged };
}

/** Every string in a value, cleaned (passages in keep are left exactly as read). Returns the cleaned copy and whether anything was removed. */
export function cleanDeep<T>(value: T, depth = 0, keep: readonly string[] = []): { value: T; flagged: boolean } {
  if (depth > 8) return { value, flagged: false };
  if (typeof value === 'string') {
    const c = cleanExcept(value, keep);
    return { value: c.text as unknown as T, flagged: c.flagged };
  }
  if (Array.isArray(value)) {
    let flagged = false;
    const out = value.map((v) => {
      const r = cleanDeep(v, depth + 1, keep);
      flagged ||= r.flagged;
      return r.value;
    });
    return { value: out as unknown as T, flagged };
  }
  if (value && typeof value === 'object') {
    let flagged = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = cleanDeep(v, depth + 1, keep);
      flagged ||= r.flagged;
      out[k] = r.value;
    }
    return { value: out as T, flagged };
  }
  return { value, flagged: false };
}
