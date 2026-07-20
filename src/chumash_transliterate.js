/**
 * chumash_transliterate.js
 * Ashkenazic transliteration for Biblical Hebrew (Chumash).
 *
 * Calibrated against native speaker review — March 2026.
 * Pronunciation standard: Litvish/Yeshivish Ashkenazic.
 *
 * KEY DIFFERENCES FROM talmud transliterate.js:
 *   1. Must strip cantillation marks (taamim) before processing
 *   2. Cholam → "oh" (NOT "oy")
 *   3. Patah + Yod cluster → "ai" diphthong
 *   4. Shva at word start → "ih" (not silent, not apostrophe-only)
 *   5. Kamatz katan → "uh" (same as kamatz gadol — no distinction made)
 *   6. Furtive patah before word-final guttural → emit "ah" before consonant
 *   7. No Aramaic forms — pure Biblical Hebrew
 *
 * ── UNICODE REFERENCE ─────────────────────────────────────────────────────────
 *   Cantillation:   U+0591–U+05AF   (strip entirely)
 *   Meteg:          U+05BD          (strip)
 *   Paseq:          U+05C0          (strip)
 *   Dagesh/Mapik:   U+05BC
 *   Shin dot:       U+05C1
 *   Sin dot:        U+05C2
 *
 * ── NIKUD DIACRITICS (KEEP) ───────────────────────────────────────────────────
 *   U+05B0  shva            U+05B1  hataf-segol
 *   U+05B2  hataf-patah     U+05B3  hataf-kamatz
 *   U+05B4  hiriq           U+05B5  tsere
 *   U+05B6  segol           U+05B7  patah
 *   U+05B8  kamatz          U+05B9  holam
 *   U+05BA  holam-vav alt   U+05BB  kubutz
 *   U+05C7  kamatz-katan
 */

// ─── STRIP CANTILLATION ───────────────────────────────────────────────────────
function stripTaamim(text) {
  return text.replace(/[\u0591-\u05AF\u05BD\u05C0]/g, '');
}

// ─── OVERRIDE TABLE ───────────────────────────────────────────────────────────
// Check before applying phonetic rules.
// Keys: Hebrew WITH nikud, WITHOUT taamim.
const OVERRIDES = {
  // Divine names
  'יְהֹוָה':        'Hashem',
  'יהוה':           'Hashem',
  'אֱלֹהִים':       'Ehlohkeem',
  'אֵל':             'Keil',
  'שַׁדַּי':         'Shakai',
  'אֵל שַׁדַּי':     'Keil Shakai',
  'אֲדֹנָי':         'Hashem',
  'צְבָאוֹת':       'Tzvuos',

  // Patriarchs
  'אַבְרָהָם':       'Avraham',
  'אַבְרָם':         'Avram',
  'יִצְחָק':         'Yitzchak',
  'יַעֲקֹב':         'Yaakov',

  // Matriarchs
  'שָׂרָה':          'Sarah',
  'שָׂרַי':          'Sarai',
  'רִבְקָה':         'Rivkah',
  'לֵאָה':           "Lei'ah",
  'רָחֵל':           'Rochel',
  'בִּלְהָה':        'Bilhah',
  'זִלְפָּה':        'Zilpah',

  // Shevatim
  'יוֹסֵף':          'Yosef',
  'בִּנְיָמִין':     'Binyamin',
  'רְאוּבֵן':        'Reuven',
  'שִׁמְעוֹן':       'Shimon',
  'לֵוִי':           'Levi',
  'יְהוּדָה':        'Yehudah',
  'יִשָּׂשכָר':      'Yissachar',
  'זְבוּלֻן':        'Zevulun',
  'דָּן':            'Dan',
  'נַפְתָּלִי':      'Naftali',
  'גָּד':            'Gad',
  'אָשֵׁר':          'Asher',

  // Major figures
  'מֹשֶׁה':          'Moh-sheh',
  'אַהֲרֹן':         'Aharon',
  'מִרְיָם':         'Miriam',
  'יְהוֹשֻׁעַ':      'Yehoshua',
  'כָּלֵב':          'Kaleiv',
  'פִּינְחָס':       'Pinchas',
  'נֹחַ':            'Noach',
  'אָדָם':           'Adam',
  'חַוָּה':          'Chavah',
  'קַיִן':           'Kayin',
  'הֶבֶל':           'Hevel',
  'שֵׁת':            'Sheis',
  'לוֹט':            'Lot',
  'יִשְׁמָעֵאל':     'Yishmael',
  'עֵשָׂו':          'Eisav',
  'לָבָן':           'Lavan',
  'דִּינָה':         'Dinah',
  'פַּרְעֹה':        'Par-oh',
  'יִתְרוֹ':         'Yisro',
  'צִפֹּרָה':        'Tzipporah',

  // Places
  'יִשְׂרָאֵל':      'Yisroel',
  'כְּנַעַן':        "Kih-na'an",
  'מִצְרַיִם':       'Mitzraiyim',
  'בָּבֶל':          'Bavel',
  'חָרָן':           'Charan',
  'יְרוּשָׁלַיִם':   'Yih-roo-shuh-laiyim',
  'חֶבְרוֹן':        'Chevron',
  'שְׁכֶם':          'Shechem',
  'בֵּית לֶחֶם':     'Beis Lechem',
  'בְּאֵר שֶׁבַע':   "Be'er Sheva",
  'מִדְיָן':         'Midyan',
  'סִינַי':          'Sinai',
  'גִּלְעָד':        'Gilad',

  // Common religious terms
  'תּוֹרָה':         'Toh-ruh',
  'שַׁבָּת':         'Shah-buhs',
  'מִצְוָה':         'Mitzvah',
  'בְּרִית':         'Bris',
  'קָרְבָּן':        'Kuhr-buhn',
  'כֹּהֵן':          'Koh-hain',
  'מִזְבֵּחַ':       'Miz-bei-ach',
  'בְּרָכָה':        "B'ruh-chuh",
};

