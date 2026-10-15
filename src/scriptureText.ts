/* ============================================================
   THE LIVING BREAD MCP, a verse inside the house's own sentences.

   Tools read passages asynchronously from the stored King James text
   (src/kjv.ts). A closing line or a page footer that carries a verse holds
   only its REFERENCE and asks for the words here:

       `“${kjv('Psalm 96:1a')}” (Psalm 96:1)`

   The words come from src/scripture.generated.ts, which
   scripts/build-scripture-text-services.mjs (repo root) writes from the same
   assets/bible/books the Worker serves, with the app's reference grammar
   (scripts/scripture-ref.mjs: "Psalm 34:8a" is a clause, the text up to the
   translators' first colon or semicolon). After adding or changing a call,
   run that script; tests/scripture-services.test.ts fails if it is stale.
   ============================================================ */
import { SCRIPTURE_KJV } from './scripture.generated';

/** The King James words of `ref`, verbatim. The argument must be a string literal. */
export function kjv(ref: string): string {
  return SCRIPTURE_KJV[ref] ?? '';
}
