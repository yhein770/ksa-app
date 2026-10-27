// Builds a printable class report and opens the browser's print dialog,
// where "Save as PDF" turns it into a PDF.
import { esc, heb } from "./firebase.js";
import { scoreAnswers, questionCount } from "./assignments.js";

const fmtDate = (t) =>
  t?.toDate ? t.toDate().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtLen = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

// opts: { assignment, className, roster: [{email, name}] | null, subs, includeTranscripts }
export function printReport({ assignment: A, className, roster, subs, includeTranscripts }) {
  const byEmail = new Map(subs.map((s) => [s.email, s]));
  // With a class: every student on the roster, submitted or not. Without: everyone who submitted.
  let rows = roster
    ? roster.map((r) => ({ email: r.email, name: byEmail.get(r.email)?.name || r.name || r.email, sub: byEmail.get(r.email) || null }))
    : subs.map((s) => ({ email: s.email, name: s.name || s.email, sub: s }));
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const qs = [];
  for (const p of A.parts || []) for (const q of p.questions || []) if (q.id) qs.push(q.id);
  const total = questionCount(A);
  const showQs = qs.length > 0 && qs.length <= 12;
  const done = rows.filter((r) => r.sub);
  const scores = done.map((r) => scoreAnswers(A, r.sub.answers).correct);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "–";

  const tableRows = rows.map((r, i) => {
    if (!r.sub) {
      return `<tr class="missing"><td>${i + 1}</td><td><b>${esc(r.name)}</b><div class="em">${esc(r.email)}</div></td>
        <td class="no">Not submitted</td><td></td>${showQs ? qs.map(() => "<td></td>").join("") : ""}<td></td><td></td><td></td></tr>`;
    }
    const sc = scoreAnswers(A, r.sub.answers);
    const memo = r.sub.audioPath ? `${fmtLen(r.sub.audioSeconds)}${r.sub.transcriptStatus === "done" ? "" : " (no transcript)"}` : (A.voice ? "None" : "");
    return `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b><div class="em">${esc(r.email)}</div></td>
      <td>${esc(fmtDate(r.sub.submittedAt))}</td>
      <td class="c"><b>${sc.correct}/${sc.total}</b></td>
      ${showQs ? qs.map((id) => `<td class="c ${sc.perQuestion[id] ? "ok" : "x"}">${sc.perQuestion[id] ? "✓" : "✗"}</td>`).join("") : ""}
      <td class="c">${esc(memo)}</td>
      <td class="c"><b>${esc(r.sub.teacherGrade || "")}</b></td>
      <td>${esc(r.sub.teacherNote || "")}</td></tr>`;
  }).join("");

  const transcripts = includeTranscripts
    ? `<h2 class="pb">Voice memo transcripts</h2>${done.map((r) => `
        <div class="tr"><h3>${esc(r.name)} <span class="em">${esc(fmtLen(r.sub.audioSeconds))}</span></h3>
        <p>${r.sub.transcriptStatus === "done" ? heb(r.sub.transcript) : "<i>No transcript.</i>"}</p></div>`).join("") || "<p>No submissions.</p>"}`
    : "";

  const title = `${A.title}${className ? ` - ${className}` : ""}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    body { font: 11px/1.4 -apple-system, system-ui, "Segoe UI", Arial, sans-serif; color: #1d1d1b; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    .sub { color: #6b6a66; margin-bottom: 10px; }
    .stats { display: flex; gap: 22px; margin: 8px 0 12px; }
    .stats b { font-size: 16px; display: block; }
    table { width: 100%; border-collapse: collapse; font-size: inherit; }
    th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #f3f1ec; font-weight: 600; font-size: 10px; }
    tr { break-inside: avoid; }
    .c { text-align: center; }
    .em { color: #6b6a66; font-size: 9.5px; font-weight: normal; }
    .ok { color: #2e7d4f; } .x { color: #b3261e; }
    .no { color: #b3261e; font-weight: 600; }
    tr.missing td { background: #fbf3f3; }
    .pb { break-before: page; font-size: 15px; }
    .tr { break-inside: avoid; margin-bottom: 12px; }
    .tr h3 { font-size: 12px; margin: 0 0 3px; }
    .tr p { margin: 0; white-space: pre-wrap; }
    .he { font-family: "Frank Ruhl Libre", "Times New Roman", serif; }
  </style></head><body>
    <h1>${esc(A.title)}</h1>
    <div class="sub">${className ? `Class: ${esc(className)} · ` : ""}Report made ${esc(new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))}</div>
    <div class="stats">
      <div><b>${done.length}${roster ? ` of ${rows.length}` : ""}</b>submitted</div>
      ${roster ? `<div><b>${rows.length - done.length}</b>not submitted</div>` : ""}
      <div><b>${avg}${scores.length ? ` / ${total}` : ""}</b>average on the questions</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Student</th><th>Submitted</th><th class="c">Score</th>
        ${showQs ? qs.map((_, i) => `<th class="c">Q${i + 1}</th>`).join("") : ""}
        <th class="c">Voice memo</th><th class="c">Grade</th><th>Note</th></tr></thead>
      <tbody>${tableRows || `<tr><td colspan="8">No students.</td></tr>`}</tbody>
    </table>
    ${transcripts}
  </body></html>`;

  // Print from a hidden frame so no pop-up is needed.
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  d.open(); d.write(html); d.close();
  const oldTitle = document.title;
  document.title = title; // Chrome uses this as the PDF file name
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => { frame.remove(); document.title = oldTitle; }, 1000);
  }, 300);
  return html;
}
