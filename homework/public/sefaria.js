// Loads a daf (or any ref) from Sefaria in the browser, the same way the KSA app does.
// The English keeps Sefaria's bold (the literal translation) as **double asterisks**,
// which the student page shows in bold. Everything else in the English is the explanation.

const toDom = (html) => new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstChild;

function hebrewText(html) {
  const el = toDom(html || "");
  el.querySelectorAll("sup, .footnote, .footnote-marker").forEach((n) => n.remove());
  return el.textContent.replace(/\s+/g, " ").trim();
}

function englishWithBold(html) {
  const el = toDom(html || "");
  el.querySelectorAll("sup, i.footnote, .footnote, .footnote-marker").forEach((n) => n.remove());
  let out = "";
  const walk = (node, bold) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent;
        out += bold && t.trim() ? t.replace(/^(\s*)(.*?)(\s*)$/s, "$1**$2**$3") : t;
      } else if (c.nodeType === 1) {
        walk(c, bold || c.tagName === "B" || c.tagName === "STRONG");
      }
    }
  };
  walk(el, false);
  // Join neighbouring bold runs ("**a** **b**" -> "**a b**") and tidy spaces.
  return out.replace(/\*\*(\s*)\*\*/g, "$1").replace(/\s+/g, " ").trim();
}

// "Kiddushin 29a" -> "Kiddushin.29a"
export function sefariaRef(input) {
  return String(input || "").trim().replace(/\s+/g, " ").replace(/ (?=\d)/, ".").replace(/ /g, "_");
}

// Returns [{ he, en }] for each segment of the ref.
export async function loadSefaria(input) {
  const ref = sefariaRef(input);
  if (!ref) throw new Error("Type a reference, like Kiddushin 29a.");
  const r = await fetch(`https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?commentary=0&context=0&pad=0`);
  if (!r.ok) throw new Error(`Sefaria didn't find "${input}".`);
  const d = await r.json();
  if (d.error) throw new Error(`Sefaria: ${d.error}`);
  const flat = (x) => (Array.isArray(x) ? x.flat(Infinity) : [x]);
  const he = flat(d.he), en = flat(d.text);
  const segs = he.map((h, i) => ({ he: hebrewText(h), en: englishWithBold(en[i] || "") })).filter((s) => s.he || s.en);
  if (!segs.length) throw new Error(`Sefaria has no text for "${input}".`);
  return segs;
}

// For matching segments to Hebrew that's already in an assignment: letters only, no vowels.
export function bareHebrew(s) {
  return String(s || "").replace(/[֑-ׇ]/g, "").replace(/[^א-ת]/g, "");
}

// Escapes text and turns **bold** into <strong>.
export function boldHtml(s, escFn) {
  return escFn(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*\*/g, "");
}
