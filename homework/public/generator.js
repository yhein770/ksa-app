// Drafts an assignment with Claude through the KSA Railway proxy (/api/claude).
import { CLAUDE_URL, CLAUDE_MODEL } from "./firebase.js";
import { normalizeDraft } from "./assignments.js";

const SYSTEM = `You write Gemara homework for a Modern Orthodox high school class. Many students in the class read slowly and struggle with abstract reasoning, so everything must be simple and concrete.

ACCURACY
- Base every question, answer and explanation ONLY on the Gemara text and translation the teacher gives you.
- Never bring in Rashi, Tosafos, any other commentator, or halachic conclusions the text itself doesn't state. If a point would need outside knowledge, leave it out.
- If you are not certain where a pasuk (verse) is from, leave its "ref" as an empty string. Never guess a reference.
- In "teacherChecks", list each specific claim your questions and answers depend on, and which line of the text it rests on, so the teacher can verify it quickly.

LANGUAGE
- Short sentences and everyday words. One idea per question.
- Every Hebrew or Aramaic word in a question or answer choice gets an English translation in parentheses the first time it appears in that question, e.g. pasuk (verse), bechor (firstborn).
- Never use em dashes.
- No point values.

QUESTION RULES
- Test the concepts and the flow of the sugya (passage). Do NOT ask translation or definition questions. Do not ask about named opinions.
- "select" questions (word bank): every question in that part uses the same word bank of 3 to 6 short choices. Exactly one choice fits each question.
- "order" questions: 3 to 5 steps of the sugya's reasoning, given in the CORRECT order in "steps". There must be only one sensible order. "joiner" is the word that links the steps, e.g. "because" or "then".
- "mcq" questions: exactly 4 choices. Exactly one is defensible from the text. The wrong ones should be plausible to a student who didn't follow the text, but clearly wrong if they did. Keep all 4 about the same length, and the correct one must NOT be the longest. "answerIndex" is the 0-based index of the correct choice.
- "dialogue" items are not questions. Use one only if an everyday example (like a short conversation) makes the concept click. "lines" is a list of [speaker, line] pairs.
- Follow the teacher's focus notes closely. That is the point of the assignment.

VOICE MEMO
- If a voice memo is requested, the checklist has one item per step of the sugya, each saying what the student must explain in their own words.
- Never use the term "shakla v'tarya" or other learning jargon students may not know. Say it plainly: the Gemara asks a question and then answers it.

OUTPUT
Return ONLY a JSON object, no other text, in exactly this shape:
{
  "title": "Masechet daf: short topic",
  "intro": "2-3 short sentences telling the student what the sugya is about and what to do.",
  "pesukim": [{ "he": "pasuk text in Hebrew", "ref": "Sefer chapter:verse or empty" }],
  "parts": [
    {
      "title": "Who has to ...? (short heading, no 'Part A')",
      "questions": [
        { "type": "select", "prompt": "...", "options": ["...", "..."], "answer": "..." },
        { "type": "order", "prompt": "...", "joiner": "because", "steps": ["first", "second", "third"] },
        { "type": "dialogue", "lines": [["Teacher", "..."], ["Student", "..."]] },
        { "type": "mcq", "prompt": "...", "options": ["...", "...", "...", "..."], "answerIndex": 2 }
      ]
    }
  ],
  "voice": { "title": "Read and explain the Gemara", "maxSeconds": 180, "instructions": "...", "checklist": ["Step 1: ...", "Step 2: ..."] },
  "teacherChecks": ["Question 3 says X. This rests on the line: ..."]
}
Set "voice" to null if no voice memo is requested.`;

async function callClaude(userText, maxTokens = 20000) {
  const r = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
    }),
  });
  let d;
  try { d = await r.json(); } catch { throw new Error(`The Claude server returned ${r.status}.`); }
  if (d?.error) throw new Error(d.error.message || JSON.stringify(d.error));
  const text = (d?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (!text) throw new Error("Claude returned nothing. Try again.");
  if (d.stop_reason === "max_tokens") throw new Error("Claude's draft was too long and got cut off. Try again, or ask for fewer questions.");
  return text;
}

function parseJson(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Claude's answer wasn't in the expected format. Try again.");
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { throw new Error("Claude's answer wasn't in the expected format. Try again."); }
}

