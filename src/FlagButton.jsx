import { useState } from "react";
import { submitFlag } from "./sharedCache";

export function FlagButton({ cacheKey, word, currentTranslation, heContext, enContext, student, callClaude, onFlagResolved }) {
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (!cacheKey) return;
    if (!suggestion.trim()) return;
    setSubmitting(true);
    try {
      const result = await submitFlag({
        cacheKey,
        originalValue: currentTranslation || "",
        suggestedValue: suggestion.trim(),
        word,
        heContext: heContext || "",
        enContext: enContext || "",
        submittedBy: student?.email || "unknown",
        claudeFn: callClaude,
      });
      setDone(true);
      setSubmitting(false);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
        setSuggestion("");
        if (onFlagResolved) onFlagResolved(result.finalValue);
      }, 1500);
    } catch (e) {
      console.error("Flag submission failed:", e);
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        style={{ background:"none", border:"1px solid rgba(184,134,11,.3)", borderRadius:8, padding:"4px 10px", fontSize:12, color:"#6B4E1A", cursor:"pointer", fontFamily:"inherit", marginTop:8 }}
      >
        ✦ Suggest correction
      </button>

      {open && (
        <div
          style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"flex-end" }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", background:"white", borderRadius:"20px 20px 0 0", padding:"24px 24px 40px", boxShadow:"0 -8px 32px rgba(0,0,0,.15)" }}>
            <div style={{ width:36, height:4, background:"rgba(0,0,0,.15)", borderRadius:2, margin:"0 auto 20px" }} />
            <div style={{ fontWeight:600, fontSize:17, color:"#3A2A1E", marginBottom:4 }}>Suggest a correction</div>
            <div style={{ fontSize:13, color:"#888", marginBottom:16 }}>
              Current translation for{" "}
              <span style={{ fontFamily:"'Heebo',sans-serif", fontWeight:700, fontSize:15 }}>{word}</span>:
            </div>
            <div style={{ background:"rgba(0,0,0,.04)", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:15, color:"#3A2A1E" }}>
              {currentTranslation || "(none)"}
            </div>
            <div style={{ fontSize:13, color:"#888", marginBottom:6 }}>Your suggested translation:</div>
            <input
              autoFocus
              value={suggestion}
              onChange={e => setSuggestion(e.target.value)}
              placeholder="Enter correction…"
              style={{ width:"100%", border:"1px solid rgba(0,0,0,.15)", borderRadius:10, padding:"11px 14px", fontSize:15, fontFamily:"inherit", boxSizing:"border-box", outline:"none", color:"#3A2A1E" }}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
            />
            {done ? (
              <div style={{ marginTop:14, textAlign:"center", color:"#1A5C2A", fontWeight:500, fontSize:15 }}>
                ✓ Submitted — thank you!
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!suggestion.trim() || submitting}
                style={{ marginTop:14, width:"100%", padding:"13px", background: suggestion.trim() ? "rgba(184,134,11,.85)" : "rgba(0,0,0,.08)", border:"none", borderRadius:12, fontFamily:"inherit", fontSize:15, fontWeight:600, color: suggestion.trim() ? "white" : "#888", cursor: suggestion.trim() ? "pointer" : "default" }}
              >
                {submitting ? "Submitting…" : "Submit correction"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
