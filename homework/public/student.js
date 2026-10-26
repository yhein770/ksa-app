import {
  auth, db, storage, signIn, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, serverTimestamp, ref, uploadBytes,
  SUBMISSIONS, submissionId, audioPath, transcribe, esc, heb,
} from "./firebase.js";
import { loadAssignment } from "./store.js";
import { bareTitle } from "./assignments.js";
import { boldHtml } from "./sefaria.js";

const params = new URLSearchParams(location.search);
const app = document.getElementById("app");
let A = null;

let user = null;
let showEnglish = true;
let answers = {};
let existing = null;          // submission already saved in Firestore
let recording = null;         // { blob, ext, type, seconds, url } for a new, unsaved recording
let recorder = null, chunks = [], timerId = null, startedAt = 0;

// ---------- drafts (per student, per assignment, this browser only) ----------
const draftKey = () => `hw-draft:${A.id}:${user?.email}`;
function saveDraft() { try { localStorage.setItem(draftKey(), JSON.stringify(answers)); } catch {} }
function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch {} }

// ---------- auth ----------
onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) return renderSignIn();
  app.innerHTML = `<p class="muted">Loading your work…</p>`;
  A = await loadAssignment(params.get("a"));
  if (!A) return renderMessage("This assignment doesn't exist. Check the link your teacher posted.");
  if (A.status !== "published") {
    let isTeacher = false;
    try { isTeacher = (await getDoc(doc(db, "teachers", u.email))).exists(); } catch {}
    if (!isTeacher) return renderMessage("This assignment isn't open yet. Check with your teacher.");
  }
  document.title = A.title;
  try {
    const snap = await getDoc(doc(db, SUBMISSIONS, submissionId(A.id, u.email)));
    existing = snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error(e);
    existing = null;
  }
  answers = existing?.answers ? structuredClone(existing.answers) : (loadDraft() || {});
  render();
});

function renderMessage(text) {
  app.innerHTML = `
    <div class="card signin">
      <p>${esc(text)}</p>
      <button class="btn ghost" id="signout">Sign out</button>
    </div>`;
  app.querySelector("#signout").onclick = () => signOut(auth);
}

function renderSignIn() {
  app.innerHTML = `
    <div class="card signin">
      <h1>Gemara homework</h1>
      <p class="muted">Sign in with your school Google account to start.</p>
      <button class="btn" id="signin">Sign in with Google</button>
      <p class="notice bad" id="err" hidden></p>
    </div>`;
  app.querySelector("#signin").onclick = async () => {
    try { await signIn(); }
    catch (e) {
      const el = app.querySelector("#err");
      el.hidden = false;
      el.textContent = "Sign-in didn't work. Allow pop-ups for this site and try again.";
      console.error(e);
    }
  };
}

