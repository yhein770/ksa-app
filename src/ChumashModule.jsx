import { useState, useEffect, useRef } from "react";
import { withCache, CacheKey } from "./sharedCache";
import { FlagButton } from "./FlagButton";
import { transliterateHebrew } from "./chumash_transliterate";
import TutorialOverlay, { CHUMASH_TUTORIAL } from "./TutorialOverlay";
import { ALL_WEAK_ROOTS, checkNeedsContext, stripPrefix, correctShoresh } from "./weakVerbRules";

// ── BETA GATE ─────────────────────────────────────────────────────────────────
export const CHUMASH_BETA_EMAILS = [];

// ── SEFARIM ───────────────────────────────────────────────────────────────────
const SEFARIM = [
  { name: "Bereishit", he: "בְּרֵאשִׁית", sefaria: "Genesis",     perakim: 50 },
  { name: "Shemot",    he: "שְׁמוֹת",      sefaria: "Exodus",      perakim: 40 },
  { name: "Vayikra",  he: "וַיִּקְרָא",   sefaria: "Leviticus",   perakim: 27 },
  { name: "Bamidbar", he: "בַּמִּדְבָּר",  sefaria: "Numbers",     perakim: 36 },
  { name: "Devarim",  he: "דְּבָרִים",    sefaria: "Deuteronomy", perakim: 34 },
];

// ── COLORS ────────────────────────────────────────────────────────────────────
const C = {
  bg:     "#F5F0EB",
  white:  "#FFFFFF",
  brown:  "#5C3317",
  gold:   "#B8860B",
  green:  "#34C759",
  red:    "#FF3B30",
  blue:   "#007AFF",
  muted:  "#8C7B6E",
  border: "rgba(0,0,0,.07)",
  label:  "#1C1412",
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.ws{cursor:pointer;border-radius:4px;padding:1px 3px;transition:background .12s;display:inline}
.ws:hover{background:rgba(180,130,60,.16)}
.ws.hit{background:rgba(0,122,255,.16) !important}
.seg-wrap{background:rgba(120,100,80,.1);border-radius:10px;padding:3px;display:flex;gap:2px;width:100%}
.tab{background:none;border:none;cursor:pointer;padding:7px 4px;font-family:inherit;font-size:13px;font-weight:500;transition:all .18s;color:#8C7B6E;flex:1;text-align:center;border-radius:8px;letter-spacing:-0.01em;white-space:nowrap}
.tab.on{background:white;color:#1C0A00;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.13),0 0.5px 1px rgba(0,0,0,.08)}
@keyframes kuf-pulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.08);opacity:0.8;}}
`;

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function stripNikud(s) {
  return s.replace(/[\u0591-\u05C7]/g, "").replace(/[^\u05D0-\u05EA\s]/g, "").trim();
}

function toHebrewNumeral(n) {
  const hundreds = ["","ק","ר","ש","ת","תק","תר","תש","תת","תתק"];
  const tens     = ["","י","כ","ל","מ","נ","ס","ע","פ","צ"];
  const ones     = ["","א","ב","ג","ד","ה","ו","ז","ח","ט"];
  if (n <= 0 || n > 999) return String(n);
  let result = hundreds[Math.floor(n/100)];
  const rem = n % 100;
  if (rem === 15) result += "טו";
  else if (rem === 16) result += "טז";
  else { result += tens[Math.floor(rem/10)] + ones[rem%10]; }
  return result;
}

// ── CALLCLAUDE ────────────────────────────────────────────────────────────────
async function callClaude(user, system, max = 400) {
  const r = await fetch("https://ksa-app-production.up.railway.app/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: max,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const d = await r.json();
  if (!d?.content?.[0]?.text) throw new Error("No content");
  return d.content[0].text;
}

// ── SEFARIA API ───────────────────────────────────────────────────────────────
async function loadPerek(seferSefaria, perekNum) {
  const cacheKey = `sefaria_chumash_v2_${seferSefaria}_${perekNum}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);
  const res = await fetch(
    `https://www.sefaria.org/api/texts/${seferSefaria}.${perekNum}?commentary=0&context=0&pad=0`
  );
  const data = await res.json();
  function cleanHe(s) {
    return s
      .replace(/<[^>]*>/g, "")
      .replace(/&thinsp;/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#[0-9]+;/g, "")
      .replace(/\{[פס]\}/g, "").replace(/\s+/g, " ").trim();
  }
  const pesukim = (data.he || []).map((he, i) => ({
    he: cleanHe(he),
    en: (data.text[i] || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
    num: i + 1,
  })).filter(p => p.he);
  const json = JSON.stringify(pesukim);
  localStorage.setItem(cacheKey, json);
  return pesukim;
}

async function loadRashiOnPasuk(seferSefaria, perekNum, pasukNum) {
  try {
    const res = await fetch(
      `https://www.sefaria.org/api/texts/Rashi_on_${seferSefaria}.${perekNum}.${pasukNum}?commentary=0&context=0&pad=0`
    );
    const data = await res.json();
    const entries = (data.he || []).map((s, i) => {
      if (!s?.trim()) return null;
      // Sefaria wraps dibbur hamatchil in <b>…</b>
      const boldMatch = s.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
      let dibbur = "";
      let bodyHtml = s;
      if (boldMatch) {
        dibbur = boldMatch[1].replace(/<[^>]*>/g, "").replace(/[.:,–—]\s*$/, "").trim();
        bodyHtml = s.replace(/<b[^>]*>[\s\S]*?<\/b>/i, "").trim();
      }
      const body = bodyHtml.replace(/<[^>]*>/g, "").trim();
      if (!body) return null;
      // Fallback: dash separator if no bold tag
      if (!dibbur) {
        const dashIdx = body.search(/\s[-–—]\s/);
        if (dashIdx > 0 && dashIdx < 80) {
          return { dibbur: body.slice(0, dashIdx).trim(), body: body.slice(dashIdx + 3).trim(), en: (data.text?.[i] || "").replace(/<[^>]*>/g, "").trim() };
        }
      }
      const en = (data.text?.[i] || "").replace(/<[^>]*>/g, "").trim();
      return { dibbur, body, en };
    }).filter(Boolean).filter(e => e.body);
    return entries;
  } catch {
    return [];
  }
}

// ── BTN ───────────────────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, bg, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "rgba(0,0,0,.08)" : (bg || C.brown),
      color: disabled ? C.muted : "#fff",
      border: "none", borderRadius: 12,
      padding: "12px 22px", fontFamily: "inherit", fontSize: 15, fontWeight: 600,
      cursor: disabled ? "default" : "pointer", transition: "opacity .15s", ...style,
    }}>
      {children}
    </button>
  );
}

// ── WORD POPUP ────────────────────────────────────────────────────────────────
function WordPopup({ word, pasuk, sefer, perek, pasukNum, onClose, onSave, student }) {
  const [translation, setTranslation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const cacheKey = `chumash_word_${sefer}_${perek}_${pasukNum}_${stripNikud(word)}`;

  useEffect(() => {
    if (!word) return;
    setLoading(true);
    withCache(cacheKey, () =>
      callClaude(
        `Hebrew text: ${pasuk.he}\nEnglish: ${pasuk.en}\nTapped word: ${word}\nGive the Artscroll-style word-for-word translation of ONLY this word. ו='and', ה='the', ל='to', מ='from', ב='in/with'. Reply with ONLY the translation, 1-5 words.`,
        "You give Artscroll-style word-for-word translations. Reply with ONLY the translation, nothing else.", 30
      )
    ).then(t => { setTranslation(t); setLoading(false); }).catch(() => setLoading(false));
  }, [word]);

  if (!word) return null;
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:200, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
      <div onClick={e => e.stopPropagation()} style={{ pointerEvents:"auto", background:C.white, borderRadius:"20px 20px 0 0", padding:"24px 20px 32px", width:"100%", maxWidth:500, boxShadow:"0 -8px 32px rgba(0,0,0,.12)" }}>
        <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:32, fontWeight:700, textAlign:"center", color:C.label, marginBottom:8 }}>{word}</div>
        <div style={{ textAlign:"center", fontSize:18, color:"#3A2A1E", fontWeight:500, minHeight:28 }}>
          {loading ? <span style={{ color:C.muted, fontSize:14 }}>Translating…</span> : translation}
        </div>
        {!loading && translation && (
          <div style={{ textAlign:"center", marginTop:6 }}>
            <FlagButton cacheKey={cacheKey} word={word} currentTranslation={translation}
              heContext={pasuk.he} enContext={pasuk.en} student={student} callClaude={callClaude}
              onFlagResolved={v => setTranslation(v)} />
          </div>
        )}
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <Btn onClick={onClose} bg="rgba(0,0,0,.08)" style={{ color:C.label, flex:1 }}>Close</Btn>
          <Btn onClick={() => { onSave(word, translation); setSaved(true); }} bg={saved ? C.green : C.gold} style={{ flex:1 }}>
            {saved ? "✓ Saved" : "Save to Vocab"}
          </Btn>
        </div>
      </div>
    </div>
  );
}


// ── MORPH CARD ────────────────────────────────────────────────────────────────
const ROLE_STYLE = {
  prefix:            { bg:"#E6F1FB", text:"#0C447C" },
  conjunction:       { bg:"#E6F1FB", text:"#0C447C" },
  "definite-article":{ bg:"#E6F1FB", text:"#0C447C" },
  conjugation:       { bg:"#E1F5EE", text:"#085041" },
  root:              { bg:"#FAEEDA", text:"#633806" },
  suffix:            { bg:"#EEEDFE", text:"#3C3489" },
};

