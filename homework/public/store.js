// Loading and saving assignments. Assignments made in the builder live in Firestore
// (homeworkAssignments). The ones in assignments.js are built in and read-only.
import { db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, ASSIGNMENTS_COL } from "./firebase.js";
import { ASSIGNMENTS } from "./assignments.js";

const builtIn = () => ASSIGNMENTS.map((a) => ({ ...a, status: "published", builtIn: true }));

export async function loadAssignment(id) {
  if (id) {
    try {
      const snap = await getDoc(doc(db, ASSIGNMENTS_COL, id));
      if (snap.exists()) return fromStored({ id, ...snap.data() });
    } catch (e) { console.error(e); }
    const b = builtIn().find((a) => a.id === id);
    if (b) return b;
    return null;
  }
  return builtIn()[0];
}

// Newest first, built-in ones at the end.
export async function listAssignments() {
  let mine = [];
  try {
    const snap = await getDocs(collection(db, ASSIGNMENTS_COL));
    mine = snap.docs.map((d) => fromStored({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); }
  const t = (a) => (a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0);
  mine.sort((a, b) => t(b) - t(a));
  // A built-in assignment you've edited is saved under the same id, so show only the edited one.
  const ids = new Set(mine.map((a) => a.id));
  return [...mine, ...builtIn().filter((a) => !ids.has(a.id))];
}

export function newId(title) {
  const slug = String(title || "assignment").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "assignment";
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function saveAssignment(a, email) {
  const { id, builtIn: _b, ...data } = a;
  const out = { ...data, updatedAt: serverTimestamp(), updatedBy: email };
  if (!a.createdBy) { out.createdBy = email; out.createdAt = serverTimestamp(); }
  // Firestore can't store nested arrays, so dialogue lines are saved as objects.
  out.parts = (out.parts || []).map((p) => ({
    ...p,
    questions: p.questions.map((q) => (q.type === "dialogue" ? { ...q, lines: q.lines.map(([who, text]) => ({ who, text })) } : q)),
  }));
  await setDoc(doc(db, ASSIGNMENTS_COL, id), out, { merge: true });
}

export async function deleteAssignment(id) {
  await deleteDoc(doc(db, ASSIGNMENTS_COL, id));
}

// Undo the dialogue-line conversion when reading back.
export function fromStored(a) {
  if (!a) return a;
  return {
    ...a,
    parts: (a.parts || []).map((p) => ({
      ...p,
      questions: (p.questions || []).map((q) =>
        q.type === "dialogue" ? { ...q, lines: (q.lines || []).map((l) => (Array.isArray(l) ? l : [l.who, l.text])) } : q),
    })),
  };
}