// ---------- main render ----------
function render() {
  let n = 0;
  // Sections are lettered in the order students see them (voice memo first or last).
  const order = [];
  if (A.voice && A.voiceFirst) order.push("voice");
  A.parts.forEach((_, i) => order.push(i));
  if (A.voice && !A.voiceFirst) order.push("voice");
  const letter = (key) => "ABCDEFGHIJ"[order.indexOf(key)];
  const voiceSection = A.voice ? `<section class="card" id="voice">${voiceHtml(letter("voice"))}</section>` : "";
  const partsHtml = A.parts.map((part, pi) => `
    <section class="card">
      <h2>Part ${letter(pi)}: ${esc(bareTitle(part.title))}</h2>
      ${part.questions.map((q) => {
        if (q.type === "dialogue") {
          return `<div class="dialogue">${q.lines.map(([who, line]) => `<p><b>${esc(who)}:</b> ${esc(line)}</p>`).join("")}</div>`;
        }
        n++;
        return `<div class="q" data-q="${q.id}">${questionHtml(q, n)}</div>`;
      }).join("")}
    </section>`).join("");

  app.innerHTML = `
    <header class="top">
      <h1>${esc(A.title)}</h1>
      <div class="who">${esc(user.displayName || user.email)}<button class="btn ghost" id="signout">Sign out</button></div>
    </header>
    ${A.status !== "published" ? `<div class="notice warn">Preview. Students can't see this until you publish it.</div>` : ""}
    ${existing ? submittedBanner() : ""}
    <section class="card">
      ${A.intro ? `<p style="margin-top:0">${heb(A.intro)}</p>` : ""}
      ${A.english?.some(Boolean) ? `<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn ghost tiny" id="toggleEn">${showEnglish ? "Hide English" : "Show English"}</button></div>` : ""}
      <div class="gemara">${A.gemara.map((p, i) => `
        <div class="piece">
          <p>${esc(p)}</p>
          ${showEnglish && A.english?.[i] ? `<p class="en">${boldHtml(A.english[i], esc)}</p>` : ""}
        </div>`).join("")}</div>
      <div class="pesukim">${(A.pesukim || []).map((p) => `<div><span class="muted small">${esc(p.ref)}:</span> <bdi class="he">${esc(p.he)}</bdi></div>`).join("")}</div>
    </section>
    ${A.voiceFirst ? voiceSection : ""}
    ${partsHtml}
    ${A.voiceFirst ? "" : voiceSection}
    <div class="row">
      <button class="btn" id="submit">${existing ? "Submit again" : "Submit homework"}</button>
      <span class="muted small" id="submitHint"></span>
    </div>
    <div id="status"></div>`;

  app.querySelector("#signout").onclick = () => signOut(auth);
  const tg = app.querySelector("#toggleEn");
  if (tg) tg.onclick = () => { showEnglish = !showEnglish; saveDraft(); render(); };
  wireQuestions();
  if (A.voice) wireVoice();
  app.querySelector("#submit").onclick = submit;
}

function submittedBanner() {
  const when = existing.submittedAt?.toDate ? existing.submittedAt.toDate().toLocaleString() : "";
  return `<div class="notice good">You submitted this ${esc(when)}. You can change your answers or re-record and submit again. Your last submission is what your teacher sees.</div>`;
}

function questionHtml(q, n) {
  const a = answers[q.id];
  if (q.type === "select") {
    return `
      <label class="prompt" for="${q.id}"><span class="num">${n}.</span>${heb(q.prompt)}</label>
      <select id="${q.id}">
        <option value="">Choose…</option>
        ${q.options.map((o) => `<option ${a === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
      </select>`;
  }
  if (q.type === "order") {
    const cur = Array.isArray(a) ? a : [];
    return `
      <label class="prompt"><span class="num">${n}.</span>${heb(q.prompt)}</label>
      <div class="chain">
        ${q.answer.map((_, i) => `
          <div class="step">
            <span class="because">${i === 0 ? "1st reason" : esc(q.joiner || "then")}</span>
            <select data-slot="${i}">
              <option value="">Choose…</option>
              ${q.options.map((o) => `<option ${cur[i] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
            </select>
          </div>`).join("")}
      </div>`;
  }
  if (q.type === "mcq") {
    return `
      <p class="prompt"><span class="num">${n}.</span>${heb(q.prompt)}</p>
      <div class="mcq">
        ${q.options.map((o, i) => `
          <label><input type="radio" name="${q.id}" value="${i}" ${a === i ? "checked" : ""}>
          <span><b>${"abcd"[i]}.</b> ${heb(o)}</span></label>`).join("")}
      </div>`;
  }
  return "";
}

function wireQuestions() {
  for (const part of A.parts) for (const q of part.questions) {
    if (!q.id) continue;
    const box = app.querySelector(`[data-q="${q.id}"]`);
    if (q.type === "select") {
      box.querySelector("select").onchange = (e) => { answers[q.id] = e.target.value || undefined; saveDraft(); };
    } else if (q.type === "order") {
      box.querySelectorAll("select").forEach((s) => {
        s.onchange = () => {
          const arr = Array.isArray(answers[q.id]) ? answers[q.id] : [];
          arr[+s.dataset.slot] = s.value || null;
          answers[q.id] = arr;
          saveDraft();
        };
      });
    } else if (q.type === "mcq") {
      box.querySelectorAll("input").forEach((r) => { r.onchange = () => { answers[q.id] = +r.value; saveDraft(); }; });
    }
  }
}

// ---------- recording ----------
let voiceLetter = "";
function voiceHtml(l) {
  if (l) voiceLetter = l;
  const V = A.voice;
  const hasSaved = existing?.audioPath && !recording;
  return `
    <h2>Part ${voiceLetter}: ${esc(bareTitle(V.title))} <span class="muted small">(${+(V.maxSeconds / 60).toFixed(1)} minutes max)</span></h2>
    <p style="margin-top:0">${heb(V.instructions)}</p>
    <ul class="checklist">${V.checklist.map((c) => `<li>${heb(c)}</li>`).join("")}</ul>
    <div class="row" id="recControls">
      <button class="btn record" id="recBtn">${recording || hasSaved ? "Record again" : "Start recording"}</button>
      <span id="recState" class="muted small">${
        recording ? `New recording ready (${fmt(recording.seconds)}). It will be sent when you submit.`
        : hasSaved ? "Your submitted recording is saved." : ""}</span>
    </div>
    ${recording ? `<audio controls src="${recording.url}"></audio>` : ""}
    <div id="micErr"></div>`;
}

function wireVoice() {
  const btn = app.querySelector("#recBtn");
  btn.onclick = () => (recorder && recorder.state === "recording" ? stopRec() : startRec());
}

function pickType() {
  const prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return prefs.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}
function extFor(type) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function startRec() {
  const errBox = app.querySelector("#micErr");
  errBox.innerHTML = "";
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    errBox.innerHTML = `<div class="notice bad">This browser can't record audio. Use Chrome, or Safari on an iPhone or iPad.</div>`;
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    errBox.innerHTML = `<div class="notice bad">The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.</div>`;
    return;
  }
  const type = pickType();
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(timerId);
    const realType = (recorder.mimeType || type || "audio/webm").split(";")[0];
    const blob = new Blob(chunks, { type: realType });
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    if (recording?.url) URL.revokeObjectURL(recording.url);
    if (seconds < 3 || blob.size < 1000) {
      recording = null;
      app.querySelector("#voice").innerHTML = voiceHtml();
      wireVoice();
      app.querySelector("#micErr").innerHTML = `<div class="notice warn">That recording was too short. Try again.</div>`;
      return;
    }
    recording = { blob, type: realType, ext: extFor(realType), seconds, url: URL.createObjectURL(blob) };
    setStatus("");
    app.querySelector("#voice").innerHTML = voiceHtml();
    wireVoice();
  };
  recorder.start(1000);
  startedAt = Date.now();
  const btn = app.querySelector("#recBtn");
  const state = app.querySelector("#recState");
  btn.textContent = "Stop recording";
  const max = A.voice.maxSeconds;
  const tick = () => {
    const s = (Date.now() - startedAt) / 1000;
    state.innerHTML = `<span class="recdot"></span> <span class="timer">${fmt(s)}</span> / ${fmt(max)}`;
    if (s >= max) stopRec();
  };
  tick();
  timerId = setInterval(tick, 250);
}

