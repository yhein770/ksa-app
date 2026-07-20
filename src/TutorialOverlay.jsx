import { useState, useEffect } from "react";

// ── SPOTLIGHT TOUR COMPONENT ──────────────────────────────────────────────────
// Each step: { target: "data-tour-id", title, body }
// Renders a dark overlay with a "spotlight cutout" over the target element.

export default function TutorialOverlay({ steps, onDone }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [visible, setVisible] = useState(false);

  function measure(stepIdx) {
    const step = steps[stepIdx];
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); setVisible(true); return; }
    const r = el.getBoundingClientRect();
    const inView = r.top >= -20 && r.bottom <= window.innerHeight + 20;
    if (inView) {
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      setVisible(true);
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        const r2 = el.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
        setVisible(true);
      }, 320);
    }
  }

  useEffect(() => {
    const raf = requestAnimationFrame(() => measure(idx));
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  useEffect(() => {
    function onResize() { measure(idx); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [idx]);

  const step = steps[idx];
  const isLast = idx === steps.length - 1;
  const PAD = 10;
  const TIP_W = 290;

  // Tooltip positioning
  let tipStyle;
  if (rect) {
    const spBottom = rect.top + rect.height + PAD;
    const spTop    = rect.top - PAD;
    const cx       = rect.left + rect.width / 2;
    const spaceBelow = window.innerHeight - spBottom - 16;
    const spaceAbove = spTop - 16;
    const tipLeft = Math.max(16, Math.min(window.innerWidth - TIP_W - 16, cx - TIP_W / 2));
    tipStyle = {
      top:  spaceBelow >= 140 || spaceBelow >= spaceAbove ? spBottom + 10 : "auto",
      bottom: spaceBelow < 140 && spaceBelow < spaceAbove ? (window.innerHeight - spTop + 10) : "auto",
      left: tipLeft,
    };
  } else {
    tipStyle = { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
  }

  if (!visible) return null;

  return (
    <>
      {/* Click blocker — prevents accidental interaction with background while touring */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 3000, cursor: "default" }}
        onClick={e => e.stopPropagation()}
      />

      {/* Spotlight cutout — the box-shadow creates the dark overlay around the highlighted element */}
      {rect && (
        <div style={{
          position:   "fixed",
          top:        rect.top  - PAD,
          left:       rect.left - PAD,
          width:      rect.width  + PAD * 2,
          height:     rect.height + PAD * 2,
          borderRadius: 14,
          boxShadow:  "0 0 0 9999px rgba(0,0,0,0.72)",
          border:     "2px solid rgba(184,134,11,0.85)",
          zIndex:     3001,
          pointerEvents: "none",
          transition: "top .32s cubic-bezier(.4,0,.2,1), left .32s cubic-bezier(.4,0,.2,1), width .32s cubic-bezier(.4,0,.2,1), height .32s cubic-bezier(.4,0,.2,1)",
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        position: "fixed",
        zIndex:   3002,
        width:    TIP_W,
        ...tipStyle,
        transition: rect ? "top .32s cubic-bezier(.4,0,.2,1), left .32s cubic-bezier(.4,0,.2,1)" : "none",
        pointerEvents: "all",
      }}>
        <div style={{
          background:   "white",
          borderRadius: 18,
          padding:      "18px 18px 15px",
          boxShadow:    "0 10px 40px rgba(0,0,0,0.28)",
          border:       "1px solid rgba(0,0,0,0.06)",
        }}>
          {/* Step counter */}
          <div style={{ fontSize: 11, color: "#9C8570", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            {idx + 1} of {steps.length}
          </div>

          {/* Title */}
          <div style={{ fontFamily: "'Heebo',sans-serif", fontSize: 17, fontWeight: 700, color: "#1C1008", marginBottom: 7, lineHeight: 1.25 }}>
            {step.title}
          </div>

          {/* Body */}
          <div style={{ fontSize: 14, color: "#3A2A1E", lineHeight: 1.65, marginBottom: 14 }}>
            {step.body}
          </div>

          {/* Progress dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 14 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                onClick={() => setIdx(i)}
                style={{
                  width: i === idx ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === idx ? "#5C3317" : "rgba(0,0,0,.15)",
                  transition: "all .2s",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={onDone}
              style={{ background: "none", border: "1px solid rgba(0,0,0,.12)", borderRadius: 980, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#9C8570", fontWeight: 500 }}
            >
              Skip
            </button>
            <div style={{ flex: 1 }} />
            {idx > 0 && (
              <button
                onClick={() => setIdx(i => i - 1)}
                style={{ background: "none", border: "1px solid rgba(0,0,0,.12)", borderRadius: 980, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#1C1008", fontWeight: 500 }}
              >
                Back
              </button>
            )}
            <button
              onClick={isLast ? onDone : () => setIdx(i => i + 1)}
              style={{ background: isLast ? "#34A853" : "#5C3317", color: "white", border: "none", borderRadius: 980, padding: "7px 20px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── KSA SIMAN TOUR ───────────────────────────────────────────────────────────
export const KSA_SIMAN_TUTORIAL = [
  {
    target: "ksa-siman-tab-study",
    title: "Study",
    body: "Tap any seif to open it. Work through Read, Vocab, Kriah, and Quiz to master it.",
  },
  {
    target: "ksa-siman-tab-reference",
    title: "Kitzur + EN",
    body: "View the full Hebrew Kitzur text alongside the English translation for review.",
  },
  {
    target: "ksa-siman-tab-flashcards",
    title: "Vocab",
    body: "All words you've saved across the seifim in this siman appear here in one place.",
  },
];

// ── TALMUD DAF TOUR ───────────────────────────────────────────────────────────
export const TALMUD_DAF_TUTORIAL = [
  {
    target: "talmud-daf-segments-tab",
    title: "Segments",
    body: "Each daf is broken into individual segments — one sugya at a time. Tap any segment to study it.",
  },
  {
    target: "talmud-daf-shakla-tab",
    title: "Shakla v'Tarya",
    body: "An AI chavruta that debates the entire daf with you — asking questions about the text's logic, pushing back on your answers, and guiding you through the Talmudic give-and-take.",
  },
];

// ── KSA HOME TOUR ─────────────────────────────────────────────────────────────
export const KSA_TUTORIAL = [
  {
    target: "ksa-first-siman",
    title: "Siman Grid",
    body: "All 221 simanim are listed here. Tap any one to open it. The color ring shows your progress — gold means in progress, green means fully mastered.",
  },
];

// ── KSA STUDY TOUR ────────────────────────────────────────────────────────────
export const KSA_STUDY_TUTORIAL = [
  {
    target: "ksa-tab-read",
    title: "Read",
    body: "Tap any Hebrew word to see its English translation. Double-tap to save it to your Vocab list. You can also highlight a phrase to translate multiple words at once.",
  },
  {
    target: "ksa-tab-vocab",
    title: "Vocab & Typing Quiz",
    body: "Words you save appear here as flashcards. Review them, then take a typing quiz — the AI grades generously, so synonyms and paraphrases count as correct.",
  },
  {
    target: "ksa-tab-kriah",
    title: "Kriah",
    body: "Record yourself reading the Hebrew seif aloud while translating it. The AI grades your Hebrew pronunciation and your translation accuracy separately.",
  },
  {
    target: "ksa-tab-quiz",
    title: "Content Quiz",
    body: "Answer comprehension questions about the seif. Pass to mark it as mastered and unlock the next one.",
  },
];

// ── TALMUD HOME TOUR ──────────────────────────────────────────────────────────
export const TALMUD_TUTORIAL = [
  {
    target: "talmud-first-masechet",
    title: "Masechet Selection",
    body: "Browse all masechtos and tap one to see its dafim. Each daf is broken into segments — one sugya at a time.",
  },
  {
    target: "talmud-ki-tab",
    title: "TalmudKI",
    body: "A smart vocab review system that tracks how well you know each Aramaic word and shows it at exactly the right time. The better you know it, the less often it appears.",
  },
  {
    target: "talmud-active-dafim",
    title: "Active Dafim",
    body: "Dafim you've already started appear here for quick access. Tap the × to remove one from the list.",
  },
];

// ── TALMUD STUDY TOUR ─────────────────────────────────────────────────────────
export const TALMUD_STUDY_TUTORIAL = [
  {
    target: "talmud-tab-read",
    title: "Read",
    body: "Tap any Aramaic word to see its meaning — checked against the Jastrow Dictionary first, then AI. Double-tap to save a word. You can also toggle transliteration to hear the text phonetically.",
  },
  {
    target: "talmud-tab-vocab",
    title: "Vocab",
    body: "Words you save become a vocab deck for this segment. Review your cards before taking the quiz.",
  },
  {
    target: "talmud-tab-kriah",
    title: "Kriah",
    body: "Record yourself reading the Aramaic aloud and translating it. The AI grades your pronunciation and translation coverage and shows you exactly what you missed.",
  },
  {
    target: "talmud-tab-quiz",
    title: "Mastery Quiz",
    body: "Answer comprehension questions about the segment. Wrong answers get replacement questions until you get them right. Pass to master the segment.",
  },
];

// ── CHUMASH HOME TOUR ─────────────────────────────────────────────────────────
export const CHUMASH_TUTORIAL = [
  {
    target: "chumash-first-sefer",
    title: "Torah Study",
    body: "Choose from the five books of the Torah. Each sefer is broken into perakim, and each perek into individual pesukim — study them one at a time.",
  },
  {
    target: "chumash-active-perakim",
    title: "Active Perakim",
    body: "Perakim you've already started appear here for quick access. Tap the × to remove one from the list.",
  },
];

// ── CLASSROOM TOUR ────────────────────────────────────────────────────────────
export const CLASSROOM_TUTORIAL = [
  {
    target: "classroom-tab-assignments",
    title: "Assignments",
    body: "Your teacher assigns specific simanim, dafim, or perakim to study. Tap Open Assignment to jump directly into the material. Your progress is tracked automatically.",
  },
  {
    target: "classroom-tab-feed",
    title: "Feed",
    body: "Your teacher posts announcements, resources, and updates here. Check back regularly.",
  },
  {
    target: "classroom-tab-chat",
    title: "Chat",
    body: "Message your teacher and classmates in real time.",
  },
];
