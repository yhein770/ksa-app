import { useState, useEffect, useRef } from "react";
import { db, auth, storage } from "./firebase";
import { doc, getDoc, setDoc, arrayUnion, arrayRemove, collection, addDoc, query, orderBy, onSnapshot, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

const C = {
  bg: "#F5F0EB", label: "#1A1A1A", muted: "#8E8E93",
  border: "rgba(0,0,0,.1)", brown: "#5C3317", green: "#34C759",
  red: "#FF3B30", blue: "#007AFF", gold: "#B8860B", purple: "#5856D6",
};

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;background:#F5F0EB;}`;

// ── Firestore helpers ─────────────────────────────────────────────────────────

export async function loadTeacher(email) {
  try {
    const snap = await getDoc(doc(db, "teachers", email));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error("loadTeacher error:", e); return null; }
}

async function saveTeacher(email, data) {
  try {
    await setDoc(doc(db, "teachers", email), { ...data, lastSeen: new Date().toISOString() }, { merge: true });
  } catch (e) { console.error("saveTeacher:", e); }
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function createClass(teacherEmail, className) {
  let code, attempts = 0;
  do {
    code = generateCode();
    const snap = await getDoc(doc(db, "classes", code));
    if (!snap.exists()) break;
  } while (++attempts < 10);
  const data = { code, name: className, teacherEmail, students: [], assignments: {}, createdAt: new Date().toISOString() };
  await setDoc(doc(db, "classes", code), data);
  await setDoc(doc(db, "teachers", teacherEmail), { classes: arrayUnion(code) }, { merge: true });
  return data;
}

async function deleteClass(code, teacherEmail, studentEmails) {
  await Promise.all((studentEmails || []).map(email =>
    setDoc(doc(db, "students", email), { classCodes: arrayRemove(code) }, { merge: true })
  ));
  await setDoc(doc(db, "teachers", teacherEmail), { classes: arrayRemove(code) }, { merge: true });
  await deleteDoc(doc(db, "classes", code));
}

export async function loadClass(code) {
  try {
    const snap = await getDoc(doc(db, "classes", code.toUpperCase()));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error("loadClass error:", e); return null; }
}

export async function joinClass(studentEmail, code) {
  const cls = await loadClass(code.trim().toUpperCase());
  if (!cls) return { error: "Class not found. Check the code and try again." };
  const upperCode = code.trim().toUpperCase();
  await setDoc(doc(db, "classes", upperCode), { students: arrayUnion(studentEmail) }, { merge: true });
  await setDoc(doc(db, "students", studentEmail), { classCodes: arrayUnion(upperCode) }, { merge: true });
  return { success: true, className: cls.name };
}

async function removeStudent(studentEmail, code) {
  await setDoc(doc(db, "classes", code), { students: arrayRemove(studentEmail) }, { merge: true });
  await setDoc(doc(db, "students", studentEmail), { classCodes: arrayRemove(code) }, { merge: true });
}

async function loadStudentDoc(email) {
  try {
    const snap = await getDoc(doc(db, "students", email));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

async function updateAssignments(code, assignments) {
  await setDoc(doc(db, "classes", code), { assignments }, { merge: true });
}

export async function sendMessage(classCode, msg) {
  await addDoc(collection(db, "classes", classCode, "messages"), {
    ...msg,
    timestamp: new Date().toISOString(),
  });
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Btn({ children, onClick, bg, style, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "rgba(0,0,0,.08)" : (bg || "white"),
      color: disabled ? C.muted : (bg ? "white" : C.label),
      border: bg ? "none" : `1px solid ${C.border}`,
      borderRadius: 12, padding: "11px 20px", fontSize: 15,
      fontWeight: 500, cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit", transition: "opacity .15s",
      ...style,
    }}>{children}</button>
  );
}

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 5, background: "rgba(0,0,0,.07)", borderRadius: 980, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color || C.green, borderRadius: 980, transition: "width .4s" }} />
    </div>
  );
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function ksaMastered(allProgress) {
  if (!allProgress) return 0;
  return Object.values(allProgress).reduce((sum, seifs) =>
    sum + Object.values(seifs || {}).filter(v => v === "mastered").length, 0);
}

function talmudMastered(talmudProgress) {
  if (!talmudProgress) return 0;
  return Object.values(talmudProgress).filter(v => v?.kriah && v?.quiz).length;
}

function formatRelTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

