import {
  auth, db, storage, signIn, signOut, onAuthStateChanged,
  doc, getDoc, updateDoc, collection, query, where, getDocs, ref, getDownloadURL,
  SUBMISSIONS, transcribe, esc, heb,
} from "./firebase.js";
import { scoreAnswers, questionCount } from "./assignments.js";
import { listAssignments } from "./store.js";
import { openBuilder } from "./builder.js";

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
let assignments = [];
let A = null;
let view = params.get("a") ? "submissions" : "assignments";
let user = null, teacher = null;
let classes = [];          // [{ code, name, students: [emails] }]
let classFilter = "all";
let subs = [];

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) return renderSignIn();
  app.innerHTML = `<p class="muted">Checking your account…</p>`;
  try {
    const snap = await getDoc(doc(db, "teachers", u.email));
    teacher = snap.exists() ? snap.data() : null;
  } catch (e) { console.error(e); teacher = null; }
  if (!teacher) {
    app.innerHTML = `
      <div class="card signin">
        <h1>Teachers only</h1>
        <p class="muted">${esc(u.email)} isn't set up as a teacher in the KSA app.</p>
        <button class="btn ghost" id="out">Sign out</button>
      </div>`;
    app.querySelector("#out").onclick = () => signOut(auth);
    return;
  }
  await loadClasses();
  await refreshAssignments();
  A = assignments.find((x) => x.id === params.get("a")) || assignments[0];
  view === "submissions" ? await load() : renderAssignments();
});

async function refreshAssignments() {
  assignments = await listAssignments();
}

function resetHandlers() { app.onclick = app.oninput = app.onchange = null; }

function tabsHtml() {
  return `
    <header class="top">
      <h1>Gemara homework</h1>
      <div class="who">${esc(user.email)}<button class="btn ghost" id="out">Sign out</button></div>
    </header>
    <nav class="tabs">
      <button data-tab="assignments" class="${view === "assignments" ? "on" : ""}">Assignments</button>
      <button data-tab="submissions" class="${view === "submissions" ? "on" : ""}">Submissions</button>
    </nav>`;
}

function wireTabs() {
  app.querySelector("#out").onclick = () => signOut(auth);
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = async () => {
    view = b.dataset.tab;
    if (view === "submissions") await load(); else renderAssignments();
  }));
}

function renderAssignments() {
  resetHandlers();
  view = "assignments";
  history.replaceState(null, "", location.pathname);
  const fmtDate = (t) => (t?.toDate ? t.toDate().toLocaleDateString([], { month: "short", day: "numeric" }) : "");
  app.innerHTML = `
    ${tabsHtml()}
    <div class="toolbar"><button class="btn" id="new">New assignment</button></div>
    <div class="alist">
      ${assignments.map((x) => `
        <div class="card item">
          <div>
            <h3>${esc(x.title || "Untitled")}</h3>
            <div class="row small">
              ${x.builtIn ? `<span class="pill plain">Built in</span>` : x.status === "published" ? `<span class="pill good">Published</span>` : `<span class="pill warn">Draft</span>`}
              <span class="muted">${questionCount(x)} questions${x.voice ? " + voice memo" : ""}</span>
              ${x.updatedAt ? `<span class="muted">· updated ${esc(fmtDate(x.updatedAt))}</span>` : ""}
            </div>
          </div>
          <div class="row">
            <button class="btn ghost tiny" data-edit="${esc(x.id)}">Edit</button>
            ${x.status === "published" ? `<button class="btn ghost tiny" data-copy="${esc(x.id)}">Copy student link</button>` : ""}
            <button class="btn secondary tiny" data-subs="${esc(x.id)}">Submissions</button>
          </div>
        </div>`).join("")}
    </div>`;
  wireTabs();
  app.querySelector("#new").onclick = () => startBuilder(null);
  app.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => startBuilder(assignments.find((x) => x.id === b.dataset.edit))));
  app.querySelectorAll("[data-subs]").forEach((b) => (b.onclick = () => { A = assignments.find((x) => x.id === b.dataset.subs); load(); }));
  app.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
    const link = `${location.origin}/?a=${encodeURIComponent(b.dataset.copy)}`;
    try { await navigator.clipboard.writeText(link); b.textContent = "Link copied"; } catch { prompt("Copy this link:", link); }
  }));
}

function startBuilder(assignment) {
  resetHandlers();
  view = "builder";
  window.scrollTo(0, 0);
  openBuilder({
    root: app, user, assignment,
    onExit: async () => { resetHandlers(); await refreshAssignments(); renderAssignments(); window.scrollTo(0, 0); },
  });
}

function renderSignIn() {
  app.innerHTML = `
    <div class="card signin">
      <h1>Homework submissions</h1>
      <p class="muted">Sign in with your teacher account.</p>
      <button class="btn" id="signin">Sign in with Google</button>
    </div>`;
  app.querySelector("#signin").onclick = () => signIn().catch(console.error);
}

