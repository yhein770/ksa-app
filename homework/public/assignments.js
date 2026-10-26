// Each assignment is one entry. To add a new sugya, copy an entry, give it a new id,
// and change the text and questions. Students open: /?a=<id>
// The first assignment in the list is the one shown when no ?a= is given.

export const ASSIGNMENTS = [
  {
    id: "kiddushin-29a-pidyon",
    title: "Kiddushin 29a: Pidyon HaBen",
    intro:
      "This sugya (passage) is about pidyon haben (redeeming a firstborn son). First, record yourself reading and explaining the Gemara. Then answer the questions.",
    gemara: [
      "לִפְדּוֹתוֹ. מְנָלַן? דִּכְתִיב: ״כׇּל בְּכוֹר בָּנֶיךָ תִּפְדֶּה״. וְהֵיכָא דְּלָא פַּרְקֵיהּ אֲבוּהּ מִיחַיַּיב אִיהוּ לְמִפְרְקֵיהּ דִּכְתִיב: (פָּדֹה) ״תִּפָּדֶה״.",
      "וְאִיהִי מְנָלַן דְּלָא מִיפַּקְדָה? דִּכְתִיב: ״תִּיפָּדֶה״ – ״תִּפְדֶּה״, כֹּל שֶׁמְּצֻוֶּוה לִפְדּוֹת אֶת עַצְמוֹ – מְצֻוֶּוה לִפְדּוֹת אֶת אֲחֵרִים, וְכֹל שֶׁאֵינוֹ מְצֻוֶּוה לִפְדּוֹת אֶת עַצְמוֹ – אֵינוֹ מְצֻוֶּוה לִפְדּוֹת אֲחֵרִים.",
      "וְאִיהִי מְנָלַן דְּלָא מִיחַיְּיבָא לְמִיפְרַק נַפְשַׁהּ? דִּכְתִיב: ״תִּפְדֶּה״ – ״תִּיפָּדֶה״, כֹּל שֶׁאֲחֵרִים מְצֻוִּוים לִפְדּוֹתוֹ – מְצֻוֶּוה לִפְדּוֹת אֶת עַצְמוֹ, וְכֹל שֶׁאֵין אֲחֵרִים מְצֻוִּוים לִפְדּוֹתוֹ – אֵין מְצֻוֶּוה לִפְדּוֹת אֶת עַצְמוֹ. וּמִנַּיִן שֶׁאֵין אֲחֵרִים מְצֻוִּוין לִפְדּוֹתָהּ? דְּאָמַר קְרָא: ״כׇּל בְּכוֹר בָּנֶיךָ תִּפְדֶּה״ – בָּנֶיךָ וְלֹא בְּנוֹתֶיךָ.",
    ],
    english: [
      "The baraita teaches that a father is obligated to redeem his son. The Gemara asks: From where do we derive this? The Gemara answers that this is as it is written: “All the firstborn of your sons you shall redeem” (Exodus 34:20). And in a case where one’s father does not redeem him he is obligated to redeem himself, as it is written: “You shall redeem [pado tifde]” (Numbers 18:15). The repetition of the verb indicates that a firstborn is required to be redeemed in any case, even if his father neglects to do so.",
      "And from where do we derive that a mother is not commanded to redeem her son? As it is written: “You shall redeem [tifde]” which can be read as: You shall be redeemed [tippadeh]. This indicates that whoever is commanded to redeem himself is commanded to redeem others, and whoever is not commanded to redeem himself is not commanded to redeem others. Since a woman is not commanded to redeem herself, she is not commanded to redeem her son either.",
      "The Gemara asks: And from where do we derive that she is not obligated to redeem herself? The Gemara answers that this is as it is written: “You shall redeem [tifde],” which can be read as: You shall be redeemed [tippadeh]. This indicates that any person whom others are commanded to redeem is commanded to redeem himself, and any person whom others are not commanded to redeem is not commanded to redeem himself. Since there is no mitzva for a parent to redeem his daughter, there is similarly no mitzva for a daughter to redeem herself. And from where is it derived that others are not commanded to redeem a daughter? As the verse states: “All the firstborn of your sons you shall redeem” (Exodus 34:20), i.e., your sons and not your daughters.",
    ],
    pesukim: [
      { he: "כֹּל בְּכוֹר בָּנֶיךָ תִּפְדֶּה", ref: "Shemos 34:20" },
      { he: "אַךְ פָּדֹה תִפְדֶּה אֵת בְּכוֹר הָאָדָם", ref: "Bamidbar 18:15" },
    ],

    parts: [
      {
        title: "Part A: Who has to redeem?",
        questions: [
          { id: "q1", type: "select", prompt: "Who has to redeem a firstborn son first?",
            options: ["the father", "the son himself", "yes", "no"], answer: "the father" },
          { id: "q2", type: "select", prompt: "If he doesn't, who has to?",
            options: ["the father", "the son himself", "yes", "no"], answer: "the son himself" },
          { id: "q3", type: "select", prompt: "Does a mother have to redeem her son?",
            options: ["the father", "the son himself", "yes", "no"], answer: "no" },
          { id: "q4", type: "select", prompt: "Does a daughter have to redeem herself?",
            options: ["the father", "the son himself", "yes", "no"], answer: "no" },
        ],
      },
      {
        title: "Part B: The chain",
        questions: [
          {
            id: "q5", type: "order",
            prompt: "Put the three reasons in order. A mother doesn't have to redeem her son, because:",
            joiner: "because",
            options: [
              "Others don't have to redeem her",
              "The pasuk says ״בָּנֶיךָ וְלֹא בְּנוֹתֶיךָ״ (your sons, not your daughters)",
              "She doesn't have to redeem herself",
            ],
            answer: [
              "She doesn't have to redeem herself",
              "Others don't have to redeem her",
              "The pasuk says ״בָּנֶיךָ וְלֹא בְּנוֹתֶיךָ״ (your sons, not your daughters)",
            ],
          },
          {
            type: "dialogue",
            lines: [
              ["Teacher", "Why can Josh leave class early?"],
              ["Josh", "Because I'm on the early dismissal list."],
              ["Teacher", "Why are you on the list?"],
              ["Josh", "Because I can leave class early."],
            ],
          },
          {
            id: "q6", type: "mcq",
            prompt:
              "Josh's two answers only prove each other. The Gemara's two rules could have the same problem. Why does the Gemara need ״בָּנֶיךָ וְלֹא בְּנוֹתֶיךָ״ (your sons, not your daughters) at the end?",
            options: [
              "To show that a father has to redeem his firstborn son",
              "To teach that a mother must redeem a firstborn daughter",
              "To teach that a son redeems himself if his father didn't",
              "To prove one step without leaning on the other steps",
            ],
            answer: 3,
          },
        ],
      },
    ],

    voiceFirst: true,
    voice: {
      title: "Read and explain the Gemara",
      maxSeconds: 240,
      instructions:
        "Read the Gemara out loud one piece at a time, and explain each piece in your own words. In each piece, the Gemara asks a question and then answers it. Say what the question is and what the answer is.",
      checklist: [
        "Piece 1: The Gemara asks how we know a father has to redeem his son. What pasuk (verse) answers it? And who has to do it if the father doesn't?",
        "Piece 2: The Gemara asks how we know a mother doesn't have to redeem her son. What rule does it use to answer?",
        "Piece 3: The Gemara asks how we know a woman doesn't have to redeem herself. What rule does it use, and what does the last line, ״בָּנֶיךָ וְלֹא בְּנוֹתֶיךָ״ (your sons, not your daughters), add?",
      ],
    },
  },
];

