const DAGESH   = "\u05BC";
const SHIN_DOT = "\u05C1";
const SIN_DOT  = "\u05C2";

const VOWEL = {
  "\u05B8": "uh",
  "\u05B7": "ah",
  "\u05B6": "eh",
  "\u05B5": "ei",
  "\u05B4": "i",
  "\u05B9": "o",
  "\u05BA": "o",
  "\u05BB": "oo",
  "\u05B0": null,
  "\u05B2": "ah",
  "\u05B1": "eh",
  "\u05B3": "oh",
};

const CONSONANT = {
  "\u05D0": "",
  "\u05D1": "b",
  "\u05D2": "g",
  "\u05D3": "d",
  "\u05D4": "h",
  "\u05D5": "v",
  "\u05D6": "z",
  "\u05D7": "ch",
  "\u05D8": "t",
  "\u05D9": "y",
  "\u05DA": "ch",
  "\u05DB": "k",
  "\u05DC": "l",
  "\u05DD": "m",
  "\u05DE": "m",
  "\u05DF": "n",
  "\u05E0": "n",
  "\u05E1": "s",
  "\u05E2": "",
  "\u05E3": "f",
  "\u05E4": "p",
  "\u05E5": "tz",
  "\u05E6": "tz",
  "\u05E7": "k",
  "\u05E8": "r",
  "\u05E9": "sh",
  "\u05EA": "s",
};

const VET_FORMS  = new Set(["\u05D1"]);
const KHAF_FORMS = new Set(["\u05DB", "\u05DA"]);
const FE_FORMS   = new Set(["\u05E4", "\u05E3"]);

const VOWELS_SET = new Set("aeiou");
function lastIsVowel(s) { return s.length > 0 && VOWELS_SET.has(s[s.length - 1]); }

export function transliterateHebrew(text) {
  const s = text.replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C4\u05C5\u05C6\u05C7]/g, "");
  let out = "";
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (!CONSONANT.hasOwnProperty(ch)) {
      if (ch === " " || ch.charCodeAt(0) < 0x0590) out += ch;
      i++;
      continue;
    }

    let j = i + 1;
    let hasDagesh  = false;
    let hasShinDot = false;
    let hasSinDot  = false;
    let vowelChar  = null;

    while (j < s.length) {
      const d = s[j];
      if (d === DAGESH)   { hasDagesh = true;  j++; continue; }
      if (d === SHIN_DOT) { hasShinDot = true; j++; continue; }
      if (d === SIN_DOT)  { hasSinDot  = true; j++; continue; }
      if (VOWEL.hasOwnProperty(d)) { vowelChar = d; j++; continue; }
      break;
    }

    // vav
    if (ch === "\u05D5") {
      if (hasDagesh && vowelChar === null) {
        if (lastIsVowel(out)) out += "'";
        out += "oo"; i = j; continue;
      }
      if (vowelChar === "\u05B9" || vowelChar === "\u05BA") {
        if (lastIsVowel(out)) out += "'";
        out += "o"; i = j; continue;
      }
    }

    // yod with no vowel
    if (ch === "\u05D9" && vowelChar === null) { i = j; continue; }

    let cons = CONSONANT[ch];

    if (ch === "\u05E9") cons = hasSinDot ? "s" : "sh";
    if (ch === "\u05EA") cons = hasDagesh ? "t" : "s";
    if (VET_FORMS.has(ch)  && !hasDagesh) cons = "v";
    if (KHAF_FORMS.has(ch) && !hasDagesh) cons = "ch";
    if (FE_FORMS.has(ch)   && !hasDagesh) cons = "f";

    out += cons;

    if (vowelChar === null) {
      // no vowel
    } else if (vowelChar === "\u05B0") {
      // shva: always silent
    } else if (vowelChar === "\u05B4") {
      // hiriq
      if (s[j] === "\u05D9") { if (lastIsVowel(out)) out += "'"; out += "ee"; j++; }
      else { if (lastIsVowel(out)) out += "'"; out += "i"; }
    } else if (vowelChar === "\u05B7") {
      // patach: before yod = "ai", otherwise "ah"
      if (s[j] === "\u05D9") { if (lastIsVowel(out)) out += "'"; out += "ai"; j++; }
      else { if (lastIsVowel(out)) out += "'"; out += "ah"; }
    } else {
      if (lastIsVowel(out)) out += "'";
      out += VOWEL[vowelChar] || "";
    }

    i = j;
  }

  return out.replace(/([aue])h([aeiou])/g, "$1$2").replace(/\s+/g, " ").trim();
}

export const TRANSLITERATION_SYSTEM_PROMPT = `You are a Talmudic text transliterator using the Litvish/Yeshivish Ashkenazic romanization system.

VOWEL RULES:
- Kamatz (ָ) → "uh"
- Patah (ַ) → "ah" (consistent; never reduces)
- Patah before ayin: ayin is silent; patah → "ah" as normal
- Segol (ֶ) → "eh"
- Tzere (ֵ) / tzere male (ֵי) → "ei" (alef after tzere does not change this)
- Hiriq short (ִ) → "i"; hiriq male (ִי) → "ee"
- Cholam (וֹ) → "o" (NOT "oi")
- Shuruk (וּ) / kubutz (ֻ) → "oo"
- Hataf-patah (ֲ) → "ah"
- Hataf-segol (ֱ) → "eh"
- Hataf-kamatz (ֳ) → "oh"
- Shva before a voweled consonant → "i" (vocal shva)
- Shva not before a voweled consonant → silent, omit

CONSONANT RULES:
- Alef (א) → silent, omit
- Ayin (ע) → always silent, omit
- Bet with dagesh (בּ) → "b"; dagesh chazak → double it "bb"
- Vet without dagesh (ב) → "v"
- Gimel (ג) → "g"
- Dalet (ד) → "d"
- He (ה) → "h" word-initial; silent word-final
- Vav (ו) as consonant → "v"; as shuruk → "oo"; as cholam male → "o"
- Zayin (ז) → "z"
- Het (ח) → "ch" (as in Bach)
- Tet (ט) → "t"
- Yod (י) as consonant → "y"; word-final → "ee"
- Kaf with dagesh (כּ) → "k"; khaf without → "ch"
- Lamed (ל) → "l"
- Mem (מ/ם) → "m"
- Nun (נ/ן) → "n"
- Samekh (ס) → "s"
- Pe with dagesh (פּ) → "p"; fe without → "f"
- Tsadi (צ/ץ) → "tz"
- Kuf (ק) → "k"
- Resh (ר) → "r"
- Shin (שׁ) → "sh"; Sin (שׂ) → "s"
- Tav WITH dagesh (תּ) → "t"
- Tav WITHOUT dagesh (ת) → "s"
- Dagesh chazak: double the consonant (e.g. רַבָּנָן → "rahbbuhnuhn")

SPECIAL ENDINGS:
- Word-final ָה (kamatz + he, feminine) → "uh"
- Word-final ָא (kamatz + alef, Aramaic) → "uh"
- Word-final ֶה (segol + he) → "eh"
- Word-final ִי (hiriq + yod) → "ee"

OUTPUT: Return ONLY the transliterated text, preserving word order and spacing. Lowercase throughout unless a proper noun. No explanation, no punctuation changes, no extra text.`;

export function transliterateSegment(heText) {
  return transliterateHebrew(heText);
}