function MorphCard({ word, pasuk, sefer, perek, pasukNum }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true); setError(false);
    const cacheKey = `chumash_morph_v4_${sefer}_${perek}_${pasukNum}_${stripNikud(word)}`;

    // Build weak-verb context string for the system prompt
    const weakRootLines = Object.entries(ALL_WEAK_ROOTS)
      .map(([root, info]) => `${root} (${info.gizra})`)
      .join(', ');

    // Check if this form is ambiguous — if so, skip post-call shoresh correction
    const needsCtx = checkNeedsContext(word);

    withCache(cacheKey, () =>
      callClaude(
        `Word: ${word} in context: ${pasuk.he}\nAnalyze this Biblical Hebrew word and return ONLY valid JSON:\n{"parts":[{"text":"וַ","role":"prefix","label":"and (consecutive)"},{"text":"יֹּ","role":"conjugation","label":"3rd person masc. singular"},{"text":"אמַר","role":"root","label":"root: to say"}],"translation":"and he said","person":"3rd person","gender":"male","number":"singular","tense":"past (vav consecutive)","binyan":"Kal","root":"א-מ-ר","root_meaning":"to say, to speak"}`,
        `You are a Biblical Hebrew morphology expert. Return ONLY valid JSON. Role must be one of: prefix, conjunction, definite-article, conjugation, root, suffix.\n\nCRITICAL RULES:\n1. Only mark ב/ל/מ/כ as a prefix if it is genuinely a prepositional prefix ATTACHED to a separate word. If ב/ל/מ/כ is the first letter of the root itself (e.g. בָּרָא root ב-ר-א, מָלַךְ root מ-ל-כ, לָמַד root ל-מ-ד), do NOT split it out.\n2. For prefix-conjugation (imperfect) verbs, the conjugation prefix (יִ/תִ/אֶ/נִ) is its own part. Example: וַיֹּאמֶר = 3 parts: וַ (conjunction), יֹּ (conjugation), אמֶר (root).\n3. If the word has NO prefixes or suffixes (bare root/noun), return exactly ONE part with role:'root'.\n4. Use full plain English labels — no abbreviations.\n5. WEAK VERB ROOTS — these roots undergo letter-dropping in conjugation. Always restore the full 3-letter root in the "root" field. Known weak roots: ${weakRootLines}. Example: וַיַּעַשׂ → root is עשה (ל"ה), NOT עש. וַיֵּשֶׁב → root is ישב (פ"י), NOT שב.`, 300
      )
    ).then(raw => {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no json");
      const parsed = JSON.parse(m[0]);
      // Post-call correction: if Claude returned a 2-letter root and this form isn't
      // flagged as ambiguous, try to expand it to a known ל"ה root
      if (!needsCtx && parsed.root) {
        const corrected = correctShoresh(parsed.root);
        if (corrected !== parsed.root) {
          parsed.root = corrected;
          // Update the root part label too if present
          if (parsed.parts) {
            const rootPart = parsed.parts.find(p => p.role === 'root');
            if (rootPart && parsed.root_meaning) {
              // root_meaning unchanged — correction only fixes the shoresh display
            }
          }
        }
      }
      setData(parsed); setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
  }, [word]);

  if (loading) return <div style={{ textAlign:"center", padding:24, color:C.muted, fontSize:14 }}>Analyzing…</div>;
  if (error || !data) return <div style={{ textAlign:"center", padding:24, color:C.muted, fontSize:14 }}>Could not analyze word.</div>;
  const simple = data.parts?.length === 1;
  return (
    <div style={{ background:C.white, borderRadius:16, padding:18, boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
      {!simple && (
        <div style={{ display:"flex", flexDirection:"row-reverse", gap:6, flexWrap:"wrap", marginBottom:16, justifyContent:"center" }}>
          {data.parts.map((p, i) => {
            const s = ROLE_STYLE[p.role] || ROLE_STYLE.root;
            return (
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                <div style={{ background:s.bg, color:s.text, borderRadius:8, padding:"6px 12px", fontFamily:"'Heebo',sans-serif", fontSize:20, fontWeight:700 }}>{p.text}</div>
                <div style={{ fontSize:10, color:s.text, fontWeight:600, textAlign:"center", maxWidth:70 }}>{p.label}</div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ textAlign:"center", fontSize:20, fontWeight:700, color:C.label, marginBottom:16 }}>{data.translation}</div>
      {!simple && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
          {[["Person",data.person],["Gender",data.gender],["Number",data.number],["Tense",data.tense]].map(([k,v]) => v ? (
            <div key={k} style={{ background:C.bg, borderRadius:10, padding:"8px 12px" }}>
              <div style={{ fontSize:10, color:C.muted, fontWeight:600, marginBottom:2 }}>{k.toUpperCase()}</div>
              <div style={{ fontSize:13, color:C.label, fontWeight:600 }}>{v}</div>
            </div>
          ) : null)}
        </div>
      )}
      {data.root && (
        <div style={{ background:"#FAEEDA", borderRadius:10, padding:"10px 14px", display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700, color:"#633806" }}>{data.root}</div>
          <div style={{ fontSize:13, color:"#633806", fontWeight:500 }}>{data.root_meaning}</div>
        </div>
      )}
    </div>
  );
}

// ── READ TAB ──────────────────────────────────────────────────────────────────
function ReadTab({ pasuk, sefer, perek, hasPrev, hasNext, onPrev, onNext, onSaveWord, student }) {
  const [popup, setPopup] = useState(null);
  const [selectionPopup, setSelectionPopup] = useState(null);
  const [showTranslit, setShowTranslit] = useState(false);
  const [translit, setTranslit] = useState(null);
  const tapTimer = useRef(null);
  const tapCount = useRef(0);

  useEffect(() => {
    let timer;
    function onSelectionChange() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || !text.includes(" ") || !/[\u05D0-\u05EA]/.test(text)) { setSelectionPopup(null); return; }
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (!rect.width && !rect.height) return;
          setSelectionPopup({ he: text, x: rect.left + rect.width / 2, y: rect.top - 12, loading: true, en: null });
          const cacheKey = `chumash_phrase_${sefer.id}_${perek}_${pasuk.num}_${stripNikud(text).slice(0, 20)}`;
          withCache(cacheKey, () =>
            callClaude(
              `Hebrew text: ${pasuk.he}\nEnglish: ${pasuk.en}\nHighlighted phrase: ${text}\nFind the corresponding portion of the English translation above. Reply with ONLY that portion, nothing else.`,
              "You are extracting a phrase from an existing translation. Reply only with the matching portion.", 60
            )
          ).then(en => setSelectionPopup(p => p?.he === text ? { ...p, en: en.trim(), loading: false } : p))
           .catch(() => setSelectionPopup(null));
        } catch(e) { setSelectionPopup(null); }
      }, 400);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => { document.removeEventListener("selectionchange", onSelectionChange); clearTimeout(timer); };
  }, [pasuk]);

  useEffect(() => {
    if (!showTranslit) return;
    setTranslit(null);
    const key = CacheKey.chumashTranslit(sefer.sefaria, perek, pasuk.num);
    withCache(key, () => Promise.resolve(transliterateHebrew(pasuk.he)))
      .then(t => setTranslit(t));
  }, [showTranslit, pasuk]);

  function handleWordTap(word) {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      if (tapCount.current >= 2) onSaveWord(word, null);
      else setPopup(word);
      tapCount.current = 0;
    }, 280);
  }

  if (!pasuk) return null;
  const words = pasuk.he.split(/\s+/).filter(Boolean);
  return (
    <div onClick={() => { if (!window.getSelection()?.toString().trim()) setSelectionPopup(null); }}>
      <div style={{ background:C.white, borderRadius:16, padding:"24px 18px", marginBottom:14, boxShadow:"0 1px 4px rgba(0,0,0,.05)", position:"relative" }}>
        {selectionPopup && (
          <div style={{ position:"fixed", left: Math.min(selectionPopup.x, window.innerWidth - 200), top: selectionPopup.y - 60, transform:"translateX(-50%)", background:"#1C1C1E", color:"white", borderRadius:12, padding:"8px 14px", fontSize:13, maxWidth:280, zIndex:9999, pointerEvents:"none", boxShadow:"0 4px 16px rgba(0,0,0,.3)" }}>
            {selectionPopup.loading ? "Translating…" : selectionPopup.en}
          </div>
        )}
        <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:20, lineHeight:2.6, textAlign:"right", margin:0, color:C.label }}>
          <sup style={{ fontSize:13, color:C.muted, marginLeft:6 }}>{toHebrewNumeral(pasuk.num)}</sup>{" "}
          {words.map((w, i) => (
            <span key={i} className={`ws${popup && stripNikud(popup) === stripNikud(w) ? " hit" : ""}`} onClick={() => handleWordTap(w)}>
              {w}{" "}
            </span>
          ))}
        </p>
      </div>
      <div style={{ background:"rgba(184,134,11,.06)", border:"1px solid rgba(184,134,11,.15)", borderRadius:12, padding:"11px 16px", fontSize:13, color:"#6B4E1A", fontWeight:500, marginBottom:16 }}>
        Tap word to translate · Double-tap to save · Highlight to translate a phrase
      </div>
      <button onClick={() => setShowTranslit(t => !t)} style={{ width:"100%", marginBottom:12, padding:"11px", background: showTranslit ? "rgba(184,134,11,.1)" : "none", border:`1px solid ${showTranslit ? "rgba(184,134,11,.4)" : C.border}`, borderRadius:12, fontFamily:"inherit", fontSize:14, cursor:"pointer", color: showTranslit ? "#6B4E1A" : C.muted }}>
        {showTranslit ? "Hide transliteration" : "Show transliteration"}
      </button>
      {showTranslit && (
        <div style={{ marginBottom:12, padding:"12px 16px", background:"#FAF7F4", borderRadius:10, fontSize:15, color:C.label, lineHeight:2, fontFamily:"serif", letterSpacing:"0.02em", borderLeft:"3px solid rgba(184,134,11,.4)" }}>
          {translit ?? <span style={{ color:C.muted, fontSize:13 }}>Loading…</span>}
        </div>
      )}
      <div style={{ display:"flex", gap:10 }}>
        <Btn onClick={onPrev} disabled={!hasPrev} style={{ flex:1 }}>‹ Prev</Btn>
        <Btn onClick={onNext} disabled={!hasNext} style={{ flex:1 }}>Next ›</Btn>
      </div>
      {popup && (
        <WordPopup word={popup} pasuk={pasuk} sefer={sefer.sefaria} perek={perek} pasukNum={pasuk.num}
          onClose={() => setPopup(null)}
          onSave={(w, t) => { onSaveWord(w, t); setPopup(null); }}
          student={student} />
      )}
    </div>
  );
}

