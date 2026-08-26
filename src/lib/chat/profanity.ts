/**
 * Self-built Korean/English banned-word filter — no external API (per
 * decision recorded when this feature was scoped). Deliberately simple
 * substring matching over a short, curated list rather than morphological
 * analysis or leetspeak normalization — good enough to catch casual abuse in
 * a small group-chat app, not a moderation platform.
 */
const BANNED_WORDS: string[] = [
  // Korean
  "시발", "씨발", "씨발놈", "개새끼", "새끼", "병신", "지랄", "좆", "존나",
  "미친놈", "미친년", "닥쳐", "꺼져", "쓰레기같은", "죽어",
  // English
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick",
];

function normalize(text: string): string {
  // Strip whitespace between characters (a common simple evasion: "시 발")
  // and lowercase for the English list — no deeper normalization on purpose.
  return text.replace(/\s+/g, "").toLowerCase();
}

export interface ProfanityCheck {
  flagged: boolean;
  /** Message with each banned word replaced by `*`s of the same length. Identical to the input when `flagged` is false. */
  clean: string;
}

export function filterProfanity(text: string): ProfanityCheck {
  const normalized = normalize(text);
  let flagged = false;
  let clean = text;

  for (const word of BANNED_WORDS) {
    const normalizedWord = normalize(word);
    if (normalized.includes(normalizedWord)) {
      flagged = true;
      // Best-effort visual mask on the original (non-normalized) string —
      // exact-substring words match directly; whitespace-evaded ones just
      // stay flagged without a precise mask, which is an acceptable
      // trade-off for this simple, non-adversarial use case.
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      clean = clean.replace(re, (m) => "*".repeat(m.length));
    }
  }

  return { flagged, clean };
}