function stopRec() {
  if (recorder && recorder.state === "recording") recorder.stop();
}

// ---------- submit ----------
function missingQuestions() {
  const missing = [];
  let n = 0;
  for (const part of A.parts) for (const q of part.questions) {
    if (!q.id) continue;
    n++;
    const a = answers[q.id];
    const done = q.type === "order"
      ? Array.isArray(a) && q.answer.every((_, i) => a[i])
      : a !== undefined && a !== null && a !== "";
    if (!done) missing.push(n);
  }
  return missing;
}

function setStatus(html) { app.querySelector("#status").innerHTML = html; }

async function submit() {
  const btn = app.querySelector("#submit");
  if (recorder && recorder.state === "recording") {
    setStatus(`<div class="notice warn">Stop your recording first.</div>`);
    return;
  }
  const missing = missingQuestions();
  if (missing.length) {
    setStatus(`<div class="notice warn">Answer question${missing.length > 1 ? "s" : ""} ${missing.join(", ")} before you submit.</div>`);
    return;
  }
  if (A.voice && !recording && !existing?.audioPath) {
    setStatus(`<div class="notice warn">Record your voice memo before you submit.</div>`);
    return;
  }

  btn.disabled = true;
  const id = submissionId(A.id, user.email);
  const docRef = doc(db, SUBMISSIONS, id);
  const base = {
    assignmentId: A.id,
    email: user.email.toLowerCase(),
    name: user.displayName || user.email,
    uid: user.uid,
    answers,
    submittedAt: serverTimestamp(),
  };

  try {
    if (recording) {
      setStatus(`<div class="notice info">Uploading your recording…</div>`);
      const path = audioPath(A.id, user.email, recording.ext);
      await uploadBytes(ref(storage, path), recording.blob, { contentType: recording.type });
      await setDoc(docRef, {
        ...base,
        audioPath: path,
        audioType: recording.type,
        audioSeconds: recording.seconds,
        transcript: "",
        transcriptStatus: "pending",
        transcriptError: "",
      }, { merge: true });
    } else {
      await setDoc(docRef, base, { merge: true });
    }
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    setStatus(`<div class="notice bad">Your homework didn't save. Check your internet and press Submit again. (${esc(e.code || e.message)})</div>`);
    return;
  }

  clearDraft();

  if (recording) {
    setStatus(`<div class="notice info">Saved. Transcribing your recording…</div>`);
    try {
      const text = await transcribe(recording.blob, `memo.${recording.ext}`);
      await updateDoc(docRef, { transcript: text, transcriptStatus: "done", transcriptError: "" });
    } catch (e) {
      console.error(e);
      // The recording is saved either way. The teacher page can retry transcription.
      try { await updateDoc(docRef, { transcriptStatus: "failed", transcriptError: String(e.message || e) }); } catch {}
    }
  }

  const snap = await getDoc(docRef).catch(() => null);
  existing = snap?.exists() ? snap.data() : { ...base, submittedAt: null };
  if (recording?.url) URL.revokeObjectURL(recording.url);
  recording = null;
  render();
  setStatus(`<div class="notice good">Done. Your homework is submitted.</div>`);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}
