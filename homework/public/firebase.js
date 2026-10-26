// Same Firebase project as the KSA app (kitzur-app1), so students sign in with the
// same Google accounts and teachers are recognized from the existing "teachers" collection.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJ4PiCzf5cMhp1FCEv1EA478rlC1H9FOU",
  authDomain: "kitzur-app1.firebaseapp.com",
  projectId: "kitzur-app1",
  storageBucket: "kitzur-app1.firebasestorage.app",
  messagingSenderId: "603995451341",
  appId: "1:603995451341:web:61f543cfdb200891381e84",
};

export const WHISPER_URL = "https://ksa-app-production.up.railway.app/api/whisper";
export const WHISPER_FROM_URL = "https://ksa-app-production.up.railway.app/api/whisper-from-url";
export const SUBMISSIONS = "homeworkSubmissions";
export const ASSIGNMENTS_COL = "homeworkAssignments";
export const CLAUDE_URL = "https://ksa-app-production.up.railway.app/api/claude";
// Model used to draft assignments. A stronger model is worth it here: it runs once per assignment.
export const CLAUDE_MODEL = "claude-sonnet-5-5";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
};

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export function submissionId(assignmentId, email) {
  return `${assignmentId}__${email.toLowerCase()}`;
}

export function audioPath(assignmentId, email, ext) {
  return `homework-audio/${assignmentId}/${email.toLowerCase()}.${ext}`;
}

// Sends audio to the KSA Railway proxy. Throws on failure so callers can mark it failed.
export async function transcribe(blob, filename) {
  const form = new FormData();
  form.append("audio", blob, filename);
  const r = await fetch(WHISPER_URL, { method: "POST", body: form });
  if (!r.ok) throw new Error(`Transcription server returned ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(typeof d.error === "string" ? d.error : d.error.message || "Transcription failed");
  if (typeof d.text !== "string") throw new Error("No transcript came back");
  return d.text.trim();
}

// Has the proxy download a saved recording and transcribe it (used by "Try again").
export async function transcribeFromUrl(url) {
  const r = await fetch(WHISPER_FROM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  let d;
  try { d = await r.json(); } catch { throw new Error(`Transcription server returned ${r.status}`); }
  if (d.error) throw new Error(typeof d.error === "string" ? d.error : d.error.message || "Transcription failed");
  if (typeof d.text !== "string") throw new Error("No transcript came back");
  return d.text.trim();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Escapes text and wraps Hebrew runs (with their ״ quote marks) in <bdi> so they
// display correctly inside English sentences.
export function heb(s) {
  return esc(s).replace(/[״"]?[\u0590-\u05FF][\u0590-\u05FF\s״׳'\-–]*[\u0590-\u05FF][״"]?/g, (m) => `<bdi class="he">${m}</bdi>`);
}
