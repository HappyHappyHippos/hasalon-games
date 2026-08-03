/**
 * Comparing a typed guess to the word, and showing the word without giving it
 * away.
 *
 * Both halves are security-shaped in the same way: the mask is the *only* form
 * of the word that non-drawers ever receive, so a bug here is not a wrong
 * answer on screen, it is the answer on screen.
 */

/** Hebrew final forms, folded to their ordinary counterparts. */
const FINAL_FORMS: Record<string, string> = {
  'ם': 'מ',
  'ן': 'נ',
  'ץ': 'צ',
  'ף': 'פ',
  'ך': 'כ',
};

/**
 * Niqqud, cantillation and the like: U+0591–U+05C7.
 *
 * Deliberately no `g` flag. A global regex carries a mutable `lastIndex`, so
 * `.test()` on one inside a loop answers about a *different offset* each call
 * and silently starts returning false — which here meant vowel points survived
 * normalisation and a correctly-spelled guess was rejected.
 */
const HEBREW_MARKS = /[֑-ׇ]/;

/**
 * Characters that are shown from the start rather than hidden.
 *
 * A space is structure, not information — hiding it turns "ice cream" into one
 * nine-letter blank and makes the length itself misleading.
 */
const ALWAYS_VISIBLE = new Set([' ', '-', '׳', "'", '.']);

/**
 * Reduce a word or a guess to the form the two are compared in.
 *
 * The Hebrew folding is not a nicety. A word ending in mem is *written* with a
 * final mem, so a guesser typing it correctly produces a different code point
 * from the same word written mid-string — comparing raw text rejects correct
 * answers, and does it more often the better the guesser's spelling.
 */
export function normalizeGuess(raw: string): string {
  let out = '';
  for (const ch of raw.normalize('NFC').toLowerCase()) {
    if (HEBREW_MARKS.test(ch)) continue;
    const folded = FINAL_FORMS[ch] ?? ch;
    // Everything that is not a letter or a digit goes: spaces, hyphens,
    // apostrophes and punctuation are all things people type inconsistently.
    if (/[\p{L}\p{N}]/u.test(folded)) out += folded;
  }
  return out;
}

/**
 * Drop interior vav and yod — the optional "mothers of reading".
 *
 * Hebrew is written both with them and without: שולחן and שלחן are the same
 * word, correctly spelled either way, and which one a person types is habit
 * rather than knowledge. Rejecting one of them is rejecting a right answer, and
 * it is the single most likely way for a Hebrew game to feel broken.
 *
 * Only interior letters, so ידיים does not lose its first letter, and only
 * consulted for words long enough that the collapse cannot make two genuinely
 * different short words equal (שיר and שר).
 */
function foldMatres(normalized: string): string {
  if (normalized.length < 4) return normalized;
  let out = normalized[0]!;
  for (let i = 1; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === 'ו' || ch === 'י') continue;
    out += ch;
  }
  return out;
}

export function isCorrect(guess: string, word: string): boolean {
  const a = normalizeGuess(guess);
  if (a.length === 0) return false;
  const b = normalizeGuess(word);
  if (a === b) return true;
  return foldMatres(a) === foldMatres(b);
}

/**
 * One edit away — worth a "close!" nudge, worth no points.
 *
 * Bounded Levenshtein: we only ever ask "is the distance at most 1", so the
 * full matrix is wasted work. Length differing by more than one settles it
 * immediately, and otherwise a single scan finds the first mismatch and checks
 * whether skipping one character on either side lines the rest up.
 */
export function isClose(guess: string, word: string): boolean {
  const a = normalizeGuess(guess);
  const b = normalizeGuess(word);
  if (a === b) return false;
  if (a.length === 0) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  // Short words have no near-misses worth reporting: at three letters, "one
  // edit away" covers a large slice of the language and the hint is noise.
  if (b.length < 4) return false;

  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return false;

  const restA = a.slice(i);
  const restB = b.slice(i);
  if (a.length === b.length) return restA.slice(1) === restB.slice(1);
  if (a.length < b.length) return restA === restB.slice(1);
  return restA.slice(1) === restB;
}

/**
 * The word as the guessers see it: revealed letters in place, everything else a
 * blank.
 *
 * `revealed` holds *indices into the word*, and letters not in that set are
 * replaced before the string ever reaches a snapshot. There is deliberately no
 * variant of this that sends the whole word plus a count of how much to hide —
 * that puts the answer on every guesser's socket and trusts the client not to
 * look.
 */
export function maskWord(word: string, revealed: ReadonlySet<number>): string {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    if (ALWAYS_VISIBLE.has(ch) || revealed.has(i)) out += ch;
    else out += '_';
  }
  return out;
}

/** Positions that a reveal is allowed to uncover, in word order. */
export function revealableIndices(word: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (!ALWAYS_VISIBLE.has(word[i]!)) out.push(i);
  }
  return out;
}