async function loadClasses() {
  classes = [];
  for (const code of teacher.classes || []) {
    try {
      const s = await getDoc(doc(db, "classes", code));
      if (s.exists()) {
        const d = s.data();
        classes.push({ code, name: d.name || code, students: (d.students || []).map((e) => e.toLowerCase()) });
      }
    } catch (e) { console.error(e); }
  }
}

async function load() {
  resetHandlers();
  view = "submissions";
  if (!A) { app.innerHTML = `${tabsHtml()}<div class="card muted">No assignments yet.</div>`; wireTabs(); return; }
  history.replaceState(null, "", `?a=${encodeURIComponent(A.id)}`);
  app.innerHTML = `${tabsHtml()}<p class="muted">Loading submissions…</p>`;
  wireTabs();
  try {
    const snap = await getDocs(query(collection(db, SUBMISSIONS), where("assignmentId", "==", A.id)));
    subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="notice bad">Couldn't load submissions: ${esc(e.message)}</div>`;
    return;
  }
  subs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  render();
}

function visibleSubs() {
  if (classFilter === "all") return subs;
  const c = classes.find((x) => x.code === classFilter);
  return c ? subs.filter((s) => c.students.includes(s.email)) : subs;
}

function render() {
  const list = visibleSubs();
  const scores = list.map((s) => scoreAnswers(A, s.answers));
  const total = scores[0]?.total ?? countQuestions();
  const avg = scores.length ? (scores.reduce((t, s) => t + s.correct, 0) / scores.length).toFixed(1) : "–";
  const failed = list.filter((s) => s.transcriptStatus && s.transcriptStatus !== "done").length;

  let missingHtml = "";
  if (classFilter !== "all") {
    const c = classes.find((x) => x.code === classFilter);
    const done = new Set(list.map((s) => s.email));
    const missing = (c?.students || []).filter((e) => !done.has(e));
    missingHtml = `
      <div class="card">
        <h2>Not submitted yet (${missing.length})</h2>
        ${missing.length ? `<p class="small" style="margin:0">${missing.map(esc).join(" · ")}</p>` : `<p class="muted small" style="margin:0">Everyone in this class has submitted.</p>`}
      </div>`;
  }

  const studentLink = `${location.origin}/?a=${encodeURIComponent(A.id)}`;

  app.innerHTML = `
    ${tabsHtml()}

    <div class="toolbar">
      <select id="asg">${assignments.map((a) => `<option value="${esc(a.id)}" ${a.id === A.id ? "selected" : ""}>${esc(a.title)}</option>`).join("")}</select>
      <select id="cls">
        <option value="all">All students</option>
        ${classes.map((c) => `<option value="${esc(c.code)}" ${c.code === classFilter ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <button class="btn secondary" id="refresh">Refresh</button>
      <button class="btn secondary" id="csv">Download CSV</button>
      <button class="btn secondary" id="copy">Copy student link</button>
    </div>

    <div class="stats">
      <div class="stat"><b>${list.length}</b><span class="muted small">submitted</span></div>
      <div class="stat"><b>${avg}${scores.length ? ` / ${total}` : ""}</b><span class="muted small">average on Parts A and B</span></div>
      <div class="stat"><b>${failed}</b><span class="muted small">transcripts missing</span></div>
    </div>

    ${missingHtml}

    <div id="list">
      ${list.length ? list.map((s) => subHtml(s)).join("") : `<div class="card muted">No submissions yet.</div>`}
    </div>`;

  wireTabs();
  app.querySelector("#asg").onchange = (e) => {
    A = assignments.find((x) => x.id === e.target.value);
    load();
  };
  app.querySelector("#cls").onchange = (e) => { classFilter = e.target.value; render(); };
  app.querySelector("#refresh").onclick = load;
  app.querySelector("#csv").onclick = downloadCsv;
  app.querySelector("#copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(studentLink); e.target.textContent = "Link copied"; }
    catch { prompt("Copy this link:", studentLink); }
  };

  app.querySelectorAll("details.sub").forEach((d) => {
    d.addEventListener("toggle", () => { if (d.open) loadAudio(d); }, { once: false });
  });
  app.querySelectorAll("[data-retry]").forEach((b) => (b.onclick = () => retry(b.dataset.retry, b)));
}

function countQuestions() { return questionCount(A); }

function statusPill(s) {
  if (s.transcriptStatus === "done") return `<span class="pill good">Transcribed</span>`;
  if (s.transcriptStatus === "failed") return `<span class="pill bad">Transcript failed</span>`;
  if (s.transcriptStatus === "pending") return `<span class="pill warn">Transcript pending</span>`;
  return `<span class="pill plain">No recording</span>`;
}

function subHtml(s) {
  const sc = scoreAnswers(A, s.answers);
  const cls = sc.correct === sc.total ? "good" : sc.correct >= sc.total / 2 ? "warn" : "bad";
  const when = s.submittedAt?.toDate ? s.submittedAt.toDate().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return `
    <details class="sub" data-id="${esc(s.id)}">
      <summary>
        <div><div class="name">${esc(s.name)}</div><div class="email">${esc(s.email)}</div></div>
        <span class="pill ${cls}">${sc.correct} / ${sc.total}</span>
        ${statusPill(s)}
        <span class="muted small">${esc(when)}</span>
      </summary>
      <div class="body">
        <div class="ans">${answersHtml(s, sc)}</div>
        <h3 style="font-size:16px;margin:16px 0 6px">Voice memo${s.audioSeconds ? ` <span class="muted small">(${Math.floor(s.audioSeconds / 60)}:${String(s.audioSeconds % 60).padStart(2, "0")})</span>` : ""}</h3>
        ${s.audioPath ? `<div class="audioSlot muted small">Loading audio…</div>` : `<p class="muted small">No recording.</p>`}
        ${s.transcriptStatus === "done"
          ? `<div class="transcript">${esc(s.transcript)}</div>`
          : s.audioPath
            ? `<div class="notice ${s.transcriptStatus === "failed" ? "bad" : "warn"}">No transcript yet.${s.transcriptError ? ` (${esc(s.transcriptError)})` : ""}
                 <button class="btn ghost" data-retry="${esc(s.id)}" style="margin-left:8px">Transcribe now</button></div>`
            : ""}
      </div>
    </details>`;
}

function answersHtml(s, sc) {
  let n = 0, out = "";
  for (const part of A.parts) for (const q of part.questions) {
    if (!q.id) continue;
    n++;
    const ok = sc.perQuestion[q.id];
    const a = s.answers?.[q.id];
    let given, right;
    if (q.type === "mcq") {
      given = a === undefined ? "–" : `${"abcd"[a]}. ${q.options[a]}`;
      right = `${"abcd"[q.answer]}. ${q.options[q.answer]}`;
    } else if (q.type === "order") {
      given = Array.isArray(a) ? a.map((x, i) => `${i + 1}) ${x || "–"}`).join("  ") : "–";
      right = q.answer.map((x, i) => `${i + 1}) ${x}`).join("  ");
    } else {
      given = a || "–"; right = q.answer;
    }
    out += `
      <span class="mark ${ok ? "good" : "bad"}">${ok ? "✓" : "✗"} ${n}</span>
      <div>${heb(given)}${ok ? "" : `<div class="correct">Answer: ${heb(right)}</div>`}</div>`;
  }
  return out;
}

async function loadAudio(details) {
  const slot = details.querySelector(".audioSlot");
  if (!slot || slot.dataset.loaded) return;
  const s = subs.find((x) => x.id === details.dataset.id);
  try {
    const url = await getDownloadURL(ref(storage, s.audioPath));
    slot.outerHTML = `<audio controls preload="metadata" src="${esc(url)}"></audio>`;
  } catch (e) {
    console.error(e);
    slot.textContent = `Couldn't load the audio (${e.code || e.message}).`;
    slot.dataset.loaded = "1";
  }
}

