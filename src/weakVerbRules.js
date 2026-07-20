/**
 * weakVerbRules.js
 *
 * Ruleset for identifying weak verb roots (גזרות) in Biblical Hebrew (Chumash).
 * Built from human-annotated examples by Yossi Hein.
 *
 * Usage: import { identifyRoot } from './weakVerbRules';
 * Returns: { shoresh, gizra, isDoubleWeak, needsContext } or null if not found
 */

// ─────────────────────────────────────────────
// LOOKUP TABLES (annotated by human expert)
// ─────────────────────────────────────────────

/**
 * ל"ה — Final ה drops in most conjugated forms.
 * Surface form looks 2-letter; restore ה as 3rd root letter.
 */
export const LAH_ROOTS = {
  'עש':  'עשה',
  'בנ':  'בנה',
  'על':  'עלה',
  'קנ':  'קנה',
  'ר':   'ראה',  // וַיַּרְא → ראה (extremely contracted)
  'רא':  'ראה',
  'הי':  'היה',
};

export const LAH_ROOT_LIST = ['עשה', 'ראה', 'היה', 'בנה', 'עלה', 'קנה'];

// ─────────────────────────────────────────────

/**
 * פ"נ — Initial נ assimilates into the following consonant (dagesh chazak).
 */
export const PEH_NUN_ROOTS = [
  'נפל', 'נגש', 'נתן', 'נשא', 'נגד', 'נסע', 'נגע',
];

export const PEH_NUN_IRREGULAR = {
  'לקח': { behavesLike: 'פ"נ', note: 'Irregular — ל assimilates like נ in wayyiqtol' },
};

// ─────────────────────────────────────────────

/**
 * פ"י / פ"ו — Initial י (or ו) drops in wayyiqtol and yiqtol.
 */
export const PEH_YOD_ROOTS = [
  'ישב', 'יצא', 'ידע', 'ילד', 'ירד', 'ירא', 'יסף', 'יצר',
];

export const PEH_YOD_IRREGULAR = {
  'הלך': { behavesLike: 'פ"י', note: 'Fully irregular — no י in shoresh' },
};

// ─────────────────────────────────────────────

/**
 * ע"ו / ע"י — Middle root letter (ו or י) drops or contracts.
 */
export const AYIN_VAV_ROOTS = [
  'קום', 'בוא', 'שוב', 'שום', 'מות', 'נוח', 'רוץ', 'בין',
];

// ─────────────────────────────────────────────

/**
 * ל"א — Final א quiesces.
 */
export const LAMED_ALEF_ROOTS = [
  'יצא', 'מצא', 'קרא', 'נשא', 'מלא', 'בוא', 'חטא',
];

// ─────────────────────────────────────────────

/**
 * DOUBLE WEAK ROOTS
 */
export const DOUBLE_WEAK = {
  'יצא': ['פ"י', 'ל"א'],
  'בוא': ['ע"ו', 'ל"א'],
  'נשא': ['פ"נ', 'ל"א'],
};

// ─────────────────────────────────────────────

/**
 * AMBIGUOUS / NEEDS CONTEXT
 */
export const NEEDS_CONTEXT = [
  {
    form: 'וַיָּגָר',
    candidates: ['גור (ע"ו — to sojourn)', 'יגר (to fear)'],
    note: 'Determine from context: patriarchal travel narrative → גור; fear context → יגר',
  },
];

// ─────────────────────────────────────────────
// MASTER LOOKUP
// ─────────────────────────────────────────────

/**
 * All confirmed weak roots with their גזרה metadata.
 */
