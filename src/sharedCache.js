/**
 * sharedCache.js
 * Global Firebase cache for all Claude API results, shared across all users.
 * Cache keys always include segment context to handle words with multiple meanings.
 *
 * Firebase RTDB structure:
 *
 * sharedCache/
 *   translit/
 *     talmud/{masechet}/{daf}/{segIdx}        → string
 *     ksa/{simanNum}/{seifIdx}                → string
 *   wordtrans/
 *     talmud/{masechet}/{daf}/{segIdx}/{word} → string
 *     ksa/{simanNum}/{seifIdx}/{word}         → string
 *   quizzes/
 *     talmud/{masechet}/{daf}/{segIdx}        → string (raw JSON)
 *     ksa/{simanNum}/{seifIdx}                → string (raw JSON)
 *   summaries/
 *     ksa/{simanNum}                          → string
 *
 * flags/
 *   {flagId}/
 *     cacheKey        → string
 *     originalValue   → string
 *     suggestedValue  → string
 *     heContext       → string
 *     enContext       → string
 *     word            → string
 *     submittedBy     → string
 *     timestamp       → number
 *     status          → "pending" | "accepted" | "rejected"
 *     claudeVerdict   → string or null
 */

import { ref, get, set, push, update } from "firebase/database";
import { rtdb } from "./firebase";

function sanitize(s) {
  return String(s)
    .replace(/\s+/g, "_")
    .replace(/[.$#[\]/]/g, "");
}

function stripNikud(s) {
  return s.replace(/[\u0591-\u05C7]/g, "").replace(/[^\u05D0-\u05EA\s]/g, "").trim();
}

export const CacheKey = {
  talmudTranslit: (masechet, daf, segIdx) =>
    `translit/talmud/${sanitize(masechet)}/${sanitize(daf)}/${segIdx}`,

  ksaTranslit: (simanNum, seifIdx) =>
    `translit/ksa/${simanNum}/${seifIdx}`,

  talmudWord: (masechet, daf, segIdx, heWord) =>
    `wordtrans/talmud/${sanitize(masechet)}/${sanitize(daf)}/${segIdx}/${sanitize(stripNikud(heWord))}`,

  ksaWord: (simanNum, seifIdx, heWord) =>
    `wordtrans/ksa/${simanNum}/${seifIdx}/${sanitize(stripNikud(heWord))}`,

  talmudQuiz: (masechet, daf, segIdx) =>
    `quizzes/talmud/${sanitize(masechet)}/${sanitize(daf)}/${segIdx}`,

  ksaQuiz: (simanNum, seifIdx) =>
    `quizzes/ksa/${simanNum}/${seifIdx}`,

  ksaSummary: (simanNum) =>
    `summaries/ksa/${simanNum}`,
};

export async function getCache(key) {
  try {
    const snap = await get(ref(rtdb, `sharedCache/${key}`));
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.warn("sharedCache read failed:", e);
    return null;
  }
}

export async function setCache(key, value) {
  try {
    await set(ref(rtdb, `sharedCache/${key}`), value);
  } catch (e) {
    console.warn("sharedCache write failed:", e);
  }
}

export async function deleteCache(key) {
  try {
    await set(ref(rtdb, `sharedCache/${key}`), null);
    localStorage.removeItem(`sc_${key}`);
  } catch (e) {
    console.warn("sharedCache delete failed:", e);
  }
}

export async function withCache(key, fn) {
  // 1. localStorage (instant)
  const localKey = `sc_${key}`;
  const local = localStorage.getItem(localKey);
  if (local) return local;

  // 2. Firebase shared cache
  const remote = await getCache(key);
  if (remote) {
    localStorage.setItem(localKey, remote);
    return remote;
  }

  // 3. Call Claude
  const result = await fn();
  if (result && result.trim()) {
    const clean = result.trim();
    localStorage.setItem(localKey, clean);
    setCache(key, clean); // fire and forget
    return clean;
  }
  return result;
}

export async function submitFlag({
  cacheKey,
  originalValue,
  suggestedValue,
  word,
  heContext,
  enContext,
  submittedBy,
  claudeFn,
}) {
  // 1. Delete the wrong cached value immediately
  await deleteCache(cacheKey);

  // 2. Store user suggestion immediately so other users benefit now
  await setCache(cacheKey, suggestedValue);
  localStorage.setItem(`sc_${cacheKey}`, suggestedValue);

  // 3. Write flag record for audit trail
  const flagRef = push(ref(rtdb, "flags"));
  await set(flagRef, {
    cacheKey,
    originalValue,
    suggestedValue,
    word,
    heContext,
    enContext,
    submittedBy,
    timestamp: Date.now(),
    status: "pending",
    claudeVerdict: null,
  });

  // 4. Ask Claude to evaluate original vs suggested in context
  let finalValue = suggestedValue;
  let claudeVerdict = null;

  try {
    const prompt = `You are evaluating a translation correction for a Hebrew/Aramaic word in a Talmud or Kitzur Shulchan Aruch app.

Hebrew word: "${word}"
Full Hebrew segment: "${heContext}"
Full English translation of segment: "${enContext}"

Current translation in app: "${originalValue}"
User's suggested correction: "${suggestedValue}"

Which translation is more accurate for this word AS USED IN THIS SPECIFIC CONTEXT?

Reply with ONLY a JSON object, no markdown:
{"better": "original" or "suggested", "bestValue": "<the more accurate translation>", "reason": "<one sentence explanation>"}`;

    const raw = await claudeFn(
      prompt,
      "You are a Talmud translation expert. Evaluate translation accuracy in context. Reply with ONLY a valid JSON object, no markdown.",
      150
    );
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    claudeVerdict = parsed.reason || null;
    finalValue = parsed.bestValue || suggestedValue;

    await setCache(cacheKey, finalValue);
    localStorage.setItem(`sc_${cacheKey}`, finalValue);

    await update(flagRef, {
      status: parsed.better === "suggested" ? "accepted" : "partial",
      claudeVerdict,
      finalValue,
    });

  } catch (e) {
    console.warn("Claude flag evaluation failed, keeping user suggestion:", e);
    await update(flagRef, {
      status: "accepted",
      claudeVerdict: "Claude evaluation failed — user suggestion kept",
      finalValue: suggestedValue,
    });
  }

  return { verdict: claudeVerdict, finalValue };
}