async function retry(id, btn) {
  const s = subs.find((x) => x.id === id);
  btn.disabled = true;
  btn.textContent = "Transcribing…";
  try {
    const url = await getDownloadURL(ref(storage, s.audioPath));
    const blob = await (await fetch(url)).blob();
    const ext = s.audioPath.split(".").pop();
    const text = await transcribe(blob, `memo.${ext}`);
    await updateDoc(doc(db, SUBMISSIONS, id), { transcript: text, transcriptStatus: "done", transcriptError: "" });
    Object.assign(s, { transcript: text, transcriptStatus: "done", transcriptError: "" });
    const open = new Set([...app.querySelectorAll("details.sub[open]")].map((d) => d.dataset.id));
    render();
    open.forEach((oid) => { const d = app.querySelector(`details.sub[data-id="${CSS.escape(oid)}"]`); if (d) d.open = true; });
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.textContent = "Try again";
    const msg = /Failed to fetch|NetworkError|Load failed/i.test(e.message)
      ? "The browser blocked downloading the audio. See the CORS step in the README."
      : e.message;
    btn.insertAdjacentHTML("afterend", `<div class="small" style="margin-top:6px">${esc(msg)}</div>`);
  }
}

function downloadCsv() {
  const list = visibleSubs();
  let qNums = [], n = 0;
  for (const part of A.parts) for (const q of part.questions) if (q.id) qNums.push([q, ++n]);
  const header = ["Name", "Email", "Submitted", "Score", "Out of", ...qNums.map(([, n]) => `Q${n} correct`), "Recording seconds", "Transcript"];
  const rows = list.map((s) => {
    const sc = scoreAnswers(A, s.answers);
    return [
      s.name, s.email,
      s.submittedAt?.toDate ? s.submittedAt.toDate().toISOString() : "",
      sc.correct, sc.total,
      ...qNums.map(([q]) => (sc.perQuestion[q.id] ? "yes" : "no")),
      s.audioSeconds || "", s.transcript || "",
    ];
  });
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `${A.id}-submissions.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