export const ALL_WEAK_ROOTS = {
  // ל"ה
  'עשה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },
  'ראה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },
  'היה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },
  'בנה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },
  'עלה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },
  'קנה': { gizra: 'ל"ה', drops: 'ה', restore: 'append ה' },

  // פ"נ
  'נפל': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'נגש': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'נתן': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'נשא': { gizra: 'פ"נ/ל"א', drops: 'נ + א weakens', restore: 'prepend נ', doubleWeak: true },
  'נגד': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'נסע': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'נגע': { gizra: 'פ"נ', drops: 'נ', restore: 'prepend נ' },
  'לקח': { gizra: 'פ"נ (irregular)', drops: 'ל assimilates', restore: 'prepend ל', note: 'Irregular' },

  // פ"י
  'ישב': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'יצא': { gizra: 'פ"י/ל"א', drops: 'י + א weakens', restore: 'prepend י', doubleWeak: true },
  'ידע': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'ילד': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'ירד': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'ירא': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'יסף': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'יצר': { gizra: 'פ"י', drops: 'י', restore: 'prepend י' },
  'הלך': { gizra: 'פ"י (irregular)', drops: 'n/a', restore: 'hardcoded', note: 'Fully irregular — no י in shoresh' },

  // ע"ו / ע"י
  'קום': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter' },
  'בוא': { gizra: 'ע"ו/ל"א', drops: 'ו + א weakens', restore: 'insert ו', doubleWeak: true },
  'שוב': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter' },
  'שום': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter', alt: 'שׂים' },
  'מות': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter' },
  'נוח': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter' },
  'רוץ': { gizra: 'ע"ו', drops: 'ו', restore: 'insert ו as 2nd letter' },
  'בין': { gizra: 'ע"י', drops: 'י', restore: 'insert י as 2nd letter' },

  // ל"א
  'מצא': { gizra: 'ל"א', drops: 'א quiesces', restore: 'append א' },
  'קרא': { gizra: 'ל"א', drops: 'א quiesces', restore: 'append א' },
  'מלא': { gizra: 'ל"א', drops: 'א quiesces', restore: 'append א' },
  'חטא': { gizra: 'ל"א', drops: 'א quiesces', restore: 'append א' },
};

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Given a shoresh string, return its weak verb metadata.
 * Returns null if shoresh is a regular (strong) verb.
 */
export function getWeakVerbInfo(shoresh) {
  return ALL_WEAK_ROOTS[shoresh] || null;
}

/**
 * Given a surface Hebrew form (with nikud), check if it needs context-based disambiguation.
 */
export function checkNeedsContext(form) {
  return NEEDS_CONTEXT.find(entry => entry.form === form) || null;
}

/**
 * Strip common Biblical Hebrew prefixes from a consonant-only string.
 * Input should already have nikud removed.
 * Prefixes: ו ה ל כ ב מ ש
 * Only strips one prefix at a time (most common case).
 */
export function stripPrefix(consonants) {
  const PREFIXES = ['ו', 'ה', 'ל', 'כ', 'ב', 'מ', 'ש'];
  if (consonants.length <= 2) return consonants; // too short to strip safely
  for (const p of PREFIXES) {
    if (consonants.startsWith(p)) {
      return consonants.slice(p.length);
    }
  }
  return consonants;
}

/**
 * Given a 2-letter consonant string, check if it maps to a known ל"ה root.
 * Returns the full 3-letter shoresh or null.
 */
export function expandLahRoot(consonants) {
  return LAH_ROOTS[consonants] || null;
}

/**
 * Validate/correct a shoresh returned by Claude.
 * - If Claude returned a 2-letter string that maps to a known ל"ה root, correct it.
 * - Returns corrected shoresh string (or original if no correction needed).
 */
export function correctShoresh(claudeShoresh) {
  if (!claudeShoresh) return claudeShoresh;
  // Strip nikud and dashes from Claude's root output (e.g. "ע-ש-ה" → "עשה")
  const clean = claudeShoresh.replace(/[\u0591-\u05C7\-\s]/g, '');
  if (clean.length === 2) {
    const expanded = expandLahRoot(clean);
    if (expanded) return expanded;
  }
  // If already 3+ letters and in ALL_WEAK_ROOTS, return as-is (already correct)
  return claudeShoresh;
}