// input: { gemara, translation, focus, level, partsWanted, questionCount, voice }
export async function draftAssignment(input) {
  const msg = [
    `GEMARA TEXT:\n${input.gemara.trim()}`,
    input.translation?.trim() ? `TRANSLATION (for your understanding):\n${input.translation.trim()}` : "No translation given. Work from the Hebrew/Aramaic only, and be extra careful.",
    input.title?.trim() ? `TITLE TO USE: ${input.title.trim()}` : "",
    `TEACHER'S FOCUS:\n${input.focus?.trim() || "The flow of the sugya and the reasoning behind each step."}`,
    `LEVEL: ${input.level}`,
    `ABOUT ${input.questionCount} QUESTIONS in total, split into parts that make sense. Mix of types: ${input.types.join(", ")}.`,
    input.voice
      ? (input.voiceFirst
          ? `VOICE MEMO: yes, ${input.voiceMinutes} minutes max, done FIRST, before any questions. The student reads the Gemara out loud one piece at a time and explains each piece: what question the Gemara asks and what answer it gives. Don't use the term "shakla v'tarya"; describe it in plain words. Make the checklist one item per question-and-answer step of the Gemara, phrased as "The Gemara asks ... What does it answer?" without giving the answer away. The written questions come after and should not just repeat the checklist.`
          : `VOICE MEMO: yes, ${input.voiceMinutes} minutes max, done after the questions. The student goes through the sugya step by step, reading each line and explaining it.`)
      : "VOICE MEMO: no.",
  ].filter(Boolean).join("\n\n");
  const raw = parseJson(await callClaude(msg));
  return normalizeDraft(raw);
}

// Sends the current draft back with the teacher's change request.
export async function reviseAssignment(current, gemaraText, request) {
  const { id, status, createdBy, createdAt, updatedAt, updatedBy, gemara, builtIn, ...rest } = current;
  const asDraft = {
    ...rest,
    parts: rest.parts.map((p) => ({
      title: p.title,
      questions: p.questions.map((q) => {
        if (q.type === "mcq") return { type: "mcq", prompt: q.prompt, options: q.options, answerIndex: q.answer };
        if (q.type === "order") return { type: "order", prompt: q.prompt, joiner: q.joiner, steps: q.answer };
        if (q.type === "select") return { type: "select", prompt: q.prompt, options: q.options, answer: q.answer };
        return { type: "dialogue", lines: q.lines };
      }),
    })),
  };
  const msg = [
    `GEMARA TEXT:\n${gemaraText.trim()}`,
    `CURRENT ASSIGNMENT (JSON):\n${JSON.stringify(asDraft, null, 1)}`,
    `THE TEACHER WANTS THIS CHANGED:\n${request.trim()}`,
    "Return the whole updated assignment as JSON in the same shape. Change only what the teacher asked for, and keep everything else the same.",
  ].join("\n\n");
  const raw = parseJson(await callClaude(msg));
  return normalizeDraft(raw);
}

// Teacher writes the request in their own words, or pastes an assignment they already have.
// input: { prompt, gemara, translation }
export async function draftFromPrompt(input) {
  const msg = [
    input.gemara?.trim() ? `GEMARA TEXT:\n${input.gemara.trim()}` : "",
    input.translation?.trim() ? `TRANSLATION:\n${input.translation.trim()}` : "",
    `THE TEACHER'S REQUEST, IN THEIR OWN WORDS:\n${input.prompt.trim()}`,
    `HOW TO HANDLE IT:
- Follow the teacher's request. It overrides the defaults above where they conflict (level, number of questions, voice memo or not, and so on).
- If the request contains an assignment the teacher already wrote (for example pasted from a chat or a document), convert it faithfully: keep their questions, wording, answers and order, and only change what the format requires.
- The site has four question types (select, order, mcq, dialogue) plus the voice memo. Open-ended written questions aren't supported. Turn an open-ended "explain" question into a voice memo checklist item; turn a question with one short right answer into a select or mcq question.
- If the teacher asks for the voice memo before the questions, set "voiceFirst": true at the top level.
- If the Hebrew/Aramaic text of the Gemara appears in the teacher's message (and no GEMARA TEXT was given above), add "gemara": [pieces] and, if there is English for it, "english": [pieces, same count], copying ONLY text that is actually in the message. Never write the Gemara text from memory. If the text isn't in the message, leave both out; the teacher will add it.
- If the teacher pasted English with the literal translation in bold, keep the bold as **double asterisks**.`,
  ].filter(Boolean).join("\n\n");
  const raw = parseJson(await callClaude(msg));
  const out = normalizeDraft(raw);
  const strs = (x) => (Array.isArray(x) ? x.map((t) => String(t).trim()).filter(Boolean) : []);
  if (strs(raw.gemara).length) out.gemara = strs(raw.gemara);
  if (strs(raw.english).length) out.english = strs(raw.english);
  return out;
}
