// Teacher-side assignment builder: paste a Gemara, Claude drafts it, you edit and publish.
import { esc, heb } from "./firebase.js";
import { renumber, checkAssignment, questionCount } from "./assignments.js";
import { draftAssignment, reviseAssignment } from "./generator.js";
import { saveAssignment, deleteAssignment, newId } from "./store.js";

const BLANK_Q = {
  select: () => ({ type: "select", prompt: "", options: ["", ""], answer: "" }),
  order: () => ({ type: "order", prompt: "", joiner: "because", answer: ["", "", ""], options: [] }),
  mcq: () => ({ type: "mcq", prompt: "", options: ["", "", "", ""], answer: -1 }),
  dialogue: () => ({ type: "dialogue", lines: [["Teacher", ""], ["Student", ""]] }),
};
const TYPE_NAMES = { select: "Word bank", order: "Put in order", mcq: "Multiple choice", dialogue: "Everyday example" };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
const paras = (s) => String(s || "").split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

// opts: { root, user, assignment (existing or null), onExit }
export function openBuilder(opts) {
  const { root, user, onExit } = opts;
  // Plain copy without the Firestore timestamps (they aren't edited and don't copy cleanly).
  let a = null;
  if (opts.assignment) {
    const { createdAt, updatedAt, ...rest } = opts.assignment;
    a = JSON.parse(JSON.stringify(rest));
  }
  let form = {
    title: "", gemara: "", translation: "", focus: "",
    level: "easy", questionCount: 6, types: ["select", "order", "mcq", "dialogue"], voice: true, voiceFirst: true, voiceMinutes: 4,
  };
  let busy = "", message = null, dirty = false;

  // ---------- step 1: the request form ----------
  function renderForm() {
    root.innerHTML = `
      <header class="top">
        <h1>New assignment</h1>
        <div class="who"><button class="btn ghost" data-act="exit">Back to assignments</button></div>
      </header>
      <div class="card">
        <label class="field"><span>Title <span class="muted small">(optional, Claude will suggest one)</span></span>
          <input data-f="title" value="${esc(form.title)}" placeholder="Kiddushin 29a: Pidyon HaBen"></label>
        <label class="field"><span>Gemara text <span class="muted small">(paste it; leave a blank line between pieces)</span></span>
          <textarea data-f="gemara" rows="8" dir="rtl" class="he-input">${esc(form.gemara)}</textarea></label>
        <label class="field"><span>English translation <span class="muted small">(optional; shown under each piece for students, and makes Claude more accurate). Blank line between pieces, matching the Hebrew.</span></span>
          <textarea data-f="translation" rows="5">${esc(form.translation)}</textarea></label>
        <label class="field"><span>What should it focus on?</span>
          <textarea data-f="focus" rows="3" placeholder="e.g. reading the text, the concept, the circular logic in the answer">${esc(form.focus)}</textarea></label>
        <div class="grid2">
          <label class="field"><span>Level</span>
            <select data-f="level">
              <option value="easy" ${form.level === "easy" ? "selected" : ""}>Easy: word banks, dropdowns, very simple wording</option>
              <option value="standard" ${form.level === "standard" ? "selected" : ""}>Standard</option>
              <option value="challenging" ${form.level === "challenging" ? "selected" : ""}>Challenging</option>
            </select></label>
          <label class="field"><span>About how many questions?</span>
            <input data-f="questionCount" type="number" min="2" max="15" value="${form.questionCount}"></label>
          <label class="field"><span>Voice memo</span>
            <select data-f="voice">
              <option value="first" ${form.voice && form.voiceFirst ? "selected" : ""}>Yes, first: read and explain the Gemara, then the questions</option>
              <option value="last" ${form.voice && !form.voiceFirst ? "selected" : ""}>Yes, after the questions</option>
              <option value="no" ${!form.voice ? "selected" : ""}>No</option>
            </select></label>
        </div>
        ${form.voice ? `<label class="field"><span>Voice memo length (minutes)</span>
          <input data-f="voiceMinutes" type="number" min="1" max="10" value="${form.voiceMinutes}"></label>` : ""}
        <div class="field"><span>Question types to use</span>
          <div class="row">${Object.entries(TYPE_NAMES).map(([k, v]) => `
            <label class="check"><input type="checkbox" data-type="${k}" ${form.types.includes(k) ? "checked" : ""}> ${v}</label>`).join("")}</div>
        </div>
        ${message ? `<div class="notice ${message.kind}">${esc(message.text)}</div>` : ""}
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="draft" ${busy ? "disabled" : ""}>${busy || "Draft it with Claude"}</button>
          <button class="btn ghost" data-act="scratch" ${busy ? "disabled" : ""}>Start from scratch instead</button>
        </div>
        ${busy ? `<p class="muted small">This usually takes 30 to 60 seconds.</p>` : ""}
      </div>`;
  }

  // ---------- step 2: the editor ----------
  function qEditor(q, pi, qi, n) {
    const ctrl = `
      <div class="qctrl">
        <span class="pill plain">${TYPE_NAMES[q.type]}</span>
        <button class="btn ghost tiny" data-act="qup" data-p="${pi}" data-q="${qi}" title="Move up">↑</button>
        <button class="btn ghost tiny" data-act="qdown" data-p="${pi}" data-q="${qi}" title="Move down">↓</button>
        <button class="btn ghost tiny" data-act="qdel" data-p="${pi}" data-q="${qi}">Remove</button>
      </div>`;
    const P = `data-p="${pi}" data-q="${qi}"`;
    if (q.type === "dialogue") {
      return `<div class="qedit">${ctrl}
        <label class="field"><span>Example (one line each, "Speaker: what they say")</span>
          <textarea ${P} data-k="lines" rows="4">${esc(q.lines.map(([w, t]) => `${w}: ${t}`).join("\n"))}</textarea></label></div>`;
    }
    let body = `<label class="field"><span><b>${n}.</b> Question</span><textarea ${P} data-k="prompt" rows="2">${esc(q.prompt)}</textarea></label>`;
    if (q.type === "select") {
      body += `
        <label class="field"><span>Word bank (one choice per line)</span>
          <textarea ${P} data-k="options" rows="${Math.max(3, q.options.length)}">${esc(q.options.join("\n"))}</textarea></label>
        <label class="field"><span>Correct answer</span>
          <select ${P} data-k="answer">
            <option value="">Choose…</option>
            ${q.options.filter(Boolean).map((o) => `<option ${o === q.answer ? "selected" : ""}>${esc(o)}</option>`).join("")}
          </select></label>`;
    } else if (q.type === "order") {
      body += `
        <label class="field"><span>Steps in the CORRECT order (one per line). Students get them mixed up.</span>
          <textarea ${P} data-k="steps" rows="${Math.max(3, q.answer.length)}">${esc(q.answer.join("\n"))}</textarea></label>
        <label class="field narrow"><span>Word between steps</span><input ${P} data-k="joiner" value="${esc(q.joiner)}"></label>`;
    } else if (q.type === "mcq") {
      body += `<div class="field"><span>Choices (pick the correct one)</span>
        ${q.options.map((o, i) => `
          <div class="mcqedit">
            <input type="radio" name="right-${pi}-${qi}" ${P} data-k="right" value="${i}" ${q.answer === i ? "checked" : ""}>
            <b>${"abcd"[i]}.</b>
            <input ${P} data-k="opt" data-i="${i}" value="${esc(o)}">
          </div>`).join("")}</div>`;
    }
    return `<div class="qedit">${ctrl}${body}</div>`;
  }

  function checksHtml(errors, warnings) {
    return `${errors.length ? `<div class="notice bad"><b>Fix before publishing:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
      ${warnings.length ? `<div class="notice warn"><b>Worth a look:</b><ul>${warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}`;
  }

  // Updates the problem list, Publish button and "unsaved" note without redrawing the page,
  // so a click on a button right after editing a field isn't lost.
  function updateChecks() {
    if (!a) return;
    renumber(a);
    const { errors, warnings } = checkAssignment(a);
    const box = root.querySelector("#checks");
    if (box) box.innerHTML = checksHtml(errors, warnings);
    const pub = root.querySelector('[data-act="publish"]');
    if (pub) pub.disabled = !!busy || errors.length > 0;
    const d = root.querySelector("#dirty");
    if (d) d.textContent = dirty ? "Unsaved changes" : "";
  }

  function renderEditor() {
    renumber(a);
    const { errors, warnings } = checkAssignment(a);
    let n = 0;
    const published = a.status === "published";
    const link = a.id ? `${location.origin}/?a=${encodeURIComponent(a.id)}` : "";
    root.innerHTML = `
      <header class="top">
        <h1>${esc(a.title || "Untitled assignment")} ${published ? `<span class="pill good">Published</span>` : `<span class="pill warn">Draft</span>`}</h1>
        <div class="who"><button class="btn ghost" data-act="exit">Back to assignments</button></div>
      </header>

      ${message ? `<div class="notice ${message.kind}">${esc(message.text)}</div>` : ""}
      <div id="checks">${checksHtml(errors, warnings)}</div>
      ${a.teacherChecks?.length ? `<div class="notice info"><b>Check these against the text before publishing:</b><ul>${a.teacherChecks.map((e) => `<li>${heb(e)}</li>`).join("")}</ul></div>` : ""}

      <div class="card">
        <h2>Ask Claude to change something</h2>
        <textarea data-f="revise" rows="2" placeholder="e.g. make question 3 easier, add a word bank question about the mother, cut the dialogue">${esc(form.revise || "")}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn secondary" data-act="revise" ${busy ? "disabled" : ""}>${busy === "Revising…" ? busy : "Revise with Claude"}</button>
        <span class="muted small">Claude rewrites the whole draft. Edits you made by hand are kept unless you ask to change them.</span></div>
      </div>

      <div class="card">
        <h2>Basics</h2>
        <label class="field"><span>Title</span><input data-a="title" value="${esc(a.title)}"></label>
        <label class="field"><span>Instructions students see at the top</span><textarea data-a="intro" rows="3">${esc(a.intro)}</textarea></label>
        <label class="field"><span>Gemara text (blank line between pieces)</span>
          <textarea data-a="gemara" rows="8" dir="rtl" class="he-input">${esc((a.gemara || []).join("\n\n"))}</textarea></label>
        <label class="field"><span>English under each piece (blank line between pieces, same order as the Hebrew)</span>
          <textarea data-a="english" rows="8">${esc((a.english || []).join("\n\n"))}</textarea></label>
        <div class="field"><span>Pesukim (verses) shown under the text</span>
          ${(a.pesukim || []).map((p, i) => `
            <div class="pasuk">
              <input data-pasuk="${i}" data-k="he" dir="rtl" class="he-input" value="${esc(p.he)}" placeholder="pasuk">
              <input data-pasuk="${i}" data-k="ref" value="${esc(p.ref)}" placeholder="Shemos 34:20">
              <button class="btn ghost tiny" data-act="pdel" data-i="${i}">Remove</button>
            </div>`).join("")}
          <button class="btn ghost tiny" data-act="padd">Add pasuk</button>
        </div>
      </div>

      ${a.parts.map((part, pi) => `
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <input class="parttitle" data-part="${pi}" value="${esc(part.title)}">
            <button class="btn ghost tiny" data-act="partdel" data-p="${pi}">Remove part</button>
          </div>
          ${part.questions.map((q, qi) => qEditor(q, pi, qi, q.type === "dialogue" ? 0 : ++n)).join("")}
          <div class="row addq">
            <span class="muted small">Add:</span>
            ${Object.entries(TYPE_NAMES).map(([k, v]) => `<button class="btn ghost tiny" data-act="qadd" data-p="${pi}" data-t="${k}">${v}</button>`).join("")}
          </div>
        </div>`).join("")}
      <button class="btn ghost" data-act="partadd" style="margin-bottom:16px">Add a part</button>

      <div class="card">
        <h2>Voice memo</h2>
        <label class="check"><input type="checkbox" data-act="voicetoggle" ${a.voice ? "checked" : ""}> Include a voice memo</label>
        ${a.voice ? `<label class="check"><input type="checkbox" data-act="voicefirst" ${a.voiceFirst ? "checked" : ""}> Students do it first, before the questions</label>`: ""}
        ${a.voice ? `
          <label class="field"><span>Heading</span><input data-v="title" value="${esc(a.voice.title)}"></label>
          <label class="field narrow"><span>Max minutes</span><input data-v="minutes" type="number" min="1" max="10" step="0.5" value="${+(a.voice.maxSeconds / 60).toFixed(1)}"></label>
          <label class="field"><span>Instructions</span><textarea data-v="instructions" rows="3">${esc(a.voice.instructions)}</textarea></label>
          <label class="field"><span>Checklist (one per line)</span><textarea data-v="checklist" rows="4">${esc(a.voice.checklist.join("\n"))}</textarea></label>` : ""}
      </div>

      <div class="savebar">
        <button class="btn secondary" data-act="save" ${busy ? "disabled" : ""}>${busy === "Saving…" ? busy : "Save draft"}</button>
        ${published
          ? `<button class="btn ghost" data-act="unpublish" ${busy ? "disabled" : ""}>Unpublish</button>`
          : `<button class="btn" data-act="publish" ${busy || errors.length ? "disabled" : ""}>Publish</button>`}
        <button class="btn ghost" data-act="preview" ${busy ? "disabled" : ""}>Preview as a student</button>
        ${published ? `<button class="btn ghost" data-act="copy">Copy student link</button>` : ""}
        ${a.createdBy ? `<button class="btn ghost danger" data-act="delete" ${busy ? "disabled" : ""}>Delete</button>` : ""}
        <span class="muted small" id="dirty">${dirty ? "Unsaved changes" : ""}</span>
        ${published ? `<span class="muted small">${esc(link)}</span>` : ""}
      </div>`;
  }

  function render() {
    const y = window.scrollY;
    a ? renderEditor() : renderForm();
    window.scrollTo(0, y);
  }

  // ---------- events ----------
  function onInput(e) {
    const t = e.target;
    if (t.dataset.f) {
      const k = t.dataset.f;
      if (k === "voice") { form.voice = t.value !== "no"; form.voiceFirst = t.value === "first"; render(); return; }
      form[k] = t.type === "number" ? +t.value : t.value;
      return;
    }
    if (t.dataset.type) {
      const k = t.dataset.type;
      form.types = t.checked ? [...new Set([...form.types, k])] : form.types.filter((x) => x !== k);
      return;
    }
    if (!a) return;
    dirty = true;
    if (t.dataset.a) {
      const k = t.dataset.a;
      a[k] = k === "gemara" || k === "english" ? paras(t.value) : t.value;
      return;
    }
    if (t.dataset.pasuk !== undefined) { a.pesukim[+t.dataset.pasuk][t.dataset.k] = t.value; return; }
    if (t.dataset.part !== undefined) { a.parts[+t.dataset.part].title = t.value; return; }
    if (t.dataset.v) {
      const k = t.dataset.v;
      if (k === "minutes") a.voice.maxSeconds = Math.round(Math.max(1, +t.value || 3) * 60);
      else if (k === "checklist") a.voice.checklist = lines(t.value);
      else a.voice[k] = t.value;
      return;
    }
    if (t.dataset.k && t.dataset.q !== undefined) {
      const q = a.parts[+t.dataset.p].questions[+t.dataset.q];
      const k = t.dataset.k;
      if (k === "prompt" || k === "joiner") q[k] = t.value;
      else if (k === "answer") q.answer = t.value;
      else if (k === "opt") q.options[+t.dataset.i] = t.value;
      else if (k === "right") q.answer = +t.value;
      else if (k === "options") { q.options = lines(t.value); if (!q.options.includes(q.answer)) q.answer = ""; }
      else if (k === "steps") q.answer = lines(t.value);
      else if (k === "lines") q.lines = lines(t.value).map((l) => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l]; });
    }
  }

  // Re-render after edits that change what other fields should show (answer dropdowns, warnings).
  function onChange(e) {
    onInput(e);
    const t = e.target;
    if (!a || t.dataset.f) return;
    if (t.dataset.k === "options") {
      // Refresh the "correct answer" dropdown for this word-bank question in place.
      const q = a.parts[+t.dataset.p].questions[+t.dataset.q];
      const sel = root.querySelector(`select[data-p="${t.dataset.p}"][data-q="${t.dataset.q}"][data-k="answer"]`);
      if (sel) sel.innerHTML = `<option value="">Choose…</option>` +
        q.options.map((o) => `<option ${o === q.answer ? "selected" : ""}>${esc(o)}</option>`).join("");
    }
    updateChecks();
  }

  async function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const P = +b.dataset.p, Q = +b.dataset.q;
    if (act === "exit") {
      if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
      return onExit();
    }
    if (act === "scratch") {
      a = { title: form.title, intro: "", gemara: paras(form.gemara), english: paras(form.translation), pesukim: [],
            parts: [{ title: "Part A", questions: [] }], voice: null, status: "draft",
            sourceText: form.gemara, translation: form.translation, focus: form.focus };
      dirty = true; message = null; return render();
    }
    if (act === "draft") {
      if (!form.gemara.trim()) { message = { kind: "warn", text: "Paste the Gemara text first." }; return render(); }
      if (!form.types.length) { message = { kind: "warn", text: "Pick at least one question type." }; return render(); }
      busy = "Claude is drafting…"; message = null; render();
      try {
        const d = await draftAssignment({
          ...form,
          types: form.types.map((t) => TYPE_NAMES[t] + ` ("${t}")`),
          level: { easy: "Easy. Students struggle: use word banks and dropdowns, very short sentences, concrete examples.",
                   standard: "Standard high school level.", challenging: "Challenging: more reasoning, fewer hints." }[form.level],
        });
        a = { ...d, title: form.title.trim() || d.title, gemara: paras(form.gemara), english: paras(form.translation), status: "draft", voiceFirst: form.voice && form.voiceFirst,
              sourceText: form.gemara, translation: form.translation, focus: form.focus };
        dirty = true;
        message = { kind: "good", text: "Here's Claude's draft. Read every question, fix anything, then save or publish." };
      } catch (err) {
        console.error(err);
        message = { kind: "bad", text: `Couldn't draft it: ${err.message}` };
      }
      busy = ""; return render();
    }
    if (!a) return;
    if (act === "revise") {
      if (!form.revise?.trim()) { message = { kind: "warn", text: "Type what you want changed first." }; return render(); }
      busy = "Revising…"; message = null; render();
      try {
        const d = await reviseAssignment(a, a.sourceText || a.gemara.join("\n\n"), form.revise);
        const keep = { id: a.id, status: a.status, createdBy: a.createdBy, voiceFirst: a.voiceFirst,
                       gemara: a.gemara, english: a.english, sourceText: a.sourceText, translation: a.translation, focus: a.focus };
        a = { ...d, ...keep };
        form.revise = ""; dirty = true;
        message = { kind: "good", text: "Revised. Check the changes, then save." };
      } catch (err) {
        console.error(err);
        message = { kind: "bad", text: `Couldn't revise it: ${err.message}` };
      }
      busy = ""; return render();
    }
    const qs = (p) => a.parts[p].questions;
    if (act === "qadd") { qs(P).push(BLANK_Q[b.dataset.t]()); dirty = true; return render(); }
    if (act === "qdel") { qs(P).splice(Q, 1); dirty = true; return render(); }
    if (act === "qup" && Q > 0) { const l = qs(P); [l[Q - 1], l[Q]] = [l[Q], l[Q - 1]]; dirty = true; return render(); }
    if (act === "qdown" && Q < qs(P).length - 1) { const l = qs(P); [l[Q + 1], l[Q]] = [l[Q], l[Q + 1]]; dirty = true; return render(); }
    if (act === "partadd") { a.parts.push({ title: `Part ${"ABCDEFG"[a.parts.length] || a.parts.length + 1}`, questions: [] }); dirty = true; return render(); }
    if (act === "partdel") { if (confirm("Remove this whole part?")) { a.parts.splice(P, 1); dirty = true; } return render(); }
    if (act === "padd") { (a.pesukim ||= []).push({ he: "", ref: "" }); dirty = true; return render(); }
    if (act === "pdel") { a.pesukim.splice(+b.dataset.i, 1); dirty = true; return render(); }
    if (act === "voicetoggle") {
      a.voice = b.checked ? { title: "Voice memo", maxSeconds: 180, instructions: "Record yourself going through the Gemara step by step. Read each line, then explain it in your own words.", checklist: [] } : null;
      dirty = true; return render();
    }
    if (act === "voicefirst") { a.voiceFirst = b.checked; dirty = true; return render(); }
    if (act === "save") return save(a.status || "draft");
    if (act === "publish") return save("published");
    if (act === "unpublish") return save("draft");
    if (act === "preview") {
      if (!(await save(a.status || "draft"))) return;
      window.open(`/?a=${encodeURIComponent(a.id)}`, "_blank");
      return;
    }
    if (act === "copy") {
      const link = `${location.origin}/?a=${encodeURIComponent(a.id)}`;
      try { await navigator.clipboard.writeText(link); b.textContent = "Link copied"; } catch { prompt("Copy this link:", link); }
      return;
    }
    if (act === "delete") {
      if (!confirm("Delete this assignment? Student submissions for it are kept, but students can no longer open it.")) return;
      try { await deleteAssignment(a.id); dirty = false; onExit(); }
      catch (err) { message = { kind: "bad", text: `Couldn't delete: ${err.message}` }; render(); }
    }
  }

  async function save(status) {
    renumber(a);
    for (const p of a.parts) for (const q of p.questions) {
      if (q.type === "order") {
        const same = q.options?.length === q.answer.length && q.answer.every((s) => q.options.includes(s));
        if (!same) q.options = shuffle(q.answer);
      }
    }
    if (status === "published" && checkAssignment(a).errors.length) {
      message = { kind: "bad", text: "Fix the problems listed at the top before publishing." };
      render(); return false;
    }
    a.id ||= newId(a.title);
    a.status = status;
    busy = "Saving…"; render();
    try {
      await saveAssignment(a, user.email);
      a.createdBy ||= user.email;
      dirty = false;
      message = { kind: "good", text: status === "published" ? "Published. Copy the student link and post it." : "Saved as a draft. Students can't open it until you publish." };
      busy = ""; render(); return true;
    } catch (err) {
      console.error(err);
      message = { kind: "bad", text: `Couldn't save: ${err.message}` };
      busy = ""; render(); return false;
    }
  }

  root.oninput = onInput;
  root.onchange = onChange;
  root.onclick = onClick;
  render();
}