// ─── UNICODE CONSTANTS ────────────────────────────────────────────────────────
const DAGESH    = '\u05BC';
const SHIN_DOT  = '\u05C1';
const SIN_DOT   = '\u05C2';
const SHVA      = '\u05B0';
const HATAF_SEG = '\u05B1';
const HATAF_PAT = '\u05B2';
const HATAF_KAM = '\u05B3';
const HIRIQ     = '\u05B4';
const TSERE     = '\u05B5';
const SEGOL     = '\u05B6';
const PATAH     = '\u05B7';
const KAMATZ    = '\u05B8';
const HOLAM     = '\u05B9';
const HOLAM_VAV = '\u05BA';
const KUBUTZ    = '\u05BB';
const KAM_KATAN = '\u05C7';

const GUTTURALS = new Set(['א', 'ה', 'ח', 'ע']);

function isHebrew(c) {
  const cp = c.codePointAt(0);
  return cp >= 0x05D0 && cp <= 0x05EA;
}

function isNikud(c) {
  const cp = c.codePointAt(0);
  return (cp >= 0x05B0 && cp <= 0x05BB) || cp === 0x05C7;
}

/**
 * Transliterate a single Hebrew word (nikud intact, taamim stripped).
 */
function transliterateWord(word) {
  const override = OVERRIDES[word];
  if (override) return override;

  const chars = [...word];
  let out = '';
  let i = 0;
  // Track state across iterations for shva and vowel-collision rules
  let prevVowelWasShva = false;  // for "two shvas in a row" rule
  let prevHadVowel     = false;  // for consecutive-vowel hyphen rule

  while (i < chars.length) {
    const c = chars[i];

    // Skip standalone nikud/diacritics (should be attached but just in case)
    if (isNikud(c) || c === DAGESH || c === SHIN_DOT || c === SIN_DOT) {
      i++; continue;
    }

    // Gather diacritics following this consonant
    let hasDagesh  = false;
    let vowel      = '';
    let hasShinDot = false;
    let hasSinDot  = false;
    let j = i + 1;

    while (j < chars.length && !isHebrew(chars[j])) {
      const d = chars[j];
      if (d === DAGESH)         hasDagesh  = true;
      else if (d === SHIN_DOT)  hasShinDot = true;
      else if (d === SIN_DOT)   hasSinDot  = true;
      else if (isNikud(d))      vowel = d;
      j++;
    }

    const isWordFinal = (j >= chars.length);

    // ── Consonant ──────────────────────────────────────────────────────────
    let cons = '';
    switch (c) {
      case 'א': cons = '';                          break;
      case 'ב': cons = hasDagesh ? 'b' : 'v';       break;
      case 'ג': cons = 'g';                          break;
      case 'ד': cons = 'd';                          break;
      case 'ה': cons = (isWordFinal && !hasDagesh) ? '' : 'h'; break;
      case 'ו':
        if (vowel === HOLAM || vowel === HOLAM_VAV) { cons = ''; }
        else if (hasDagesh && vowel === '')           { cons = ''; vowel = 'shuruk'; }
        else                                          { cons = 'v'; }
        break;
      case 'ז': cons = 'z';                          break;
      case 'ח': cons = 'ch';                         break;
      case 'ט': cons = 't';                          break;
      case 'י': cons = 'y';                          break;
      case 'כ':
      case 'ך': cons = hasDagesh ? 'k' : 'ch';       break;
      case 'ל': cons = 'l';                          break;
      case 'מ':
      case 'ם': cons = 'm';                          break;
      case 'נ':
      case 'ן': cons = 'n';                          break;
      case 'ס': cons = 's';                          break;
      case 'ע': cons = isWordFinal ? '' : "'";       break;
      case 'פ':
      case 'ף': cons = hasDagesh ? 'p' : 'f';        break;
      case 'צ':
      case 'ץ': cons = 'tz';                         break;
      case 'ק': cons = 'k';                          break;
      case 'ר': cons = 'r';                          break;
      case 'ש':
        cons = hasSinDot ? 's' : 'sh';               break;
      case 'ת': cons = hasDagesh ? 't' : 's';        break;
      default:  cons = c;
    }

    // ── Furtive patah: emitted BEFORE the final guttural ──────────────────
    if (vowel === PATAH && isWordFinal && GUTTURALS.has(c) && c !== 'א') {
      if (prevHadVowel && (cons === '' || cons === "'" || cons === 'h')) out += '-';
      out += 'ah' + cons;
      prevHadVowel = true;
      prevVowelWasShva = false;
      i = j;
      continue;
    }

    // ── Vowel ──────────────────────────────────────────────────────────────
    let vout = '';
    switch (vowel) {
      case KAMATZ:
      case KAM_KATAN:
        vout = 'uh'; break;

      case PATAH:
        if (chars[j] === 'י') { vout = 'ai'; j++; }
        else                   { vout = 'ah'; }
        break;

      case SEGOL:
        vout = 'eh'; break;

      case TSERE:
        if (chars[j] === 'י') { vout = 'ei'; j++; }
        else                   { vout = 'ei'; }
        break;

      case HIRIQ:
        if (chars[j] === 'י') { vout = 'ee'; j++; }
        else                   { vout = 'i'; }
        break;

      case HOLAM:
      case HOLAM_VAV:
        vout = 'oh'; break;

      case KUBUTZ:
      case 'shuruk':
        vout = 'oo'; break;

      case HATAF_PAT: vout = 'ah'; break;
      case HATAF_SEG: vout = 'eh'; break;
      case HATAF_KAM: vout = 'oh'; break;

      case SHVA:
        // Vocal shva conditions:
        //   1. Word-initial letter → always vocal
        //   2. Dagesh in the letter → vocal
        //   3. Next consonant is the same letter (doubled) → vocal
        //   4. Immediately follows another shva (second of two) → vocal
        // Everything else → silent (omit)
        // Note: meteg/trope rule cannot be applied here since taamim are stripped.
        vout = ((i === 0) || hasDagesh || (chars[j] === c) || prevVowelWasShva)
          ? 'ih' : '';
        break;

      default:
        vout = ''; break;
    }

    // ── Consecutive-vowel hyphen ───────────────────────────────────────────
    // When a silent or weak consonant (alef, ayin, he) carries a vowel sound
    // directly after a previous vowel sound, the two sounds collide in the
    // output. Insert a hyphen so the reader knows they are separate syllables.
    // "Weak" consonants here: '' (alef/silent), "'" (ayin mid-word), 'h' (he).
    if (vout && prevHadVowel && (cons === '' || cons === "'" || cons === 'h')) {
      out += '-';
    }

    out += cons + vout;
    prevHadVowel     = (vout !== '');
    prevVowelWasShva = (vowel === SHVA);
    i = j;
  }

  return out;
}

/**
 * Main function: transliterate Hebrew text (words separated by spaces).
 * Strips taamim, checks phrase overrides, then word-by-word.
 */
export function transliterateHebrew(hebrewText) {
  const clean = stripTaamim(hebrewText);

  const phraseOverride = OVERRIDES[clean.trim()];
  if (phraseOverride) return phraseOverride;

  return clean.split(/\s+/).map(word => {
    const w = word.trim();
    if (!w) return '';
    return transliterateWord(w);
  }).join(' ');
}