export function ChatPanel({ classCode, className, currentUser, onClose, style }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "classes", classCode, "messages"), orderBy("timestamp"));
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingMsgs(false);
    });
    return unsub;
  }, [classCode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isTeacher = currentUser.role === "teacher";

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await sendMessage(classCode, {
      email: currentUser.email,
      name: currentUser.name,
      role: currentUser.role || "student",
      text: t,
    });
    inputRef.current?.focus();
  }

  async function deleteMessage(msgId) {
    try {
      await deleteDoc(doc(db, "classes", classCode, "messages", msgId));
    } catch (e) { console.error("deleteMessage error:", e); }
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", ...style }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `0.5px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.label }}>{className}</div>
            <div style={{ fontSize: 12, color: C.muted }}>Class Chat</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: C.muted, lineHeight: 1 }}>×</button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {loadingMsgs ? (
          <p style={{ color: C.muted, textAlign: "center", padding: "30px 0" }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={{ color: C.muted, textAlign: "center", padding: "40px 0", fontSize: 14 }}>No messages yet. Say something!</p>
        ) : messages.map((m, i) => {
          const isMe = m.email === currentUser.email;
          const showName = !isMe && (i === 0 || messages[i - 1].email !== m.email);
          return (
            <div key={m.id} style={{ marginBottom: 6, display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
              {showName && (
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 3, paddingLeft: 4, fontWeight: 500 }}>
                  {m.name} {m.role === "teacher" && <span style={{ color: C.brown }}>· Teacher</span>}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: isMe ? "row-reverse" : "row" }}>
                <div style={{
                  maxWidth: "72%", padding: "8px 13px", borderRadius: 14,
                  borderBottomRightRadius: isMe ? 4 : 14,
                  borderBottomLeftRadius: isMe ? 14 : 4,
                  background: isMe ? C.brown : "white",
                  color: isMe ? "white" : C.label,
                  fontSize: 14, lineHeight: 1.5,
                  boxShadow: "0 1px 3px rgba(0,0,0,.07)",
                }}>
                  {m.text}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: C.muted }}>{formatTime(m.timestamp)}</div>
                  {isTeacher && (
                    <button onClick={() => deleteMessage(m.id)} title="Delete message" style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(0,0,0,.2)", fontSize: 13, lineHeight: 1, borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red}
                      onMouseLeave={e => e.currentTarget.style.color = "rgba(0,0,0,.2)"}>
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: `0.5px solid ${C.border}`, flexShrink: 0, background: "white" }}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Message…"
          style={{ flex: 1, padding: "9px 14px", border: `1px solid ${C.border}`, borderRadius: 20, fontFamily: "inherit", fontSize: 14, outline: "none", background: "#fafafa" }}
        />
        <button onClick={send} disabled={!text.trim()} style={{
          background: text.trim() ? C.brown : "rgba(0,0,0,.08)", color: text.trim() ? "white" : C.muted,
          border: "none", borderRadius: 20, padding: "9px 18px", cursor: text.trim() ? "pointer" : "default",
          fontFamily: "inherit", fontSize: 14, fontWeight: 600, transition: "background .15s",
        }}>Send</button>
      </div>
    </div>
  );
}

// ── Feed Panel ────────────────────────────────────────────────────────────────

const MASECHTOS = [
  "Berakhot","Shabbat","Eruvin","Pesachim","Rosh Hashanah","Yoma","Sukkah","Beitzah",
  "Taanit","Megillah","Moed Katan","Chagigah","Yevamot","Ketubot","Nedarim","Nazir",
  "Sotah","Gittin","Kiddushin","Bava Kamma","Bava Metzia","Bava Batra","Sanhedrin",
  "Makkot","Shevuot","Avodah Zarah","Horayot","Zevachim","Menachot","Chullin",
  "Bekhorot","Arakhin","Temurah","Keritot","Meilah","Niddah",
];

const TYPE_META = {
  announcement: { label: "Announcement", color: C.blue },
  assignment:   { label: "Assignment",   color: C.gold },
  resource:     { label: "Resource",     color: C.purple },
};

export function FeedPanel({ classCode, isTeacher, currentUser, onAssignmentSaved, onSelectAssignment, onPreviewAssignment, onViewProgress, filterType, allProgress, talmudProgress, onCountChange }) {
  const [items, setItems] = useState([]);
  const [composing, setComposing] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [postType, setPostType] = useState("announcement");
  // announcement
  const [annText, setAnnText] = useState("");
  // assignment
  const [assignName, setAssignName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ksaMode, setKsaMode] = useState("all");
  const [ksaFrom, setKsaFrom] = useState("");
  const [ksaTo, setKsaTo] = useState("");
  const [talmudMasechet, setTalmudMasechet] = useState("");
  const [talmudDaf, setTalmudDaf] = useState("");
  const [talmudFromSeg, setTalmudFromSeg] = useState("");
  const [talmudToSeg, setTalmudToSeg] = useState("");
  // resource
  const [resTitle, setResTitle] = useState("");
  const [resDesc, setResDesc] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resFile, setResFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "classes", classCode, "feed"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(q, snap => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setItems(loaded);
      if (onCountChange) {
        const count = filterType ? loaded.filter(i => i.type === filterType).length : loaded.length;
        onCountChange(count);
      }
    });
    return unsub;
  }, [classCode]);

  function resetForm() {
    setAnnText(""); setAssignName(""); setDueDate(""); setKsaMode("all"); setKsaFrom(""); setKsaTo("");
    setTalmudMasechet(""); setTalmudDaf(""); setTalmudFromSeg(""); setTalmudToSeg(""); setResTitle(""); setResDesc(""); setResUrl(""); setResFile(null); setUploadProgress(null); setUploadError(null);
    setEditingItem(null);
    setComposing(false);
  }

  function startEdit(item) {
    setPostType("assignment");
    setAssignName(item.title || "");
    setDueDate(item.dueDate || "");
    const ksa = item.assignmentData?.ksa;
    if (ksa?.all) { setKsaMode("all"); }
    else if (ksa?.simanim?.length) { setKsaMode("range"); setKsaFrom(String(Math.min(...ksa.simanim))); setKsaTo(String(Math.max(...ksa.simanim))); }
    else { setKsaMode("none"); }
    const t = item.assignmentData?.talmud;
    setTalmudMasechet(t?.masechet || "");
    setTalmudDaf(t?.daf || "");
    setTalmudFromSeg(t?.fromSeg ? String(t.fromSeg) : "");
    setTalmudToSeg(t?.toSeg ? String(t.toSeg) : "");
    setEditingItem(item);
    setComposing(true);
  }

  async function post() {
    setPosting(true);
    const base = { type: postType, authorName: currentUser.name, authorEmail: currentUser.email };
    let item;

    if (postType === "announcement") {
      if (!annText.trim()) { setPosting(false); return; }
      item = { ...base, text: annText.trim() };
    } else if (postType === "assignment") {
      const ksaSimanim = ksaMode === "range" && ksaFrom && ksaTo
        ? Array.from({ length: Math.max(0, parseInt(ksaTo) - parseInt(ksaFrom) + 1) }, (_, i) => parseInt(ksaFrom) + i).filter(n => n >= 1 && n <= 221)
        : null;
      const talmudData = talmudMasechet && talmudDaf
        ? { masechet: talmudMasechet, daf: talmudDaf, fromSeg: talmudFromSeg ? parseInt(talmudFromSeg) : 1, toSeg: talmudToSeg ? parseInt(talmudToSeg) : null, masechtos: [talmudMasechet] }
        : null;
      const assignmentData = {
        ksa: ksaSimanim?.length ? { simanim: ksaSimanim } : (ksaMode === "all" ? { all: true } : null),
        talmud: talmudData,
      };
      item = { ...base, assignmentData, title: assignName.trim() || "Assignment", dueDate: dueDate || null };
      await updateAssignments(classCode, assignmentData);
      onAssignmentSaved?.(assignmentData);
    } else if (postType === "resource") {
      if (!resTitle.trim()) { setPosting(false); return; }
      let fileUrl = null;
      let fileName = null;
      if (resFile) {
        setUploadError(null);
        setUploadProgress(10);
        fileName = resFile.name;
        try {
          const storageRef = ref(storage, `class-files/${classCode}/${Date.now()}_${resFile.name}`);
          setUploadProgress(30);
          const snapshot = await uploadBytes(storageRef, resFile);
          setUploadProgress(80);
          fileUrl = await getDownloadURL(snapshot.ref);
          setUploadProgress(100);
        } catch (err) {
          console.error("Upload failed:", err);
          setUploadError(`Upload failed: ${err.code || err.message}`);
          setUploadProgress(null);
          setPosting(false);
          return;
        }
      }
      item = { ...base, title: resTitle.trim(), description: resDesc.trim(), url: resUrl.trim(), fileUrl, fileName };
    }

    if (editingItem) {
      await setDoc(doc(db, "classes", classCode, "feed", editingItem.id), {
        ...item,
        timestamp: editingItem.timestamp,
        editedAt: new Date().toISOString(),
      });
    } else {
      await addDoc(collection(db, "classes", classCode, "feed"), {
        ...item,
        timestamp: new Date().toISOString(),
      });
    }
    resetForm();
    setPosting(false);
  }

  return (
    <div>
      {/* Compose button */}
      {isTeacher && !composing && (
        <button onClick={() => setComposing(true)} style={{ width: "100%", background: "rgba(92,51,23,.06)", border: "1.5px dashed rgba(92,51,23,.25)", borderRadius: 14, padding: "13px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: C.brown, fontWeight: 500, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Post to Feed
        </button>
      )}

      {/* Compose sheet */}
      {isTeacher && composing && (
        <div style={{ background: "white", borderRadius: 16, padding: "18px 20px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
          {editingItem && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontWeight: 500 }}>Editing assignment</div>}
          {/* Type tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {Object.entries(TYPE_META).map(([t, { label, color }]) => (
              <button key={t} onClick={() => !editingItem && setPostType(t)} style={{ flex: 1, padding: "7px 6px", borderRadius: 10, border: "none", cursor: editingItem ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: postType === t ? color : "rgba(0,0,0,.06)", color: postType === t ? "white" : C.label, transition: "all .12s", opacity: editingItem && postType !== t ? 0.4 : 1 }}>{label}</button>
            ))}
          </div>

          {/* Announcement */}
          {postType === "announcement" && (
            <textarea value={annText} onChange={e => setAnnText(e.target.value)} placeholder="Write an announcement for your class…" rows={3}
              style={{ width: "100%", padding: "10px 14px", border: `1px solid ${C.border}`, borderRadius: 12, fontFamily: "inherit", fontSize: 14, outline: "none", resize: "vertical", marginBottom: 4 }} />
          )}

          {/* Assignment */}
          {postType === "assignment" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Assignment Name</div>
                  <input value={assignName} onChange={e => setAssignName(e.target.value)} placeholder="e.g. Chapter 5 – Shabbat"
                    style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Due Date</div>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    style={{ width: "100%", padding: "9px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.label, marginBottom: 8 }}>Kitzur Shulchan Aruch</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["all", "All simanim"], ["range", "Custom range"], ["none", "None"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setKsaMode(val)} style={{ flex: 1, padding: "6px 8px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 500, background: ksaMode === val ? C.brown : "rgba(0,0,0,.06)", color: ksaMode === val ? "white" : C.label }}>{lbl}</button>
                ))}
              </div>
              {ksaMode === "range" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                  <input type="number" min="1" max="221" value={ksaFrom} onChange={e => setKsaFrom(e.target.value)} placeholder="From"
                    style={{ flex: 1, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
                  <span style={{ color: C.muted }}>–</span>
                  <input type="number" min="1" max="221" value={ksaTo} onChange={e => setKsaTo(e.target.value)} placeholder="To"
                    style={{ flex: 1, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
                </div>
              )}
              <div style={{ fontWeight: 600, fontSize: 13, color: C.label, marginBottom: 8 }}>Talmud</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select value={talmudMasechet} onChange={e => setTalmudMasechet(e.target.value)}
                  style={{ flex: 2, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", background: "white", color: talmudMasechet ? C.label : C.muted }}>
                  <option value="">Masechet…</option>
                  {MASECHTOS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <input value={talmudDaf} onChange={e => setTalmudDaf(e.target.value)} placeholder="Daf (e.g. 2a)"
                  style={{ flex: 1, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Segments</div>
                <input type="number" min="1" value={talmudFromSeg} onChange={e => setTalmudFromSeg(e.target.value)} placeholder="From"
                  style={{ flex: 1, padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
                <span style={{ color: C.muted }}>–</span>
                <input type="number" min="1" value={talmudToSeg} onChange={e => setTalmudToSeg(e.target.value)} placeholder="To"
                  style={{ flex: 1, padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", textAlign: "center" }} />
              </div>
            </div>
          )}

          {/* Resource */}
          {postType === "resource" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input value={resTitle} onChange={e => setResTitle(e.target.value)} placeholder="Title (required)"
                style={{ padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <textarea value={resDesc} onChange={e => setResDesc(e.target.value)} placeholder="Description (optional)" rows={2}
                style={{ padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none", resize: "none" }} />
              <input value={resUrl} onChange={e => setResUrl(e.target.value)} placeholder="Link or URL (optional)"
                style={{ padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: `1px dashed ${C.border}`, borderRadius: 10, cursor: "pointer", fontSize: 14, color: C.muted }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {resFile ? <span style={{ color: C.label, fontWeight: 500 }}>{resFile.name} ({(resFile.size / 1024 / 1024).toFixed(1)} MB)</span> : "Upload a file (PDF, image, etc.)"}
                <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.gif" onChange={e => setResFile(e.target.files[0] || null)} style={{ display: "none" }} />
              </label>
              {resFile && <button onClick={() => setResFile(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.muted, textAlign: "left", fontFamily: "inherit" }}>✕ Remove file</button>}
              {uploadProgress !== null && uploadProgress < 100 && (
                <div style={{ background: "rgba(0,0,0,.06)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${uploadProgress}%`, background: C.brown, transition: "width .2s" }} />
                </div>
              )}
              {uploadError && (
                <div style={{ background: "rgba(255,59,48,.07)", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C.red, lineHeight: 1.5 }}>{uploadError}</div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Btn onClick={post} bg={C.brown} disabled={posting} style={{ flex: 1 }}>{posting ? (uploadProgress !== null && uploadProgress < 100 ? `Uploading ${uploadProgress}%…` : "Saving…") : (editingItem ? "Save Changes" : "Post")}</Btn>
            <Btn onClick={resetForm} style={{ flex: 1 }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Feed list */}
      {(() => {
        const visible = filterType ? items.filter(i => i.type === filterType) : items;
        if (visible.length === 0 && !composing) return (
          <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
            <p style={{ fontSize: 14 }}>{isTeacher ? "No posts yet. Post an assignment, announcement, or resource above." : "Nothing here yet."}</p>
          </div>
        );
        return visible.map(item => {
          const meta = TYPE_META[item.type] || { label: item.type, color: C.muted };
          const isAssignment = item.type === "assignment";
          const dueDateStr = item.dueDate ? new Date(item.dueDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
          const isPastDue = item.dueDate && new Date(item.dueDate + "T23:59:59") < new Date();
          // Compute completion for student view
          let isComplete = false;
          if (!isTeacher && isAssignment && (allProgress || talmudProgress)) {
            const ad = item.assignmentData;
            const ksaDone = !ad?.ksa || (ad.ksa.all ? false : (ad.ksa.simanim || []).every(num => {
              const seifs = allProgress?.[num] || {};
              return Object.values(seifs).length > 0 && Object.values(seifs).every(v => v === "mastered");
            }));
            const talmudDone = !ad?.talmud?.masechet || (() => {
              const t = ad.talmud;
              if (!t.fromSeg || !t.toSeg) return false;
              for (let i = t.fromSeg - 1; i <= t.toSeg - 1; i++) {
                const st = talmudProgress?.[`${t.masechet}_${t.daf}_${i}`];
                if (!st?.kriah || !st?.quiz) return false;
              }
              return true;
            })();
            isComplete = ksaDone && talmudDone && (ad?.ksa || ad?.talmud);
          }
          return (
            <div key={item.id} style={{ background: "white", borderRadius: 16, padding: "16px 18px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,.05),0 3px 12px rgba(0,0,0,.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: meta.color, color: "white", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>{item.authorName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{formatRelTime(item.timestamp)}</span>
                  {isTeacher && confirmDelete !== item.id && (
                    <button onClick={() => setConfirmDelete(item.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px", color: C.muted, fontSize: 16, lineHeight: 1 }} title="Delete">×</button>
                  )}
                </div>
              </div>
              {isTeacher && confirmDelete === item.id && (
                <div style={{ background: "rgba(255,59,48,.06)", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, color: C.red, fontWeight: 500 }}>Delete this post?</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={async () => { await deleteDoc(doc(db, "classes", classCode, "feed", item.id)); setConfirmDelete(null); }} style={{ background: C.red, color: "white", border: "none", borderRadius: 8, padding: "5px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>Delete</button>
                    <button onClick={() => setConfirmDelete(null)} style={{ background: "rgba(0,0,0,.07)", color: C.label, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              )}

              {item.type === "announcement" && (
                <p style={{ fontSize: 14, color: C.label, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{item.text}</p>
              )}

              {isAssignment && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: C.label, margin: 0 }}>{item.title}</p>
                    {isComplete && <span style={{ background: "rgba(52,199,89,.12)", color: C.green, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>✓ Complete</span>}
                  </div>
                  {dueDateStr && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: isPastDue ? C.red : C.gold, marginBottom: 8 }}>
                      Due {dueDateStr}{isPastDue ? " · Past due" : ""}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: C.muted, marginBottom: onSelectAssignment ? 12 : 0 }}>
                    {item.assignmentData?.ksa?.simanim && `KSA: Simanim ${Math.min(...item.assignmentData.ksa.simanim)}–${Math.max(...item.assignmentData.ksa.simanim)}`}
                    {item.assignmentData?.ksa?.all && "KSA: All Simanim"}
                    {item.assignmentData?.ksa && item.assignmentData?.talmud && " · "}
                    {item.assignmentData?.talmud?.masechet && (() => {
                      const t = item.assignmentData.talmud;
                      const segs = t.fromSeg ? (t.toSeg ? `segs ${t.fromSeg}–${t.toSeg}` : `from seg ${t.fromSeg}`) : "";
                      return `Talmud: ${t.masechet} ${t.daf}${segs ? ` · ${segs}` : ""}`;
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {onSelectAssignment && (
                      <button onClick={() => onSelectAssignment(item)} style={{ background: C.brown, color: "white", border: "none", borderRadius: 10, padding: "8px 18px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>
                        Open Assignment →
                      </button>
                    )}
                    {onViewProgress && isTeacher && (
                      <button onClick={() => onViewProgress(item)} style={{ background: C.brown, color: "white", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>
                        Student Progress
                      </button>
                    )}
                    {onPreviewAssignment && isTeacher && (
                      <button onClick={() => onPreviewAssignment(item)} style={{ background: "rgba(92,51,23,.08)", color: C.brown, border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>
                        Preview
                      </button>
                    )}
                    {isTeacher && (
                      <button onClick={() => startEdit(item)} style={{ background: "rgba(0,0,0,.05)", color: C.label, border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500 }}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              )}

              {item.type === "resource" && (
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: C.label, marginBottom: item.description ? 4 : 8 }}>{item.title}</p>
                  {item.description && <p style={{ fontSize: 13, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>{item.description}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: C.blue, textDecoration: "none", fontWeight: 500, background: "rgba(0,122,255,.07)", borderRadius: 8, padding: "6px 12px" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        Open Link
                      </a>
                    )}
                    {item.fileUrl && (
                      <a href={item.fileUrl} target="_blank" rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: C.purple, textDecoration: "none", fontWeight: 500, background: "rgba(88,86,214,.07)", borderRadius: 8, padding: "6px 12px" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {item.fileName || "View File"}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        });
      })()}
    </div>
  );
}

// ── Teacher Login ─────────────────────────────────────────────────────────────

export function TeacherLogin({ onLogin, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle = {
    width: "100%", padding: "13px 16px", border: `1px solid ${C.border}`,
    borderRadius: 12, fontFamily: "inherit", fontSize: 15, background: "white",
    color: C.label, marginBottom: 10, outline: "none",
  };

  async function handleSubmit() {
    setLoading(true); setErr("");
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        const data = await loadTeacher(email.trim().toLowerCase());
        if (!data) { setErr("No teacher account found with this email."); setLoading(false); return; }
        onLogin(data);
      } else {
        if (!name.trim()) { setErr("Please enter your name."); setLoading(false); return; }
        await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        const profile = { name: name.trim(), email: email.trim().toLowerCase(), role: "teacher", classes: [] };
        await saveTeacher(profile.email, profile);
        onLogin(profile);
      }
    } catch (e) {
      if (e.code === "auth/email-already-in-use") setErr("Email already in use.");
      else if (e.code === "auth/weak-password") setErr("Password must be at least 6 characters.");
      else if (e.code === "auth/invalid-credential") setErr("Incorrect password.");
      else setErr("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{CSS}</style>
      <div style={{ background: "white", borderRadius: 24, padding: "40px 32px", width: "100%", maxWidth: 400, boxShadow: "0 2px 12px rgba(0,0,0,.06),0 16px 48px rgba(0,0,0,.1)", textAlign: "center" }}>
        <button onClick={onBack} style={{ display: "block", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.muted, fontFamily: "inherit", marginBottom: 24, padding: 0 }}>← Back to student login</button>
        <div style={{ width: 56, height: 56, background: "rgba(92,51,23,.1)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.brown} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <h2 style={{ fontFamily: "'Heebo',sans-serif", fontSize: 24, fontWeight: 700, color: C.label, marginBottom: 4 }}>Teacher Portal</h2>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>{mode === "login" ? "Sign in to your teacher account" : "Create a teacher account"}</p>
        {mode === "register" && (
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={inputStyle} autoFocus />
        )}
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" style={inputStyle} autoFocus={mode === "login"} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()} placeholder="Password" style={{ ...inputStyle, marginBottom: err ? 8 : 16 }} />
        {err && <p style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{err}</p>}
        <Btn onClick={handleSubmit} bg={C.brown} style={{ width: "100%" }} disabled={loading || !email.includes("@") || !password}>
          {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
        </Btn>
        <p style={{ fontSize: 14, color: C.muted, marginTop: 16 }}>
          {mode === "login" ? "New teacher? " : "Already registered? "}
          <button onClick={() => { setMode(m => m === "login" ? "register" : "login"); setErr(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.brown, fontFamily: "inherit", fontSize: 14, fontWeight: 500 }}>
            {mode === "login" ? "Register here" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Student Detail ────────────────────────────────────────────────────────────

function StudentDetail({ student, teacher, onBack, onRemove, classAssignments }) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  const assignedSimanim = classAssignments?.ksa?.simanim || null;
  const assignedMasechtos = classAssignments?.talmud?.masechtos || null;
  const showKSA = !!assignedSimanim;
  const showTalmud = !!assignedMasechtos;
  const showBoth = !showKSA && !showTalmud;

  const [tab, setTab] = useState(showKSA || showBoth ? "ksa" : "talmud");

  const ksaBySimans = {};
  if (showKSA || showBoth) {
    Object.entries(student.allProgress || {}).forEach(([siman, seifs]) => {
      if (assignedSimanim && !assignedSimanim.includes(parseInt(siman))) return;
      const mastered = Object.values(seifs || {}).filter(v => v === "mastered").length;
      const total = Object.keys(seifs || {}).length;
      if (total > 0) ksaBySimans[siman] = { mastered, total };
    });
  }

  const talmudByDaf = {};
  if (showTalmud || showBoth) {
    Object.entries(student.talmudProgress || {}).forEach(([key, v]) => {
      const parts = key.split("_");
      if (assignedMasechtos && !assignedMasechtos.includes(parts[0])) return;
      const dafKey = `${parts[0]}_${parts[1]}`;
      if (!talmudByDaf[dafKey]) talmudByDaf[dafKey] = { masechet: parts[0], daf: parts[1], mastered: 0, started: 0 };
      if (v?.kriah || v?.quiz) talmudByDaf[dafKey].started++;
      if (v?.kriah && v?.quiz) talmudByDaf[dafKey].mastered++;
    });
  }

  const ksaTotal = Object.values(ksaBySimans).reduce((s, { mastered }) => s + mastered, 0);
  const talmudTotal = Object.values(talmudByDaf).filter(({ mastered }) => mastered > 0).length;
  const lastSeen = student.lastSeen ? new Date(student.lastSeen).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never";

  const tabs = [...((showKSA || showBoth) ? [["ksa", "KSA Progress"]] : []), ...((showTalmud || showBoth) ? [["talmud", "Talmud Progress"]] : [])];

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.brown, fontFamily: "inherit", marginBottom: 20, padding: 0, fontWeight: 500 }}>‹ Back to class</button>

      <div style={{ background: "white", borderRadius: 18, padding: "22px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 22, color: C.label, marginBottom: 3 }}>{student.name}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{student.email}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Last active</div>
            <div style={{ fontSize: 13, color: C.label, fontWeight: 500 }}>{lastSeen}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: showBoth || (showKSA && showTalmud) ? "1fr 1fr" : "1fr", gap: 10 }}>
          {(showKSA || showBoth) && (
            <div style={{ background: C.bg, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.gold, marginBottom: 2 }}>{ksaTotal}</div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>KSA Seifim Mastered</div>
            </div>
          )}
          {(showTalmud || showBoth) && (
            <div style={{ background: C.bg, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.brown, marginBottom: 2 }}>{talmudTotal}</div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>Talmud Segments Mastered</div>
            </div>
          )}
        </div>
      </div>

      {tabs.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "rgba(0,0,0,.05)", borderRadius: 12, padding: 4 }}>
          {tabs.map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500, background: tab === id ? "white" : "transparent", color: tab === id ? C.label : C.muted, boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,.08)" : "none", transition: "all .15s" }}>{lbl}</button>
          ))}
        </div>
      )}

      {tab === "ksa" && (
        Object.keys(ksaBySimans).length === 0
          ? <p style={{ color: C.muted, textAlign: "center", padding: "40px 0" }}>No KSA activity yet.</p>
          : Object.entries(ksaBySimans).sort(([a], [b]) => parseInt(a) - parseInt(b)).map(([siman, { mastered, total }]) => (
            <div key={siman} style={{ background: "white", borderRadius: 12, padding: "14px 16px", marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 500, color: C.label, fontSize: 14 }}>Siman {siman}</span>
                <span style={{ fontSize: 13, color: mastered === total ? C.green : C.muted, fontWeight: 500 }}>{mastered}/{total} mastered</span>
              </div>
              <ProgressBar value={mastered} max={total} color={mastered === total ? C.green : C.brown} />
            </div>
          ))
      )}

      {tab === "talmud" && (
        Object.keys(talmudByDaf).length === 0
          ? <p style={{ color: C.muted, textAlign: "center", padding: "40px 0" }}>No Talmud activity yet.</p>
          : Object.values(talmudByDaf).map(({ masechet, daf, mastered, started }) => (
            <div key={`${masechet}_${daf}`} style={{ background: "white", borderRadius: 12, padding: "14px 16px", marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 500, color: C.label, fontSize: 14 }}>{masechet} {daf}</span>
                <span style={{ fontSize: 13, color: C.muted }}>{mastered} mastered · {started} started</span>
              </div>
              <ProgressBar value={mastered} max={started || 1} color={C.brown} />
            </div>
          ))
      )}

      <div style={{ marginTop: 32, borderTop: `0.5px solid ${C.border}`, paddingTop: 20 }}>
        {confirmRemove
          ? <div style={{ background: "rgba(255,59,48,.06)", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 14, color: C.red, marginBottom: 12 }}>Remove {student.name} from this class?</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={onRemove} bg={C.red} style={{ flex: 1 }}>Yes, Remove</Btn>
                <Btn onClick={() => setConfirmRemove(false)} style={{ flex: 1 }}>Cancel</Btn>
              </div>
            </div>
          : <button onClick={() => setConfirmRemove(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.muted, textDecoration: "underline" }}>Remove from class</button>
        }
      </div>
    </div>
  );
}

// ── Class Detail ──────────────────────────────────────────────────────────────

function ClassDetail({ classData: initialClass, teacher, onBack }) {
  const [classData, setClassData] = useState(initialClass);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("students");
  const [previewAssignment, setPreviewAssignment] = useState(null);
  const [progressAssignment, setProgressAssignment] = useState(null);
  const [progressStudents, setProgressStudents] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState(false);

  async function openProgress(item) {
    setProgressAssignment(item);
    setLoadingProgress(true);
    const fresh = await Promise.all((classData.students || []).map(loadStudentDoc));
    setProgressStudents(fresh.filter(Boolean));
    setLoadingProgress(false);
  }

  function computeAssignmentProgress(student, ad) {
    const t = ad?.talmud;
    let talmudDone = 0, talmudTotal = 0;
    if (t?.masechet && t?.fromSeg && t?.toSeg) {
      talmudTotal = t.toSeg - t.fromSeg + 1;
      for (let i = t.fromSeg - 1; i <= t.toSeg - 1; i++) {
        const st = student.talmudProgress?.[`${t.masechet}_${t.daf}_${i}`];
        if (st?.kriah && st?.quiz) talmudDone++;
      }
    } else if (t?.masechet && t?.daf) {
      // no seg range — count any mastered segs on that daf
      Object.entries(student.talmudProgress || {}).forEach(([k, v]) => {
        if (k.startsWith(`${t.masechet}_${t.daf}_`)) {
          talmudTotal++;
          if (v?.kriah && v?.quiz) talmudDone++;
        }
      });
    }
    const ksa = ad?.ksa;
    let ksaDone = 0, ksaTotal = 0;
    if (ksa?.simanim?.length) {
      ksaTotal = ksa.simanim.length;
      ksa.simanim.forEach(num => {
        const seifs = student.allProgress?.[num] || {};
        if (Object.values(seifs).length > 0 && Object.values(seifs).every(v => v === "mastered")) ksaDone++;
      });
    }
    const isComplete = (talmudTotal === 0 || talmudDone === talmudTotal) && (ksaTotal === 0 || ksaDone === ksaTotal) && (talmudTotal > 0 || ksaTotal > 0);
    return { talmudDone, talmudTotal, ksaDone, ksaTotal, isComplete };
  }

  useEffect(() => {
    async function load() {
      setLoadingStudents(true);
      const loaded = await Promise.all((classData.students || []).map(loadStudentDoc));
      setStudents(loaded.filter(Boolean));
      setLoadingStudents(false);
    }
    load();
  }, [classData.code]);

  async function handleRemove(studentEmail) {
    await removeStudent(studentEmail, classData.code);
    setClassData(c => ({ ...c, students: c.students.filter(e => e !== studentEmail) }));
    setStudents(s => s.filter(s => s.email !== studentEmail));
    setSelected(null);
  }

  function copyCode() {
    navigator.clipboard.writeText(classData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (selected) {
    return (
      <StudentDetail
        student={selected}
        teacher={teacher}
        onBack={() => setSelected(null)}
        onRemove={() => handleRemove(selected.email)}
        classAssignments={classData.assignments}
      />
    );
  }

  const filtered = students.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.brown, fontFamily: "inherit", marginBottom: 20, padding: 0, fontWeight: 500 }}>‹ All Classes</button>

      {/* Class header */}
      <div style={{ background: "white", borderRadius: 18, padding: "20px 22px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.label, marginBottom: 4 }}>{classData.name}</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>{classData.students?.length || 0} student{classData.students?.length !== 1 ? "s" : ""} enrolled</div>
        <div style={{ background: C.bg, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Class Code</div>
            <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: C.brown, letterSpacing: "0.18em" }}>{classData.code}</div>
          </div>
          <button onClick={copyCode} style={{ background: copied ? C.green : C.brown, color: "white", border: "none", borderRadius: 10, padding: "9px 18px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, transition: "background .2s" }}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.label }}>Shakla v'Tarya progression lock</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{classData.progressionLocked !== false ? "Students must complete segments to unlock chavruta" : "Students can access chavruta freely"}</div>
          </div>
          <button onClick={async () => {
            const newVal = classData.progressionLocked === false ? true : false;
            await setDoc(doc(db, "classes", classData.code), { progressionLocked: newVal }, { merge: true });
            setClassData(c => ({ ...c, progressionLocked: newVal }));
          }} style={{ background: classData.progressionLocked !== false ? C.brown : C.green, color: "white", border: "none", borderRadius: 20, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, transition: "background .2s", flexShrink: 0 }}>
            {classData.progressionLocked !== false ? "Locked" : "Unlocked"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, background: "rgba(0,0,0,.05)", borderRadius: 12, padding: 4 }}>
        {[["students", "Students"], ["feed", "Feed"], ["chat", "Chat"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500,
            background: tab === id ? "white" : "transparent",
            color: tab === id ? C.label : C.muted,
            boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,.08)" : "none",
            transition: "all .15s",
          }}>{lbl}</button>
        ))}
      </div>

      {/* Students tab */}
      {tab === "students" && (
        <>
          {students.length > 4 && (
            <div style={{ background: "white", borderRadius: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…" style={{ border: "none", outline: "none", fontFamily: "inherit", fontSize: 14, background: "transparent", flex: 1, color: C.label }} />
            </div>
          )}
          {loadingStudents ? (
            <p style={{ color: C.muted, textAlign: "center", padding: "40px 0" }}>Loading students…</p>
          ) : students.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 6, color: C.label }}>No students yet</p>
              <p style={{ fontSize: 13 }}>Share the class code above — students enter it in the app to join.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filtered.map(s => {
                const assignedSimanim = classData.assignments?.ksa?.simanim;
                const assignedMasechtos = classData.assignments?.talmud?.masechtos;
                const showKSA = !!assignedSimanim || (!assignedSimanim && !assignedMasechtos);
                const showTalmud = !!assignedMasechtos || (!assignedSimanim && !assignedMasechtos);
                const ksaCount = assignedSimanim
                  ? assignedSimanim.reduce((sum, num) => sum + Object.values(s.allProgress?.[num] || {}).filter(v => v === "mastered").length, 0)
                  : ksaMastered(s.allProgress);
                const talmudCount = assignedMasechtos
                  ? Object.entries(s.talmudProgress || {}).filter(([k, v]) => assignedMasechtos.some(m => k.startsWith(m + "_")) && v?.kriah && v?.quiz).length
                  : talmudMastered(s.talmudProgress);
                const lastSeen = s.lastSeen ? new Date(s.lastSeen).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
                return (
                  <div key={s.email} onClick={() => setSelected(s)}
                    style={{ background: "white", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,.05),0 3px 12px rgba(0,0,0,.04)", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, transition: "box-shadow .15s" }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,.1),0 6px 20px rgba(0,0,0,.07)"}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,.05),0 3px 12px rgba(0,0,0,.04)"}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: `hsl(${s.name.charCodeAt(0) * 7 % 360},40%,70%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "white", flexShrink: 0 }}>
                      {s.name[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: C.label, marginBottom: 2 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{s.email}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
                      {showKSA && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{ksaCount}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>KSA</div>
                        </div>
                      )}
                      {showTalmud && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.brown }}>{talmudCount}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>Talmud</div>
                        </div>
                      )}
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.label }}>{lastSeen}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>Last seen</div>
                      </div>
                    </div>
                    <span style={{ color: C.muted, fontSize: 18, fontWeight: 300 }}>›</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Feed tab */}
      {tab === "feed" && (
        <FeedPanel
          classCode={classData.code}
          isTeacher={true}
          currentUser={teacher}
          onAssignmentSaved={newAssignments => setClassData(c => ({ ...c, assignments: newAssignments }))}
          onPreviewAssignment={setPreviewAssignment}
          onViewProgress={openProgress}
        />
      )}

      {/* Assignment progress sheet */}
      {progressAssignment && (
        <div onClick={() => setProgressAssignment(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#F5F0EB", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:720, maxHeight:"85vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <div>
                <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:500, marginBottom:4 }}>Student Progress</div>
                <div style={{ fontWeight:700, fontSize:18, color:C.label }}>{progressAssignment.title}</div>
              </div>
              <button onClick={() => setProgressAssignment(null)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.muted, lineHeight:1 }}>×</button>
            </div>
            {(() => {
              const ad = progressAssignment.assignmentData;
              const t = ad?.talmud;
              const ksa = ad?.ksa;
              return (
                <div style={{ fontSize:12, color:C.muted, marginBottom:20 }}>
                  {ksa?.simanim && `KSA: Simanim ${Math.min(...ksa.simanim)}–${Math.max(...ksa.simanim)}`}
                  {ksa?.all && "KSA: All Simanim"}
                  {ksa && t?.masechet && " · "}
                  {t?.masechet && `${t.masechet} ${t.daf}${t.fromSeg && t.toSeg ? ` · segs ${t.fromSeg}–${t.toSeg}` : ""}`}
                </div>
              );
            })()}
            {loadingProgress ? (
              <p style={{ color:C.muted, textAlign:"center", padding:"30px 0" }}>Loading…</p>
            ) : progressStudents.length === 0 ? (
              <p style={{ color:C.muted, textAlign:"center", padding:"30px 0" }}>No students enrolled.</p>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {progressStudents
                  .map(s => ({ s, prog: computeAssignmentProgress(s, progressAssignment.assignmentData) }))
                  .sort((a, b) => {
                    if (a.prog.isComplete && !b.prog.isComplete) return -1;
                    if (!a.prog.isComplete && b.prog.isComplete) return 1;
                    const aTotal = a.prog.talmudTotal + a.prog.ksaTotal;
                    const bTotal = b.prog.talmudTotal + b.prog.ksaTotal;
                    const aPct = aTotal > 0 ? (a.prog.talmudDone + a.prog.ksaDone) / aTotal : 0;
                    const bPct = bTotal > 0 ? (b.prog.talmudDone + b.prog.ksaDone) / bTotal : 0;
                    return bPct - aPct;
                  })
                  .map(({ s, prog }) => {
                    const overall = prog.talmudTotal + prog.ksaTotal > 0
                      ? Math.round(((prog.talmudDone + prog.ksaDone) / (prog.talmudTotal + prog.ksaTotal)) * 100)
                      : 0;
                    return (
                      <div key={s.email} style={{ background:"white", borderRadius:14, padding:"14px 16px", boxShadow:"0 1px 4px rgba(0,0,0,.04)", display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ width:38, height:38, borderRadius:"50%", background:`hsl(${s.name.charCodeAt(0)*7%360},40%,70%)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:"white", flexShrink:0 }}>
                          {s.name[0].toUpperCase()}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                            <span style={{ fontWeight:600, fontSize:14, color:C.label }}>{s.name}</span>
                            {prog.isComplete
                              ? <span style={{ background:"rgba(52,199,89,.12)", color:C.green, borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:700 }}>✓ Complete</span>
                              : <span style={{ fontSize:12, color:C.muted, fontWeight:500 }}>{overall}%</span>}
                          </div>
                          {prog.talmudTotal > 0 && (
                            <div style={{ marginBottom:prog.ksaTotal>0?6:0 }}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:11, color:C.muted }}>Talmud segments</span>
                                <span style={{ fontSize:11, color:prog.talmudDone===prog.talmudTotal?C.green:C.muted, fontWeight:600 }}>{prog.talmudDone}/{prog.talmudTotal}</span>
                              </div>
                              <div style={{ height:5, background:"rgba(0,0,0,.07)", borderRadius:99, overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${prog.talmudTotal>0?(prog.talmudDone/prog.talmudTotal)*100:0}%`, background:prog.talmudDone===prog.talmudTotal?C.green:C.brown, borderRadius:99, transition:"width .3s" }} />
                              </div>
                            </div>
                          )}
                          {prog.ksaTotal > 0 && (
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:11, color:C.muted }}>KSA simanim</span>
                                <span style={{ fontSize:11, color:prog.ksaDone===prog.ksaTotal?C.green:C.muted, fontWeight:600 }}>{prog.ksaDone}/{prog.ksaTotal}</span>
                              </div>
                              <div style={{ height:5, background:"rgba(0,0,0,.07)", borderRadius:99, overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${prog.ksaTotal>0?(prog.ksaDone/prog.ksaTotal)*100:0}%`, background:prog.ksaDone===prog.ksaTotal?C.green:C.gold, borderRadius:99, transition:"width .3s" }} />
                              </div>
                            </div>
                          )}
                          {prog.talmudTotal === 0 && prog.ksaTotal === 0 && (
                            <div style={{ fontSize:12, color:C.muted }}>Not started</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assignment preview sheet */}
      {previewAssignment && (
        <div onClick={() => setPreviewAssignment(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#F5F0EB", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:720, maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <div style={{ fontSize:11, color:C.muted, letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:500, marginBottom:4 }}>Student View Preview</div>
                <div style={{ fontWeight:700, fontSize:18, color:C.label }}>{previewAssignment.title}</div>
              </div>
              <button onClick={() => setPreviewAssignment(null)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.muted, lineHeight:1 }}>×</button>
            </div>
            {previewAssignment.dueDate && (
              <div style={{ fontSize:13, fontWeight:600, color:C.gold, marginBottom:16 }}>
                Due {new Date(previewAssignment.dueDate + "T12:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}
              </div>
            )}
            {/* KSA section */}
            {previewAssignment.assignmentData?.ksa && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontWeight:700, fontSize:15, color:C.label, marginBottom:8 }}>Kitzur Shulchan Aruch</div>
                {previewAssignment.assignmentData.ksa.all
                  ? <div style={{ fontSize:13, color:C.muted }}>All Simanim</div>
                  : <div style={{ fontSize:13, color:C.muted }}>Simanim {Math.min(...previewAssignment.assignmentData.ksa.simanim)}–{Math.max(...previewAssignment.assignmentData.ksa.simanim)}</div>}
              </div>
            )}
            {/* Talmud section */}
            {previewAssignment.assignmentData?.talmud?.masechet && (() => {
              const t = previewAssignment.assignmentData.talmud;
              const segLabel = t.fromSeg ? (t.toSeg ? `Segments ${t.fromSeg}–${t.toSeg}` : `From segment ${t.fromSeg}`) : "All segments";
              return (
                <div>
                  <div style={{ fontWeight:700, fontSize:15, color:C.label, marginBottom:8 }}>תלמוד</div>
                  <div style={{ background:"white", borderRadius:14, padding:"20px 18px", boxShadow:"0 1px 4px rgba(0,0,0,.05)", display:"flex", alignItems:"center", gap:16 }}>
                    <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:28, fontWeight:700, color:C.label }}>{t.masechet}</div>
                    <div>
                      <div style={{ fontWeight:600, fontSize:15, color:C.label }}>{t.masechet}</div>
                      <div style={{ fontSize:13, color:C.muted }}>{t.daf} · {segLabel}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Chat tab */}
      {tab === "chat" && (
        <div style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
          <ChatPanel
            classCode={classData.code}
            className={classData.name}
            currentUser={teacher}
            style={{ height: 520 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Teacher Dashboard ─────────────────────────────────────────────────────────

export function TeacherDash({ teacher, onLogout }) {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // class code to delete
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadAll() {
      const codes = teacher.classes || [];
      const loaded = await Promise.all(codes.map(loadClass));
      setClasses(loaded.filter(Boolean));
      setLoadingClasses(false);
    }
    loadAll();
  }, [teacher.email]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    const cls = await createClass(teacher.email, newName.trim());
    setClasses(c => [...c, cls]);
    setNewName("");
    setCreating(false);
    setSaving(false);
    setSelectedClass(cls);
  }

  async function handleDelete(cls) {
    setDeleting(true);
    await deleteClass(cls.code, teacher.email, cls.students || []);
    setClasses(c => c.filter(x => x.code !== cls.code));
    setDeleteConfirm(null);
    setDeleting(false);
  }

  if (selectedClass) return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px 80px" }}>
        <ClassDetail classData={selectedClass} teacher={teacher} onBack={() => setSelectedClass(null)} />
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px 80px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 5, fontWeight: 500 }}>Teacher Dashboard</div>
            <h1 style={{ fontFamily: "'Heebo',sans-serif", fontSize: 30, fontWeight: 700, lineHeight: 1, color: C.label }}>My Classes</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: C.label, marginBottom: 2 }}>{teacher.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{teacher.email}</div>
            <button onClick={onLogout} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 980, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: C.muted }}>Sign out</button>
          </div>
        </div>

        {creating ? (
          <div style={{ background: "white", borderRadius: 18, padding: "20px", marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: C.label, marginBottom: 14 }}>New Class</div>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              placeholder="e.g. 10th Grade Halacha"
              autoFocus
              style={{ width: "100%", padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 12, fontFamily: "inherit", fontSize: 15, outline: "none", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={handleCreate} bg={C.brown} disabled={!newName.trim() || saving} style={{ flex: 1 }}>
                {saving ? "Creating…" : "Create Class"}
              </Btn>
              <Btn onClick={() => { setCreating(false); setNewName(""); }} style={{ flex: 1 }}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} style={{ width: "100%", background: "rgba(92,51,23,.06)", border: "1.5px dashed rgba(92,51,23,.25)", borderRadius: 16, padding: "16px", cursor: "pointer", fontFamily: "inherit", fontSize: 15, color: C.brown, fontWeight: 500, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create New Class
          </button>
        )}

        {/* Delete confirmation */}
        {deleteConfirm && (
          <div style={{ background: "rgba(255,59,48,.06)", border: `1px solid rgba(255,59,48,.2)`, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.red, marginBottom: 6 }}>Delete "{deleteConfirm.name}"?</p>
            <p style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>This will remove all {deleteConfirm.students?.length || 0} students from the class and cannot be undone.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => handleDelete(deleteConfirm)} bg={C.red} disabled={deleting} style={{ flex: 1 }}>{deleting ? "Deleting…" : "Delete Class"}</Btn>
              <Btn onClick={() => setDeleteConfirm(null)} style={{ flex: 1 }}>Cancel</Btn>
            </div>
          </div>
        )}

        {loadingClasses ? (
          <p style={{ color: C.muted, textAlign: "center", padding: "50px 0" }}>Loading…</p>
        ) : classes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>🏫</div>
            <p style={{ fontSize: 16, fontWeight: 500, color: C.label, marginBottom: 6 }}>No classes yet</p>
            <p style={{ fontSize: 14 }}>Create your first class to get started.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {classes.map(cls => (
              <div key={cls.code}
                style={{ background: "white", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "box-shadow .15s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,.1),0 6px 20px rgba(0,0,0,.07)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)"}>
                <div onClick={() => setSelectedClass(cls)} style={{ flex: 1, cursor: "pointer" }}>
                  <div style={{ fontWeight: 600, fontSize: 17, color: C.label, marginBottom: 5 }}>{cls.name}</div>
                  <div style={{ fontSize: 13, color: C.muted }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.brown, letterSpacing: "0.1em", marginRight: 10 }}>{cls.code}</span>
                    {cls.students?.length || 0} student{cls.students?.length !== 1 ? "s" : ""}
                    {cls.assignments?.ksa?.simanim && (
                      <span style={{ marginLeft: 10, color: C.gold }}>
                        · KSA {Math.min(...cls.assignments.ksa.simanim)}–{Math.max(...cls.assignments.ksa.simanim)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirm(cls); }}
                    style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: C.muted, fontFamily: "inherit", fontSize: 13, lineHeight: 1 }}
                    title="Delete class"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                  <span onClick={() => setSelectedClass(cls)} style={{ color: C.muted, fontSize: 22, fontWeight: 300, cursor: "pointer" }}>›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