// ── VOCAB TAB ─────────────────────────────────────────────────────────────────
function VocabTab({ pasuk, sefer, perek, savedWords, onVocabDone }) {
  const cards = Object.entries(savedWords || {}).map(([he, val]) => ({
    he,
    en: typeof val === "object" ? val.en : val,
  }));

  const [knownSet, setKnownSet] = useState(new Set());
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [fetchedEn, setFetchedEn] = useState({});
  const [quizMode, setQuizMode] = useState(false);
  const [quizCardIdx, setQuizCardIdx] = useState(0);
  const [quizInput, setQuizInput] = useState("");
  const [quizResult, setQuizResult] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);

  const remaining = cards.filter(c => !knownSet.has(c.he));
  const card = remaining[cardIdx % Math.max(remaining.length, 1)];
  const enToShow = card?.en || fetchedEn[card?.he];

  // Auto-fetch translation if null when card is flipped
  useEffect(() => {
    if (!flipped || !card || card.en || fetchedEn[card.he]) return;
    const cacheKey = `chumash_word_${sefer.sefaria}_${perek}_${pasuk.num}_${stripNikud(card.he)}`;
    withCache(cacheKey, () =>
      callClaude(
        `Hebrew text: ${pasuk.he}\nEnglish: ${pasuk.en}\nTapped word: ${card.he}\nGive the Artscroll-style word-for-word translation of ONLY this word. ו='and', ה='the', ל='to', מ='from', ב='in/with'. Reply with ONLY the translation, 1-5 words.`,
        "You give Artscroll-style word-for-word translations. Reply with ONLY the translation, nothing else.", 30
      )
    ).then(t => setFetchedEn(p => ({ ...p, [card.he]: t }))).catch(() => {});
  }, [flipped, card?.he]);

  if (!cards.length) return (
    <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📖</div>
      <div style={{ fontSize:15, fontWeight:500 }}>Double-tap any word in the Read tab to save it here.</div>
    </div>
  );

  // ── Quiz mode ──
  if (quizMode) {
    const quizCard = cards[quizCardIdx];
    const correctEn = quizCard?.en || fetchedEn[quizCard?.he] || "";
    const isLast = quizCardIdx === cards.length - 1;
    async function submitQuiz() {
      if (quizLoading || !quizInput.trim()) return;
      setQuizLoading(true);
      const result = await callClaude(
        `Hebrew word: ${quizCard.he}\nCorrect translation: ${correctEn}\nStudent answer: ${quizInput}\nReply with exactly one word: CORRECT, CLOSE, or WRONG.`,
        "You judge Hebrew vocabulary quiz answers. Be lenient with minor spelling differences. Reply with ONLY one word: CORRECT, CLOSE, or WRONG.", 10
      ).catch(() => "WRONG");
      setQuizResult(result.trim().toUpperCase().split(/[\s,.:!?]/)[0]);
      setQuizLoading(false);
    }
    const verdict = quizResult?.startsWith("CORRECT") ? "correct" : quizResult?.startsWith("CLOSE") ? "close" : quizResult ? "wrong" : null;
    function goNext() {
      setQuizResult(null); setQuizInput("");
      if (!isLast) setQuizCardIdx(i => i + 1);
      else { setQuizMode(false); setQuizCardIdx(0); onVocabDone?.(); }
    }
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <button onClick={() => { setQuizMode(false); setQuizResult(null); setQuizInput(""); setQuizCardIdx(0); }}
            style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.muted, fontFamily:"inherit" }}>‹ Exit quiz</button>
          <div style={{ fontSize:13, color:C.muted }}>{quizCardIdx + 1} / {cards.length}</div>
        </div>
        <div style={{ background:C.white, borderRadius:20, padding:"36px 24px 24px", marginBottom:16, textAlign:"center", boxShadow:"0 2px 8px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:36, fontWeight:700, color:C.label, marginBottom:8 }}>{quizCard?.he}</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:20 }}>Type the English translation</div>
          <input value={quizInput} onChange={e => !verdict && setQuizInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { if (verdict) goNext(); else submitQuiz(); } }}
            placeholder="Translation…" autoFocus
            style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"10px 14px", fontSize:16, fontFamily:"inherit", outline:"none", marginBottom:12, background: verdict ? "rgba(0,0,0,.02)" : C.white }} />
          {verdict && (
            <div style={{ padding:"14px 16px", borderRadius:10, fontSize:18, fontWeight:700,
              background: verdict==="correct"?"rgba(52,199,89,.1)":verdict==="close"?"rgba(184,134,11,.1)":"rgba(255,59,48,.1)",
              color: verdict==="correct"?C.green:verdict==="close"?C.gold:C.red, marginBottom:12 }}>
              {verdict === "correct" ? "✓ Correct" : verdict === "close" ? "∼ Close" : "✗ Incorrect"}
              {verdict === "wrong" && correctEn && (
                <div style={{ fontSize:13, fontWeight:500, marginTop:6, color:C.label }}>Answer: {correctEn}</div>
              )}
            </div>
          )}
          {!verdict && <Btn onClick={submitQuiz} disabled={!quizInput.trim() || quizLoading}>{quizLoading ? "Checking…" : "Submit"}</Btn>}
          {verdict && <Btn onClick={goNext}>{isLast ? "Done ✓" : "Next →"}</Btn>}
        </div>
      </div>
    );
  }

  // ── All reviewed ──
  if (remaining.length === 0) return (
    <div style={{ textAlign:"center", padding:"50px 20px" }}>
      <div style={{ width:64, height:64, background:"rgba(52,199,89,.12)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <p style={{ fontSize:20, fontWeight:600, marginBottom:6, color:C.label }}>All cards reviewed!</p>
      <p style={{ color:C.muted, marginBottom:24, fontSize:15 }}>Now test yourself with the vocab quiz.</p>
      <Btn bg={C.green} onClick={() => { setQuizCardIdx(0); setQuizMode(true); }}>Start Vocab Quiz</Btn>
    </div>
  );

  // ── Breakdown view ──
  if (showBreakdown && flipped) return (
    <div>
      <button onClick={() => setShowBreakdown(false)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.brown, fontFamily:"inherit", fontWeight:500, marginBottom:16, padding:0 }}>‹ Back to translation</button>
      <MorphCard word={card.he} pasuk={pasuk} sefer={sefer.sefaria} perek={perek} pasukNum={pasuk.num} />
    </div>
  );

  // ── Flashcards ──
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:12, color:C.muted, fontWeight:500, letterSpacing:"0.02em", textTransform:"uppercase" }}>Vocab · Pasuk {pasuk.num}</span>
        <span style={{ fontSize:12, color:C.muted }}>{knownSet.size}/{cards.length} · {remaining.length} left</span>
      </div>
      <div style={{ height:3, background:"rgba(0,0,0,.06)", borderRadius:980, marginBottom:18, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(knownSet.size/cards.length)*100}%`, background:C.green, borderRadius:980, transition:"width .4s" }}/>
      </div>
      <div onClick={() => { setFlipped(f => !f); setShowBreakdown(false); }}
        style={{ cursor:"pointer", background:"white", borderRadius:20, padding:"36px 24px 24px", minHeight:200, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04)", marginBottom:16, userSelect:"none", position:"relative" }}>
        <span style={{ position:"absolute", top:14, right:18, fontSize:11, color:C.muted, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:500 }}>{flipped ? "English" : "Hebrew"}</span>
        {!flipped ? (
          <div style={{ textAlign:"center" }}>
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:40, fontWeight:700, color:C.label, marginBottom:12 }}>{card.he}</div>
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:14, color:C.muted, lineHeight:2 }}>
              {pasuk?.he.split(/\s+/).map((w, i) => {
                const match = stripNikud(w) === stripNikud(card.he);
                return <span key={i} style={match ? { color:C.brown, fontWeight:700 } : {}}>{w} </span>;
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:22, color:"#3A2A1E", lineHeight:1.55, marginBottom:16 }}>
              {enToShow || <span style={{ color:C.muted, fontSize:14 }}>Loading…</span>}
            </div>
            <button onClick={e => { e.stopPropagation(); setShowBreakdown(true); }}
              style={{ background:"rgba(92,51,23,.08)", color:C.brown, border:"none", borderRadius:980, padding:"6px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 }}>
              View Breakdown
            </button>
          </div>
        )}
      </div>
      {flipped ? (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <button className="opt" style={{ textAlign:"center", color:C.red, borderColor:"rgba(255,59,48,.25)", background:"rgba(255,59,48,.04)" }}
            onClick={() => { setFlipped(false); setCardIdx(i => (i+1) % remaining.length); }}>Study Again</button>
          <Btn bg={C.green} style={{ width:"100%" }}
            onClick={() => { setKnownSet(s => new Set([...s, card.he])); setFlipped(false); }}>Got It</Btn>
        </div>
      ) : (
        <>
          <p style={{ textAlign:"center", fontSize:13, color:C.muted }}>Tap card to reveal · Enter to flip</p>
          <button onClick={() => { setQuizCardIdx(0); setQuizMode(true); }}
            style={{ display:"block", margin:"12px auto 0", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, color:C.muted, textDecoration:"underline" }}>Skip to Quiz</button>
        </>
      )}
    </div>
  );
}

// ── RASHI TAB ─────────────────────────────────────────────────────────────────
function RashiTab({ pasuk, rashiEntries, sefer, perek }) {
  const [questionGuess, setQuestionGuess] = useState({});
  const [chatOpen, setChatOpen] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatDone, setChatDone] = useState({});
  const [showEnglish, setShowEnglish] = useState({});
  const [rashiInfo, setRashiInfo] = useState({});
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior:"smooth" });
  }, [chatMessages]);

  useEffect(() => {
    rashiEntries.forEach((entry, idx) => {
      const key = `rashi_info/${sefer.id}/${perek}/${pasuk.num}/${idx}`;
      withCache(key, () =>
        callClaude(
          `Rashi on ${sefer.name} ${perek}:${pasuk.num}
Dibbur hamatchil: ${entry.dibbur}
Rashi text: ${entry.body}

Classify this Rashi comment. Reply with ONLY a JSON object, no markdown:
{"type": "<one of: Vocabulary|Grammar|Narrative|Contradiction|Reference|Theological|Logic>", "difficulty": "<Easy|Medium|Hard>", "summary": "<one sentence: what question Rashi is answering>"}`,
          "You are a Rashi expert. Reply with ONLY valid JSON, no markdown.", 120
        ).then(raw => {
          try { return JSON.stringify(JSON.parse(raw.replace(/```json|```/g, "").trim())); }
          catch { return null; }
        })
      ).then(cached => {
        if (!cached) return;
        try {
          const info = typeof cached === "string" ? JSON.parse(cached) : cached;
          setRashiInfo(r => ({ ...r, [idx]: info }));
        } catch {}
      });
    });
  }, [rashiEntries, sefer, perek, pasuk.num]);

  async function startChavruta(idx, entry) {
    const guess = questionGuess[idx] || "";
    setChatOpen(idx); setChatLoading(true);
    const raw = await callClaude(
      `You are doing chavruta learning with a student on this Rashi.
Pasuk (${sefer.name} ${perek}:${pasuk.num}): ${pasuk.he}
English: ${pasuk.en}
Rashi dibbur hamatchil: ${entry.dibbur}
Rashi text: ${entry.body}
Student's question guess: "${guess}"

Respond to their guess — affirm what's right, gently correct what's off. Ask ONE focused follow-up question to deepen understanding. 2-3 sentences. Do NOT append [DONE] yet.`,
      "You are a Rashi chavruta guide. Keep responses to 2-3 sentences. Append [DONE] ONLY when the student has clearly articulated both Rashi's question AND answer.", 160
    ).catch(() => "Let's explore this Rashi together. What in the pasuk do you think prompted Rashi to comment?");
    const text = raw.replace(/\[DONE\]/g, "").trim();
    setChatMessages(m => ({ ...m, [idx]: [{ role:"assistant", text }] }));
    if (raw.includes("[DONE]")) setChatDone(d => ({ ...d, [idx]: true }));
    setChatLoading(false);
  }

  async function sendChavruta(idx, entry) {
    if (!chatInput.trim() || chatLoading) return;
    const prev = chatMessages[idx] || [];
    const updated = [...prev, { role:"user", text: chatInput }];
    setChatMessages(m => ({ ...m, [idx]: updated }));
    setChatInput(""); setChatLoading(true);
    const history = updated.map(m => `${m.role==="user"?"Student":"Chavruta"}: ${m.text}`).join("\n");
    const raw = await callClaude(
      `Rashi — Pasuk (${sefer.name} ${perek}:${pasuk.num}): ${pasuk.he}
English: ${pasuk.en}
Rashi dibbur hamatchil: ${entry.dibbur}
Rashi text: ${entry.body}

Conversation:
${history}

Continue guiding. 2 sentences max. When the student has clearly articulated both Rashi's question AND answer, close warmly and append [DONE] at the very end.`,
      "You are a Rashi chavruta guide. 2 sentences max. Append [DONE] at the end ONLY when student fully understands both Rashi's question and answer.", 160
    ).catch(() => "Keep thinking — what is Rashi explaining here?");
    const text = raw.replace(/\[DONE\]/g, "").trim();
    setChatMessages(m => ({ ...m, [idx]: [...updated, { role:"assistant", text }] }));
    if (raw.includes("[DONE]")) setChatDone(d => ({ ...d, [idx]: true }));
    setChatLoading(false);
  }

  return (
    <div>
      {rashiEntries.map((entry, idx) => (
        <div key={idx} style={{ background:C.white, borderRadius:16, padding:"18px 16px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>

          {/* Dibbur hamatchil — always big bold brown */}
          {entry.dibbur && (
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:24, fontWeight:900, color:C.brown, marginBottom:8, textAlign:"right", lineHeight:1.4 }}>
              {entry.dibbur}
            </div>
          )}


          {/* Hebrew body */}
          <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:16, lineHeight:2.1, color:C.label, marginBottom:12, textAlign:"right" }}>{entry.body}</p>

          {/* English from Sefaria — on demand */}
          {entry.en && (
            showEnglish[idx] ? (
              <div style={{ background:"rgba(0,122,255,.06)", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:14, color:C.label, lineHeight:1.7 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                  <span style={{ fontWeight:600, color:C.blue, fontSize:10, letterSpacing:"0.08em" }}>ENGLISH</span>
                  <button onClick={() => setShowEnglish(s => ({ ...s, [idx]: false }))} style={{ background:"none", border:"none", fontSize:12, color:C.muted, cursor:"pointer", padding:0 }}>Hide</button>
                </div>
                {entry.en}
              </div>
            ) : (
              <button
                onClick={() => setShowEnglish(s => ({ ...s, [idx]: true }))}
                style={{ background:"none", border:"1px solid rgba(0,122,255,.25)", borderRadius:8, padding:"4px 12px", fontSize:12, color:C.blue, cursor:"pointer", marginBottom:16, fontFamily:"inherit" }}
              >
                Show English
              </button>
            )
          )}

          {/* Question input — required gate before chavruta */}
          {!chatOpen && !chatDone[idx] && (
            <div style={{ background:"rgba(184,134,11,.06)", border:"1px solid rgba(184,134,11,.18)", borderRadius:12, padding:"14px 16px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.gold, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Before Chavruta</div>
              <div style={{ fontSize:13, color:C.label, marginBottom:10 }}>What do you think is Rashi's question here?</div>
              <textarea value={questionGuess[idx] || ""}
                onChange={e => setQuestionGuess(g => ({ ...g, [idx]: e.target.value }))}
                placeholder="What bothered Rashi about this pasuk?" rows={2}
                style={{ width:"100%", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"10px 12px", fontSize:14, fontFamily:"inherit", resize:"vertical", outline:"none", marginBottom:10 }} />
              <Btn onClick={() => startChavruta(idx, entry)}
                disabled={!questionGuess[idx]?.trim() || (chatLoading && chatOpen === idx)}
                bg={C.blue} style={{ padding:"9px 20px", fontSize:13 }}>
                {chatLoading && chatOpen === idx ? "Starting…" : "Start Rashi Chavruta →"}
              </Btn>
            </div>
          )}

          {/* Active chavruta */}
          {chatOpen === idx && !chatDone[idx] && (
            <div style={{ background:C.bg, borderRadius:14, padding:14 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.label, marginBottom:10 }}>Rashi Chavruta</div>
              <div ref={scrollRef} style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:8, marginBottom:10 }}>
                {(chatMessages[idx] || []).map((msg, mi) => (
                  <div key={mi} style={{ alignSelf: msg.role==="user"?"flex-end":"flex-start", maxWidth:"85%",
                    background: msg.role==="user"?C.brown:C.white, color: msg.role==="user"?"#fff":C.label,
                    borderRadius:12, padding:"9px 13px", fontSize:14, lineHeight:1.6 }}>
                    {msg.text}
                  </div>
                ))}
                {chatLoading && <div style={{ alignSelf:"flex-start", color:C.muted, fontSize:13 }}>…</div>}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && sendChavruta(idx, entry)}
                  placeholder="Respond…"
                  style={{ flex:1, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"9px 12px", fontSize:14, fontFamily:"inherit", outline:"none" }} />
                <Btn onClick={() => sendChavruta(idx, entry)} disabled={!chatInput.trim() || chatLoading} style={{ padding:"9px 16px", fontSize:13 }}>Send</Btn>
              </div>
            </div>
          )}

          {/* Chavruta complete */}
          {chatDone[idx] && (
            <div style={{ background:"rgba(52,199,89,.08)", border:"1.5px solid rgba(52,199,89,.25)", borderRadius:12, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
              <span style={{ fontSize:22 }}>✓</span>
              <div>
                <div style={{ fontWeight:700, color:"#1A7A3A", fontSize:15 }}>Rashi Mastered</div>
                <div style={{ fontSize:13, color:"#2D9A4E", marginTop:2 }}>You've demonstrated understanding of this Rashi.</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── GROUP QUIZ ────────────────────────────────────────────────────────────────
function GroupQuiz({ pesukim, sefer, perek, onPass }) {
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState({});
  const [replacements, setReplacements] = useState({});
  const [repAnswers, setRepAnswers] = useState({});
  const [repSubmitted, setRepSubmitted] = useState({});
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const pasukList = pesukim.map(p => `Pasuk ${p.num}: ${p.he}\nTranslation: ${p.en}`).join("\n\n");
      const raw = await callClaude(
        `Generate a quiz on ${sefer.name} ${perek} pesukim ${pesukim[0].num}–${pesukim[pesukim.length-1].num}.\n\nPesukim:\n${pasukList}\n\nCreate 4 multiple choice questions testing real understanding. Keep explanations SHORT (under 15 words, English only, no Hebrew/transliteration). Return ONLY a valid JSON array:\n[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}]`,
        "You generate multiple choice quizzes on Chumash pesukim. Return ONLY a valid JSON array. No markdown, no extra text. Keep explanations under 15 words.", 900
      ).catch(() => "[]");
      let parsed = [];
      try {
        const cleaned = raw.replace(/```json|```/g, "").trim();
        const start = cleaned.indexOf("[");
        const end = cleaned.lastIndexOf("]");
        if (start !== -1 && end !== -1) parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch(e) { console.warn("Quiz JSON parse failed:", e, raw); }
      // Strip A./B./C./D. prefixes, shuffle, re-label
      const labels = ["A", "B", "C", "D"];
      parsed = parsed.map(q => {
        const stripped = q.options.map(o => o.replace(/^[A-D]\.\s*/, ""));
        const correctText = stripped[q.answer];
        const shuffled = [...stripped].sort(() => Math.random() - 0.5);
        const relabeled = shuffled.map((o, i) => `${labels[i]}. ${o}`);
        return { ...q, options: relabeled, answer: shuffled.indexOf(correctText) };
      });
      setQuestions(parsed);
      setLoading(false);
    })();
  }, []);

  async function submit() {
    if (!questions) return;
    const res = {};
    questions.forEach((q, qi) => { res[qi] = answers[qi] === q.answer; });
    setResults(res); setSubmitted(true);
    const wrong = Object.entries(res).filter(([,v]) => !v).map(([k]) => parseInt(k));
    if (!wrong.length) { setPassed(true); onPass(); return; }
    const reps = {};
    await Promise.all(wrong.map(async qi => {
      const q = questions[qi];
      const raw = await callClaude(
        `A student got this question wrong: "${q.question}"\nGenerate ONE new different question on the same concept. Return ONLY valid JSON: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}`,
        "Generate a replacement quiz question. Return ONLY valid JSON.", 200
      ).catch(() => null);
      if (raw) { const m = raw.match(/\{[\s\S]*\}/); if (m) reps[qi] = JSON.parse(m[0]); }
    }));
    setReplacements(reps);
  }

  function submitReplacement(qi) {
    const q = replacements[qi];
    if (!q) return;
    const correct = repAnswers[qi] === q.answer;
    const next = { ...repSubmitted, [qi]: correct };
    setRepSubmitted(next);
    if (Object.keys(replacements).every(k => next[k])) { setPassed(true); onPass(); }
  }

  if (loading) return (
    <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}>
      <div style={{ width:48, height:48, animation:"kuf-pulse 1.4s ease-in-out infinite", margin:"0 auto 16px" }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
          <rect width="100" height="100" rx="20" fill="#5C3317"/>
          <path d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="rgba(255,255,255,.85)"/>
          <path d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="rgba(255,255,255,.85)"/>
        </svg>
      </div>
      <div style={{ fontSize:15 }}>Generating quiz…</div>
    </div>
  );
  if (!questions?.length) return <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>Could not generate quiz.</div>;

  if (passed) return (
    <div style={{ background:"rgba(52,199,89,.1)", border:"1.5px solid rgba(52,199,89,.3)", borderRadius:16, padding:"24px 20px", textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:8 }}>✓</div>
      <div style={{ fontWeight:700, fontSize:18, color:"#1A7A3A" }}>Group Mastered!</div>
      <div style={{ fontSize:14, color:"#2D9A4E", marginTop:4 }}>Pesukim {pesukim[0].num}–{pesukim[pesukim.length-1].num} complete</div>
    </div>
  );

  return (
    <div>
      {questions.map((q, qi) => {
        const isWrong = submitted && results[qi] === false;
        const isCorrect = submitted && results[qi] === true;
        const rep = replacements[qi];
        return (
          <div key={qi} style={{ background:C.white, borderRadius:14, padding:"16px 16px", marginBottom:14, boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ fontWeight:600, fontSize:15, color:C.label, marginBottom:12 }}>{q.question}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {q.options.map((opt, oi) => {
                let bg = C.bg, color = C.label;
                if (submitted) {
                  if (oi === q.answer) { bg = "rgba(52,199,89,.15)"; color = C.green; }
                  else if (oi === answers[qi] && answers[qi] !== q.answer) { bg = "rgba(255,59,48,.1)"; color = C.red; }
                }
                return (
                  <button key={oi} onClick={() => !submitted && setAnswers(a => ({ ...a, [qi]: oi }))}
                    style={{ background: answers[qi]===oi&&!submitted?"rgba(92,51,23,.1)":bg, border:`1.5px solid ${answers[qi]===oi&&!submitted?C.brown:C.border}`, borderRadius:10, padding:"10px 14px", textAlign:"left", cursor:submitted?"default":"pointer", fontFamily:"inherit", fontSize:14, color, transition:"all .1s" }}>
                    {opt}
                  </button>
                );
              })}
            </div>
            {isCorrect && <div style={{ fontSize:13, color:C.green, marginTop:8, fontWeight:500 }}>✓ {q.explanation}</div>}
            {isWrong && !rep && <div style={{ fontSize:13, color:C.muted, marginTop:8 }}>Generating replacement question…</div>}
            {isWrong && rep && !repSubmitted[qi] && (
              <div style={{ marginTop:14, background:C.bg, borderRadius:12, padding:14 }}>
                <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>Try this replacement question:</div>
                <div style={{ fontWeight:600, fontSize:14, color:C.label, marginBottom:10 }}>{rep.question}</div>
                {rep.options.map((opt, oi) => (
                  <button key={oi} onClick={() => setRepAnswers(a => ({ ...a, [qi]: oi }))}
                    style={{ display:"block", width:"100%", background:repAnswers[qi]===oi?"rgba(92,51,23,.1)":C.white, border:`1.5px solid ${repAnswers[qi]===oi?C.brown:C.border}`, borderRadius:10, padding:"9px 12px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", fontSize:13, color:C.label, marginBottom:6 }}>
                    {opt}
                  </button>
                ))}
                <Btn onClick={() => submitReplacement(qi)} disabled={repAnswers[qi] === undefined} style={{ marginTop:8, padding:"9px 18px", fontSize:13 }}>Submit</Btn>
              </div>
            )}
            {repSubmitted[qi] && <div style={{ fontSize:13, color:C.green, marginTop:8, fontWeight:500 }}>✓ {rep?.explanation}</div>}
          </div>
        );
      })}
      {!submitted && (
        <Btn onClick={submit} disabled={Object.keys(answers).length < questions.length} style={{ width:"100%" }}>Submit Quiz</Btn>
      )}
    </div>
  );
}

// ── PASUK STUDY ───────────────────────────────────────────────────────────────
function PasukStudy({ sefer, perek, pasuk, pesukim, progress, vocab, rashiEntries, hasRashi, onBack, onProgressUpdate, onVocabSave, onVocabDone, onQuizPass, groupIdx, groupPesukim, groupPassed, onNavigate, student, initialTab, backLabel, onGoToSefer, onGoToHome, onGoToChumash }) {
  const [tab, setTab] = useState(initialTab || "read");
  const key = `${sefer.name}_${perek}_${pasuk.num}`;
  const p = progress[key] || {};

  function openTab(t) {
    setTab(t);
    if (t === "read"  && !p.read)  onProgressUpdate(key, { read: true });
    if (t === "vocab" && !p.vocab) onProgressUpdate(key, { vocab: true });
    if (t === "rashi" && !p.rashi && hasRashi) onProgressUpdate(key, { rashi: true });
  }

  useEffect(() => {
    const t = setTimeout(() => { if (!p.read) onProgressUpdate(key, { read: true }); }, 3000);
    return () => clearTimeout(t);
  }, [key]);

  const pasukIdx = pesukim.findIndex(pp => pp.num === pasuk.num);
  const groupReady = groupPesukim.every(gp => (progress[`${sefer.name}_${perek}_${gp.num}`] || {}).read);
  const quizLabel = `Quiz ${groupPesukim[0]?.num}–${groupPesukim[groupPesukim.length-1]?.num}`;

  const vocabCount = Object.keys(vocab[key] || {}).length;
  const tabs = [
    { id:"read",  label:"Read" },
    { id:"vocab", label:"Vocab", badge: vocabCount || null },
    { id:"rashi", label:"Rashi",    muted:!hasRashi,   title:"No Rashi on this pasuk" },
    { id:"kriah", label:"Kriah",    muted:true,         title:"Coming Soon" },
    { id:"quiz",  label:quizLabel,  hidden:true },
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>
        {/* Breadcrumb nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16, flexWrap:"wrap", background:"rgba(184,134,11,.08)", borderRadius:10, padding:"8px 14px" }}>
          {onGoToHome && <button onClick={onGoToHome} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>{backLabel ? "Assignment" : "Subjects"}</button>}
          {onGoToHome && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          {onGoToChumash && <button onClick={onGoToChumash} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>Chumash</button>}
          {onGoToChumash && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          {onGoToSefer && <button onClick={onGoToSefer} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>{sefer.name}</button>}
          {onGoToSefer && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>
            {backLabel ? backLabel.replace("← ","") : `Perek ${perek}`}
          </button>
          <span style={{ fontSize:15, color:C.brown }}>›</span>
          <span style={{ fontSize:15, color:C.label, fontWeight:700 }}>Pasuk {pasuk.num}</span>
          <div style={{ flex:1 }} />
          {p.read && <span style={{ fontSize:11, background:"rgba(52,199,89,.12)", color:C.green, borderRadius:20, padding:"2px 8px", fontWeight:600 }}>Read</span>}
          {groupPassed && <span style={{ fontSize:11, background:"rgba(52,199,89,.12)", color:C.green, borderRadius:20, padding:"2px 8px", fontWeight:600 }}>✓ Mastered</span>}
        </div>

        <div className="seg-wrap" style={{ marginBottom:20 }}>
          {tabs.filter(t => !t.hidden).map(t => (
            <button key={t.id} className={`tab${tab===t.id?" on":""}`}
              onClick={() => !t.muted && openTab(t.id)}
              title={t.muted ? t.title : undefined}
              style={{ opacity: t.muted ? 0.4 : 1, cursor: t.muted ? "default" : "pointer", display:"inline-flex", alignItems:"center", gap:5 }}>
              {t.label}
              {t.badge ? <span style={{ marginLeft:4, fontSize:11, color:C.muted, fontWeight:400 }}>{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {tab === "read" && (
          <ReadTab pasuk={pasuk} sefer={sefer} perek={perek}
            hasPrev={pasukIdx > 0} hasNext={pasukIdx < pesukim.length - 1}
            onPrev={() => pasukIdx > 0 && onNavigate(pesukim[pasukIdx - 1])}
            onNext={() => pasukIdx < pesukim.length - 1 && onNavigate(pesukim[pasukIdx + 1])}
            onSaveWord={(w, t) => onVocabSave(key, w, t)}
            student={student} />
        )}
        {tab === "vocab" && (
          <VocabTab pasuk={pasuk} sefer={sefer} perek={perek} savedWords={vocab[key] || {}} onVocabDone={() => onVocabDone?.(key)} />
        )}
        {tab === "rashi" && hasRashi && (
          <RashiTab pasuk={pasuk} rashiEntries={rashiEntries} sefer={sefer} perek={perek} />
        )}
        {tab === "kriah" && (
          <div style={{ textAlign:"center", padding:"50px 20px", color:C.muted }}>
            <div style={{ fontSize:28, marginBottom:12 }}>🎙️</div>
            <div style={{ fontSize:16, fontWeight:600 }}>Kriah — Coming Soon</div>
          </div>
        )}
        {tab === "quiz" && groupReady && (
          <GroupQuiz pesukim={groupPesukim} sefer={sefer} perek={perek}
            onPass={() => onQuizPass(`${sefer.name}_${perek}_group_${groupIdx}`)} />
        )}
        <div style={{ textAlign:"center", padding:"24px 0 12px", fontSize:12, color:C.muted }}>
          © {new Date().getFullYear()} Joseph Hein · All rights reserved
        </div>
      </div>
    </div>
  );
}

// ── PEREK VIEW ────────────────────────────────────────────────────────────────
function PerekView({ sefer, perekNum, progress, quizProgress, vocab, onBack, onProgressUpdate, onVocabSave, onVocabDone, onQuizPass, lastVisitedPasuk, onSetLastVisited, student, assignmentRange, onGoToHome, onGoToChumash }) {
  const [pesukim, setPesukim] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePasuk, setActivePasuk] = useState(null);
  const [initialTab, setInitialTab] = useState("read");
  const [rashiCache, setRashiCache] = useState({});
  const [rashiChecked, setRashiChecked] = useState({});
  const [pasukSearch, setPasukSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    loadPerek(sefer.sefaria, perekNum).then(ps => {
      setPesukim(ps);
      setLoading(false);
      if (lastVisitedPasuk) {
        const lv = ps.find(p => p.num === lastVisitedPasuk);
        if (lv) setActivePasuk(lv);
      }
    });
  }, [sefer.sefaria, perekNum]);

  useEffect(() => {
    pesukim.forEach(p => {
      if (rashiChecked[p.num]) return;
      setRashiChecked(c => ({ ...c, [p.num]: true }));
      loadRashiOnPasuk(sefer.sefaria, perekNum, p.num).then(entries => {
        if (entries.length > 0) setRashiCache(r => ({ ...r, [p.num]: entries }));
      });
    });
  }, [pesukim]);

  function openPasuk(p, tab = "read") {
    setInitialTab(tab);
    setActivePasuk(p);
    onSetLastVisited?.({ sefer: sefer.name, perek: perekNum, pasuk: p.num });
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <style>{CSS}</style>
      <div style={{ width:52, height:52, animation:"kuf-pulse 1.4s ease-in-out infinite", marginBottom:16 }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
          <rect width="100" height="100" rx="20" fill="#5C3317"/>
          <path d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="rgba(255,255,255,.85)"/>
          <path d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="rgba(255,255,255,.85)"/>
        </svg>
      </div>
      <div style={{ color:C.muted, fontSize:15 }}>Loading {sefer.name} {perekNum}…</div>
    </div>
  );

  const displayPesukim = assignmentRange
    ? pesukim.filter(p => p.num >= assignmentRange.fromPasuk && (!assignmentRange.toPasuk || p.num <= assignmentRange.toPasuk))
    : pesukim;

  if (activePasuk) {
    const idx = displayPesukim.findIndex(p => p.num === activePasuk.num);
    const groupIdx = Math.floor(idx / 5);
    const groupPesukim = displayPesukim.slice(groupIdx * 5, groupIdx * 5 + 5);
    return (
      <PasukStudy
        sefer={sefer} perek={perekNum} pasuk={activePasuk} pesukim={displayPesukim}
        progress={progress} vocab={vocab} student={student}
        rashiEntries={rashiCache[activePasuk.num] || []}
        hasRashi={(rashiCache[activePasuk.num] || []).length > 0}
        onBack={() => setActivePasuk(null)}
        backLabel={assignmentRange ? "← Assignment Pesukim" : undefined}
        onGoToSefer={assignmentRange ? null : onBack}
        onGoToHome={onGoToHome}
        onGoToChumash={assignmentRange ? null : onGoToChumash}
        onProgressUpdate={onProgressUpdate} onVocabSave={onVocabSave} onVocabDone={onVocabDone} onQuizPass={onQuizPass}
        groupIdx={groupIdx} groupPesukim={groupPesukim}
        groupPassed={!!quizProgress[`${sefer.name}_${perekNum}_group_${groupIdx}`]?.passed}
        onNavigate={p => { setInitialTab("read"); setActivePasuk(p); onSetLastVisited?.({ sefer: sefer.name, perek: perekNum, pasuk: p.num }); }}
        initialTab={initialTab}
      />
    );
  }

  const groups = [];
  for (let i = 0; i < displayPesukim.length; i += 5) groups.push(displayPesukim.slice(i, i + 5));

  const filteredPesukim = pasukSearch
    ? displayPesukim.filter(p => String(p.num).includes(pasukSearch) || p.he.includes(pasukSearch))
    : null;

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16, flexWrap:"wrap", background:"rgba(184,134,11,.08)", borderRadius:10, padding:"8px 14px" }}>
          {onGoToHome && <button onClick={onGoToHome} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>{assignmentRange ? "Assignment" : "Subjects"}</button>}
          {onGoToHome && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          {!assignmentRange && onGoToChumash && <button onClick={onGoToChumash} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>Chumash</button>}
          {!assignmentRange && onGoToChumash && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          {!assignmentRange && <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>{sefer.name}</button>}
          {!assignmentRange && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          <span style={{ fontSize:15, color:C.label, fontWeight:700 }}>Perek {perekNum}</span>
          {assignmentRange && <button onClick={onBack} style={{ marginLeft:"auto", background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>← Assignment</button>}
        </div>
        <div style={{ background:C.white, borderRadius:12, padding:"14px 18px", boxShadow:"0 1px 3px rgba(0,0,0,.06)", marginBottom:12 }}>
          <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700, color:C.label }}>{sefer.he} · {toHebrewNumeral(perekNum)} · {sefer.name} {perekNum}</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{displayPesukim.length} pesukim{assignmentRange ? " · Assignment" : ""}</div>
        </div>

        {/* Search */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", background:C.white, borderRadius:980, boxShadow:"0 1px 6px rgba(0,0,0,.08)", padding:"8px 8px 8px 16px", gap:8, width:"100%" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={pasukSearch} onChange={e => setPasukSearch(e.target.value)} placeholder="Search pasuk…"
              style={{ border:"none", outline:"none", fontFamily:"inherit", fontSize:14, background:"transparent", flex:1, color:C.label }} />
          </div>
        </div>

        {filteredPesukim ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {filteredPesukim.map(p => {
              const pp = progress[`${sefer.name}_${perekNum}_${p.num}`] || {};
              return (
                <div key={p.num} onClick={() => openPasuk(p)}
                  style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"16px 18px", borderRadius:12, background:C.white, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,.05)", transition:"all .1s", borderLeft:`3px solid ${pp.read?"rgba(52,199,89,.5)":"transparent"}` }}
                  onMouseEnter={e => e.currentTarget.style.background="#FAF7F4"}
                  onMouseLeave={e => e.currentTarget.style.background=C.white}>
                  <span style={{ fontSize:12, color:C.muted, minWidth:24, flexShrink:0, paddingTop:4, fontFamily:"'Heebo',sans-serif", textAlign:"right" }}>{toHebrewNumeral(p.num)}</span>
                  <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:20, lineHeight:2, textAlign:"right", flex:1, margin:0, color:C.label }}>{p.he}</p>
                </div>
              );
            })}
            {filteredPesukim.length === 0 && <div style={{ textAlign:"center", padding:"30px 0", color:C.muted }}>No pesukim found</div>}
          </div>
        ) : (
          groups.map((group, gi) => {
            const qKey = `${sefer.name}_${perekNum}_group_${gi}`;
            const groupPassed = !!quizProgress[qKey]?.passed;
            const studiedCount = group.filter(p => (progress[`${sefer.name}_${perekNum}_${p.num}`] || {}).read).length;
            const allStudied = studiedCount === group.length;
            return (
              <div key={gi} style={{ background:C.white, borderRadius:16, padding:"16px 18px", marginBottom:14, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:15, color:C.label }}>Pesukim {group[0].num}–{group[group.length-1].num}</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{studiedCount}/{group.length} read</div>
                  </div>
                  {groupPassed
                    ? <span style={{ background:"rgba(52,199,89,.12)", color:C.green, borderRadius:20, padding:"4px 12px", fontSize:12, fontWeight:700 }}>✓ Mastered</span>
                    : allStudied
                      ? <Btn onClick={() => openPasuk(group[0], "quiz")} bg={C.gold} style={{ padding:"7px 14px", fontSize:12 }}>Take Quiz</Btn>
                      : <span style={{ fontSize:12, color:C.muted }}>Read all to unlock quiz</span>
                  }
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {group.map(p => {
                    const pp = progress[`${sefer.name}_${perekNum}_${p.num}`] || {};
                    return (
                      <div key={p.num} onClick={() => openPasuk(p)}
                        style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"16px 18px", borderRadius:12, background:C.bg, cursor:"pointer", transition:"all .1s", borderLeft:`3px solid ${pp.read?"rgba(52,199,89,.5)":pp.vocab||pp.rashi?"rgba(184,134,11,.4)":"transparent"}` }}
                        onMouseEnter={e => e.currentTarget.style.background="#FAF7F4"}
                        onMouseLeave={e => e.currentTarget.style.background=C.bg}>
                        <span style={{ fontSize:12, color:C.muted, minWidth:24, flexShrink:0, paddingTop:4, fontFamily:"'Heebo',sans-serif", textAlign:"right" }}>{toHebrewNumeral(p.num)}</span>
                        <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:20, lineHeight:2, textAlign:"right", flex:1, margin:0, color:C.label }}>{p.he}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
        <div style={{ textAlign:"center", padding:"24px 0 8px", fontSize:12, color:C.muted }}>
          © {new Date().getFullYear()} Joseph Hein · All rights reserved
        </div>
      </div>
    </div>
  );
}

// ── CHUMASH HOME ──────────────────────────────────────────────────────────────
function ChumashHome({ student, chumashProgress = {}, chumashQuizProgress = {}, chumashVocab = {}, onProgressUpdate, onQuizPass, onVocabSave, onVocabDone, onBack, onLogout, lastVisitedChumash, onSetLastVisitedChumash, assignmentRange, onClearPerek, seenTutorial, onTutorialSeen }) {
  const [activeSefer, setActiveSefer] = useState(() => {
    if (assignmentRange?.seferName) return SEFARIM.find(s => s.name === assignmentRange.seferName) || null;
    return null;
  });
  const [activePerek, setActivePerek] = useState(() => assignmentRange?.perek || null);
  const [showTutorial, setShowTutorial] = useState(!seenTutorial);
  function dismissTutorial() { setShowTutorial(false); onTutorialSeen?.(); }
  const [seferSearch, setSeferSearch] = useState("");
  const [perekSearch, setPerekSearch] = useState("");



  if (activeSefer && activePerek !== null) {
    return (
      <PerekView
        sefer={activeSefer} perekNum={activePerek}
        progress={chumashProgress} quizProgress={chumashQuizProgress} vocab={chumashVocab}
        onBack={assignmentRange ? onBack : () => setActivePerek(null)}
        onGoToHome={onBack}
        onGoToChumash={assignmentRange ? null : () => { setActiveSefer(null); setActivePerek(null); }}
        onProgressUpdate={onProgressUpdate} onVocabSave={onVocabSave} onVocabDone={onVocabDone} onQuizPass={onQuizPass}
        lastVisitedPasuk={lastVisitedChumash?.sefer === activeSefer.name && lastVisitedChumash?.perek === activePerek ? lastVisitedChumash.pasuk : null}
        onSetLastVisited={lv => onSetLastVisitedChumash?.(lv)}
        student={student}
        assignmentRange={assignmentRange}
      />
    );
  }

  // ── PEREK GRID ──
  if (activeSefer) {
    const perakim = Array.from({ length: activeSefer.perakim }, (_, i) => i + 1);

    function getPerekRing(pn) {
      const keys = Object.keys(chumashProgress).filter(k => k.startsWith(`${activeSefer.name}_${pn}_`));
      if (!keys.length) return `conic-gradient(rgba(0,0,0,.06) 0deg 360deg)`;
      const totalGroups = Math.max(Math.ceil(keys.length / 5), 1);
      const deg = 360 / totalGroups;
      const stops = Array.from({ length: totalGroups }, (_, gi) => {
        const color = chumashQuizProgress[`${activeSefer.name}_${pn}_group_${gi}`]?.passed ? C.green : "rgba(184,134,11,.5)";
        return `${color} ${gi * deg}deg ${(gi + 1) * deg}deg`;
      });
      return `conic-gradient(from -90deg, ${stops.join(", ")})`;
    }

    const filteredPerakim = perekSearch
      ? perakim.filter(pn => String(pn).includes(perekSearch) || toHebrewNumeral(pn).includes(perekSearch))
      : perakim;

    return (
      <div style={{ minHeight:"100vh", background:C.bg }}>
        <style>{CSS}</style>
        <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>
          {/* Breadcrumb */}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16, flexWrap:"wrap", background:"rgba(184,134,11,.08)", borderRadius:10, padding:"8px 14px" }}>
            {onBack && <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>Subjects</button>}
            {onBack && <span style={{ fontSize:15, color:C.brown }}>›</span>}
            <button onClick={() => setActiveSefer(null)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>Chumash</button>
            <span style={{ fontSize:15, color:C.brown }}>›</span>
            <span style={{ fontSize:15, color:C.label, fontWeight:700 }}>{activeSefer.name}</span>
          </div>
          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
            <div>
              <h1 style={{ fontFamily:"'Heebo',sans-serif", fontSize:32, fontWeight:700, lineHeight:1, color:C.label }}>{activeSefer.he}</h1>
              <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{activeSefer.name} · {activeSefer.perakim} perakim</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:600, fontSize:15, color:C.label }}>{student.name}</div>
              <div style={{ fontSize:12, color:C.muted }}>{student.email}</div>
              {onLogout && <div style={{ display:"flex", gap:6, justifyContent:"flex-end", marginTop:6 }}>
                <button onClick={onLogout} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:7, padding:"3px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:C.muted }}>Switch</button>
              </div>}
            </div>
          </div>

          {/* Last visited in this sefer */}
          {lastVisitedChumash?.sefer === activeSefer.name && lastVisitedChumash?.perek && (
            <div onClick={() => setActivePerek(lastVisitedChumash.perek)}
              style={{ background:"rgba(184,134,11,.08)", borderRadius:14, padding:"14px 18px", marginBottom:16, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", border:"0.5px solid rgba(184,134,11,.2)", transition:"all .15s" }}
              onMouseEnter={e => e.currentTarget.style.background="rgba(184,134,11,.13)"}
              onMouseLeave={e => e.currentTarget.style.background="rgba(184,134,11,.08)"}>
              <div>
                <div style={{ fontSize:11, color:"#6B4E1A", marginBottom:3, fontWeight:500, letterSpacing:"0.02em" }}>Pick up where you left off</div>
                <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:15, fontWeight:700, color:C.label }}>
                  {activeSefer.name} · Perek {lastVisitedChumash.perek}{lastVisitedChumash.pasuk ? ` · Pasuk ${lastVisitedChumash.pasuk}` : ""}
                </div>
              </div>
              <span style={{ color:"#6B4E1A", fontSize:20, fontWeight:300 }}>›</span>
            </div>
          )}

          {/* Active perakim (in-progress, not mastered) */}
          {(() => {
            const activePerakim = perakim.filter(pn => {
              const keys = Object.keys(chumashProgress).filter(k => k.startsWith(`${activeSefer.name}_${pn}_`));
              if (!keys.length) return false;
              const totalGroups = Math.ceil(keys.length / 5);
              const allPassed = Array.from({ length: totalGroups }, (_, gi) =>
                chumashQuizProgress[`${activeSefer.name}_${pn}_group_${gi}`]?.passed
              ).every(Boolean);
              return !allPassed;
            });
            if (!activePerakim.length) return null;
            return (
              <div data-tour="chumash-active-perakim" style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, color:"#6B4E1A", fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:8, paddingLeft:2 }}>Active Perakim</div>
                {activePerakim.map(pn => (
                  <div key={pn}
                    onClick={() => { setActivePerek(pn); onSetLastVisitedChumash?.({ sefer: activeSefer.name, perek: pn }); }}
                    style={{ background:"rgba(184,134,11,.08)", borderRadius:12, padding:"12px 16px", marginBottom:6, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", border:"0.5px solid rgba(184,134,11,.15)" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(184,134,11,.13)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(184,134,11,.08)"}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:16, fontWeight:700, color:C.label }}>{toHebrewNumeral(pn)}</div>
                      <div style={{ fontSize:13, color:"#6B4E1A", fontWeight:500 }}>{activeSefer.name} · Perek {pn}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ color:C.muted, fontSize:18 }}>›</span>
                      {onClearPerek && (
                        <button
                          onClick={e => { e.stopPropagation(); onClearPerek(activeSefer.name, pn); }}
                          title="Remove from active list"
                          style={{ background:"rgba(0,0,0,.07)", border:"none", borderRadius:6, width:22, height:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, fontSize:14, lineHeight:1, padding:0, flexShrink:0 }}
                        >×</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <p style={{ fontSize:11, color:C.muted, marginBottom:12, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:500 }}>Select a Perek</p>

          {/* Search */}
          <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", background:C.white, borderRadius:980, boxShadow:"0 1px 6px rgba(0,0,0,.08)", padding:"8px 8px 8px 16px", gap:8, width:"100%" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={perekSearch} onChange={e => setPerekSearch(e.target.value)} placeholder="Search perek…"
                style={{ border:"none", outline:"none", fontFamily:"inherit", fontSize:14, background:"transparent", flex:1, color:C.label }} />
            </div>
          </div>

          {/* Perek grid — same style as KSA siman grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(80px, 1fr))", gap:8, direction:"rtl" }}>
            {filteredPerakim.map(pn => {
              const hasProgress = Object.keys(chumashProgress).some(k => k.startsWith(`${activeSefer.name}_${pn}_`));
              return (
                <div key={pn}
                  onClick={() => { setActivePerek(pn); onSetLastVisitedChumash?.({ sefer: activeSefer.name, perek: pn }); }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow="0 3px 12px rgba(0,0,0,.13)"}
                  onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 5px rgba(0,0,0,.07)"}
                  style={{ borderRadius:13, padding:3, cursor:"pointer", transition:"all .15s", boxShadow:"0 1px 5px rgba(0,0,0,.07)", background: getPerekRing(pn) }}>
                  <div style={{ background:C.white, borderRadius:10, padding:"12px 6px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, minHeight:70 }}>
                    <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:17, fontWeight:700, color: hasProgress ? C.green : C.label }}>{toHebrewNumeral(pn)}</div>
                    <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.03em" }}>{pn}</div>
                  </div>
                </div>
              );
            })}
            {filteredPerakim.length === 0 && <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"30px 0", color:C.muted }}>No perakim found</div>}
          </div>
          <div style={{ textAlign:"center", padding:"24px 0 12px", fontSize:12, color:C.muted }}>
            © {new Date().getFullYear()} Joseph Hein · All rights reserved
          </div>
        </div>
      </div>
    );
  }

  // ── SEFER SELECTION ──
  const filteredSefarim = seferSearch
    ? SEFARIM.filter(s => s.name.toLowerCase().includes(seferSearch.toLowerCase()) || s.he.includes(seferSearch))
    : SEFARIM;

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <style>{CSS}</style>
      {showTutorial && <TutorialOverlay steps={CHUMASH_TUTORIAL} onDone={dismissTutorial} />}
      <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>

        {/* Breadcrumb */}
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16, flexWrap:"wrap", background:"rgba(184,134,11,.08)", borderRadius:10, padding:"8px 14px" }}>
          {onBack && <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:C.brown, fontFamily:"inherit", padding:0, fontWeight:600 }}>Subjects</button>}
          {onBack && <span style={{ fontSize:15, color:C.brown }}>›</span>}
          <span style={{ fontSize:15, color:C.label, fontWeight:700 }}>Chumash</span>
        </div>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
          <div>
            <h1 style={{ fontFamily:"'Heebo',sans-serif", fontSize:32, fontWeight:700, lineHeight:1, color:C.label }}>חומש</h1>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:600, fontSize:15, color:C.label }}>{student.name}</div>
            <div style={{ fontSize:12, color:C.muted }}>{student.email}</div>
            <div style={{ display:"flex", gap:6, justifyContent:"flex-end", marginTop:6 }}>
              <button onClick={() => setShowTutorial(true)} title="How it works" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:980, width:28, height:28, cursor:"pointer", fontFamily:"inherit", fontSize:13, color:C.muted, display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>?</button>
              {onLogout && <button onClick={onLogout} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:7, padding:"3px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:C.muted }}>Switch</button>}
            </div>
          </div>
        </div>

        {/* Last visited */}
        {lastVisitedChumash?.sefer && (
          <div onClick={() => {
              const s = SEFARIM.find(sf => sf.name === lastVisitedChumash.sefer);
              if (s) { setActiveSefer(s); if (lastVisitedChumash.perek) setActivePerek(lastVisitedChumash.perek); }
            }}
            style={{ background:"rgba(184,134,11,.08)", borderRadius:14, padding:"14px 18px", marginBottom:16, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", border:"0.5px solid rgba(184,134,11,.2)", transition:"all .15s" }}
            onMouseEnter={e => e.currentTarget.style.background="rgba(184,134,11,.13)"}
            onMouseLeave={e => e.currentTarget.style.background="rgba(184,134,11,.08)"}>
            <div>
              <div style={{ fontSize:11, color:"#6B4E1A", marginBottom:3, fontWeight:500, letterSpacing:"0.02em" }}>Pick up where you left off</div>
              <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:15, fontWeight:700, color:C.label }}>
                {lastVisitedChumash.sefer}{lastVisitedChumash.perek ? ` · Perek ${lastVisitedChumash.perek}` : ""}{lastVisitedChumash.pasuk ? ` · Pasuk ${lastVisitedChumash.pasuk}` : ""}
              </div>
            </div>
            <span style={{ color:"#6B4E1A", fontSize:20, fontWeight:300 }}>›</span>
          </div>
        )}

        <p style={{ fontSize:11, color:C.muted, marginBottom:12, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:500 }}>Select a Sefer</p>

        {/* Search */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", background:C.white, borderRadius:980, boxShadow:"0 1px 6px rgba(0,0,0,.08)", padding:"8px 8px 8px 16px", gap:8, width:"100%" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={seferSearch} onChange={e => setSeferSearch(e.target.value)} placeholder="Search sefer…"
              style={{ border:"none", outline:"none", fontFamily:"inherit", fontSize:14, background:"transparent", flex:1, color:C.label }} />
          </div>
        </div>

        {/* Sefer grid — matches Talmud masechet grid style */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:12, direction:"rtl" }}>
          {filteredSefarim.map((sefer, si) => {
            const startedPerakim = Array.from({ length: sefer.perakim }, (_, i) => i + 1)
              .filter(pn => Object.keys(chumashProgress).some(k => k.startsWith(`${sefer.name}_${pn}_`))).length;
            return (
              <div key={sefer.name} data-tour={si === 0 ? "chumash-first-sefer" : undefined} onClick={() => setActiveSefer(sefer)}
                onMouseEnter={e => e.currentTarget.style.boxShadow="0 3px 12px rgba(0,0,0,.13)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.05),0 4px 12px rgba(0,0,0,.04)"}
                style={{ background:C.white, borderRadius:14, padding:"18px 12px", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,.05),0 4px 12px rgba(0,0,0,.04)", textAlign:"center", transition:"all .15s", borderTop:`3px solid ${startedPerakim > 0 ? "rgba(52,199,89,.5)" : "transparent"}` }}>
                <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700, marginBottom:4, color:C.label }}>{sefer.he.split(" ")[0]}</div>
                <div style={{ fontSize:12, color:C.muted }}>{sefer.name}</div>
                {startedPerakim > 0 && <div style={{ fontSize:11, color:C.green, fontWeight:600, marginTop:4 }}>{startedPerakim}</div>}
              </div>
            );
          })}
        </div>

        <div style={{ textAlign:"center", padding:"24px 0 12px", fontSize:12, color:C.muted }}>
          © {new Date().getFullYear()} Joseph Hein · All rights reserved
        </div>
      </div>
    </div>
  );
}

export default ChumashHome;