export function getAssignment(id) {
  return ASSIGNMENTS.find((a) => a.id === id) || ASSIGNMENTS[0];
}

// Returns { correct, total, perQuestion: { id: true/false } } for the auto-checked questions.
export function scoreAnswers(assignment, answers) {
  let correct = 0, total = 0;
  const perQuestion = {};
  for (const part of assignment.parts) {
    for (const q of part.questions) {
      if (!q.id) continue;
      total++;
      const a = answers?.[q.id];
      let ok = false;
      if (q.type === "order") ok = Array.isArray(a) && q.answer.every((v, i) => a[i] === v);
      else ok = a === q.answer;
      perQuestion[q.id] = ok;
      if (ok) correct++;
    }
  }
  return { correct, total, perQuestion };
}

// ---------- shared helpers for assignments made in the builder ----------

export function questionCount(a) {
  return (a.parts || []).reduce((t, p) => t + (p.questions || []).filter((q) => q.id).length, 0);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const noDash = (s) => String(s ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ").trim();

// Turns Claude's draft into the same shape as the built-in assignments:
// gives questions ids, shuffles MCQ options so the right letter is random,
// shuffles the order-question word bank, and strips em dashes.
export function normalizeDraft(raw) {
  const parts = (raw.parts || []).map((p) => ({
    title: noDash(p.title),
    questions: (p.questions || []).map((q) => {
      if (q.type === "dialogue") {
        return { type: "dialogue", lines: (q.lines || []).map(([w, t]) => [noDash(w), noDash(t)]) };
      }
      if (q.type === "mcq") {
        const opts = (q.options || []).map(noDash);
        const right = opts[q.answerIndex ?? q.answer ?? 0];
        const mixed = shuffle(opts);
        return { type: "mcq", prompt: noDash(q.prompt), options: mixed, answer: mixed.indexOf(right) };
      }
      if (q.type === "order") {
        const steps = (q.steps || q.answer || []).map(noDash);
        return { type: "order", prompt: noDash(q.prompt), joiner: noDash(q.joiner || "because"), answer: steps, options: shuffle(steps) };
      }
      // select (word bank)
      return { type: "select", prompt: noDash(q.prompt), options: (q.options || []).map(noDash), answer: noDash(q.answer) };
    }),
  }));
  return renumber({
    title: noDash(raw.title),
    intro: noDash(raw.intro),
    pesukim: (raw.pesukim || []).filter((p) => p && p.he).map((p) => ({ he: String(p.he).trim(), ref: noDash(p.ref) })),
    parts,
    voiceFirst: !!raw.voiceFirst,
    voice: raw.voice
      ? {
          title: noDash(raw.voice.title || "Voice memo"),
          maxSeconds: Math.min(600, Math.max(60, Math.round(raw.voice.maxSeconds || 180))),
          instructions: noDash(raw.voice.instructions),
          checklist: (raw.voice.checklist || []).map(noDash).filter(Boolean),
        }
      : null,
    teacherChecks: (raw.teacherChecks || []).map(noDash).filter(Boolean),
  });
}

// Gives every answerable question an id q1, q2, ... in reading order.
export function renumber(a) {
  let n = 0;
  for (const p of a.parts || []) for (const q of p.questions || []) {
    if (q.type === "dialogue") delete q.id;
    else q.id = `q${++n}`;
  }
  return a;
}

// Problems that should be fixed (errors) or looked at (warnings) before publishing.
export function checkAssignment(a) {
  const errors = [], warnings = [];
  if (!a.title?.trim()) errors.push("The assignment needs a title.");
  if (!a.gemara?.length) errors.push("The assignment needs the Gemara text.");
  if (!questionCount(a) && !a.voice) errors.push("The assignment has no questions and no voice memo.");
  let n = 0;
  for (const p of a.parts || []) for (const q of p.questions || []) {
    if (q.type === "dialogue") continue;
    n++;
    const label = `Question ${n}`;
    if (!q.prompt?.trim()) errors.push(`${label} has no question text.`);
    if (q.type === "select") {
      if (!q.options?.includes(q.answer)) errors.push(`${label}: the correct answer isn't one of the choices.`);
      if (new Set(q.options).size !== q.options?.length) warnings.push(`${label} has the same choice twice.`);
    }
    if (q.type === "mcq") {
      if ((q.options || []).some((o) => !o.trim())) errors.push(`${label} has an empty choice.`);
      if (!(q.answer >= 0 && q.answer < q.options.length)) errors.push(`${label} has no correct answer marked.`);
      else {
        const len = q.options.map((o) => o.length);
        const right = len[q.answer];
        if (right === Math.max(...len) && len.filter((l) => l === right).length === 1) {
          warnings.push(`${label}: the correct choice is the longest one. Shorten it or lengthen another.`);
        }
      }
    }
    if (q.type === "order") {
      if ((q.answer || []).length < 2) errors.push(`${label} needs at least two steps.`);
      if ((q.answer || []).some((s) => !s.trim())) errors.push(`${label} has an empty step.`);
    }
  }
  if (a.voice && !a.voice.checklist?.length) warnings.push("The voice memo has no checklist.");
  if (a.english?.length && a.english.length !== a.gemara?.length) {
    warnings.push(`The Hebrew has ${a.gemara.length} pieces but the English has ${a.english.length}. Separate both with blank lines in the same places so each English piece sits under its Hebrew.`);
  }
  return { errors, warnings };
}

// Strips a leading "Part A:" so the page can letter sections in the order they appear.
export function bareTitle(t) {
  return String(t || "").replace(/^\s*part\s+[a-z0-9]+\s*[:.\-]\s*/i, "").trim();
}
