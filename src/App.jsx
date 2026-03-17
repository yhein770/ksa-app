import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, collection, onSnapshot, deleteDoc } from "firebase/firestore";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, fetchSignInMethodsForEmail, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
async function callClaude(user, system, max = 400) {
  const r = await fetch("https://ksa-app-production.up.railway.app/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: max,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const d = await r.json();
  if (!d?.content?.[0]?.text) {
    console.error("Claude API error:", JSON.stringify(d));
    throw new Error("Claude API returned no content");
  }
  return d.content[0].text;
}
async function callWhisper(audioBlob, language = null) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  if (language) formData.append("language", language);
  const r = await fetch("https://ksa-app-production.up.railway.app/api/whisper", {
    method: "POST",
    body: formData
  });
  const d = await r.json();
  console.log("whisper full response:", JSON.stringify(d));
  return d.text || "";
}

async function loadStudent(email) {
  try {
    const snap = await getDoc(doc(db, "students", email));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error("loadStudent error:", e); return null; }
}

async function saveStudent(email, data) {
  try {
    await setDoc(doc(db, "students", email), { ...data, lastSeen: new Date().toISOString() }, { merge: true });
  } catch (e) { console.error("saveStudent error:", e); }
}

const SEIFIM_DATA = {};

async function loadSimanText(simanNum) {
  if (SEIFIM_DATA[simanNum]) { SEIFIM = SEIFIM_DATA[simanNum]; return; }
  const cacheKey = `sefaria_ksa_${simanNum}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) { SEIFIM_DATA[simanNum] = JSON.parse(cached); SEIFIM = SEIFIM_DATA[simanNum]; return; }
  const res = await fetch(`https://www.sefaria.org/api/texts/Kitzur_Shulchan_Aruch.${simanNum}?commentary=0&context=0&pad=0`);
  const data = await res.json();
SEIFIM_DATA[simanNum] = data.he.map((he, i) => ({
  he,
  en: (data.text[i] || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
}));
  localStorage.setItem(cacheKey, JSON.stringify(SEIFIM_DATA[simanNum]));
  SEIFIM = SEIFIM_DATA[simanNum];
}

async function loadTOC() {
  const cached = localStorage.getItem("sefaria_ksa_toc");
  if (cached) return JSON.parse(cached);
  const toc = Array.from({ length: 221 }, (_, i) => ({
    num: i + 1,
    he: `סימן ${i + 1}`,
    en: `Siman ${i + 1}`,
  }));
  localStorage.setItem("sefaria_ksa_toc", JSON.stringify(toc));
  return toc;
}
function stripNikud(s) {
  return s.replace(/[\u0591-\u05C7]/g, "").replace(/[^\u05D0-\u05EA\s]/g, "").trim();
}

function toHebrewNumeral(n) {
  const hundreds = ["","ק","ר","ש","ת","תק","תר","תש","תת","תתק"];
  const tens     = ["","י","כ","ל","מ","נ","ס","ע","פ","צ"];
  const ones     = ["","א","ב","ג","ד","ה","ו","ז","ח","ט"];
  let str = hundreds[Math.floor(n/100)];
  const r = n % 100;
  if (r === 15) str += "טו";
  else if (r === 16) str += "טז";
  else { str += tens[Math.floor(r/10)]; str += ones[r%10]; }
  if (str.length === 1) return str + "׳";
  return str.slice(0,-1) + "״" + str.slice(-1);
}
const PHRASES = [
  { he:"מִכָּל מָקוֹם", stripped:"מכל מקום", en:"nevertheless / in any case" },
  { he:"אַף עַל פִּי", stripped:"אף על פי", en:"even though / although" },
  { he:"אַף עַל פִּי כֵן", stripped:"אף על פי כן", en:"even so / nonetheless" },
  { he:"כָּל שֶׁכֵּן", stripped:"כל שכן", en:"all the more so" },
  { he:"הַקָּדוֹשׁ בָּרוּךְ הוּא", stripped:"הקדוש ברוך הוא", en:"God" },
  { he:"בִּשְׁעַת הַדְּחָק", stripped:"בשעת הדחק", en:"under pressing circumstances" },
  { he:"חַס וְשָׁלוֹם", stripped:"חס ושלום", en:"God forbid" },
  { he:"חַס וְחָלִילָה", stripped:"חס וחלילה", en:"God forbid (stronger)" },
  { he:"מוֹצָאֵי שַׁבָּת", stripped:"מוצאי שבת", en:"Saturday night / after Shabbat ends" },
  { he:"בֵּין הַשְּׁמָשׁוֹת", stripped:"בין השמשות", en:"twilight" },
  { he:"צֵאת הַכּוֹכָבִים", stripped:"צאת הכוכבים", en:"nightfall" },
  { he:"מִצְוָה מִן הַמֻּבְחָר", stripped:"מצוה מן המובחר", en:"the ideal way to perform a mitzvah" },
  { he:"יֵצֶר הָרָע", stripped:"יצר הרע", en:"the evil inclination" },
  { he:"בֵּית הַכִּסֵּא", stripped:"בית הכסא", en:"bathroom" },
  { he:"שֵׁם שָׁמַיִם", stripped:"שם שמים", en:"God (reverent euphemism)" },
  { he:"יִרְאַת שָׁמַיִם", stripped:"יראת שמים", en:"piety / being God-fearing" },
  { he:"מִדַּת חֲסִידוּת", stripped:"מדת חסידות", en:"going beyond the letter of the law" },
  { he:"לְשׁוֹן הָרָע", stripped:"לשון הרע", en:"forbidden speech / gossip" },
  { he:"בֵּין אָדָם לַחֲבֵרוֹ", stripped:"בין אדם לחברו", en:"interpersonal obligations" },
  { he:"כָּבוֹד הַבְּרִיּוֹת", stripped:"כבוד הבריות", en:"human dignity" },
  { he:"מַה שֶּׁאֵין כֵּן", stripped:"מה שאין כן", en:"whereas / as opposed to that" },
  { he:"מִן הַסְּתָם", stripped:"מן הסתם", en:"by default / ordinarily" },
  { he:"דֶּרֶךְ אֶרֶץ", stripped:"דרך ארץ", en:"proper conduct / etiquette" },
  { he:"לִפְנִים מִשּׁוּרַת הַדִּין", stripped:"לפנים משורת הדין", en:"beyond the letter of the law" },
  { he:"מִפְּנֵי דַרְכֵי שָׁלוֹם", stripped:"מפני דרכי שלום", en:"for the sake of communal harmony" },
  { he:"עַל אַחַת כַּמָּה וְכַמָּה", stripped:"על אחת כמה וכמה", en:"all the more so (stronger)" },
  { he:"בֵּין כָּךְ וּבֵין כָּךְ", stripped:"בין כך ובין כך", en:"either way / in any case" },
  { he:"פִּקּוּחַ נֶפֶשׁ", stripped:"פקוח נפש", en:"saving a life (overrides most laws)" },
  { he:"חִלּוּל הַשֵּׁם", stripped:"חילול השם", en:"a public act that shames God or Judaism" },
  { he:"מַרְאִית הָעַיִן", stripped:"מראית העין", en:"avoiding appearances of wrongdoing" },
  { he:"קַל וָחֹמֶר", stripped:"קל וחומר", en:"a fortiori reasoning (if X, certainly Y)" },
  { he:"יָצָא יְדֵי חוֹבָה", stripped:"יצא ידי חובה", en:"fulfilled one's obligation" },
  { he:"בֵּין אָדָם לַמָּקוֹם", stripped:"בין אדם למקום", en:"obligations between man and God" },
  { he:"בְּרֹב עַם הַדְרַת מֶלֶךְ", stripped:"ברוב עם הדרת מלך", en:"more people = greater honor to God" },
  { he:"לֹא פְּלוּג", stripped:"לא פלוג", en:"the rule applies uniformly" },
];

const WORD_BANK_RAW = [
  ["צָרִיךְ","must"],["לִזָּהֵר","to be careful"],["מְאֹד","very"],["שֶׁלֹּא","so as not to"],
  ["לְהוֹנוֹת","to deceive/wrong"],["חֲבֵרוֹ","his fellow"],["וְכֹל","and anyone"],
  ["הַמְאַנֶּה","who wrongs"],["בֵּין","whether / or"],["הַלּוֹקֵחַ","the buyer"],
  ["הַמּוֹכֵר","the seller"],["עוֹבֵר","transgresses"],["בְּלָאו","a negative commandment"],
  ["שֶׁנֶּאֱמַר","as it is said"],["תִמְכְּרוּ","you sell"],["מִמְכָּר","a sale"],
  ["לַעֲמִיתֶךָ","to your fellow"],["קָנֹה","buying"],["מִיַּד","from the hand of"],
  ["תּוֹנוּ","wrong/deceive"],["אִישׁ","a man/each one"],["אָחִיו","his brother"],
  ["הַשְׁאֵלָה","the question"],["הָרִאשׁוֹנָה","the first"],["שֶׁשּׁוֹאֲלִין","that they ask"],
  ["הָאָדָם","the person"],["שֶׁמַּכְנִיסִין","that they bring"],["לַדִּין","to judgment"],
  ["נָשָׂאתָ","did you conduct"],["וְנָתַתָּ","and give"],["בֶּאֱמוּנָה","in faithfulness/honestly"],
  ["כְּשֵׁם","just as"],["אִסּוּר","a prohibition"],["אוֹנָאָה","wronging/deception (ona'ah)"],
  ["בְּמַשָּׂא","in buying"],["וּמַתָּן","and selling"],["בִּשְׂכִירוּת","in hiring"],
  ["וּבְקַבְּלָנוּת","and in contracting"],["וּבְחִילּוּף","and in exchanging"],["מַטְבֵּעַ","currency"],
  ["הַנּוֹשֵׂא","one who deals"],["וְנוֹתֵן","and gives"],["אֵינוֹ","does not"],
  ["חוֹשֵׁשׁ","need to worry"],["כֵּיצַד","how so?"],["חֵפֶץ","item/object"],
  ["לְקַחְתִּיו","I bought it"],["רוֹצֶה","want"],["לְהִשְׂתַּכֵּר","to profit"],
  ["נִתְאַנָּה","was wronged/overpaid"],["בִּלְקִיחָתוֹ","in his purchase"],
  ["הַמִּתְאַנֶּה","who was wronged"],["רַשַּׁאי","permitted"],["אֲחֵרִים","others"],
  ["מֻתָּר","it is permitted"],["שֶׁהֲרֵי","for indeed"],["כִּמְפָרֵשׁ","like one who explains"],
  ["יִסְמֹךְ","rely"],["שְׁוִי","the value of"],["הַמִּקָּח","the item/purchase"],
  ["אֶלָּא","but rather"],["הַדָּמִים","the price"],["בַּעֲדוֹ","for it"],
  ["לִמְכּוֹר","to sell"],["אָסוּר","it is forbidden"],["לְיַפּוֹתוֹ","to beautify it"],
  ["כְּדֵי","in order to"],["לְרַמּוֹת","to deceive"],["כְּגוֹן","for example"],
  ["לְהַשְׁקוֹת","to give to drink"],["בְּהֵמָה","an animal"],["סֻבִּין","bran"],
  ["שֶׁמְּנַפְּחִין","which puffs up"],["שַׂעֲרוֹתֶיהָ","its hairs"],["שֶׁתֵּרָאֶה","it will appear"],
  ["שְׁמֵנָה","fat/healthy"],["לִצְבּוֹעַ","to paint/dye"],["כֵּלִים","vessels/utensils"],
  ["יְשָׁנִים","old"],["כַּחֲדָשִׁים","like new"],["וְכֵן","and likewise"],
  ["לְעָרֵב","to mix"],["מְעַט","a little"],["פֵּרוֹת","fruit"],["רָעִים","bad/inferior"],
  ["יָפִים","good/fine"],["לְמָכְרָם","to sell them"],["בְּחֶזְקַת","under the presumption of"],
  ["מַשְׁקֶה","a beverage"],["טַעְמוֹ","its taste"],["נִכָּר","detectable/recognizable"],
  ["יַרְגִּישׁ","will detect/notice"],["לְחֶנְוָנִי","for a shopkeeper"],["לְחַלֵּק","to distribute"],
  ["קְלָיוֹת","roasted kernels"],["וֶאֱגוֹזִים","and nuts"],["לְתִינוֹקוֹת","to children"],
  ["לְהַרְגִּילָם","to accustom them"],["שֶׁיִּקְנוּ","that they will buy"],
  ["מִמֶּנּוּ","from him"],["בְּזוֹל","cheaply"],["מֵהַשַּׁעַר","than the market price"],
  ["הַשּׁוּק","the market"],["לְעַכֵּב","prevent/stop"],["הַמּוֹדֵד","one who measures"],
  ["שׁוֹקֵל","weighs"],["חָסֵר","short/deficient"],["לַנָּכְרִי","to a non-Jew"],
  ["עָוֶל","injustice/wrong"],["בַּמִּדָּה","in measurement"],["בַּמִּשְׁקָל","in weight"],
  ["וּבַמְּשׂוּרָה","and in volume"],["הַמִּדּוֹת","the measures"],["וְהַמִּשְׁקָלוֹת","and the weights"],
  ["קָשֶׁה","severe/hard"],["לָשׁוּב","to return/repent"],["בִּתְשׁוּבָה","in repentance"],
  ["הֲגוּנָה","proper/fitting"],["יָשִׁיב","to repay/return"],["צָרְכֵי","the needs of"],
  ["רַבִּים","the public/many"],["תְּשׁוּבָה","repentance"],["כְּתִיב","it is written"],
  ["בְּכִיסְךָ","in your bag/pocket"],["אֶבֶן","a stone/weight"],["וָאָבֶן","two different weights"],
  ["גְּדוֹלָה","large"],["וּקְטַנָּה","and small"],["בְּבֵיתְךָ","in your house"],
  ["אֵיפָה","a measure (eifah)"],["שְׁלֵמָה","full/complete"],["וָצֶדֶק","and just"],
  ["רַבּוֹתֵינוּ","our Rabbis"],["זִכְרוֹנָם","their memory"],["לִבְרָכָה","for a blessing"],
  ["מָמוֹן","money/wealth"],["מִשּׁוּם","because of"],["וְיִתְעַשֵּׁר","to become wealthy"],
  ["יִשָּׂא","let him conduct"],["רַחֲמִים","mercy/compassion"],["שֶׁהָעֹשֶׁר","that the wealth"],
  ["הַכֶּסֶף","the silver"],["הַזָּהָב","the gold"],["לִמְדּוֹד","to measure"],
  ["וְלִשְׁקוֹל","and to weigh"],["בְּעַיִן","with an eye"],["יָפָה","good/generous"],
  ["עוֹדֵף","excess/extra"],["הַמִּדָּה","the measure"],["צַדֵּק","be just"],
  ["מִשֶּׁלְּךָ","from your own"],["כְּמִנְהַג","according to the custom of"],
  ["הַמְּדִינָה","the region/locality"],["יְשַׁנֶּה","deviate/change"],["כְּלָל","at all"],
  ["שֶׁנָּהֲגוּ","where it is customary"],["לִגְדּוֹשׁ","to give heaped measure"],
  ["יִמְחוֹק","give level measure"],["בִּרְצוֹן","with the consent of"],
  ["שֶׁפִּחֵת","who reduced"],["מִדָּמִים","from the price"],["שֶׁמּוֹסִיף","who adds/charges more"],
  ["הִקְפִּידָה","is strict/careful"],["עִוּוּת","distorting/falsifying"],
  ["תַּקָלָה","a stumbling block/harm"],["הָרוֹאֶה","the observer"],
  ["חַיָּבִים","are obligated"],["רָאשֵׁי","the heads/leaders of"],
  ["הַקָּהָל","the community"],["לְהַעֲמִיד","to appoint"],["מְמֻנִּים","supervisors/officers"],
  ["מְחַזְּרִים","going around/inspecting"],["הַחֲנֻיּוֹת","the shops"],
  ["מֹאזְנַיִם","scales/balance"],["מְקֻלְקָלִים","faulty/defective"],
  ["רַשָּׁאִים","they are permitted"],["לְהַכּוֹתוֹ","to flog/strike him"],
  ["וּלְקָנְסוֹ","and to fine him"],["לְהַשְׁהוֹת","to keep/retain"],
  ["בְּבֵיתוֹ","in his house"],["בַּחֲנוּתוֹ","in his shop"],["עָבִיט","a chamber pot"],
  ["שֶׁמָּא","lest"],["הַמְחַזֵּר","one who seeks/pursues"],
  ["הֻשְׁווּ","they agreed on price"],["הַקִּנְיָן","the transaction/acquisition"],
  ["נִקְרָא","is called"],["רָשָׁע","wicked"],["עֲדַיִן","still/yet"],
  ["לְהַשִּׂיג","to encroach on"],["גְּבוּל","the boundary of"],["רֵעֵהוּ","his neighbor"],
  ["הַנּוֹתֵן","one who gives"],["מָעוֹת","money/coins"],["לִקְנוֹת","to buy"],
  ["הַשָּׁלִיחַ","the agent/messenger"],["הַחֵפֶץ","the item/object"],
  ["בִּמְעוֹתָיו","with his own money"],["הֲרֵי","behold/this person is"],
  ["רַמָּאי","a swindler/cheater"],["הַמְשַׁלֵּחַ","the principal/sender"],
  ["מְחֻיָּב","he is obligated"],["לִתְּנוֹ","to give it"],
  ["מִקְצָת","a portion/partial"],["שֶׁרָשַׁם","who marked"],["סִימָן","a sign/mark"],
  ["בִּפְנֵי","in the presence of"],["הַחוֹזֵר","who backs out"],
  ["מַעֲשֵׂה","the deed of"],["יִשְׂרָאֵל","a Jew/Israel"],["וְחַיָּב","and is liable"],
  ["מִי שֶׁפָּרַע","Mi She'para — court curse for backing out"],
  ["שֶׁאוֹרְרִין","that they curse"],["שֶׁפָּרַע","who punished"],
  ["הַמַּבּוּל","the Flood"],["הַפְּלַגָּה","the Tower of Babel"],
  ["סְדוֹם","Sodom"],["וַעֲמוֹרָה","and Gomorrah"],["שֶׁטָּבְעוּ","who drowned"],
  ["בַּיָּם","in the sea"],["יִפָּרַע","will punish"],["בְּדִבּוּרוֹ","his word"],
  ["וְרָאוּי","and it is fitting/proper"],["לַעֲמֹד","to stand by"],
  ["הַמְּחִיר","the price"],["לַחֲזוֹר","to back out"],["חוֹזֵר","backs out"],
  ["מִמְחֻסְּרֵי","among those lacking"],["אֲמָנָה","faithfulness/integrity"],
  ["רוּחַ","the spirit of"],["חֲכָמִים","the Sages"],["נוֹחָה","at rest/pleased"],
  ["שְׁאֵרִית","the remnant of"],["עַוְלָה","injustice"],["כָּזָב","falsehood"],
  ["שָׁמַיִם","Heaven"],["לְקַיֵּם","to fulfill"],["מַחְשֶׁבֶת","the thought of"],
  ["לִבּוֹ","his heart"],["חָשַׁב","he thought"],["וְגָמַר","and decided"],
  ["לִמְכֹּר","to sell"],["בִּסְכוּם","at a sum/price of"],["וְהַלָּה","and the other person"],
  ["וְהוֹסִיף","and offered more"],["וְדוֹבֵר","and speaks"],["אֱמֶת","truth"],
  ["טוֹבָה","good deed/favor"],["מִצְוָה","of a mitzvah"],["שְׂפָתָיו","his lips"],
  ["לִתֵּן","to give"],["מַתָּנָה","gift"],["קְטַנָּה","small"],
  ["סָמַךְ","relied"],["בְּדַעְתּוֹ","in his mind"],["שֶׁבְּוַדַּאי","that certainly"],
  ["חָזַר","he changed his mind"],["מְרֻבָּה","large"],["גְּמוּרָה","complete/genuine"],
  ["לְשַׁנּוֹת","to change one's mind"],["בַּפֶּה","with the mouth"],["בַּלֵּב","in the heart"],
  ["צֶדֶק","justice/honest"],["נֵדֶר","a vow"],["מַחְשַׁבְתּוֹ","his intention"],
  ["הָרוֹצֶה","one who wishes"],["בַּיִת","a house"],["שְׁנַיִם","two buyers"],
  ["בְּדָמִים","at the price of"],["בַּעַל","owner of"],["הַמֶּצֶר","the adjacent land"],
  ["מִיּוֹשְׁבֵי","from the residents of"],["עִירוֹ","his city"],
  ["בֶּן","son/person of"],["קוֹדֵם","takes priority"],["שֶׁנֵיהֶם","both of them"],
  ["שְׁכֵנוֹ","his neighbor"],["הָרָגִיל","who regularly visits"],
  ["קְרוֹבוֹ","his relative"],["שָׁכֵן","a neighbor"],["קָרוֹב","near"],
  ["מֵאָח","than a brother"],["רָחוֹק","far"],["חָכָם","Torah scholar"],
  ["לְכֻלָּם","over all of them"],["לְהַלּוֹקֵחַ","to the buyer"],
  ["וּלְסַלֵּק","and displace/remove"],["הַמִּצְרָן","the adjacent owner"],
  ["עַם","a person of"],["הָאָרֶץ","the land [unlearned person]"],
  ["קְדִימוֹת","priorities"],["וְעָשִׂיתָ","and you shall do"],
  ["הַיָּשָׁר","the upright/straight"],["וְהַטּוֹב","and the good"],["ה׳","Hashem"],
];

const WORD_MAP = {};
WORD_BANK_RAW.forEach(([he, en]) => {
  const k = stripNikud(he);
  if (!WORD_MAP[k]) WORD_MAP[k] = { he, en };
});

let SEIFIM = [];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Heebo:wght@300;400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body { overflow-x: hidden; width: 100%; }
  html { overflow-x: hidden; }
  body{background:hsl(35,25%,95%);font-family:'EB Garamond',serif;}
  .ws{cursor:pointer;border-radius:3px;padding:1px 2px;transition:background .1s;display:inline;}
  .ws:hover{background:hsl(45,90%,70%);}
  .ws.hit{background:hsl(200,80%,82%) !important;}
  .tab{background:none;border:none;cursor:pointer;padding:10px 16px;font-family:'EB Garamond',serif;font-size:15px;border-bottom:2.5px solid transparent;transition:all .2s;color:hsl(25,20%,52%);white-space:nowrap;}
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes kuf-pulse { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(1.1); opacity:0.75; } }
  @keyframes kuf-draw { 0%,100% { opacity:0.35; } 50% { opacity:1; } }
  .tab.on{border-bottom-color:hsl(25,50%,36%);color:hsl(25,40%,20%);font-weight:600;}
  .opt{width:100%;text-align:left;border:1.5px solid hsl(35,20%,80%);background:white;border-radius:10px;padding:11px 14px;cursor:pointer;font-family:'EB Garamond',serif;font-size:15px;transition:all .15s;margin-bottom:8px;color:hsl(25,20%,25%);}
  .opt:hover:not(:disabled){border-color:hsl(25,40%,55%);background:hsl(35,40%,97%);}
  .opt.sel{border-color:hsl(210,55%,55%);background:hsl(210,80%,97%);}
  .opt.cor{border-color:hsl(142,50%,42%);background:hsl(142,50%,95%);color:hsl(142,40%,22%);}
  .opt.wrg{border-color:hsl(0,55%,55%);background:hsl(0,70%,97%);color:hsl(0,40%,30%);}
  input:focus{outline:none;border-color:hsl(25,40%,52%) !important;}
`;

const C = {
  bg:"hsl(35,25%,95%)", white:"white", brown:"hsl(25,45%,33%)",
  gold:"hsl(45,70%,52%)", green:"hsl(142,44%,37%)", red:"hsl(0,55%,50%)",
  muted:"hsl(25,20%,50%)", border:"hsl(35,20%,82%)"
};

function Btn({ children, onClick, disabled, bg, style={} }) {
  const b = disabled ? "hsl(35,15%,74%)" : (bg || C.brown);
  return (
    <button onClick={onClick} disabled={disabled} style={{ background:b, color:disabled?"#999":"white", border:"none", borderRadius:11, padding:"12px 22px", cursor:disabled?"not-allowed":"pointer", fontFamily:"'EB Garamond',serif", fontSize:16, ...style }}>
      {children}
    </button>
  );
}

// ── WORD POPUP ───────────────────────────────────────────────────────────────
function WordPopup({ popup, onClose }) {
  if (!popup) return null;
  return (
    <div onClick={e => e.stopPropagation()} style={{ position:"fixed",bottom:0,left:0,right:0,background:"white",borderTop:`2px solid ${C.border}`,padding:"14px 22px 22px",zIndex:300,boxShadow:"0 -6px 24px rgba(0,0,0,.13)" }}>
      <div style={{ maxWidth:700, margin:"0 auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={onClose} style={{ background:"none",border:"none",cursor:"pointer",fontSize:20,color:C.muted,padding:0 }}>✕</button>
{popup.en && <span style={{ fontSize:11,background:"hsl(142,40%,90%)",color:"hsl(142,40%,28%)",borderRadius:20,padding:"2px 10px" }}>{popup.isPhrase ? "📚 Expression" : "Saved ✓"}</span>}   
       </div>
          <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:26,fontWeight:700 }}>{popup.he}</div>
        </div>
        {popup.loading
          ? <p style={{ color:C.muted,fontSize:15,textAlign:"center" }}>Looking up…</p>
          : <p style={{ fontSize:17,color:"hsl(25,20%,28%)",lineHeight:1.5 }}>{popup.en}</p>}
      </div>
    </div>
  );
}

function CtxSnippet({ ctx, targetHe }) {
  if (!ctx) return null;
  const targetStripped = stripNikud(targetHe);
  return (
    <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:13, color:C.muted, marginTop:8, lineHeight:2.2, textAlign:"center" }}>
      {ctx.split(" ").map((w, i, arr) => {
        const isTarget = stripNikud(w) === targetStripped;
        return (
          <span key={i} style={{ textDecoration: "none", fontWeight:isTarget?700:400, color:isTarget?"hsl(25,20%,35%)":C.muted }}>
            {w}{i < arr.length-1 ? " " : ""}
          </span>
        );
      })}
    </p>
  );
}

// ── SEIF VOCAB FLASHCARDS ────────────────────────────────────────────────────
function SeifCards({ seifIdx, seifVocab, onDone, vocabCompleted }) {
  const words = Object.entries(seifVocab || {}).map(([key, val]) => ({
    key,
    he: typeof val === "object" ? val.he : key,
    en: typeof val === "object" ? val.en : val,
    ctx: typeof val === "object" ? val.ctx : "",
  }));

  const [knownSet, setKnownSet] = useState(new Set());
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const remaining = words.filter(w => !knownSet.has(w.key));
  const card = remaining[cardIdx % Math.max(remaining.length, 1)];

  useEffect(() => {
    function handleKey(e) {
      if (e.key !== "Enter") return;
      if (!card || remaining.length === 0) return;
      if (!flipped) setFlipped(true);
      else { setKnownSet(s => new Set([...s, card.key])); setFlipped(false); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flipped, card, remaining.length]);

  if (words.length === 0) {
    if (vocabCompleted) return (
      <div style={{ textAlign:"center", padding:"50px 20px" }}>
        <div style={{ fontSize:36, marginBottom:10 }}>✅</div>
        <p style={{ fontSize:17, marginBottom:22 }}>Vocab complete! Tap words in the Read tab to add more.</p>
        <Btn onClick={() => onDone(true)}>Go to Content Quiz →</Btn>
      </div>
    );
    return (
      <div style={{ textAlign:"center", padding:"50px 20px" }}>
        <div style={{ fontSize:36, marginBottom:10 }}>💡</div>
        <p style={{ fontSize:17, marginBottom:20 }}>Tap words in the Read tab to build your vocab deck.</p>
<Btn onClick={() => onDone(true)}>← Back to Reading</Btn>      </div>
    );
  }

  if (remaining.length === 0) return (
    <div style={{ textAlign:"center", padding:"50px 20px" }}>
      <div style={{ fontSize:48, marginBottom:10 }}>🎉</div>
      <p style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>All cards reviewed!</p>
      <p style={{ color:C.muted, marginBottom:22 }}>Now test yourself with the vocab quiz.</p>
      <Btn bg={C.green} onClick={() => onDone(false)}>Start Vocab Quiz →</Btn>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{ fontSize:13, color:C.muted }}>🃏 Vocab Flashcards — Seif {seifIdx+1}</span>
        <span style={{ fontSize:13, color:C.muted }}>{knownSet.size}/{words.length} known · {remaining.length} left</span>
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3, marginBottom:18, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(knownSet.size/words.length)*100}%`, background:C.green, transition:"width .4s" }}/>
      </div>
      <div onClick={() => setFlipped(f => !f)} style={{ cursor:"pointer",background:"white",borderRadius:16,padding:"32px 24px 20px",minHeight:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 14px rgba(0,0,0,.08)",border:`1.5px solid ${C.border}`,marginBottom:16,userSelect:"none",position:"relative" }}>
        <span style={{ position:"absolute",top:12,right:16,fontSize:11,color:C.muted,letterSpacing:1 }}>{flipped ? "ENGLISH" : "HEBREW — tap to reveal"}</span>
        {!flipped ? (
          <div style={{ textAlign:"center" }}>
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:38,fontWeight:700 }}>{card.he}</div>
            <CtxSnippet ctx={card.ctx} targetHe={card.he} />
          </div>
        ) : (
          <div style={{ fontSize:22,color:"hsl(25,20%,28%)",textAlign:"center",lineHeight:1.55 }}>{card.en}</div>
        )}
      </div>
      {flipped ? (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <button className="opt" style={{ textAlign:"center",color:C.red,borderColor:"hsl(0,50%,75%)" }}
            onClick={() => { setFlipped(false); setCardIdx(i => (i+1) % remaining.length); }}>🔁 Study Again</button>
          <Btn bg={C.green} style={{ width:"100%" }}
            onClick={() => { setKnownSet(s => new Set([...s, card.key])); setFlipped(false); }}>✓ Got It</Btn>
        </div>
      ) : (
        <>
          <p style={{ textAlign:"center",fontSize:13,color:C.muted }}>Tap the card to reveal · Enter to flip / mark known</p>
          <button onClick={() => onDone(false)} style={{ display:"block",margin:"12px auto 0",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,color:C.muted,textDecoration:"underline" }}>Skip to Quiz →</button>
        </>
      )}
    </div>
  );
}
const SYNONYMS = [
  ["fellow","friend","neighbor","companion","associate","colleague","peer","brother"],
  ["deceive","wrong","defraud","cheat","mislead","swindle","trick","delude"],
  ["forbidden","prohibited","not permitted","not allowed","banned","disallowed"],
  ["permitted","allowed","acceptable","fine","okay","lawful","permissible"],
  ["transgresses","violates","breaks","sins","disobeys"],
  ["commandment","precept","mitzvah","law","rule","prohibition","directive"],
  ["conduct","deal","transact","engage","behave"],
  ["faithful","honest","trustworthy","truthful","reliable","integrity"],
  ["repentance","atonement","return","teshuva"],
  ["measure","measurement","quantity","amount","volume"],
  ["seller","vendor","merchant","salesperson","dealer"],
  ["buyer","purchaser","customer","acquirer"],
  ["wicked","evil","sinful","wrongful","unjust","dishonest"],
  ["judgment","court","trial","reckoning","divine judgment"],
  ["item","object","article","thing","product","goods","merchandise"],
  ["sages","rabbis","scholars","wise men","chachamim"],
  ["market","marketplace","bazaar","store","shop"],
  ["property","land","real estate","field","possession"],
  ["agent","messenger","representative","emissary","proxy"],
  ["priority","precedence","preference","first right"],
  ["custom","practice","tradition","norm","usage","convention"],
  ["community","congregation","public","assembly","kehilla"],
  ["vow","oath","pledge","promise","commitment"],
];

function inSameGroup(a, b) {
  return SYNONYMS.some(group => group.includes(a) && group.includes(b));
}

async function judgeAnswer(userAnswer, correctAnswer) {
  const u = userAnswer.toLowerCase().trim();
  const c = correctAnswer.toLowerCase().trim();
  if (u === c) return "correct";
  const variants = c.split(/[\/,]/).map(s => s.replace(/\(.*?\)/g, "").trim().toLowerCase());
  if (variants.some(v => u === v)) return "correct";
  try {
    const raw = await callClaude(
      `Correct answer: "${correctAnswer}"\nStudent answer: "${userAnswer}"\n\nIs the student's answer correct, close (synonymous/same meaning), or wrong? Reply with exactly one word: correct, close, or wrong.\n\nIMPORTANT: Hebrew words often have prefixes like ו (and), ב (in/with), ל (to), מ (from), ה (the). If the student included a valid prefix translation like "and morning" for "morning" or "in the house" for "house" — mark as CORRECT.`,
"You are grading a Hebrew vocabulary quiz. Be very generous — if the student conveyed the core meaning in any reasonable way, mark it correct or close. Accept synonyms, paraphrases, partial answers that capture the main idea, and Hebrew prefix translations (ו=and, ב=in/with, ל=to, מ=from, ה=the). Only mark wrong if the answer is clearly incorrect or completely unrelated. Reply with only one word: correct, close, or wrong.",
     20
    );
    const verdict = raw.toLowerCase().trim();
    if (verdict.includes("correct")) return "correct";
    if (verdict.includes("close")) return "close";
    return "wrong";
  } catch {
    const keyWords = c.split(/\s+/).filter(w => w.length > 3);
    const matchCount = keyWords.filter(kw => u.includes(kw)).length;
    return keyWords.length > 0 && matchCount / keyWords.length >= 0.4 ? "close" : "wrong";
  }
}
function SpotCheck({ words, onPass }) {
  const [queue, setQueue] = useState(() => [...words]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const card = queue[0];
  const inputRef = useRef(null);
useEffect(() => { if (!result) setTimeout(() => inputRef.current?.focus(), 50); }, [result]);
  const total = words.length;

  useEffect(() => {
  function handleKey(e) {
    if (e.key !== "Enter") return;
    if (result) next();
    else if (input.trim() && !checking) check();
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
}, [result, input, checking]);

useEffect(() => {
  if (queue.length === 0) onPass();
}, [queue.length]);

if (queue.length === 0) return null;

  async function check() {
    setChecking(true);
    const res = await judgeAnswer(input, card.en);
    setResult(res);
    setChecking(false);
  }

 const [quizDone, setQuizDone] = useState(false);

  function next() {
    if (result === "correct" || result === "close") {
      const newQueue = queue.slice(1);
      setQueue(newQueue);
      if (newQueue.length === 0) { setQuizDone(true); return; }
    } else {
      setQueue(q => [...q.slice(1), q[0]]);
    }
    setInput("");
    setResult(null);
  }

  const resultColor = (result === "correct" || result === "close") ? C.green : C.red;
  const resultMsg = (result === "correct" || result === "close") ? "✓ Correct!" : "✗ Not quite — you'll see this again";

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(35,35%,36%)" }}>
        🔍 <strong>Quick spot check</strong> — must get all correct · {queue.length} remaining
      </div>
      <div style={{ height:5,background:C.border,borderRadius:3,marginBottom:16,overflow:"hidden" }}>
        <div style={{ height:"100%",width:`${((total-queue.length)/total)*100}%`,background:"hsl(210,55%,55%)",transition:"width .4s" }}/>
      </div>
      <div style={{ background:"white",borderRadius:14,padding:"32px 24px",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.06)",marginBottom:14 }}>
        <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:42,fontWeight:700,marginBottom:24 }}>{card.he}</div>
        <input
  key={card?.he}
  value={input}
  onChange={e => setInput(e.target.value)}
  onKeyDown={e => { if (e.key !== "Enter") return; if (result) next(); else if (input.trim() && !checking) check(); }}
  disabled={!!result || checking}
  placeholder="Type English translation…"
  style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${result ? resultColor : C.border}`,borderRadius:9,fontFamily:"'EB Garamond',serif",fontSize:16,textAlign:"center",marginBottom:12 }}
  autoFocus
/>
        {result && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:18,fontWeight:600,color:resultColor,marginBottom:4 }}>{resultMsg}</div>
            <div style={{ fontSize:15,color:C.muted }}>Answer: <strong>{card.en}</strong></div>
          </div>
        )}
        {!result
          ? <Btn style={{ width:"100%" }} onClick={check} disabled={!input.trim() || checking}>{checking ? "Checking…" : "Check →"}</Btn>
          : <Btn style={{ width:"100%" }} bg={queue.length === 1 && (result === "correct" || result === "close") ? C.green : C.brown} onClick={next}>
              {queue.length === 1 && (result === "correct" || result === "close") ? "Continue →" : "Next →"}
            </Btn>}
      </div>
      <p style={{ textAlign:"center",fontSize:13,color:C.muted }}>Go back to Read tab to tap and save vocab words if needed.</p>
    </div>
  );
}
// ── VOCAB TYPING QUIZ ────────────────────────────────────────────────────────
function TypingQuiz({ seifIdx, seifVocab, onDone, onWordMastered, onBack }) {
    const allWords = Object.entries(seifVocab || {}).map(([key, val]) => ({
    key,
    he: typeof val === "object" ? val.he : key,
    en: typeof val === "object" ? val.en : val,
    ctx: typeof val === "object" ? val.ctx : "",
  }));

const [queue, setQueue] = useState(() => [...allWords]);
const [input, setInput] = useState("");
const [result, setResult] = useState(null);
const [checking, setChecking] = useState(false);
const [quizDone, setQuizDone] = useState(false);
const inputRef = useRef(null);


  useEffect(() => { if (allWords.length === 0) onDone(); }, []);

  useEffect(() => {
    if (!result) setTimeout(() => inputRef.current?.focus(), 50);
  }, [queue[0]?.key, result]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key !== "Enter") return;
      if (result) next();
      else if (input.trim() && !checking) checkAnswer();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [result, input, checking]);

if (quizDone) return (
  <div style={{ textAlign:"center", padding:"50px 20px" }}>
    <div style={{ fontSize:48, marginBottom:10 }}>🎉</div>
    <p style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>All words mastered!</p>
    <p style={{ color:C.muted, marginBottom:22 }}>Ready for the content quiz.</p>
<Btn bg={C.green} style={{ width:"100%", marginBottom:10 }} onClick={onDone}>Take me to Kriah →</Btn><Btn style={{ width:"100%" }} onClick={onBack}>← Back to Seif</Btn>
  </div>
);
  const card = queue[0];
  const total = allWords.length;

  async function checkAnswer() {
    if (checking || !input.trim()) return;
    setChecking(true);
    const res = await judgeAnswer(input, card.en);
    setResult(res);
    if (res === "correct" || res === "close") onWordMastered(card.key);
    setChecking(false);
  }

  function next() {
    if (result === "correct" || result === "close") {
      const newQueue = queue.slice(1);
      setQueue(newQueue);
if (newQueue.length === 0) { setQuizDone(true); return; }
    } else {
      setQueue(q => [...q.slice(1), q[0]]);
    }
    setInput("");
    setResult(null);
  }

  const isGood = result === "correct" || result === "close";
  const resultColor = isGood ? C.green : C.red;
  const resultMsg = isGood ? "✓ Correct!" : "✗ Not quite — you'll see this again";

  return (
    <div>
      <div style={{ background:"hsl(210,60%,93%)",border:"1px solid hsl(210,50%,78%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(210,40%,30%)" }}>
        ✏️ <strong>Vocab Quiz</strong> — must get all correct · {queue.length} remaining
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3, marginBottom:16, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${((total-queue.length)/total)*100}%`, background:"hsl(210,55%,55%)", transition:"width .4s" }}/>
      </div>
      <div style={{ background:"white",borderRadius:14,padding:"32px 24px",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.06)",marginBottom:14 }}>
<div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:42,fontWeight:700,marginBottom:8 }}>{card.he}</div>
<CtxSnippet ctx={card.ctx} targetHe={card.he} />        <input
          ref={inputRef}
          key={card.key}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={!!result || checking}
          placeholder="Type English translation…"
          style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${result ? resultColor : C.border}`,borderRadius:9,fontFamily:"'EB Garamond',serif",fontSize:16,textAlign:"center",marginBottom:12 }}
          autoFocus
        />
        {result && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:18,fontWeight:600,color:resultColor,marginBottom:4 }}>{resultMsg}</div>
            <div style={{ fontSize:15,color:C.muted }}>Answer: <strong>{card.en}</strong></div>
          </div>
        )}
        {!result
          ? <Btn style={{ width:"100%" }} onClick={checkAnswer} disabled={!input.trim() || checking}>{checking ? "Checking…" : "Check →"}</Btn>
          : <Btn style={{ width:"100%" }} bg={queue.length === 1 && isGood ? C.green : C.brown} onClick={next}>
              {queue.length === 1 && isGood ? "Finish →" : "Next →"}
            </Btn>}
      </div>
      <div style={{ textAlign:"center",fontSize:13,color:C.muted }}>{total-queue.length}/{total} mastered · Enter to check / advance</div>
    </div>
  );
}
// ── SEIF CONTENT QUIZ ─────────────────────────────────────────────────────────
function ResultsPanel({ quiz, answers, seifIdx, onPass, onReview, onRetry }) {
  const [replacements, setReplacements] = useState({});
  const [replacementAnswers, setReplacementAnswers] = useState({});
  const [loadingAll, setLoadingAll] = useState(false);
  const [submitted2, setSubmitted2] = useState({});

  const wrongIndices = quiz.map((q, i) => answers[i] !== parseInt(q.answer) ? i : null).filter(i => i !== null);
  const originalCorrect = quiz.filter((q, i) => answers[i] === parseInt(q.answer)).length;
  const replacedCorrect = wrongIndices.filter(i => submitted2[i] && replacementAnswers[i] === parseInt(replacements[i]?.answer)).length;
  const totalCorrect = originalCorrect + replacedCorrect;
  const allDone = wrongIndices.every(i => submitted2[i] && replacementAnswers[i] === parseInt(replacements[i]?.answer));
  const replacementsGenerated = wrongIndices.every(i => replacements[i]);

  async function generateAllReplacements() {
    setLoadingAll(true);
    const seif = SEIFIM[seifIdx];
    await Promise.all(wrongIndices.map(async qi => {
      if (replacements[qi]) return;
      const original = quiz[qi];
      try {
        const raw = await callClaude(
`A student got this question wrong on a Kitzur Shulchan Aruch quiz:\n"${original.question}"\nQuestion type: ${original.type === "practical" ? "practical application (real-life scenario)" : "text comprehension (what does the seif say)"}\n\nGenerate ONE new different question of the SAME type testing the SAME concept.\nSeif ${seifIdx+1}: ${seif.en}\n\nReturn ONLY valid JSON (no markdown):\n{"type":"${original.type || "text"}","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}`,
          "Return ONLY a valid JSON object. No markdown, no commentary.", 500
        );
        const cleaned = raw.split("```json").join("").split("```").join("").trim();
        const q = JSON.parse(cleaned);
        q.answer = parseInt(q.answer);
        setReplacements(r => ({ ...r, [qi]: q }));
      } catch {}
    }));
    setLoadingAll(false);
  }

  return (
    <div>
      <div style={{ background:"white",borderRadius:14,padding:24,textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:16 }}>
        <div style={{ fontSize:42,marginBottom:8 }}>{allDone ? "🏆" : "📖"}</div>
        <div style={{ fontSize:34,fontWeight:700,color:allDone?C.green:C.brown }}>{totalCorrect}/{quiz.length}</div>
        <div style={{ color:C.muted,marginTop:4,fontSize:15,marginBottom:16 }}>
          {allDone ? "All correct! Seif mastered ✓" : wrongIndices.length > 0 ? "Answer the replacement questions below to unlock" : ""}
        </div>
        {allDone
          ? <Btn bg={C.green} onClick={() => onPass(100)}>Continue ›</Btn>
          : <div style={{ display:"flex",gap:10,justifyContent:"center" }}>
              <Btn style={{ flex:1 }} onClick={onReview}>Review Seif</Btn>
              {!replacementsGenerated && (
                <Btn style={{ flex:1 }} bg={C.gold} onClick={generateAllReplacements} disabled={loadingAll}>
                  {loadingAll ? "Generating…" : "Generate Replacements"}
                </Btn>
              )}
            </div>}
      </div>

      {wrongIndices.map(qi => {
        const gotItRight = submitted2[qi] && replacementAnswers[qi] === parseInt(replacements[qi]?.answer);
        const gotItWrong = submitted2[qi] && replacementAnswers[qi] !== parseInt(replacements[qi]?.answer);
        if (!replacements[qi]) return (
          <div key={qi} style={{ background:"white",borderRadius:12,padding:"18px 20px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.06)",border:`1.5px solid hsl(0,50%,80%)`,opacity:0.5,textAlign:"center",color:C.muted,fontSize:14 }}>
            {loadingAll ? "⏳ Generating replacement…" : "Click \"Generate Replacements\" above"}
          </div>
        );
        return (
          <div key={qi} style={{ background:"white",borderRadius:12,padding:"18px 20px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.06)",border:`1.5px solid ${gotItRight ? C.green : "hsl(0,50%,80%)"}` }}>
            {gotItRight && <p style={{ fontSize:13,color:C.green,marginBottom:8,fontWeight:600 }}>✓ Correct!</p>}
            <p style={{ fontSize:15,fontWeight:500,marginBottom:12,lineHeight:1.55 }}>{replacements[qi].question}</p>
            {replacements[qi].options.map((opt, oi) => {
              let cls = "opt";
              if (submitted2[qi]) { if (oi === replacements[qi].answer) cls += " cor"; else if (replacementAnswers[qi] === oi) cls += " wrg"; }
              else if (replacementAnswers[qi] === oi) cls += " sel";
              return <button key={oi} className={cls} disabled={!!submitted2[qi]} onClick={() => !submitted2[qi] && setReplacementAnswers(a => ({ ...a, [qi]: oi }))}>{opt}</button>;
            })}
            {!submitted2[qi]
              ? <Btn style={{ width:"100%",marginTop:8 }} disabled={replacementAnswers[qi] === undefined} onClick={() => setSubmitted2(s => ({ ...s, [qi]: true }))}>Submit</Btn>
: <>
                  {replacements[qi].explanation && (
                    <div style={{ marginTop:8,padding:"8px 12px",background:"hsl(35,30%,97%)",borderRadius:8,fontSize:13,color:"hsl(25,20%,36%)" }}>💡 {replacements[qi].explanation}</div>
                  )}
                  {gotItWrong && (
                    <Btn style={{ width:"100%",marginTop:8 }} disabled={loadingAll} onClick={async () => {
                      setLoadingAll(true);
                      try {
                        const raw = await callClaude(
`A student got this question wrong on a Kitzur Shulchan Aruch quiz:\n"${replacements[qi].question}"\nQuestion type: ${replacements[qi].type === "practical" ? "practical application (real-life scenario)" : "text comprehension (what does the seif say)"}\n\nGenerate ONE new different question of the SAME type testing the SAME concept.\nSeif ${seifIdx+1}: ${SEIFIM[seifIdx].en}\n\nReturn ONLY valid JSON (no markdown):\n{"type":"${replacements[qi].type || "text"}","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}`,
                          "Return ONLY a valid JSON object. No markdown, no commentary.", 500
                        );
                        const cleaned = raw.split("```json").join("").split("```").join("").trim();
                        const q = JSON.parse(cleaned); q.answer = parseInt(q.answer);
                        setReplacements(r => ({ ...r, [qi]: q }));
                        setSubmitted2(s => { const n={...s}; delete n[qi]; return n; });
                        setReplacementAnswers(a => { const n={...a}; delete n[qi]; return n; });
                      } catch {}
                      setLoadingAll(false);
                    }}>
                      {loadingAll ? "Generating…" : "Try Another Question →"}
                    </Btn>
                  )}
                </>}
          </div>
        );
      })}
    </div>
  );
}
function SeifQuiz({ seifIdx, onPass, onReview }) {
const [quiz, setQuiz] = useState(null);
const [loading, setLoading] = useState(false);
const [answers, setAnswers] = useState({});
const [submitted, setSubmitted] = useState(false);
const [retryKey, setRetryKey] = useState(0);
const [started, setStarted] = useState(false);

useEffect(() => {
    if (!started) return;
    const seif = SEIFIM[seifIdx];
    setQuiz(null); setLoading(true); setAnswers({}); setSubmitted(false);
    callClaude(
`Quiz Modern Orthodox high school students on ONE seif of Kitzur Shulchan Aruch.\n\nSeif ${seifIdx+1} (Hebrew): ${seif.he}\nSeif ${seifIdx+1} (English): ${seif.en}\n\nCreate exactly 2 questions with 4 answer choices (A–D):\n- Question 1: a text comprehension question (what does this seif actually say?) it shouldn't just be spit back and the answer shouldn't just be easily implied in the question\n- Question 2: a practical application question (a real-life scenario testing if the student can apply this halacha) - the question should be more difficult so it can just be answered with basic Jewish understanding but should show slightly greater understanding of the seif\nReturn ONLY valid JSON array, each object must include a "type" field:\n[{"type":"text","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."},{"type":"practical","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}]`,
      "Return ONLY a valid JSON array. No markdown, no commentary.", 1000
    ).then(raw => {
  try {
    const cleaned = raw.split("```json").join("").split("```").join("").trim();
    const parsed = JSON.parse(cleaned);
    setQuiz(parsed);
  } catch(e) {
    console.log("Parse error:", e);
    console.log("Raw response:", raw);
    setQuiz([]);
  }
  setLoading(false);
}).catch(() => { setQuiz([]); setLoading(false); });
}, [seifIdx, retryKey, started]);

if (!started) return (
  <div style={{ textAlign:"center", padding:"50px 20px" }}>
    <div style={{ fontSize:36, marginBottom:10 }}>📝</div>
    <p style={{ fontSize:17, color:C.muted, marginBottom:22 }}>Ready to test your understanding of this seif?</p>
    <Btn bg={C.green} onClick={() => setStarted(true)}>Generate Quiz →</Btn>
  </div>
);

if (loading) return (
    <div style={{ textAlign:"center",padding:"60px 0",color:C.muted }}>
      <div style={{ fontSize:36,marginBottom:10 }}>🤔</div>
      <div style={{ fontSize:17 }}>Generating content quiz for סעיף {seifIdx+1}…</div>
    </div>
  );
  if (!quiz?.length) return (
    <div style={{ textAlign:"center",padding:40,color:C.red,fontSize:15 }}>
      Could not generate quiz.{" "}
      <button style={{ background:"none",border:"none",cursor:"pointer",color:C.brown,fontFamily:"inherit",fontSize:15,textDecoration:"underline" }} onClick={() => setRetryKey(k => k+1)}>Try again</button>
    </div>
  );

  const score = quiz.filter((q, i) => answers[i] === parseInt(q.answer)).length;
  const pct = submitted ? Math.round(score / quiz.length * 100) : 0;
  const passed = pct >= 100;

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(35,35%,36%)" }}>
       📝 <strong>Content Quiz — Seif {seifIdx+1}</strong> · Answer all questions correctly to master
      </div>
      {quiz.map((q, qi) => (
        <div key={qi} style={{ background:"white",borderRadius:12,padding:"18px 20px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
          <p style={{ fontSize:16,fontWeight:500,marginBottom:12,lineHeight:1.55 }}>{qi+1}. {q.question}</p>
          {q.options.map((opt, oi) => {
            let cls = "opt";
            if (submitted) { if (oi === q.answer) cls += " cor"; else if (answers[qi] === oi) cls += " wrg"; }
            else if (answers[qi] === oi) cls += " sel";
            return <button key={oi} className={cls} disabled={submitted} onClick={() => !submitted && setAnswers(a => ({ ...a, [qi]: oi }))}>{opt}</button>;
          })}
          {submitted && q.explanation && (
            <div style={{ marginTop:8,padding:"8px 12px",background:"hsl(35,30%,97%)",borderRadius:8,fontSize:13,color:"hsl(25,20%,36%)",lineHeight:1.5 }}>💡 {q.explanation}</div>
          )}
        </div>
      ))}
      {!submitted
        ? <Btn disabled={Object.keys(answers).length < quiz.length} bg={C.green} style={{ width:"100%" }} onClick={() => setSubmitted(true)}>Submit Answers ({Object.keys(answers).length}/{quiz.length})</Btn>
        : <ResultsPanel
    quiz={quiz}
    answers={answers}
    seifIdx={seifIdx}
    onPass={onPass}
    onReview={onReview}
    onRetry={() => setRetryKey(k => k+1)}
  />}
    </div>
  );
}

// ── GLOBAL VOCAB FLASHDECK ───────────────────────────────────────────────────
function FlashDeck({ vocab, checked, onCheck }) {
  const entries = Object.entries(vocab).filter(([k]) => !checked[k]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); 
  const total = Object.keys(vocab).length;
  const doneCount = total - entries.length;

  if (total === 0) return (
    <div style={{ textAlign:"center",padding:"60px 0",color:C.muted }}>
      <div style={{ fontSize:40,marginBottom:10 }}>📚</div>
      <p>Tap words in any seif to build your flashcard deck.</p>
    </div>
  );

  if (entries.length === 0) return (
    <div style={{ textAlign:"center",padding:"50px 0" }}>
      <div style={{ fontSize:48,marginBottom:10 }}>🎉</div>
      <p style={{ fontSize:20,marginBottom:6 }}>All {total} words checked off!</p>
      <p style={{ color:C.muted }}>You know every word in your deck.</p>
    </div>
  );
  const card = entries[idx % entries.length];
  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}>
        <span style={{ fontSize:13,color:C.muted }}>{doneCount} checked off · {entries.length} remaining of {total}</span>
        <div style={{ display:"flex",gap:4 }}>
          <button onClick={() => setViewMode("cards")} style={{ background:viewMode==="cards"?C.brown:"none",color:viewMode==="cards"?"white":C.muted,border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12 }}>🃏 Cards</button>
          <button onClick={() => setViewMode("list")} style={{ background:viewMode==="list"?C.brown:"none",color:viewMode==="list"?"white":C.muted,border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12 }}>📋 List</button>
        </div>
      </div>
     <div style={{ height:5,background:C.border,borderRadius:3,marginBottom:18,overflow:"hidden" }}>
        <div style={{ height:"100%",width:`${(doneCount/total)*100}%`,background:C.green,transition:"width .4s" }}/>
      </div>
      {viewMode === "cards" ? (
        <>
          <div onClick={() => setFlipped(f => !f)} style={{ cursor:"pointer",background:"white",borderRadius:16,padding:"40px 24px",minHeight:190,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 14px rgba(0,0,0,.08)",border:`1.5px solid ${C.border}`,marginBottom:16,userSelect:"none",position:"relative" }}>
            <span style={{ position:"absolute",top:12,right:16,fontSize:11,color:C.muted,letterSpacing:1 }}>{flipped ? "ENGLISH" : "HEBREW — tap to reveal"}</span>
            {!flipped
              ? <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:38,fontWeight:700 }}>{card[0]}</div>
              : <div style={{ fontSize:22,color:"hsl(25,20%,28%)",textAlign:"center",lineHeight:1.55 }}>{card[1]}</div>}
          </div>
          {flipped
            ? <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <button className="opt" style={{ textAlign:"center",color:C.red,borderColor:"hsl(0,50%,75%)" }} onClick={() => { setFlipped(false); setIdx(i => (i+1) % entries.length); }}>🔁 Study Again</button>
                <Btn bg={C.green} style={{ width:"100%" }} onClick={() => { onCheck(card[0]); setFlipped(false); }}>✓ I Know This</Btn>
              </div>
            : <p style={{ textAlign:"center",fontSize:13,color:C.muted }}>Tap the card to reveal</p>}
        </>
      ) : (
        <div>
          {SEIFIM.map((seif, i) => {
            const seifTokens = new Set(seif.he.split(/\s+/).map(w => stripNikud(w)));
            const seifWords = Object.entries(vocab).filter(([he]) => seifTokens.has(stripNikud(he)));
            if (seifWords.length === 0) return null;
            return (
              <div key={i} style={{ marginBottom:16 }}>
                <div style={{ fontSize:13,fontWeight:600,color:C.muted,marginBottom:8,letterSpacing:1,textTransform:"uppercase" }}>Seif {i+1}</div>
                {seifWords.map(([he, en]) => (
                  <div key={he} style={{ background:"white",borderRadius:10,padding:"11px 16px",marginBottom:8,boxShadow:"0 1px 3px rgba(0,0,0,.06)",display:"flex",justifyContent:"space-between",alignItems:"center",opacity:checked[he]?0.45:1 }}>
                    <div style={{ display:"flex",gap:16,alignItems:"center" }}>
                      <span dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:20,fontWeight:700 }}>{he}</span>
                      <span style={{ fontSize:15,color:"hsl(25,20%,35%)" }}>{en}</span>
                    </div>
                    {checked[he]
                      ? <span style={{ fontSize:12,color:C.green }}>✓ Done</span>
                      : <button onClick={() => onCheck(he)} style={{ background:"none",border:`1px solid ${C.green}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.green }}>✓ I Know This</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── KRIAH STUDY ──────────────────────────────────────────────────────────
function Kriah({ seif, onPass }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = async () => {
  stream.getTracks().forEach(t => t.stop());
  setRecording(false);
  setProcessing(true);
  await new Promise(res => setTimeout(res, 300));
  const blob = new Blob(chunksRef.current, { type: "audio/webm" });
  console.log("chunks:", chunksRef.current.length, "blob size:", blob.size);
 const [heTranscript, enTranscript] = await Promise.all([
  callWhisper(blob, "he"),
  callWhisper(blob, "en")
]);
console.log("he transcript:", heTranscript);
console.log("en transcript:", enTranscript);
const score = await gradeKriah(heTranscript, enTranscript, seif.he, seif.en);
  console.log("score:", score);
  setResult(score);
  setProcessing(false);
};
    mediaRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    mediaRef.current?.stop();
  }

async function gradeKriah(heTranscript, enTranscript, heText, enText) {
  const heOnly = heTranscript.split(' ').filter(w => /[\u05D0-\u05EA]/.test(w)).join(' ');

  const heResponse = await callClaude(
    `A student read this Hebrew text aloud.\n\nExpected Hebrew text: "${heText}"\nHebrew-only transcript: "${heOnly}"\n\nCount what percentage of the source Hebrew words appear in the transcript in roughly correct order. Ignore English words completely. Accept all phonetic variants without exception.\n\nScoring:\n- 90%+ of words present → score 95\n- 75-90% → score 85\n- 50-75% → score 70\n- Under 50% → score 40\n\nRespond ONLY in this exact format:\nSCORE: [0-100]\nFEEDBACK: [one encouraging sentence]`,
    "You are checking Hebrew reading coverage only. Count words present vs absent. Phonetic variants always count as correct. Use the scoring table provided exactly. Reply ONLY in the exact format specified.",
    200
  );

  const heRaw = parseInt(heResponse.match(/SCORE:\s*(\d+)/)?.[1] || 0);
  const heScore = Math.min(100, heRaw + 10);
  const heFeedback = heResponse.match(/FEEDBACK:\s*(.+)/)?.[1] || "";

 const enResponse = await callClaude(
`Reference translation: "${enText}"\nStudent translation: "${enTranscript}"\n\nIMPORTANT: The student was reading Hebrew aloud while translating — their transcript contains Hebrew words mixed in. IGNORE all non-English words completely.\n\nOnly evaluate CONTENT words from the reference (nouns, verbs, adjectives, adverbs) — skip articles, prepositions, conjunctions.\n\nFor each content word/phrase in the reference, write YES if the student conveyed that meaning in any way (synonyms and paraphrases count), NO only if clearly missing or wrong.\n\nLast line must be: MATCHED: X OUT OF Y`,
"Compare two translations word by word. Synonyms and paraphrases count as YES. Ignore non-English words in the student transcript. Reply in the exact format shown.",
400
  );

  const matchLine = enResponse.match(/MATCHED:\s*(\d+)\s*OUT OF\s*(\d+)/i);
  const matched = matchLine ? parseInt(matchLine[1]) : 0;
  const total = matchLine ? parseInt(matchLine[2]) : 1;
  const enRaw = total > 0 ? Math.round((matched / total) * 100) : 0;
  const enScore = Math.min(100, enRaw + 10);
  const enFeedback = enScore >= 90 ? "Excellent — nearly every word covered!" : enScore >= 80 ? "Great work — strong coverage overall." : enScore >= 70 ? "Good — a few words missed but you got the core." : "Keep practicing — try to translate each word as you go.";

  return { heScore, heFeedback, enScore, enFeedback, passed: enScore >= 70 };
}

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:9,padding:"9px 14px",marginBottom:14,fontSize:13,color:"hsl(35,35%,36%)" }}>
        🎙 <strong>Kriah</strong> — Read the Hebrew aloud, translating into English as you go
      </div>

      <div style={{ background:"white",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,.06)",marginBottom:16,borderRight:`4px solid ${C.gold}` }}>
        <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:20,lineHeight:2.4,textAlign:"right",margin:0 }}>
          {seif.he}
        </p>
      </div>

      {!result && !processing && (
        <div style={{ textAlign:"center", marginTop:24 }}>
          {!recording ? (
            <button onClick={startRecording} style={{ background:"white",color:C.muted,border:`1.5px solid ${C.border}`,borderRadius:12,padding:"12px 28px",fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
              <span style={{ fontSize:18 }}>💬</span> Begin Reading
            </button>
          ) : (
            <button onClick={stopRecording} style={{ background:"hsl(210,30%,96%)",color:"hsl(210,40%,40%)",border:`1.5px solid hsl(210,30%,82%)`,borderRadius:12,padding:"12px 28px",fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:8 }}>
              <span style={{ fontSize:16, animation:"pulse 1.5s infinite", display:"inline-block" }}>🔵</span> Listening… tap when done
            </button>
          )}
        </div>
      )}

   {processing && (
  <div style={{ textAlign:"center", padding:"30px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
    <div style={{ width:60, height:60, animation:"kuf-pulse 1.4s ease-in-out infinite" }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
        <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
        <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite" }}
          d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z"
          fill="hsl(45,70%,88%)"/>
        <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite 0.7s" }}
          d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z"
          fill="hsl(45,70%,88%)"/>
      </svg>
    </div>
    <p style={{ color:C.muted, fontSize:14 }}>Grading your reading…</p>
  </div>
)}

{result && (
  <div style={{ background:"white",borderRadius:14,padding:"24px",boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
    <div style={{ textAlign:"center", padding:"14px", background:"hsl(35,30%,97%)", borderRadius:10, marginBottom:16 }}>
  <div style={{ fontSize:11, color:C.muted, letterSpacing:1, marginBottom:4 }}>ENGLISH TRANSLATION</div>
  <div style={{ fontSize:36, fontWeight:700, color:result.enScore>=70?C.green:C.red }}>{result.enScore}%</div>
  <p style={{ fontSize:12, color:C.muted, marginTop:6, fontStyle:"italic", lineHeight:1.4 }}>{result.enFeedback}</p>
</div>
    {result.passed ? (
      <Btn bg={C.green} style={{ width:"100%" }} onClick={onPass}>✓ Kriah Complete →</Btn>
    ) : (
      <div>
        <p style={{ textAlign:"center",color:C.red,fontWeight:600,marginBottom:12 }}>
          Need 70% in both to pass — {result.heScore < 70 && result.enScore < 70 ? "keep working on your reading and translation!" : result.heScore < 70 ? "focus on your Hebrew reading!" : "focus on your English translation!"}
        </p>
        <Btn style={{ width:"100%" }} onClick={() => setResult(null)}>Try Again</Btn>
      </div>
    )}
  </div>
)}
    </div>
  );
}
// ── SEIF STUDY VIEW ──────────────────────────────────────────────────────────
function SeifStudy({ seifIdx, activeSiman, status, onMastered, onBack, onVocabSave, onWordMastered, simanVocab, onVocabDone, quizScores, onQuizScore }) {
  const [tab, setTab] = useState("read");
  const [vocabStage, setVocabStage] = useState("init");
  const [popup, setPopup] = useState(null);
const seif = SEIFIM[seifIdx];
  const mastered = status === "mastered";
  const vocabDone = status === "vocab_done" || mastered;
  const kriahDone = status === "kriah_done" || vocabDone || mastered;
  const seifVocab = (simanVocab || {})[seifIdx] || {};

  // Reset vocab stage whenever we enter a new seif
  useEffect(() => { setVocabStage("cards"); setTab("read"); }, [seifIdx]);

function handleWord(e) {
    e.stopPropagation();
    const raw = e.target.innerText?.trim();
    if (!raw || raw.length < 2) return;
    const s = stripNikud(raw);

    const seifWords = seif.he.split(" ");
    const tapIdx = seifWords.findIndex(w => stripNikud(w) === s);
    const ctx = tapIdx >= 0 ? seifWords.slice(Math.max(0, tapIdx-3), tapIdx+4).join(" ") : "";

   const seifStripped = seif.he.split(" ").map(w => stripNikud(w));
const tapIdx2 = seifStripped.indexOf(s);
if (tapIdx2 >= 0) {
  const sortedPhrases = [...PHRASES].sort((a, b) => b.stripped.split(" ").length - a.stripped.split(" ").length);
  for (const ph of sortedPhrases) {
    const phWords = ph.stripped.split(" ");
    for (let start = Math.max(0, tapIdx2 - phWords.length + 1); start <= tapIdx2; start++) {
      const slice = seifStripped.slice(start, start + phWords.length);
      if (slice.join(" ") === ph.stripped) {
        const fullHe = seif.he.split(" ").slice(start, start + phWords.length).join(" ");
        setPopup({ he: fullHe, en: ph.en, isPhrase: true, tappedWord: raw });
        onVocabSave(fullHe, ph.en, ctx);
        return;
      }
    }
  }
}
    setPopup({ he:raw, en:null, loading:true });
callClaude(
  `Hebrew text: "${seif.he}"\nEnglish translation: "${seif.en}"\nTapped Hebrew word: "${raw}"\n\nFind the English word or short phrase in the translation that corresponds to "${raw}". Reply with ONLY that word or phrase — nothing else.`,
  "You are identifying which part of an English translation corresponds to a specific Hebrew word. Reply with ONLY the corresponding English word or phrase. No explanation, no context, no punctuation.", 20
)
    .then(d => {
  const en = d.trim().replace(/^[\*\_\s]+|[\*\_\s]+$/g, "");
  setPopup(p => p?.he === raw ? { ...p, he: raw, en, loading:false } : p);
  onVocabSave(raw, en, ctx);
})
    .catch(() => setPopup(p => p?.he === raw ? { ...p, en:"(translation unavailable)", loading:false } : p));
  }

const hasVocab = Object.keys(seifVocab).length > 0;

  const badge = mastered
    ? <span style={{ background:"hsl(142,40%,90%)",color:"hsl(142,40%,28%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>✓ Mastered</span>
    : vocabDone
    ? <span style={{ background:"hsl(210,60%,90%)",color:"hsl(210,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>Vocab ✓ → Quiz</span>
    : <span style={{ background:"hsl(45,70%,90%)",color:"hsl(35,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>In Progress</span>;

  return (
    <div style={{ minHeight:"100vh",background:C.bg}} onClick={() => setPopup(null)}>
      <style>{CSS}</style>
      <div style={{ position:"sticky",top:0,zIndex:100,background:"hsl(35,22%,91%)",borderBottom:`1.5px solid ${C.border}` }}>
        <div style={{ maxWidth:720,margin:"0 auto",padding:"10px 18px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
            <button onClick={onBack} style={{ background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:C.muted }}>← All Seifim</button>
<div style={{ fontFamily:"'Heebo',sans-serif",fontSize:15,fontWeight:700 }}>סימן {toHebrewNumeral(activeSiman)} · סעיף {toHebrewNumeral(seifIdx+1)}</div>        
    {badge}
          </div>
<div style={{ display:"flex", width:"100%", borderTop:`1px solid ${C.border}` }}>
            {[
              ["read","📖 Read"],
              ["kriah","🎙 Kriah" + (kriahDone?" ✓":"")],
              ["vocab","🃏 Vocab" + (vocabDone?" ✓":"")],
              ["quiz","📝 Quiz" + (mastered?" ✓":"")]
            ].map(([id, lbl]) => (
<button key={id} className={`tab${tab===id?" on":""}`} style={{ flex:1, textAlign:"center" }} onClick={e => { e.stopPropagation(); setTab(id); }}>{lbl}</button>            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:720,margin:"0 auto",padding:"20px 18px 120px" }}>

        {/* ── READ ── */}
        {tab === "read" && <>
          <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:9,padding:"9px 14px",marginBottom:14,fontSize:13,color:"hsl(35,35%,36%)" }}>
          💡 <strong>Tap a word</strong> for its translation — saved automatically to your Vocab deck
          </div>
          <div style={{ background:"white",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,.06)",borderRight:`4px solid ${mastered?C.green:C.gold}` }}>
            <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:20,lineHeight:2.4,textAlign:"right" }}>
              {seif.he.split(" ").map((w, wi) => (
                <span key={wi} className={`ws${popup?.he && stripNikud(w) === stripNikud(popup.he) ? " hit" : ""}`} onClick={handleWord}>{w} </span>
              ))}
            </p>
          </div>
          {!mastered && (
            <Btn style={{ width:"100%",marginTop:16 }} onClick={() => setTab("vocab")}>
              {hasVocab ? "Continue to Vocab Cards →" : "Continue to Content Quiz →"}
            </Btn>
          )}
        </>}
        {tab === "kriah" && <Kriah
  seif={seif}
  onPass={() => {
    onVocabDone(); // we'll replace this with a dedicated handler later
    setTab("vocab");
  }}
/>}

{/* ── VOCAB ── */}
{tab === "vocab" && (() => {
const hasSeifVocab = Object.keys(seifVocab).length > 0;
if (vocabDone && !hasSeifVocab && vocabStage !== "typing") return (
      <div style={{ textAlign:"center", padding:"50px 20px", color:C.muted }}>
      <div style={{ fontSize:36, marginBottom:10 }}>✅</div>
      <p style={{ fontSize:16, marginBottom:20 }}>Vocab complete! Tap words in the Read tab to add more.</p>
      <Btn onClick={() => setTab("quiz")}>Go to Content Quiz →</Btn>
    </div>
  );
return vocabStage === "typing"
    ? <TypingQuiz
          key={`typing-${seifIdx}`}
          seifIdx={seifIdx}
          seifVocab={seifVocab}
          onWordMastered={onWordMastered}
onDone={() => { onVocabDone(); setVocabStage("cards"); setTab("quiz"); }}
onBack={() => { setVocabStage("cards"); setTab("read"); }}
     />
      : <SeifCards
          key={`cards-${seifIdx}`}
          seifIdx={seifIdx}
          seifVocab={seifVocab}
          vocabCompleted={vocabDone}
       onDone={(skipToContent) => {
  if (skipToContent) {
    if (hasVocab) { onVocabDone(); setVocabStage("cards"); setTab("quiz"); }
    else { setTab("read"); }
  }
  else { setVocabStage("typing"); }
}}
        />;
})()}
        {/* ── CONTENT QUIZ ── */}
        {tab === "quiz" && (
          mastered
            ? <div style={{ textAlign:"center",padding:"40px 0" }}>
                <div style={{ fontSize:48,marginBottom:10 }}>🏆</div>
                <p style={{ fontSize:20,fontWeight:600,marginBottom:6 }}>Seif {seifIdx+1} Mastered!</p>
                {quizScores[seifIdx]?.length > 0 && <p style={{ color:C.muted }}>Best score: {Math.max(...quizScores[seifIdx].map(s => s.pct))}%</p>}
              </div>
            : !vocabDone
            ? <div style={{ textAlign:"center",padding:"50px 0",color:C.muted }}>
                <div style={{ fontSize:36,marginBottom:10 }}>🔒</div>
                <p style={{ marginBottom:14 }}>Complete the Vocab section first to unlock the content quiz.</p>
                <Btn onClick={() => { setVocabStage("init"); setTab("vocab"); }}>Go to Vocab →</Btn>
              </div>
            : <SeifQuiz
                seifIdx={seifIdx}
                onPass={pct => { onQuizScore(seifIdx, pct); onMastered(); }}
                onReview={() => setTab("read")}
              />
        )}
      </div>
      <WordPopup popup={popup} onClose={() => setPopup(null)} />
    </div>
  );
}
// ── REFERENCE ────────────────────────────────────────────────────────────────
function Reference() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      {SEIFIM.map((seif, i) => (
        <div key={i} style={{ background:"white",borderRadius:11,marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,.06)",overflow:"hidden" }}>
          <div onClick={() => setOpen(open === i ? null : i)} style={{ padding:"13px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ fontFamily:"'Heebo',sans-serif",fontSize:12,fontWeight:700,background:"hsl(35,10%,90%)",color:"hsl(35,10%,50%)",borderRadius:6,padding:"2px 8px" }}>סעיף {i+1}</span>
              <span style={{ fontSize:13,color:C.muted }}>{seif.en.slice(0,60)}…</span>
            </div>
            <span style={{ color:C.muted,fontSize:16 }}>{open === i ? "▲" : "▼"}</span>
          </div>
          {open === i && (
            <div style={{ borderTop:`1px solid ${C.border}`,padding:"16px 18px" }}>
              <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:18,lineHeight:2.2,textAlign:"right",marginBottom:14 }}>{seif.he}</div>
              <div style={{ fontSize:15,fontStyle:"italic",color:"hsl(25,20%,35%)",lineHeight:1.7,borderTop:`1px solid ${C.border}`,paddingTop:12 }}>{seif.en}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
// ── HOME ─────────────────────────────────────────────────────────────────────
function Home({ student, seifProgress, onOpen, onLogout, onBack, vocab, checked, onCheck, returnToSiman, toc, activeSiman, onOpenSiman, allProgress, seifCounts }) {  const [simanOpen, setSimanOpen] = useState(returnToSiman);
  const [tab, setTab] = useState("study");
  const [simanSummary, setSimanSummary] = useState({});
  const [simanSearch, setSimanSearch] = useState("");
  const mastered = Object.values(seifProgress).filter(v => v === "mastered").length;
  const pct = Math.round(mastered / (SEIFIM.length || 18) * 100);

  useEffect(() => {
    if (!activeSiman || simanSummary[activeSiman] || SEIFIM.length === 0) return;
    const cacheKey = `summary_${activeSiman}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setSimanSummary(s => ({ ...s, [activeSiman]: cached })); return; }
    const preview = SEIFIM.slice(0, 3).map((sf, i) => `Seif ${i+1}: ${sf.en}`).join("\n");
    callClaude(
      `Based on these seifim from Kitzur Shulchan Aruch Siman ${activeSiman}:\n${preview}\n\nWrite a single sentence (max 20 words) summarizing what this siman is about.`,
      "Reply with ONE sentence only. No preamble.", 80
    ).then(r => {
      localStorage.setItem(cacheKey, r.trim());
      setSimanSummary(s => ({ ...s, [activeSiman]: r.trim() }));
    });
  }, [activeSiman, SEIFIM.length]);

  return (
    <div style={{ minHeight:"100vh",background:C.bg}}>
      <style>{CSS}</style>
      <div style={{ maxWidth:780,margin:"0 auto",padding:"28px 20px 80px" }}>

        {/* Header */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22 }}>
          <div>
           <div style={{ fontSize:11,letterSpacing:4,textTransform:"uppercase",color:C.muted,marginBottom:4 }}>KITZ · קיצור שולחן ערוך</div>
<h1 style={{ fontFamily:"'Heebo',sans-serif",fontSize:32,fontWeight:700,lineHeight:1 }}>קיצור שולחן ערוך</h1>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:600,fontSize:15 }}>{student.name}</div>
            <div style={{ fontSize:12,color:C.muted }}>{student.email}</div>
            <div style={{ display:"flex",gap:6,justifyContent:"flex-end",marginTop:6 }}>
<button onClick={onLogout} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.muted }}>Switch</button>
<button onClick={onBack} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.muted }}>← Subjects</button>            </div>
          </div>
        </div>

        {/* Siman list — for now just one */}
        {!simanOpen ? (
  <div>
<p style={{ fontSize:13,color:C.muted,marginBottom:12,letterSpacing:2,textTransform:"uppercase" }}>Select a Siman</p>
{(() => {
  const entry = Object.entries(allProgress).flatMap(([siman, seifs]) =>
    Object.entries(seifs).filter(([,v]) => v && v !== "mastered").map(([seif]) => ({ siman: parseInt(siman), seif: parseInt(seif) }))
  )[0];
  if (!entry) return null;
  return (
    <div onClick={async () => { await onOpenSiman(entry.siman); setSimanOpen(true); setTimeout(() => onOpen(entry.seif), 100); }} style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:12, padding:"14px 18px", marginBottom:16, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}
      onMouseEnter={e => e.currentTarget.style.background="hsl(45,70%,88%)"}
      onMouseLeave={e => e.currentTarget.style.background="hsl(45,70%,93%)"}>
      <div>
        <div style={{ fontSize:12, color:"hsl(35,35%,45%)", marginBottom:2 }}>📍 Pick up where you left off</div>
        <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:15, fontWeight:700 }}>סימן {entry.siman} · סעיף {entry.seif + 1}</div>
      </div>
      <span style={{ color:"hsl(35,35%,45%)", fontSize:18 }}>›</span>
    </div>
  );
})()}
    <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
  <div style={{ display:"flex", alignItems:"center", background:"white", borderRadius:50, border:`1.5px solid ${C.border}`, boxShadow:"0 1px 4px rgba(0,0,0,.07)", padding:"6px 6px 6px 14px", gap:8 }}>
    <span style={{ fontSize:13, color:C.muted }}>🔍</span>
    <input
      value={simanSearch}
      onChange={e => setSimanSearch(e.target.value)}
      onKeyDown={async e => {
        if (e.key !== "Enter") return;
        const num = parseInt(simanSearch);
        if (!num || num < 1 || num > 221) return;
        await onOpenSiman(num); setSimanOpen(true);
      }}
      placeholder="Siman #"
      style={{ border:"none", outline:"none", fontFamily:"'EB Garamond',serif", fontSize:14, background:"transparent", width:70 }}
    />
    <button onClick={async () => {
      const num = parseInt(simanSearch);
      if (!num || num < 1 || num > 221) return;
      await onOpenSiman(num); setSimanOpen(true);
    }} style={{ padding:"6px 14px", background:C.brown, color:"white", border:"none", cursor:"pointer", fontFamily:"'EB Garamond',serif", fontSize:13, fontWeight:600, borderRadius:50 }}>Go</button>
  </div>
</div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(80px, 1fr))", gap:8, direction:"rtl" }}>

{toc.filter(s => simanSearch === "" || String(s.num).includes(simanSearch)).map(s => {
    const simanProgress = allProgress[s.num] || {};
    const masteredCount = Object.values(simanProgress).filter(v => v === "mastered").length;
    return (
      <div key={s.num}
  onClick={async () => { await onOpenSiman(s.num); setSimanOpen(true); }}
  onMouseEnter={e => e.currentTarget.style.boxShadow="0 3px 12px rgba(0,0,0,.13)"}
  onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 5px rgba(0,0,0,.07)"}
  style={{
    borderRadius: 13, padding: 3, cursor: "pointer", transition: "all .15s",
    boxShadow: "0 1px 5px rgba(0,0,0,.07)",
    background: (() => {
      const total = seifCounts[s.num] || Object.keys(simanProgress).length || 1;
      const deg = 360 / total;
      const stops = Array.from({ length: total }, (_, i) => {
        const status = simanProgress[i];
        const color = status === "mastered" ? "hsl(142,44%,37%)" : status === "vocab_done" ? "hsl(45,70%,52%)" : status ? "hsl(35,20%,82%)" : "hsl(35,15%,90%)";
        return `${color} ${i * deg}deg ${(i+1) * deg}deg`;
      });
      return `conic-gradient(from -90deg, ${stops.join(", ")})`;
    })()
  }}>
  <div style={{ background:"white", borderRadius:10, padding:"12px 6px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, minHeight:70 }}>
    <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:17, fontWeight:700, color: masteredCount > 0 ? C.green : "hsl(25,20%,20%)" }}>{toHebrewNumeral(s.num)}</div>
    <div style={{ fontSize:11, color:C.muted, letterSpacing:0.5 }}>{s.num}</div>
  </div>
</div>
    );
  })}
</div>
    <div style={{ textAlign:"center", padding:"24px 0 12px", fontSize:12, color:C.muted }}>
      © {new Date().getFullYear()} Joseph Hein · All rights reserved
    </div>
  </div>
        ) : (
          <div>
            {/* Back + Siman header */}
            <div style={{ marginBottom:16 }}>
  <button onClick={() => { setSimanOpen(false); setSimanSearch(""); }} style={{ background:"none",border:"none",cursor:"pointer",fontSize:14,color:C.muted,fontFamily:"inherit",marginBottom:8,padding:0 }}>← All Simanim</button>
  <div style={{ background:"white",borderRadius:12,padding:"14px 18px",boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
<div style={{ fontFamily:"'Heebo',sans-serif",fontSize:22,fontWeight:700,lineHeight:1,marginBottom:4 }}>סימן {toHebrewNumeral(activeSiman)} · Siman {activeSiman}</div>
    {simanSummary[activeSiman] && (
      <div style={{ fontSize:14,color:"hsl(25,20%,35%)",lineHeight:1.55,borderTop:`1px solid ${C.border}`,paddingTop:8 }}>
        {simanSummary[activeSiman]}
      </div>
    )}
  </div>
</div>
            {/* Progress bar */}
            <div style={{ background:"white",borderRadius:12,padding:"14px 18px",marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                <span style={{ fontWeight:600,fontSize:15 }}>Progress</span>
<span style={{ fontWeight:700,color:mastered===SEIFIM.length?C.green:C.brown }}>{mastered}/{SEIFIM.length} mastered</span>
              </div>
              <div style={{ height:8,background:C.bg,borderRadius:4,overflow:"hidden" }}>
                <div style={{ height:"100%",width:`${pct}%`,background:mastered===18?C.green:C.gold,transition:"width .5s" }}/>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", width:"100%", borderBottom:`1.5px solid ${C.border}`, overflowX:"auto", marginBottom:18 }}>
              {[
                ["study","📖 Study"],
                ["reference","📚 Kitzur with English"],
                ["flashcards",`🃏 My Vocab${Object.keys(vocab).length > 0 ? " ("+Object.keys(vocab).length+")" : ""}`]
              ].map(([id, lbl]) => (
                <button key={id} className={`tab${tab===id?" on":""}`} onClick={() => setTab(id)}>{lbl}</button>
              ))}
            </div>

            {tab === "study" && (
              <div style={{ display:"grid",gap:9 }}>
                {SEIFIM.map((seif, i) => {
                  const st = seifProgress[i];
const unlocked = true;                  const isMastered = st === "mastered";
                  const inProg = st && !isMastered;
                  return (
                    <div key={i} onClick={() => unlocked && onOpen(i)} style={{ background:"white",borderRadius:11,padding:"13px 16px",boxShadow:"0 1px 3px rgba(0,0,0,.06)",cursor:unlocked?"pointer":"default",opacity:unlocked?1:0.45,borderLeft:`4px solid ${isMastered?C.green:inProg?C.gold:unlocked?"hsl(35,20%,82%)":"hsl(35,10%,88%)"}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:3 }}>
                          <span style={{ fontFamily:"'Heebo',sans-serif",fontSize:12,fontWeight:700,background:isMastered?"hsl(142,40%,90%)":inProg?"hsl(45,70%,88%)":"hsl(35,10%,90%)",color:isMastered?"hsl(142,40%,28%)":inProg?"hsl(35,40%,30%)":"hsl(35,10%,55%)",borderRadius:6,padding:"2px 8px" }}>
                            {!unlocked ? "🔒" : isMastered ? "✓" : inProg ? "●" : "🔑"} סעיף {i+1}
                          </span>
                          <span style={{ fontSize:12,color:isMastered?C.green:inProg?"hsl(35,35%,45%)":unlocked?C.muted:"hsl(35,10%,60%)" }}>
{isMastered ? "Mastered" : inProg ? "Unlocked" : unlocked ? "Unlocked" : "Locked"}                          </span>
                        </div>
                        <p style={{ fontSize:14,color:C.muted,lineHeight:1.4 }}>{seif.en.slice(0,75)}…</p>
                      </div>
                      {unlocked && <span style={{ color:C.muted,fontSize:18,marginLeft:10 }}>›</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "reference" && <Reference />}
            {tab === "flashcards" && <FlashDeck vocab={vocab} checked={checked} onCheck={onCheck} />}
            <div style={{ textAlign:"center", padding:"24px 0 12px", fontSize:12, color:C.muted }}>
              © {new Date().getFullYear()} Joseph Hein · All rights reserved
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function SubjectSelector({ student, onSelect, onLogout }) {
const isTeacher = true;  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth:500, width:"92%", textAlign:"center" }}>
        <div style={{ width:64, height:64, margin:"0 auto 16px" }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
            <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
            <path d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="hsl(45,70%,88%)"/>
            <path d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="hsl(45,70%,88%)"/>
          </svg>
        </div>
        <h1 style={{ fontFamily:"'Heebo',sans-serif", fontSize:36, fontWeight:700, marginBottom:4 }}>KITZ</h1>
        <p style={{ color:C.muted, fontSize:15, marginBottom:36 }}>Torah Studies Fluency</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:24 }}>
          <div onClick={() => onSelect("ksa")} style={{ background:"white", borderRadius:16, padding:"28px 16px", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.08)", border:`1.5px solid ${C.border}`, transition:"all .15s" }}
            onMouseEnter={e => e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.13)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.08)"}>
            <div style={{ fontSize:36, marginBottom:10 }}>📖</div>
            <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:18, fontWeight:700, marginBottom:4 }}>קיצור שולחן ערוך</div>
            <div style={{ fontSize:13, color:C.muted }}>Kitzur Shulchan Aruch</div>
          </div>
          <div onClick={() => isTeacher && onSelect("talmud")} style={{ background:"white", borderRadius:16, padding:"28px 16px", cursor:isTeacher?"pointer":"default", boxShadow:"0 2px 8px rgba(0,0,0,.08)", border:`1.5px solid ${C.border}`, opacity:isTeacher?1:0.7, position:"relative", overflow:"hidden" }}
            onMouseEnter={e => { if(isTeacher) e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.13)"; }}
            onMouseLeave={e => e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.08)"}>
            <div style={{ fontSize:36, marginBottom:10 }}>🕍</div>
            <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:18, fontWeight:700, marginBottom:4 }}>תלמוד</div>
            <div style={{ fontSize:13, color:C.muted }}>Talmud</div>
            {!isTeacher && <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"hsl(35,30%,93%)", padding:"6px", fontSize:11, color:C.muted, fontWeight:600, letterSpacing:1, textTransform:"uppercase" }}>Coming Soon</div>}
          </div>
        </div>
        <div style={{ fontSize:12, color:C.muted }}>{student.name} · <button onClick={onLogout} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:C.muted, textDecoration:"underline" }}>Sign out</button></div>
      </div>
    </div>
  );
}
// ── LOGIN ────────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState("email");
  const [checking, setChecking] = useState(false);
const [err, setErr] = useState("");
const [showPw, setShowPw] = useState(false);

  async function signInWithGoogle() {
  setChecking(true);
  setErr("");
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email;
    const existing = await loadStudent(email);
    if (existing) {
      onLogin(existing);
    } else {
      const profile = { email, name: result.user.displayName || email };
      await saveStudent(email, { name: profile.name, email, allProgress: {}, allVocab: {}, allChecked: {}, allScores: {} });
      onLogin(profile);
    }
  } catch (e) {
    setErr("Google sign-in failed. Please try again.");
  }
  setChecking(false);
}

async function checkEmail() {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return;
  setChecking(true);
  setErr("");
  const existing = await loadStudent(e);
  setChecking(false);
  if (existing) setStep("password");
  else setStep("register");
}

async function login() {
  if (!password.trim()) return;
  setChecking(true);
  setErr("");
  try {
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    const data = await loadStudent(email.trim().toLowerCase());
    onLogin(data);
  } catch (e) {
    if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
      setStep("register");
      setErr("Please set a password for your existing account.");
    } else {
      setErr("Incorrect password. Please try again.");
    }
  }
  setChecking(false);
}

  async function register() {
    if (!name.trim() || !password.trim()) return;
    setChecking(true);
    setErr("");
    try {
      await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const profile = { email: email.trim().toLowerCase(), name: name.trim() };
      await saveStudent(profile.email, { name: profile.name, email: profile.email, allProgress: {}, allVocab: {}, allChecked: {}, allScores: {} });
      onLogin(profile);
    } catch (e) {
      if (e.code === "auth/weak-password") setErr("Password must be at least 6 characters.");
      else setErr("Could not create account. Try again.");
    }
    setChecking(false);
  }

  return (
    <div style={{ minHeight:"100vh",background:C.bg, display:"flex",alignItems:"center",justifyContent:"center" }}>
      <style>{CSS}</style>
      <div style={{ background:"white",borderRadius:20,padding:"40px 36px",maxWidth:400,width:"92%",textAlign:"center",boxShadow:"0 4px 24px rgba(0,0,0,.1)" }}>
        <div style={{ width:72, height:72, marginBottom:10, margin:"0 auto 10px" }}>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
    <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
    <path d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="hsl(45,70%,88%)"/>
    <path d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="hsl(45,70%,88%)"/>
  </svg>
</div>
       <h2 style={{ fontFamily:"'Heebo',sans-serif",fontSize:32,fontWeight:700,marginBottom:4 }}>KITZ</h2>
<p style={{ color:C.muted,fontSize:15,marginBottom:26 }}>Torah Studies Fluency</p>

        {step === "email" && <>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && checkEmail()} placeholder="School email address" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:12,textAlign:"center" }} autoFocus />
          {err && <p style={{ color:C.red,fontSize:13,marginBottom:8 }}>{err}</p>}
          <Btn style={{ width:"100%" }} onClick={checkEmail} disabled={!email.includes("@") || checking}>{checking ? "Checking…" : "Continue →"}</Btn>
       
       <div style={{ display:"flex",alignItems:"center",gap:10,margin:"14px 0" }}>
  <div style={{ flex:1,height:1,background:C.border }}/>
  <span style={{ fontSize:12,color:C.muted }}>or</span>
  <div style={{ flex:1,height:1,background:C.border }}/>
</div>
<button onClick={signInWithGoogle} disabled={checking} style={{ width:"100%",padding:"11px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:15,cursor:"pointer",background:"white",display:"flex",alignItems:"center",justifyContent:"center",gap:10 }}>
  <img src="https://www.google.com/favicon.ico" style={{ width:16,height:16 }}/>
  Continue with Google
</button>

        </>}

        {step === "password" && <>
          <p style={{ fontSize:14,color:C.muted,marginBottom:14 }}>Welcome back! Enter your password.</p>
<div style={{ position:"relative", marginBottom:12 }}>
  <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Password" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,textAlign:"center" }} autoFocus />
  <button onClick={() => setShowPw(p => !p)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.muted }}>{showPw ? "🙈" : "👁"}</button>
</div>
          {err && <p style={{ color:C.red,fontSize:13,marginBottom:8 }}>{err}</p>}
          <Btn style={{ width:"100%" }} bg={C.green} onClick={login} disabled={!password.trim() || checking}>{checking ? "Signing in…" : "Sign In →"}</Btn>
<div style={{ display:"flex", justifyContent:"space-between", marginTop:10 }}>
  <button onClick={() => { setStep("email"); setErr(""); }} style={{ background:"none",border:"none",cursor:"pointer",color:C.muted,fontFamily:"inherit",fontSize:13 }}>← Back</button>
  <button onClick={async () => {
    if (!email) return;
    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setErr("Reset email sent! Check your inbox.");
    } catch { setErr("Could not send reset email."); }
  }} style={{ background:"none",border:"none",cursor:"pointer",color:C.muted,fontFamily:"inherit",fontSize:13,textDecoration:"underline" }}>Forgot password?</button>
</div>        </>}

        {step === "register" && <>
          <p style={{ fontSize:14,color:C.muted,marginBottom:14 }}>New account for <strong>{email}</strong></p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:10,textAlign:"center" }} autoFocus />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && register()} placeholder="Choose a password" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:12,textAlign:"center" }} />
          {err && <p style={{ color:C.red,fontSize:13,marginBottom:8 }}>{err}</p>}
          <Btn style={{ width:"100%" }} onClick={register} disabled={!name.trim() || !password.trim() || checking}>{checking ? "Creating…" : "Create Account →"}</Btn>
          <button onClick={() => { setStep("email"); setErr(""); }} style={{ background:"none",border:"none",cursor:"pointer",marginTop:10,color:C.muted,fontFamily:"inherit",fontSize:13 }}>← Back</button>
        </>}
      </div>
    </div>
  );
}
// ════════════════════════════════════════════════════════════════
// ── TALMUD MODULE ───────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════

const SUGYA_DATA = {};

async function loadDafText(masechet, daf) {
  const key = `${masechet}_${daf}`;
  if (SUGYA_DATA[key]) return SUGYA_DATA[key];
  const cacheKey = `sefaria_talmud_${key}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) { SUGYA_DATA[key] = JSON.parse(cached); return SUGYA_DATA[key]; }
const res = await fetch(`https://www.sefaria.org/api/texts/${masechet}.${daf}?commentary=0&context=0&pad=0`);
const data = await res.json();
  const segments = (data.he || []).map((he, i) => ({
    he: he.replace(/<[^>]*>/g, "").trim(),
    en: (data.text[i] || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
  })).filter(s => s.he && s.en);
  SUGYA_DATA[key] = segments;
  localStorage.setItem(cacheKey, JSON.stringify(segments));
  return segments;
}

function makeDafim(start, end) {
  const dafim = [];
  for (let i = start; i <= end; i++) {
    dafim.push(`${i}a`);
    dafim.push(`${i}b`);
  }
  return dafim;
}

const TALMUD_TOC = [
  // Seder Zeraim
  { masechet: "Berakhot",      he: "ברכות",      dafim: makeDafim(2, 64) },
  // Seder Moed
  { masechet: "Shabbat",       he: "שבת",        dafim: makeDafim(2, 157) },
  { masechet: "Eruvin",        he: "עירובין",     dafim: makeDafim(2, 105) },
  { masechet: "Pesachim",      he: "פסחים",      dafim: makeDafim(2, 121) },
  { masechet: "Yoma",          he: "יומא",       dafim: makeDafim(2, 88) },
  { masechet: "Sukkah",        he: "סוכה",       dafim: makeDafim(2, 56) },
  { masechet: "Beitzah",       he: "ביצה",       dafim: makeDafim(2, 40) },
  { masechet: "Rosh Hashanah", he: "ראש השנה",   dafim: makeDafim(2, 35) },
  { masechet: "Taanit",        he: "תענית",      dafim: makeDafim(2, 31) },
  { masechet: "Megillah",      he: "מגילה",      dafim: makeDafim(2, 32) },
  { masechet: "Moed Katan",    he: "מועד קטן",   dafim: makeDafim(2, 29) },
  { masechet: "Chagigah",      he: "חגיגה",      dafim: makeDafim(2, 27) },
  // Seder Nashim
  { masechet: "Yevamot",       he: "יבמות",      dafim: makeDafim(2, 122) },
  { masechet: "Ketubot",       he: "כתובות",     dafim: makeDafim(2, 112) },
  { masechet: "Nedarim",       he: "נדרים",      dafim: makeDafim(2, 91) },
  { masechet: "Nazir",         he: "נזיר",       dafim: makeDafim(2, 66) },
  { masechet: "Sotah",         he: "סוטה",       dafim: makeDafim(2, 49) },
  { masechet: "Gittin",        he: "גיטין",      dafim: makeDafim(2, 90) },
  { masechet: "Kiddushin",     he: "קידושין",    dafim: makeDafim(2, 82) },
  // Seder Nezikin
  { masechet: "Bava Kamma",    he: "בבא קמא",    dafim: makeDafim(2, 119) },
  { masechet: "Bava Metzia",   he: "בבא מציעא",  dafim: makeDafim(2, 119) },
  { masechet: "Bava Batra",    he: "בבא בתרא",   dafim: makeDafim(2, 176) },
  { masechet: "Sanhedrin",     he: "סנהדרין",    dafim: makeDafim(2, 113) },
  { masechet: "Makkot",        he: "מכות",       dafim: makeDafim(2, 24) },
  { masechet: "Shevuot",       he: "שבועות",     dafim: makeDafim(2, 49) },
  { masechet: "Avodah Zarah",  he: "עבודה זרה",  dafim: makeDafim(2, 76) },
  { masechet: "Horayot",       he: "הוריות",     dafim: makeDafim(2, 14) },
  // Seder Kodashim
  { masechet: "Zevachim",      he: "זבחים",      dafim: makeDafim(2, 120) },
  { masechet: "Menachot",      he: "מנחות",      dafim: makeDafim(2, 110) },
  { masechet: "Chullin",       he: "חולין",      dafim: makeDafim(2, 142) },
  { masechet: "Bekhorot",      he: "בכורות",     dafim: makeDafim(2, 61) },
  { masechet: "Arakhin",       he: "ערכין",      dafim: makeDafim(2, 34) },
  { masechet: "Temurah",       he: "תמורה",      dafim: makeDafim(2, 34) },
  { masechet: "Keritot",       he: "כריתות",     dafim: makeDafim(2, 28) },
  { masechet: "Meilah",        he: "מעילה",      dafim: makeDafim(2, 22) },
  { masechet: "Tamid",         he: "תמיד",       dafim: makeDafim(2, 33) },
  // Seder Taharot
  { masechet: "Niddah",        he: "נדה",        dafim: makeDafim(2, 73) },
];
function TalmudKriah({ segment, masechet, daf, onPass }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      setProcessing(true);
      await new Promise(res => setTimeout(res, 300));
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const enTranscript = await callWhisper(blob, "en");
      const score = await gradeTalmudKriah(enTranscript, segment.en);
      setResult(score);
      setProcessing(false);
    };
    mediaRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  function stopRecording() { mediaRef.current?.stop(); }

 async function gradeTalmudKriah(enTranscript, enText) {
  const response = await callClaude(
`Text A: "${enText}"\nText B: "${enTranscript}"\n\nCompare Text A and Text B. For each meaningful word or phrase in Text A, does Text B contain a word or phrase with the same or similar meaning? Be very generous with synonyms — for example "as it is written" and "as it says" are the same, "went" and "walked" are the same, "said" and "told" are the same. Any reasonable paraphrase or synonym counts as a full match. Ignore any non-English words in Text B entirely.\n\n Score based on % of Text A words matched in Text B:\nLiterally count: how many meaningful words/phrases are in the reference? How many did the student correctly translate? Divide to get a real percentage. Do not round to a nice number — if they got 7 out of 10 words, score is 70. If they got 0 words, score is 0. If they got all words, score is 95-100. Be precise, not approximate.\n\nRespond ONLY:\nSCORE: [0-100]\nFEEDBACK: [one short sentence about word coverage ONLY — e.g. "You translated X out of Y words correctly." Do NOT mention meaning, content, sources, or context — only word coverage]`,
"You are comparing two translations word by word. Synonyms and valid paraphrases always count as YES. Be generous. Reply ONLY in the format shown.", );

const enRaw = parseInt(response.match(/SCORE:\s*(\d+)/)?.[1] || 0);
const enScore = Math.min(100, enRaw + 10);
const feedback = enScore >= 90 ? "Excellent — nearly every word covered!" : enScore >= 80 ? "Great work — strong coverage overall." : enScore >= 70 ? "Good — a few words missed but you got the core." : "Keep practicing — try to translate each word as you go.";
return { score: enScore, feedback, passed: enScore >= 70 };
}

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:9, padding:"9px 14px", marginBottom:14, fontSize:13, color:"hsl(35,35%,36%)" }}>
        🎙 <strong>Kriah</strong> — Read the Aramaic aloud, translating into English as you go
      </div>
      <div style={{ background:"white", borderRadius:14, padding:"18px 20px", boxShadow:"0 1px 4px rgba(0,0,0,.06)", marginBottom:16, borderRight:`4px solid ${C.gold}` }}>
        <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:20, lineHeight:2.4, textAlign:"right", margin:0 }}>{segment.he}</p>
      </div>
      {!result && !processing && (
        <div style={{ textAlign:"center", marginTop:24 }}>
          {!recording
            ? <button onClick={startRecording} style={{ background:"white", color:C.muted, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"12px 28px", fontSize:14, cursor:"pointer", fontFamily:"inherit", display:"inline-flex", alignItems:"center", gap:8, boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
                <span style={{ fontSize:18 }}>💬</span> Begin Reading
              </button>
            : <button onClick={stopRecording} style={{ background:"hsl(210,30%,96%)", color:"hsl(210,40%,40%)", border:`1.5px solid hsl(210,30%,82%)`, borderRadius:12, padding:"12px 28px", fontSize:14, cursor:"pointer", fontFamily:"inherit", display:"inline-flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:16, animation:"pulse 1.5s infinite", display:"inline-block" }}>🔵</span> Listening… tap when done
              </button>}
        </div>
      )}
      {processing && (
        <div style={{ textAlign:"center", padding:"30px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <div style={{ width:60, height:60, animation:"kuf-pulse 1.4s ease-in-out infinite" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
              <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
              <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite" }} d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="hsl(45,70%,88%)"/>
              <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite 0.7s" }} d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="hsl(45,70%,88%)"/>
            </svg>
          </div>
          <p style={{ color:C.muted, fontSize:14 }}>Grading your reading…</p>
        </div>
      )}
      {result && (
        <div style={{ background:"white", borderRadius:14, padding:"24px", boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
          <div style={{ textAlign:"center", padding:"14px", background:"hsl(35,30%,97%)", borderRadius:10, marginBottom:16 }}>
            <div style={{ fontSize:11, color:C.muted, letterSpacing:1, marginBottom:4 }}>ENGLISH TRANSLATION</div>
            <div style={{ fontSize:36, fontWeight:700, color:result.score>=70?C.green:C.red }}>{result.score}%</div>
            <p style={{ fontSize:12, color:C.muted, marginTop:6, fontStyle:"italic", lineHeight:1.4 }}>{result.feedback}</p>
          </div>
          {result.passed
            ? <Btn bg={C.green} style={{ width:"100%" }} onClick={onPass}>✓ Kriah Complete →</Btn>
            : <div>
                <p style={{ textAlign:"center", color:C.red, fontWeight:600, marginBottom:12 }}>Need 70% to pass — keep practicing!</p>
                <Btn style={{ width:"100%" }} onClick={() => setResult(null)}>Try Again</Btn>
              </div>}
        </div>
      )}
    </div>
  );
}

function TalmudQuiz({ segment, masechet, daf, onPass, onReview }) {
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [started, setStarted] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!started) return;
    setQuiz(null); setLoading(true); setAnswers({}); setSubmitted(false);
    callClaude(
      `Quiz a Modern Orthodox high school student on this Talmud segment from ${masechet} ${daf}.\n\nAramaic text: "${segment.he}"\nEnglish translation: "${segment.en}"\n\nCreate exactly 2 comprehension questions with 4 answer choices (A–D):\n- Question 1: what does this segment actually say? Test understanding of the content.\n- Question 2: what is the Talmudic argument or reasoning in this segment?\n\nBoth questions should be purely about understanding the text — no practical application.\n\nReturn ONLY valid JSON array:\n[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."},{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}]`,
      "Return ONLY a valid JSON array. No markdown, no commentary.", 1000
    ).then(raw => {
      try {
        const cleaned = raw.split("```json").join("").split("```").join("").trim();
        setQuiz(JSON.parse(cleaned));
      } catch { setQuiz([]); }
      setLoading(false);
    }).catch(() => { setQuiz([]); setLoading(false); });
  }, [started, retryKey]);

  if (!started) return (
    <div style={{ textAlign:"center", padding:"50px 20px" }}>
      <div style={{ fontSize:36, marginBottom:10 }}>📝</div>
      <p style={{ fontSize:17, color:C.muted, marginBottom:22 }}>Ready to test your understanding?</p>
      <Btn bg={C.green} onClick={() => setStarted(true)}>Generate Quiz →</Btn>
    </div>
  );

  if (loading) return (
    <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}>
      <div style={{ fontSize:36, marginBottom:10 }}>🤔</div>
      <div style={{ fontSize:17 }}>Generating quiz…</div>
    </div>
  );

  if (!quiz?.length) return (
    <div style={{ textAlign:"center", padding:40, color:C.red, fontSize:15 }}>
      Could not generate quiz.{" "}
      <button style={{ background:"none", border:"none", cursor:"pointer", color:C.brown, fontFamily:"inherit", fontSize:15, textDecoration:"underline" }} onClick={() => setRetryKey(k => k+1)}>Try again</button>
    </div>
  );

  const score = quiz.filter((q, i) => answers[i] === parseInt(q.answer)).length;
  const passed = submitted && score === quiz.length;

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"hsl(35,35%,36%)" }}>
        📝 <strong>Comprehension Quiz</strong> · Answer all questions correctly to master
      </div>
      {quiz.map((q, qi) => (
        <div key={qi} style={{ background:"white", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
          <p style={{ fontSize:16, fontWeight:500, marginBottom:12, lineHeight:1.55 }}>{qi+1}. {q.question}</p>
          {q.options.map((opt, oi) => {
            let cls = "opt";
            if (submitted) { if (oi === parseInt(q.answer)) cls += " cor"; else if (answers[qi] === oi) cls += " wrg"; }
            else if (answers[qi] === oi) cls += " sel";
            return <button key={oi} className={cls} disabled={submitted} onClick={() => !submitted && setAnswers(a => ({ ...a, [qi]: oi }))}>{opt}</button>;
          })}
          {submitted && q.explanation && (
            <div style={{ marginTop:8, padding:"8px 12px", background:"hsl(35,30%,97%)", borderRadius:8, fontSize:13, color:"hsl(25,20%,36%)", lineHeight:1.5 }}>💡 {q.explanation}</div>
          )}
        </div>
      ))}
      {!submitted
        ? <Btn disabled={Object.keys(answers).length < quiz.length} bg={C.green} style={{ width:"100%" }} onClick={() => setSubmitted(true)}>Submit Answers ({Object.keys(answers).length}/{quiz.length})</Btn>
        : passed
          ? <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:36, marginBottom:10 }}>🏆</div>
              <p style={{ fontSize:18, fontWeight:600, marginBottom:16, color:C.green }}>Segment Mastered!</p>
              <Btn bg={C.green} onClick={onPass}>Continue ›</Btn>
            </div>
          : <div style={{ textAlign:"center", padding:"16px 0" }}>
              <p style={{ color:C.red, fontWeight:600, marginBottom:12 }}>Not quite — review and try again.</p>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                <Btn onClick={onReview}>Review Segment</Btn>
                <Btn bg={C.gold} onClick={() => { setSubmitted(false); setAnswers({}); }}>Retry Quiz</Btn>
              </div>
            </div>}
    </div>
  );
}

function ShaklaVTarya({ segments, progress, masechet, daf }) {
  const studiedSegments = segments.filter((_, i) => {
    const key = `${masechet}_${daf}_${i}`;
    return progress[key] === "mastered"; 
  });

const [messages, setMessages] = useState([]);
const [input, setInput] = useState("");
const [loading, setLoading] = useState(false);
const [started, setStarted] = useState(false);
const [currentSegIdx, setCurrentSegIdx] = useState(0);
const [chatDone, setChatDone] = useState(false);
const inputRef = useRef(null);
const scrollRef = useRef(null);
useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const allText = studiedSegments.map((seg, i) => `Segment ${i}: ${seg.he}\nTranslation: ${seg.en}`).join("\n\n");
  const firstSeg = studiedSegments[0];
  const firstPhrase = firstSeg ? firstSeg.he.split(" ").slice(0, 6).join(" ") : "";

async function startSession() {
  setLoading(true);    setStarted(true);
    setCurrentSegIdx(0);
    const firstSeg = studiedSegments[0];
const openingPrompt = await callClaude(
  `This is a segment from ${masechet} ${daf}:\n\n"${firstSeg.he}"\nTranslation: "${firstSeg.en}"\n\nIs this a Mishnah, a Baraita, a Gemara question, an answer, or something else? Write ONE opening chavruta question about the shakla v'tarya of this specific segment — what argument or idea is it introducing? Don't ask for translation. Don't ask broad questions. Be specific to what this segment actually says.`,
  "You are starting a Talmud chavruta session. Identify what type of unit this is (Mishnah, Gemara question, answer, proof, objection, etc.). (If it is a Mishna, label the top line Mishna (in bold), otherwise no need for a top line - go right into the question) Ask ONE simple, text-grounded question about what this segment is saying — what ruling is stated, what position is being taken, or what the basic point is. Stay close to what the text actually says. No speculation, no deep analysis. Think: what would a Rebbi ask first to make sure the student understood what they just read? 1-2 sentences, no preamble. (an example of a question I would ask on the mishna: simply put, what is the Mishna teaching here?)" , 
  150
);
setStarted(true);
setCurrentSegIdx(0);
const cleanedOpening = openingPrompt.replace(/SEGMENT:\d+\n?/, "").trim();
const segIdxRaw = await callClaude(
  `These are the Talmud segments:\n${allText}\n\nThis question was just asked:\n"${cleanedOpening}"\n\nWhich segment index (0-based) is this question about? Reply with ONLY a single integer, nothing else.`,
  "You identify which segment a question refers to. Reply with ONLY a single integer — the 0-based index of the relevant segment. No explanation, no punctuation.",
  10
);
const detectedIdx = Math.max(0, parseInt(segIdxRaw.trim()) || 0);
setMessages([{ role: "assistant", text: cleanedOpening, segRef: detectedIdx }]);
setLoading(false);
setLoading(false);
}

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const newMessages = [...messages, { role: "user", text: input }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    const history = newMessages.map(m => `${m.role === "user" ? "Student" : "Chavruta"}: ${m.text}`).join("\n");
    const response = await callClaude(
`You are doing chavruta learning with a student on these Talmud segments from ${masechet} ${daf}:\n\n${allText}\n\nConversation so far:\n${history}\n\nContinue the chavruta. Ask simple, text-grounded questions about the shakla v'tarya — what the text is saying, what ruling or position is being stated, what objection is raised, what answer is given. Stay close to what the text actually says. Don't go deeper than the text warrants. NEVER refer to segments by number or label (never say 'segment 2' or 'the next segment'). Instead refer to the content itself — e.g. 'the Gemara's rejection of Hannah as proof' not 'segment 2'. 2 sentences max.`,
"You are a Talmud chavruta. Ask simple, direct questions about what the text is actually saying — what ruling is stated, what objection is raised, what answer is given, what proof is brought. Stay grounded in the text. Don't ask students to speculate beyond what the Gemara itself says. Think: what would a good Rebbi ask a student to make sure they understand the basic flow of the sugya? 2 sentences max. Once the conversation has naturally covered the key points of all the segments, wrap up warmly with a brief closing thought — don't keep asking new questions." ,
      200
    );
const cleanedResponse = response.replace(/SEGMENT:\d+\n?/, "").trim();
const segIdxRaw = await callClaude(
  `These are the Talmud segments:\n${allText}\n\nThis question was just asked:\n"${cleanedResponse}"\n\nWhich segment index (0-based) is this question about? Reply with ONLY a single integer, nothing else.`,
  "You identify which segment a question refers to. Reply with ONLY a single integer — the 0-based index of the relevant segment. No explanation, no punctuation.",
  10
);
const detectedSegIdx = Math.max(0, parseInt(segIdxRaw.trim()) || 0);
if (detectedSegIdx !== currentSegIdx) setCurrentSegIdx(detectedSegIdx);
setMessages(m => [...m, { role: "assistant", text: cleanedResponse, segRef: detectedSegIdx }]);
const covered = await callClaude(
  `These are the segments:\n${allText}\n\nThis is the full conversation:\n${history}\n\nHave all ${studiedSegments.length} segments been meaningfully discussed? Reply YES or NO only.`,
  "Reply with only YES or NO.", 5
);
if (covered.trim().toUpperCase().startsWith("YES")) setChatDone(true);
setLoading(false);
setTimeout(() => inputRef.current?.focus(), 50);
  }

  if (studiedSegments.length === 0) return (
    <div style={{ textAlign:"center", padding:"50px 20px", color:C.muted }}>
      <div style={{ fontSize:36, marginBottom:10 }}>🔒</div>
      <p>Complete some segments first to unlock chavruta learning.</p>
    </div>
  );

  if (!started) return (
    <div style={{ textAlign:"center", padding:"40px 20px" }}>
      <div style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:9, padding:"9px 14px", marginBottom:20, fontSize:13, color:"hsl(35,35%,36%)", textAlign:"left" }}>
        🤝 <strong>Shakla v'Tarya</strong> — Chavruta covering {studiedSegments.length} studied segment{studiedSegments.length > 1 ? "s" : ""}
      </div>
      <Btn bg={C.brown} onClick={startSession}>Begin Chavruta →</Btn>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 240px)" }}>
<div ref={messagesEndRef => { if (messagesEndRef) messagesEndRef.scrollTop = messagesEndRef.scrollHeight; }} style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:12 }}>        {messages.map((m, i) => (
  <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
    <div style={{ maxWidth:"80%", background:m.role==="user"?C.brown:"white", color:m.role==="user"?"white":"hsl(25,20%,25%)", borderRadius:12, padding:"10px 14px", fontSize:14, lineHeight:1.6, boxShadow:"0 1px 3px rgba(0,0,0,.08)", whiteSpace:"pre-wrap" }}>
      {m.text.replace(/\*\*/g, "").replace(/\*/g, "")}
      {m.role === "assistant" && m.segRef !== undefined && studiedSegments[m.segRef] && (
        <details style={{ marginTop:8 }}>
          <summary style={{ cursor:"pointer", fontSize:11, color:"hsl(25,20%,55%)", listStyle:"none" }}>📜 View segment</summary>
          <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:12, lineHeight:2, color:"hsl(25,20%,35%)", marginTop:6, paddingTop:6, borderTop:"1px solid hsl(35,20%,88%)" }}>{studiedSegments[m.segRef].he}</p>
        </details>
      )}
    </div>
  </div>
))}
        {loading && (
          <div style={{ display:"flex", justifyContent:"flex-start" }}>
            <div style={{ background:"white", borderRadius:12, padding:"10px 14px", fontSize:14, color:C.muted, boxShadow:"0 1px 3px rgba(0,0,0,.08)" }}>thinking…</div>
          </div>
        )}
      </div>
      {chatDone
  ? <div style={{ textAlign:"center", padding:"16px", color:C.muted, fontSize:15, fontStyle:"italic", borderTop:`1px solid ${C.border}` }}>
      🤝 Chavruta complete — great learning!
    </div>
  : <div style={{ display:"flex", gap:8 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === "Enter" && sendMessage()}
        placeholder="Respond to your chavruta…"
        style={{ flex:1, padding:"11px 14px", border:`1.5px solid ${C.border}`, borderRadius:9, fontFamily:"'EB Garamond',serif", fontSize:15 }}
        autoFocus
      />
      <Btn onClick={sendMessage} disabled={!input.trim() || loading}>Send</Btn>
    </div>
}
    </div>
  );
}

function TalmudSegmentStudy({ segment, segIdx, daf, masechet, status, onMastered, onBack, onVocabSave, onWordMastered, segVocab, onVocabDone, onKriahDone, onPrev, onNext, totalSegments }) {    const [tab, setTab] = useState("read");
  const [popup, setPopup] = useState(null);
  const [vocabStage, setVocabStage] = useState("cards");
  const [explanation, setExplanation] = useState(null);
const [loadingExplanation, setLoadingExplanation] = useState(false);
const [rashi, setRashi] = useState(null);
const [loadingRashi, setLoadingRashi] = useState(false);
const [rashiTranslation, setRashiTranslation] = useState(null);
const [loadingRashiTranslation, setLoadingRashiTranslation] = useState(false);
  const [showMastered, setShowMastered] = useState(false);

const vocabDone = status?.vocab === true;
const kriahDone = status?.kriah === true;
const quizDone = status?.quiz === true;
const mastered = vocabDone && kriahDone && quizDone;

useEffect(() => { setTab("read"); setVocabStage("cards"); setExplanation(null); setRashi(null); setRashiTranslation(null); }, [segIdx]);
useEffect(() => {
  if (mastered) setShowMastered(true);
}, [mastered]);

  function handleWord(e) {
    e.stopPropagation();
    const raw = e.target.innerText?.trim();
    if (!raw || raw.length < 2) return;
    setPopup({ he: raw, en: null, loading: true });
    callClaude(
      `Context (${masechet} ${daf}): "${segment.he}"\n\nTranslate the Aramaic word "${raw}" as used in this context. Reply with ONLY the English translation, 1-5 words, nothing else.`,
      "You are a Talmud translator. Reply with ONLY the English translation. No labels, no punctuation, no explanation.", 40
    ).then(d => {
      const en = d.trim().replace(/^[\*\_\s]+|[\*\_\s]+$/g, "");
      setPopup(p => p?.he === raw ? { ...p, en, loading: false } : p);
      onVocabSave(raw, en);
    }).catch(() => setPopup(p => p?.he === raw ? { ...p, en:"(unavailable)", loading: false } : p));
  }

  const badge = mastered
    ? <span style={{ background:"hsl(142,40%,90%)",color:"hsl(142,40%,28%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>✓ Mastered</span>
    : vocabDone
    ? <span style={{ background:"hsl(210,60%,90%)",color:"hsl(210,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>Vocab ✓ → Quiz</span>
    : <span style={{ background:"hsl(45,70%,90%)",color:"hsl(35,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>In Progress</span>;

  return (
    <div style={{ minHeight:"100vh", background:C.bg }} onClick={() => setPopup(null)}>
      <style>{CSS}</style>
      {showMastered && (
  <div style={{ position:"fixed", inset:0, zIndex:500, background:"rgba(0,0,0,.45)", display:"flex", alignItems:"center", justifyContent:"center" }}>
    <div style={{ background:"white", borderRadius:20, padding:"40px 32px", maxWidth:340, width:"92%", textAlign:"center", border:`0.5px solid ${C.border}` }}>
      <div style={{ width:72, height:72, margin:"0 auto 16px", background:"hsl(142,40%,92%)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="hsl(142,44%,37%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:500, marginBottom:8 }}>Segment mastered!</h2>
      <p style={{ color:C.muted, fontSize:14, marginBottom:24, lineHeight:1.6 }}>You completed the vocab, kriah, and content quiz. Great work!</p>
      <div style={{ display:"flex", justifyContent:"center", gap:24, marginBottom:20 }}>
        {[["Vocab", vocabDone], ["Kriah", kriahDone], ["Quiz", quizDone]].map(([label, done]) => (
          <div key={label} style={{ textAlign:"center" }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:4, letterSpacing:0.5 }}>{label.toUpperCase()}</div>
            <div style={{ width:28, height:28, background:"hsl(142,40%,92%)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(142,44%,37%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onBack} style={{ width:"100%", padding:12, background:"hsl(142,40%,92%)", border:"none", borderRadius:9, fontSize:15, fontWeight:500, color:"hsl(142,44%,37%)", cursor:"pointer", fontFamily:"'EB Garamond',serif" }}>← Back to Daf</button>
    </div>
  </div>
)}
      <div style={{ position:"sticky", top:0, zIndex:100, background:"hsl(35,22%,91%)", borderBottom:`1.5px solid ${C.border}` }}>
        <div style={{ maxWidth:720, margin:"0 auto", padding:"10px 18px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
            <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:14, color:C.muted }}>← {masechet} {daf}</button>
<div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:14, fontWeight:700 }}>{segment.he.split(" ").slice(0, 3).join(" ")}…</div>            {badge}
          </div>
          <div style={{ display:"flex", width:"100%", borderTop:`1px solid ${C.border}` }}>
            {[
              ["read","📖 Read"],
["vocab","🃏 Vocab" + (vocabDone?" ✓":"")],
["kriah","🎙 Kriah" + (kriahDone?" ✓":"")],
["quiz","📝 Quiz" + (quizDone?" ✓":"")]
            ].map(([id, lbl]) => (
              <button key={id} className={`tab${tab===id?" on":""}`} style={{ flex:1, textAlign:"center" }} onClick={e => { e.stopPropagation(); setTab(id); }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:"20px 18px 120px" }}>
        {tab === "read" && (
          <>
            <div style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:9, padding:"9px 14px", marginBottom:14, fontSize:13, color:"hsl(35,35%,36%)" }}>
              💡 <strong>Tap a word</strong> for its translation — saved to your Vocab deck
            </div>
           <div style={{ background:"white", borderRadius:14, padding:"18px 20px", boxShadow:"0 1px 4px rgba(0,0,0,.06)", borderRight:`4px solid ${mastered?C.green:C.gold}` }}>
  <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:20, lineHeight:2.4, textAlign:"right" }}>
    {(() => {
      const isHadran = /הדרן/.test(stripNikud(segment.he));
      if (isHadran) {
        return (
          <span style={{ fontWeight:700 }}>
            {segment.he.split(" ").map((w, wi) => <span key={wi}>{w} </span>)}
          </span>
        );
      }
      return segment.he.split(" ").map((w, wi) => {
        const s = stripNikud(w);
        const isBold = stripNikud(w).startsWith("מתני") || stripNikud(w).startsWith("גמ");
        return (
          <span
            key={wi}
            className={`ws${popup?.he === w ? " hit" : ""}`}
            onClick={handleWord}
            style={isBold ? { fontWeight:700 } : {}}
          >{w} </span>
        );
      });
    })()}
  </p>
</div>
            <button onClick={async () => {
  if (explanation) { setExplanation(null); return; }
  setLoadingExplanation(true);
  const exp = await callClaude(
`This is a single Talmud segment from ${masechet} ${daf}:\n\nAramaic: "${segment.he}"\nTranslation: "${segment.en}"\n\nExplain ONLY what is happening in THIS specific segment — not the broader sugya, not what comes before or after. What is this one unit saying or doing? 2-3 sentences max. Do not start with a title or heading — go straight into the explanation.`,    "You are a Talmud teacher explaining a passage to a Modern Orthodox high school student. Be clear, conversational, and specific to what the text actually says. No jargon without explanation. 3-5 sentences.", 300
  );
  setExplanation(exp);
  setLoadingExplanation(false);
}} style={{ width:"100%", marginTop:12, padding:"10px", background:"none", border:`1.5px solid ${C.border}`, borderRadius:9, fontFamily:"'EB Garamond',serif", fontSize:14, cursor:"pointer", color:C.muted }}>
  {loadingExplanation ? "Loading…" : explanation ? "Hide explanation" : "💬 Explain this to me"}
</button>
{explanation && (
  <div style={{ marginTop:10, background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:10, padding:"14px 16px", fontSize:14, color:"hsl(35,30%,25%)", lineHeight:1.7 }}>
    {explanation.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+.*\n?/gm, "").trim()}

  </div>
)}
<button onClick={async () => {
  if (rashi) { setRashi(null); return; }
  setLoadingRashi(true);
  try {
    const res = await fetch(`https://www.sefaria.org/api/texts/Rashi_on_${masechet}.${daf}.${segIdx + 1}?commentary=0&context=0&pad=0`);
    const data = await res.json();
    const text = (data.he || []).join(" ").replace(/<[^>]*>/g, "").trim();
setRashi(text || null);
if (!text) setRashi("__none__");
  } catch { setRashi("Could not load Rashi."); }
  setLoadingRashi(false);
}} style={{ width:"100%", marginTop:8, padding:"10px", background:"none", border:`1.5px solid ${C.border}`, borderRadius:9, fontFamily:"'EB Garamond',serif", fontSize:14, cursor:"pointer", color:C.muted }}>
  {loadingRashi ? "Loading…" : rashi ? "Hide Rashi" : "📖 View Rashi"}
</button>
{rashi && rashi !== "__none__" && (
  <div style={{ marginTop:10, background:"white", border:`1.5px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
    <div style={{ fontSize:11, color:C.muted, letterSpacing:1, marginBottom:8 }}>RASHI</div>
    <p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:16, lineHeight:2.2, color:"hsl(25,20%,25%)", marginBottom:10 }}>{rashi}</p>
    <button onClick={async () => {
      if (rashiTranslation) { setRashiTranslation(null); return; }
      setLoadingRashiTranslation(true);
      const trans = await callClaude(
        `Translate this Rashi commentary into clear English for a Modern Orthodox high school student:\n\n"${rashi}"\n\nContext: this is Rashi on ${masechet} ${daf}. Give a clean English translation only — no preamble.`,
        "You are translating Rashi's Talmud commentary into clear, accessible English for high school students. Translate faithfully but naturally. No preamble or labels.", 300
      );
      setRashiTranslation(trans.replace(/\*\*/g, "").replace(/\*/g, "").trim());
      setLoadingRashiTranslation(false);
    }} style={{ width:"100%", padding:"8px", background:"none", border:`1px solid ${C.border}`, borderRadius:7, fontFamily:"'EB Garamond',serif", fontSize:13, cursor:"pointer", color:C.muted }}>
      {loadingRashiTranslation ? "Translating…" : rashiTranslation ? "Hide translation" : "🔤 Translate Rashi"}
    </button>
    {rashiTranslation && (
      <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}`, fontSize:14, color:"hsl(25,20%,30%)", lineHeight:1.7 }}>{rashiTranslation}</div>
    )}
  </div>
)}
{rashi === "__none__" && (
  <div style={{ marginTop:10, textAlign:"center", fontSize:13, color:C.muted, padding:"10px 0" }}>No Rashi on this segment</div>
)}
{!mastered && (
  <Btn style={{ width:"100%", marginTop:12 }} onClick={() => setTab("vocab")}>Continue to Vocab →</Btn>
)}
<div style={{ display:"flex", gap:8, marginTop:8 }}>
  <button onClick={onPrev} disabled={segIdx === 0} style={{ flex:1, padding:"10px", background:"none", border:`1.5px solid ${C.border}`, borderRadius:9, fontFamily:"'EB Garamond',serif", fontSize:14, cursor:segIdx===0?"not-allowed":"pointer", color:segIdx===0?C.border:C.muted }}>← Previous</button>
  <button onClick={onNext} disabled={segIdx === totalSegments - 1} style={{ flex:1, padding:"10px", background:"none", border:`1.5px solid ${C.border}`, borderRadius:9, fontFamily:"'EB Garamond',serif", fontSize:14, cursor:segIdx===totalSegments-1?"not-allowed":"pointer", color:segIdx===totalSegments-1?C.border:C.muted }}>Next →</button>
</div>
          </>
        )}

        {tab === "vocab" && (
  vocabStage === "typing"
    ? <TypingQuiz
        key={`talmud-typing-${segIdx}`}
        seifIdx={segIdx}
        seifVocab={segVocab || {}}
        onWordMastered={onWordMastered}
        onDone={() => { onVocabDone(); setVocabStage("cards"); setTab("kriah"); }}
        onBack={() => { setVocabStage("cards"); setTab("read"); }}
      />
    : <SeifCards
        key={`talmud-vocab-${segIdx}`}
        seifIdx={segIdx}
        seifVocab={segVocab || {}}
        vocabCompleted={vocabDone}
       onDone={(skipToContent) => {
  if (skipToContent) {
    const hasVocab = Object.keys(segVocab || {}).length > 0;
    if (hasVocab) { onVocabDone(); setTab("kriah"); }
    else { setTab("read"); }
  }
  else { setVocabStage("typing"); }
}}
      />
)}

        {tab === "kriah" && (
          <TalmudKriah
            segment={segment}
            masechet={masechet}
            daf={daf}
onPass={() => { onKriahDone(); setTab("quiz"); }}
          />
        )}

        {tab === "quiz" && (
  <TalmudQuiz
    segment={segment}
    masechet={masechet}
    daf={daf}
    onPass={onMastered}
    onReview={() => setTab("read")}
  />
)}
      </div>
      <WordPopup popup={popup} onClose={() => setPopup(null)} />
    </div>
  );
}

function TalmudAnki({ anki, onUpdate }) {
const today = new Date().toLocaleDateString('en-CA');
const NEW_CARDS_PER_DAY = 10;

function getDailyNew() {
  const saved = JSON.parse(localStorage.getItem("talmud_daily_new") || "{}");
  if (saved.date !== today) return [];
  return saved.cards || [];
}

function saveDailyNew(cards) {
  localStorage.setItem("talmud_daily_new", JSON.stringify({ date: today, cards }));
}

function getQueue() {
  const dailyNew = getDailyNew();
  const due = [], newCards = [];
  TALMUD_VOCAB.forEach(card => {
    const state = anki[card.he];
    if (!state) {
      if (dailyNew.includes(card.he)) newCards.push(card);
    } else if (state.dueDate <= today) due.push(card);
  });
  const allNew = TALMUD_VOCAB.filter(c => !anki[c.he] && !dailyNew.includes(c.he));
  const toAdd = allNew.slice(0, Math.max(0, NEW_CARDS_PER_DAY - dailyNew.length));
  const updatedDaily = [...dailyNew, ...toAdd.map(c => c.he)];
  saveDailyNew(updatedDaily);
  toAdd.forEach(c => newCards.push(c));
  return [...due, ...newCards];
}

const [queue, setQueue] = useState(() => getQueue());
const [revealed, setRevealed] = useState(false);
const [filter, setFilter] = useState("all");

const [done, setDone] = useState(() => {
  const saved = JSON.parse(localStorage.getItem("talmud_anki_done") || "{}");
  return saved.date === today;
});

useEffect(() => {
  if (done) updateStreak();
}, [done]);

  const filteredQueue = queue.filter(c => {
    if (filter === "core") return c.core;
    if (filter === "1") return c.difficulty === 1;
    if (filter === "2") return c.difficulty === 2;
    if (filter === "3") return c.difficulty === 3;
    return true;
  });

const card = filteredQueue[0] || queue[0];
  function sm2(card, rating) {
    const state = anki[card.he] || { interval: 0, easeFactor: 2.5, reps: 0 };
    let { interval, easeFactor, reps } = state;

    if (rating === 0) {
      interval = 1; easeFactor = Math.max(1.3, easeFactor - 0.2); reps = 0;
    } else if (rating === 1) {
      interval = Math.max(1, Math.round(interval * 1.2));
      easeFactor = Math.max(1.3, easeFactor - 0.15);
    } else if (rating === 2) {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      reps++;
    } else {
      if (reps === 0) interval = 4;
      else if (reps === 1) interval = 6;
      else interval = Math.round(interval * easeFactor * 1.3);
      easeFactor = Math.min(3.0, easeFactor + 0.15);
      reps++;
    }

    const due = new Date();
    due.setDate(due.getDate() + interval);
    return { interval, easeFactor, reps, dueDate: due.toISOString().split("T")[0] };
  }

function getStreak() {
  const saved = JSON.parse(localStorage.getItem("talmud_streak") || "{}");
  if (!saved.lastDate) return 0;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toLocaleDateString('en-CA');
  if (saved.lastDate === today) return saved.streak;
  if (saved.lastDate === yStr) return saved.streak;
  return 0;
}

function updateStreak() {
  const saved = JSON.parse(localStorage.getItem("talmud_streak") || "{}");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toLocaleDateString('en-CA');
  let streak;
  if (saved.lastDate === today) {
    streak = saved.streak;
  } else if (saved.lastDate === yStr) {
    streak = (saved.streak || 0) + 1;
  } else {
    streak = 1;
  }
  localStorage.setItem("talmud_streak", JSON.stringify({ lastDate: today, streak }));
  return streak;
}

  function grade(rating) {
    const newState = sm2(card, rating);
    onUpdate(card.he, newState);
    const newQueue = filteredQueue.slice(1);
    if (rating === 0) newQueue.push(card);
    setQueue(newQueue.filter(c => {
      if (filter === "core") return c.core;
      if (filter === "1") return c.difficulty === 1;
      if (filter === "2") return c.difficulty === 2;
      if (filter === "3") return c.difficulty === 3;
      return true;
    }));
    setRevealed(false);

if (newQueue.length === 0 && rating !== 0) {
  localStorage.setItem("talmud_anki_done", JSON.stringify({ date: today }));
  setDone(true);
}
}

  const diffColor = { 1:"hsl(142,44%,37%)", 2:"hsl(35,70%,45%)", 3:"hsl(0,55%,50%)" };
  const diffBg = { 1:"hsl(142,40%,92%)", 2:"hsl(45,70%,90%)", 3:"hsl(0,60%,94%)" };

  const totalDue = TALMUD_VOCAB.filter(c => {
    const s = anki[c.he];
    return !s || s.dueDate <= today;
  }).length;
  const totalMastered = TALMUD_VOCAB.filter(c => (anki[c.he]?.interval || 0) >= 21).length;

if (done || filteredQueue.length === 0) {
  const streak = getStreak();
  return (
    <div style={{ textAlign:"center", padding:"60px 20px" }}>
      <div style={{ fontSize:48, marginBottom:12 }}>🎉</div>
      <p style={{ fontSize:20, fontWeight:600, marginBottom:16 }}>All caught up!</p>
      <div style={{ display:"flex", justifyContent:"center", gap:12, marginBottom:20 }}>
        <div style={{ background:"hsl(25,80%,92%)", borderRadius:12, padding:"12px 20px" }}>
          <div style={{ fontSize:28, fontWeight:700, color:"hsl(25,60%,35%)" }}>🔥 {streak}</div>
          <div style={{ fontSize:12, color:"hsl(25,60%,35%)" }}>day streak</div>
        </div>
        <div style={{ background:"hsl(142,40%,90%)", borderRadius:12, padding:"12px 20px" }}>
          <div style={{ fontSize:28, fontWeight:700, color:"hsl(142,40%,28%)" }}>{totalMastered}</div>
          <div style={{ fontSize:12, color:"hsl(142,40%,28%)" }}>mastered</div>
        </div>
        <div style={{ background:"hsl(210,60%,93%)", borderRadius:12, padding:"12px 20px" }}>
          <div style={{ fontSize:28, fontWeight:700, color:"hsl(210,50%,35%)" }}>{TALMUD_VOCAB.filter(c => !anki[c.he]).length}</div>
          <div style={{ fontSize:12, color:"hsl(210,50%,35%)" }}>remaining</div>
        </div>
      </div>
      <p style={{ color:C.muted, fontSize:13 }}>Come back tomorrow for your next {NEW_CARDS_PER_DAY} new cards.</p>
    </div>
  );
}

  const cardState = anki[card.he];
  const isNew = !cardState;
  const interval = cardState?.interval || 0;

  return (
    <div>
      {/* Stats bar */}
<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:16 }}>
        {[
          ["📬 Due", totalDue, "hsl(210,60%,93%)", "hsl(210,50%,35%)"],
          ["🆕 New", TALMUD_VOCAB.filter(c => !anki[c.he]).length, "hsl(45,70%,90%)", "hsl(35,50%,32%)"],
          ["✓ Mastered", totalMastered, "hsl(142,40%,90%)", "hsl(142,40%,28%)"],
          ["🔥 Streak", getStreak(), "hsl(25,80%,92%)", "hsl(25,60%,35%)"],
        ].map(([label, val, bg, color]) => (
          <div key={label} style={{ background:bg, borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:700, color }}>{val}</div>
            <div style={{ fontSize:11, color, opacity:0.8 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ height:4, background:C.border, borderRadius:2, marginBottom:16, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(totalMastered/TALMUD_VOCAB.length)*100}%`, background:C.green, transition:"width .4s" }}/>
      </div>

      {/* Card */}
      <div onClick={() => !revealed && setRevealed(true)}
        style={{ background:"white", borderRadius:16, padding:"32px 24px", minHeight:220, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", boxShadow:"0 3px 14px rgba(0,0,0,.08)", border:`1.5px solid ${C.border}`, marginBottom:16, cursor:revealed?"default":"pointer", userSelect:"none", position:"relative" }}>

        {/* Badges */}
        <div style={{ position:"absolute", top:12, left:16, display:"flex", gap:6 }}>
          <span style={{ fontSize:11, background:diffBg[card.difficulty], color:diffColor[card.difficulty], borderRadius:20, padding:"2px 10px", fontWeight:600 }}>{card.difficultyLabel}</span>
          {card.core && <span style={{ fontSize:11, background:"hsl(45,70%,90%)", color:"hsl(35,50%,32%)", borderRadius:20, padding:"2px 10px" }}>⭐ Core</span>}
        </div>
        <span style={{ position:"absolute", top:12, right:16, fontSize:11, color:C.muted }}>
          {isNew ? "New" : `Every ${interval}d`}
        </span>

        {!revealed ? (
          <div style={{ textAlign:"center" }}>
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:42, fontWeight:700, marginBottom:8 }}>{card.he}</div>
            <p style={{ color:C.muted, fontSize:13 }}>Tap to reveal</p>
          </div>
        ) : (
          <div style={{ textAlign:"center" }}>
            <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:32, fontWeight:700, marginBottom:16, color:C.muted }}>{card.he}</div>
            <div style={{ fontSize:20, color:"hsl(25,20%,25%)", lineHeight:1.55, maxWidth:400 }}>{card.en}</div>
          </div>
        )}
      </div>

      {/* Buttons */}
      {!revealed ? (
        <Btn style={{ width:"100%" }} onClick={() => setRevealed(true)}>Show Answer</Btn>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8 }}>
          {[
            [0, "Again", "hsl(0,55%,50%)", "hsl(0,60%,96%)"],
            [1, "Hard", "hsl(25,60%,50%)", "hsl(35,60%,94%)"],
            [2, "Good", "hsl(210,55%,50%)", "hsl(210,60%,94%)"],
            [3, "Easy", "hsl(142,44%,37%)", "hsl(142,40%,92%)"],
          ].map(([rating, label, color, bg]) => (
            <button key={rating} onClick={() => grade(rating)} style={{ background:bg, color, border:`1.5px solid ${color}`, borderRadius:11, padding:"12px 8px", cursor:"pointer", fontFamily:"'EB Garamond',serif", fontSize:15, fontWeight:600 }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <p style={{ textAlign:"center", fontSize:12, color:C.muted, marginTop:12 }}>
        {filteredQueue.length} card{filteredQueue.length !== 1 ? "s" : ""} remaining
      </p>
    </div>
  );
}

function TalmudHome({ student, onBack, onLogout, talmudProgress, onMastered, onVocabSave, onWordMastered, onVocabDone, onKriahDone, talmudVocab, talmudAnki, onAnkiUpdate }) {  
const [activeMasechet, setActiveMasechet] = useState(null);
const [activeDaf, setActiveDaf] = useState(null);
const [selectedMasechet, setSelectedMasechet] = useState(null);
const [dafSearch, setDafSearch] = useState("");
const [masechetSearch, setMasechetSearch] = useState("");
  const [segments, setSegments] = useState([]);
  const [loadingDaf, setLoadingDaf] = useState(false);
  const [activeSegIdx, setActiveSegIdx] = useState(null);
  const [dafTab, setDafTab] = useState("segments");
  const [homeTab, setHomeTab] = useState("learn");
  const [dafSegCounts, setDafSegCounts] = useState(() => {
  const saved = localStorage.getItem("talmud_daf_seg_counts");
  return saved ? JSON.parse(saved) : {};
});

  async function openDaf(masechet, daf) {
    setLoadingDaf(true);
    setActiveMasechet(masechet);
    setActiveDaf(daf);
    setDafTab("segments");
    const result = await loadDafText(masechet, daf);
    setSegments(result);
    setLoadingDaf(false);
    const countKey = `${masechet}_${daf}`;
setDafSegCounts(c => {
  const updated = { ...c, [countKey]: result.length };
  localStorage.setItem("talmud_daf_seg_counts", JSON.stringify(updated));
  return updated;
});
  }

  if (activeSegIdx !== null && segments[activeSegIdx]) {
    const seg = segments[activeSegIdx];
    const key = `${activeMasechet}_${activeDaf}_${activeSegIdx}`;
    return (
      <TalmudSegmentStudy
  segment={seg}
  segIdx={activeSegIdx}
  daf={activeDaf}
  masechet={activeMasechet}
  status={talmudProgress[key]}
  onMastered={() => onMastered(key)}
  onBack={() => setActiveSegIdx(null)}
  onVocabSave={(he, en) => onVocabSave(key, he, en)}
  onWordMastered={(he) => onWordMastered(key, he)}
  segVocab={talmudVocab[key] || {}}
onVocabDone={() => onVocabDone(key)}
  onKriahDone={() => onKriahDone(key)}
  onPrev={() => setActiveSegIdx(i => Math.max(0, i - 1))}
  onNext={() => setActiveSegIdx(i => Math.min(segments.length - 1, i + 1))}
  totalSegments={segments.length}
/>
    );
  }

  if (activeDaf && !loadingDaf) {
    const masteredCount = segments.filter((_, i) => talmudProgress[`${activeMasechet}_${activeDaf}_${i}`] === "mastered").length;
    return (
      <div style={{ minHeight:"100vh", background:C.bg }}>
        <style>{CSS}</style>
        <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>
          <button onClick={() => { setActiveDaf(null); setSegments([]); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.muted, fontFamily:"inherit", marginBottom:16 }}>← Back</button>
       {(() => {
  const inProgress = segments.findIndex((_, i) => {
    const key = `${activeMasechet}_${activeDaf}_${i}`;
    const st = talmudProgress[key];
    return st && !(st?.vocab && st?.kriah && st?.quiz);
  });
  if (inProgress === -1) return null;
  return (
    <div onClick={() => setActiveSegIdx(inProgress)} style={{ background:"hsl(45,70%,93%)", border:"1px solid hsl(45,50%,75%)", borderRadius:12, padding:"14px 18px", marginBottom:12, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}
      onMouseEnter={e => e.currentTarget.style.background="hsl(45,70%,88%)"}
      onMouseLeave={e => e.currentTarget.style.background="hsl(45,70%,93%)"}>
      <div>
        <div style={{ fontSize:12, color:"hsl(35,35%,45%)", marginBottom:2 }}>📍 Pick up where you left off</div>
        <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:14, fontWeight:700 }}>{segments[inProgress]?.he.split(" ").slice(0,3).join(" ")}…</div>
      </div>
      <span style={{ color:"hsl(35,35%,45%)", fontSize:18 }}>›</span>
    </div>
  );
})()}
          <div style={{ background:"white", borderRadius:12, padding:"14px 18px", boxShadow:"0 1px 3px rgba(0,0,0,.06)", marginBottom:16 }}>
            <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700, marginBottom:4 }}>{activeMasechet} · {activeDaf}</div>
            <div style={{ fontSize:13, color:C.muted }}>{masteredCount}/{segments.length} segments mastered</div>
          </div>

          <div style={{ display:"flex", width:"100%", borderBottom:`1.5px solid ${C.border}`, marginBottom:18 }}>
            {[["segments","📜 Segments"],["shakla","🤝 Shakla v'Tarya"]].map(([id, lbl]) => (
              <button key={id} className={`tab${dafTab===id?" on":""}`} onClick={() => setDafTab(id)}>{lbl}</button>
            ))}
          </div>

          {dafTab === "segments" && (
<div style={{ display:"flex", flexDirection:"column" }}>
      {segments.map((seg, i) => {
      const key = `${activeMasechet}_${activeDaf}_${i}`;
      const st = talmudProgress[key];
const isMastered = st?.vocab && st?.kriah && st?.quiz;
const inProg = (st?.vocab || st?.kriah || st?.quiz) && !isMastered;
      return (
        <div key={i} onClick={() => setActiveSegIdx(i)}
style={{ background:"white", cursor:"pointer", borderRadius:12, boxShadow:"0 1px 4px rgba(0,0,0,.07)", display:"flex", alignItems:"flex-start", gap:12, padding:"16px 18px", transition:"all .1s", border:`1.5px solid ${isMastered?C.green:inProg?C.gold:C.border}`, marginBottom:8 }}
onMouseEnter={e => e.currentTarget.style.background="hsl(35,30%,97%)"}
          onMouseLeave={e => e.currentTarget.style.background="white"}>
          <span style={{ fontSize:12, color:C.muted, minWidth:24, paddingTop:4, textAlign:"right", flexShrink:0 }}>{i+1}</span>
<p dir="rtl" style={{ fontFamily:"'Heebo',sans-serif", fontSize:17, lineHeight:2, textAlign:"right", flex:1, margin:0, fontWeight: stripNikud(seg.he).startsWith("הדרן עלך") ? 700 : 400 }}>{seg.he}</p>
        </div>
      );
    })}
  </div>
)}
          {dafTab === "shakla" && (
            <ShaklaVTarya
              segments={segments}
              progress={talmudProgress}
              masechet={activeMasechet}
              daf={activeDaf}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth:720, margin:"0 auto", padding:"28px 20px 80px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
          <div>
            <div style={{ fontSize:11, letterSpacing:4, textTransform:"uppercase", color:C.muted, marginBottom:4 }}>Kitz · תלמוד</div>
            <h1 style={{ fontFamily:"'Heebo',sans-serif", fontSize:32, fontWeight:700, lineHeight:1 }}>תלמוד בבלי</h1>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:600, fontSize:15 }}>{student.name}</div>
            <div style={{ fontSize:12, color:C.muted }}>{student.email}</div>
            <div style={{ display:"flex", gap:6, justifyContent:"flex-end", marginTop:6 }}>
              <button onClick={onBack} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:7, padding:"3px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:C.muted }}>← Subjects</button>
              <button onClick={onLogout} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:7, padding:"3px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:C.muted }}>Switch</button>
            </div>
          </div>
        </div>

        <div style={{ display:"flex", width:"100%", borderBottom:`1.5px solid ${C.border}`, marginBottom:20 }}>
          {[["learn","📜 Learn"],["anki","TalmudKI"]].map(([id, lbl]) => (
            <button key={id} className={`tab${homeTab===id?" on":""}`} onClick={() => setHomeTab(id)}>{lbl}</button>
          ))}
        </div>

        {homeTab === "anki" && (
          <TalmudAnki anki={talmudAnki} onUpdate={(he, state) => onAnkiUpdate(he, state)} />
        )}

        {homeTab === "learn" && loadingDaf && (
          <div style={{ textAlign:"center", padding:"60px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
            <div style={{ width:60, height:60, animation:"kuf-pulse 1.4s ease-in-out infinite" }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
                <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
                <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite" }} d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z" fill="hsl(45,70%,88%)"/>
                <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite 0.7s" }} d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z" fill="hsl(45,70%,88%)"/>
              </svg>
            </div>
            <p style={{ color:C.muted, fontSize:14 }}>Loading daf…</p>
          </div>
        )}
{homeTab === "learn" && !loadingDaf && !selectedMasechet && (
  <div>
    <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", background:"white", borderRadius:50, border:`1.5px solid ${C.border}`, boxShadow:"0 1px 4px rgba(0,0,0,.07)", padding:"6px 6px 6px 14px", gap:8 }}>
        <span style={{ fontSize:13, color:C.muted }}>🔍</span>
        <input
          value={masechetSearch}
          onChange={e => setMasechetSearch(e.target.value)}
          placeholder="Search masechet…"
          style={{ border:"none", outline:"none", fontFamily:"'EB Garamond',serif", fontSize:14, background:"transparent", width:160 }}
        />
      </div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:12 }}>  
      {TALMUD_TOC.filter(m => masechetSearch === "" || m.masechet.toLowerCase().includes(masechetSearch.toLowerCase()) || m.he.includes(masechetSearch)).map(m => {
      const masteredCount = Object.entries(talmudProgress)
        .filter(([k]) => k.startsWith(`${m.masechet}_`))
        .filter(([,v]) => v?.vocab && v?.kriah && v?.quiz).length;
      return (
        <div key={m.masechet} onClick={() => { setSelectedMasechet(m); setMasechetSearch(""); }}
          onMouseEnter={e => e.currentTarget.style.boxShadow="0 3px 12px rgba(0,0,0,.13)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.07)"}
style={{ background:"white", borderRadius:13, padding:"18px 12px", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,.07)", textAlign:"center", border:`1.5px solid ${C.border}`, borderTop:`4px solid ${masteredCount > 0 ? C.green : C.border}` }}>
          <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700, marginBottom:4 }}>{m.he}</div>
          <div style={{ fontSize:12, color:C.muted }}>{m.masechet}</div>   </div>
      );
    })}
</div>
  </div>
)}

{homeTab === "learn" && !loadingDaf && selectedMasechet && (
  <div>
    <button onClick={() => setSelectedMasechet(null)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.muted, fontFamily:"inherit", marginBottom:16, padding:0 }}>← All Masachtot</button>
<div style={{ background:"white", borderRadius:12, padding:"14px 18px", boxShadow:"0 1px 3px rgba(0,0,0,.06)", marginBottom:12 }}>
  <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:22, fontWeight:700 }}>{selectedMasechet.he} · {selectedMasechet.masechet}</div>
</div>
<div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
  <div style={{ display:"flex", alignItems:"center", background:"white", borderRadius:50, border:`1.5px solid ${C.border}`, boxShadow:"0 1px 4px rgba(0,0,0,.07)", padding:"6px 6px 6px 14px", gap:8 }}>
    <span style={{ fontSize:13, color:C.muted }}>🔍</span>
    <input value={dafSearch} onChange={e => setDafSearch(e.target.value)} placeholder="Daf #" style={{ border:"none", outline:"none", fontFamily:"'EB Garamond',serif", fontSize:14, background:"transparent", width:80 }} />
  </div>
</div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(100px, 1fr))", gap:10 }}>
{selectedMasechet.dafim.filter(daf => dafSearch === "" || daf.includes(dafSearch)).map(daf => {        const dafMastered = Object.entries(talmudProgress)
          .filter(([k]) => k.startsWith(`${selectedMasechet.masechet}_${daf}_`))
          .filter(([,v]) => v?.vocab && v?.kriah && v?.quiz).length;
        return (
          <div key={daf} onClick={() => openDaf(selectedMasechet.masechet, daf)}
            onMouseEnter={e => e.currentTarget.style.boxShadow="0 3px 12px rgba(0,0,0,.13)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.07)"}
            style={{
              borderRadius:13, padding:3, cursor:"pointer", transition:"all .15s",
              boxShadow:"0 1px 4px rgba(0,0,0,.07)",
              background: (() => {
                const total = dafSegCounts[`${selectedMasechet.masechet}_${daf}`] || 1;
                const deg = 360 / total;
                const stops = Array.from({ length: total }, (_, i) => {
                  const key = `${selectedMasechet.masechet}_${daf}_${i}`;
                  const status = talmudProgress[key];
                  const color = status?.vocab && status?.kriah && status?.quiz ? "hsl(142,44%,37%)" : status ? "hsl(45,70%,52%)" : "hsl(35,15%,90%)";
                  return `${color} ${i * deg}deg ${(i+1) * deg}deg`;
                });
                return `conic-gradient(from -90deg, ${stops.join(", ")})`;
              })()
            }}>
            <div style={{ background:"white", borderRadius:10, padding:"12px 6px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, minHeight:70 }}>
              <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:18, fontWeight:700, color:dafMastered>0?C.green:"hsl(25,20%,20%)" }}>{daf}</div>
              {dafMastered > 0 && <div style={{ fontSize:10, color:C.green, fontWeight:600 }}>✓ {dafMastered}</div>}
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}
      </div>
    </div>
  );
}

const TALMUD_VOCAB = [
  { he: "לא", en: "no / not", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אין", en: "yes / indeed", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "לאו", en: "no / is it not?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אי", en: "if", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "כי", en: "because / when / like", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אלא", en: "but rather / however", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "נמי", en: "also / too", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הא", en: "this / here / but!", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מן", en: "from", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "על", en: "on / about / regarding", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "עד", en: "until / up to", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "אם", en: "if / when", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "אבל", en: "but / however", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אף", en: "even / also", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "או", en: "or", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "בין", en: "between", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "כן", en: "so / thus / yes", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "כל", en: "all / every", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מה", en: "what / how", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קא", en: "present tense marker — is [doing]", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דהא", en: "since / because / for", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דאי", en: "that if / for if", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ואי", en: "and if", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "וכי", en: "and is it so? / really?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אי נמי", en: "or alternatively", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ואף", en: "and even", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "מדי", en: "from / of it", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "בי", en: "in / with (prefix form)", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "הכא", en: "here", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "התם", en: "there", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הכי", en: "so / thus / like this", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מאי", en: "what?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "האי", en: "this (Aramaic)", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הני", en: "these (Aramaic)", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מאן", en: "who? / whoever", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ליה", en: "to him / for him", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "לה", en: "to her / for her", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "להו", en: "to them / for them", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ביה", en: "in it / with it", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "בה", en: "in her / with her", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "בהו", en: "in them / with them", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "מינה", en: "from it / from her", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מיניה", en: "from him", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "גביה", en: "with him / by him / near him", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קמיה", en: "before him / in his presence", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דלא", en: "that not / without", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הכי נמי", en: "so too / likewise", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הכי קאמר", en: "this is what he means / he is saying this", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אמר", en: "said / says", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אמרי", en: "they say / it is said", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קאמר", en: "is saying / means to say", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אמר ליה", en: "said to him", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אמרינן", en: "we say / we hold", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אמרת", en: "you said / one has said", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אתא", en: "came / arrived", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אזל", en: "went / left", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "יתיב", en: "sat / was sitting", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קם", en: "stood up / arose", difficulty: 1, difficultyLabel: "Beginner", core: false },
  { he: "בעי", en: "wants / asks / needs", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "בעינן", en: "we need / it requires", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "נפק", en: "went out / exited", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "עאל", en: "entered / went in", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "חזא", en: "saw", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "חזי", en: "sees / fitting / appropriate", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "שמע", en: "heard / listened", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ידע", en: "knows / knew", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "שאל", en: "asked", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אתי", en: "comes / comes to", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הוי", en: "it is / becomes / is called", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הוה", en: "was / existed (past)", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הוו", en: "they were / there were", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הוה ליה", en: "he had / he should have", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קרי", en: "calls / reads / is called", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "נקט", en: "holds / takes / grasps", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "נקטינן", en: "we hold / we take as given", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "פסק", en: "ruled / decided", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תניא", en: "it was taught — introduces a Baraita", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תנו רבנן", en: "the Rabbis taught — introduces Baraita", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תנא", en: "a Tanna / one who taught", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מתני", en: "our Mishnah / it was taught", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "גמרא", en: "Gemara / the Talmudic discussion", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הלכה", en: "Jewish law / the ruling", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מחלוקת", en: "dispute / disagreement", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "פליגי", en: "they disagree / dispute", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דתניא", en: "as it was taught in a Baraita", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דתנן", en: "as we learned in the Mishnah", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "כתיב", en: "it is written", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דכתיב", en: "as it is written", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "שנאמר", en: "as it is said", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קרא", en: "a verse / scripture", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "סברא", en: "logical reasoning / common sense", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "משנה", en: "Mishnah", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "ברייתא", en: "Baraita — a teaching not in the Mishnah", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תא שמע", en: "come and hear — introduces a proof", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "שמע מינה", en: "learn from this / conclude from this", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קשיא", en: "this is difficult / there is a contradiction", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תיובתא", en: "a refutation / definitive disproof", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "היינו", en: "that is / that is the same as", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "כלומר", en: "that is to say / meaning", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "דהיינו", en: "that is / namely", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "בשלמא", en: "it is understandable / granted that", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אימא", en: "say / one might say", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "לימא", en: "let us say / shall we say", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מהו", en: "what is it? / what is the ruling?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "אלא מאי", en: "but what then? / so what do you say?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מאי קאמר", en: "what is he saying?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "הוי אמינא", en: "I would have thought", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "היכי דמי", en: "what is the case exactly? / how does this apply?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מאי טעמא", en: "what is the reason?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מנא לן", en: "from where do we know this?", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "תא חזי", en: "come and see — introduces an observation", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קא פריך", en: "he is asking / raising a difficulty", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "קא משמע לן", en: "it teaches us / comes to inform us", difficulty: 1, difficultyLabel: "Beginner", core: true },
  { he: "מיתיבי", en: "they challenged / raised an objection from a Baraita", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מותיב", en: "he objected / he challenged", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "פריך", en: "he asks / raises a difficulty", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "משני", en: "he answers / differentiates", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אוקמה", en: "he established it / interpreted it as referring to", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "דחי", en: "he rejected / pushed aside the argument", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תריץ", en: "answer! / resolve this difficulty", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "שני", en: "it is different / differentiate", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "קסבר", en: "he holds / maintains the view that", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "סבר", en: "he thinks / holds the opinion", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "סבירא", en: "it seems / one might think", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "פשיטא", en: "it is obvious! / of course!", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מיבעיא", en: "is there a question? / it is needed", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "קתני", en: "it teaches / the Mishnah states", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "קתני מיהת", en: "it teaches at least / it states at minimum", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "רמי", en: "he raised a contradiction / he posed a challenge", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "רמינהו", en: "let us contrast them / they contradict each other", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אוקי", en: "establish / interpret as", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מוקי", en: "he establishes / he interprets as", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מוקמינן", en: "we establish / we interpret it as", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אסיק", en: "concluded / raised / brought up", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אסיק אדעתיה", en: "it occurred to him / he realized", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "נפקא מינה", en: "the practical difference is / it matters for", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "פלוגתא", en: "a dispute / point of disagreement", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "איפלגו", en: "they disputed / they disagreed", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תנאי היא", en: "it is a dispute among Tannaim", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "קים להו", en: "they established / they knew with certainty", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "משמע", en: "implies / we infer / it sounds like", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "טעמא", en: "the reason / the rationale", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "טעמא מאי", en: "what is the reason?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כיון", en: "since / because / once", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "שאני", en: "it is different / this is a special case", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "דמי", en: "resembles / is like / is comparable to", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לא דמי", en: "it is not comparable / not similar", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "היכי", en: "how? / in what way?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "היכא", en: "where?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מכאן", en: "from here / from this", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אשכחן", en: "we find / we have found", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "ממאי", en: "from what? / how do we know?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אמר קרא", en: "the verse says / Scripture states", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תלמוד לומר", en: "the Torah teaches / Scripture comes to say", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לא צריכא", en: "it is not needed / unnecessary to state", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "צריכא", en: "it is needed / necessary", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "איצטריך", en: "it was needed / had to be stated", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מילי", en: "matters / words / things", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "הני מילי", en: "these matters apply only when / this is only when", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מילתא", en: "a matter / a thing / a word", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מילתא דפשיטא", en: "an obvious matter", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מסתברא", en: "it is reasonable / it makes sense", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "הכי נמי מסתברא", en: "so too it is reasonable / this seems correct", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תדע", en: "know this — introducing a proof", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מדקאמר", en: "from the fact that he said", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מדינא", en: "strictly / legally / by law", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מהיכא תיתי", en: "from where would that come? / what is the basis?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לא קשיא", en: "it is not difficult / there is no contradiction", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לא קשיא כאן", en: "it is not difficult — here it refers to", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "הא מני", en: "this — whose opinion is it?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כמאן", en: "like whom? / according to whose opinion?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "למאן", en: "to whom? / according to whom?", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מאן דאמר", en: "the one who says / whoever holds", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "איכא", en: "there is / there are", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "ליכא", en: "there is not / there are not", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אסור", en: "forbidden / prohibited", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מותר", en: "permitted / allowed", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "חייב", en: "obligated / liable", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "פטור", en: "exempt / not liable", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כשר", en: "valid / fit / kosher", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "פסול", en: "invalid / disqualified", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "ספק", en: "doubt / uncertainty", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "ודאי", en: "certainly / definitely", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "בדיעבד", en: "after the fact / ex post facto", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לכתחילה", en: "ideally / from the outset", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "דרבנן", en: "of Rabbinic origin", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "דאורייתא", en: "of Biblical / Torah origin", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "גזרה", en: "a Rabbinic decree", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תקנה", en: "a Rabbinic enactment", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אסמכתא", en: "a Biblical support — not the primary source", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מצוה", en: "commandment / mitzvah", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "עבירה", en: "transgression / sin", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "חובה", en: "obligation / liability / duty", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מותבינן", en: "we challenge / we raise an objection", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "בטל", en: "nullified / annulled / void", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "אסיר", en: "forbidden (Aramaic form)", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "שרי", en: "permitted (Aramaic)", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כד", en: "when / while (Aramaic)", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כי אתא", en: "when he came", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "כי הוה", en: "when he was / when there was", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "מעיקרא", en: "originally / from the beginning / at first", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "לבסוף", en: "in the end / finally", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "בתר הכי", en: "after this / thereafter (Aramaic)", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "השתא", en: "now / at this moment", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "תדיר", en: "regularly / always / frequent", difficulty: 2, difficultyLabel: "Intermediate", core: true },
  { he: "איבעיא להו", en: "they asked / it was asked — introduces unresolved question", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "בעי מיניה", en: "he asked him / posed the question to him", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "שקלא וטריא", en: "give and take / the back-and-forth of Talmudic debate", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "תיקו", en: "the question stands unresolved", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אכתי", en: "still / yet / even now", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אדרבה", en: "on the contrary!", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מיהו", en: "however / but / nevertheless", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מיהת", en: "at least / in any case / however", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מכל מקום", en: "in any case / nevertheless", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אף על גב", en: "even though / despite", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לאו דוקא", en: "not precisely / not exactly", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "דוקא", en: "precisely / specifically / exactly", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לעולם", en: "always / I will maintain — introducing a sustained position", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "בעלמא", en: "merely / just / in general / simply", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אית ליה", en: "he holds the opinion / he has this view", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לית ליה", en: "he does not hold / he does not have this view", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "סבירא ליה", en: "he holds the opinion / he thinks", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "קא סבר", en: "he holds / maintains — present tense", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "ודחינן", en: "and we reject / we push aside", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לעולם אימא לך", en: "I will always say to you / my position remains", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "הוה אמינא", en: "I would have thought / one might think", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "ותסברא", en: "and do you really think? / can you reason that?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "ואזדו לטעמייהו", en: "and they follow their own reasoning / consistent with their view", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אזדא לטעמיה", en: "he follows his own reasoning / consistent with his view", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לטעמיה", en: "according to his reasoning / following his logic", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "פירכא", en: "a logical objection / a refutation", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "הדרא קושיא לדוכתא", en: "the question returns to its place — still unanswered", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מאי הוי עלה", en: "what was the conclusion? / what happened with it?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מי איכא", en: "is there? / does there exist?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מי אמרינן", en: "do we say? / do we hold?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מי סברת", en: "do you think? / do you hold?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אי הכי", en: "if so / if that is the case", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אי הכי מאי", en: "if so, what then?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אי לא תימא הכי", en: "if you do not say so / if you reject this", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לא תימא", en: "do not say / do not think", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "קל וחומר", en: "a fortiori — if X then certainly Y", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "גזרה שוה", en: "verbal analogy — equal expression hermeneutical rule", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "כלל ופרט", en: "general and specific — hermeneutical rule", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "הקיש", en: "comparison / analogy drawn from juxtaposition in Torah", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "ריבוי ומיעוט", en: "inclusion and exclusion — hermeneutical rule", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "בנין אב", en: "paradigm case — establishing a rule from one case", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "חזקה", en: "presumption / established status / legal assumption", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מיגו", en: "since he could have claimed — a credibility argument", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "אומדנא", en: "assessment / inference / presumed intent", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "ברירה", en: "retroactive clarification / selection after the fact", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "מוקצה", en: "set aside / designated — item forbidden on Shabbat", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "הא בהא תליא", en: "this depends on that / they are interconnected", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "לאו הכי נמי", en: "is it not so? / is this not also the case?", difficulty: 3, difficultyLabel: "Advanced", core: true },
  { he: "הא קא משמע לן", en: "this is what it teaches us", difficulty: 3, difficultyLabel: "Advanced", core: true },
];


// ── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
const [student, setStudent]           = useState(null);
const savedNav = JSON.parse(localStorage.getItem("ksa_nav") || "null");
const [view, setView]                 = useState("home");
const [activeSeif, setActiveSeif]     = useState(0);
const [activeSiman, setActiveSiman]   = useState(null);
const [allProgress, setAllProgress]   = useState({});
const [allVocab, setAllVocab]         = useState({});
const [allChecked, setAllChecked]     = useState({});
const [allScores, setAllScores]       = useState({});
const [subject, setSubject] = useState(null);
const [returnToSiman, setReturnToSiman] = useState(false);
const [talmudProgress, setTalmudProgress] = useState({});
const [talmudVocab, setTalmudVocab] = useState({});
const [talmudAnki, setTalmudAnki] = useState({});
const [tocLoaded, setTocLoaded]       = useState(false);
const [toc, setToc]                   = useState([]);
const [seifCounts, setSeifCounts] = useState(() => {
  const counts = {};
  for (let i = 1; i <= 221; i++) {
    const stored = localStorage.getItem(`ksa_seifcount_${i}`);
    if (stored) counts[i] = parseInt(stored);
  }
  return counts;
});

const seifProgress = allProgress[activeSiman] || {};
const vocabChecked = allChecked[activeSiman] || {};
const quizScores   = allScores[activeSiman] || {};
// Flatten per-seif vocab for the global FlashDeck
const flatVocab = Object.values(allVocab[activeSiman] || {}).reduce((acc, seifWords) => {
  Object.entries(seifWords || {}).forEach(([key, val]) => {
    acc[key] = typeof val === "object" ? val.en : val;
  });
  return acc;
}, {});

useEffect(() => { if (returnToSiman) setReturnToSiman(false); }, [returnToSiman]);

useEffect(() => {
  loadTOC().then(t => setToc(t));
}, []);
useEffect(() => {
  if (activeSiman) loadSimanText(activeSiman);
}, [activeSiman]);
useEffect(() => {
  if (view === "seif" && activeSiman && activeSeif !== null) {
    localStorage.setItem("ksa_nav", JSON.stringify({ view, activeSiman, activeSeif }));
  } else {
    localStorage.removeItem("ksa_nav");
  }
}, [view, activeSiman, activeSeif]);

useEffect(() => {
  const unsub = onAuthStateChanged(auth, async user => {
    if (user) {
      const data = await loadStudent(user.email);
      if (data) {
        setStudent(data);
       setAllProgress(data.allProgress || {});
setAllVocab(data.allVocab || {});
setAllChecked(data.allChecked || {});
setAllScores(data.allScores || {});
setTalmudAnki(data.talmudAnki || {});
setTalmudProgress(data.talmudProgress || {});
setTalmudVocab(data.talmudVocab || {});
      }
    }
    setTocLoaded(true);
  });
  return () => unsub();
}, []);
async function load(profile) {
  setStudent(profile);
  const data = await loadStudent(profile.email);
  if (data) {
setAllProgress(data.allProgress || {});
setAllVocab(data.allVocab || {});
setAllChecked(data.allChecked || {});
setAllScores(data.allScores || {});
setTalmudAnki(data.talmudAnki || {});
setTalmudProgress(data.talmudProgress || {});
setTalmudVocab(data.talmudVocab || {});
  }
}

  const saveTimeout = useCallback((() => {
    let timer = null;
    return (email, data) => {
      clearTimeout(timer);
      timer = setTimeout(() => saveStudent(email, data), 1500);
    };
  })(), []);

useEffect(() => {
  if (!student) return;
saveTimeout(student.email, { name: student.name, email: student.email, allProgress, allVocab, allChecked, allScores, talmudAnki, talmudProgress, talmudVocab });
}, [student, allProgress, allVocab, allChecked, allScores, talmudAnki, talmudProgress, talmudVocab, saveTimeout]);
function logout() {
  signOut(auth);
  setStudent(null);
  setAllProgress({}); setAllVocab({});
  setAllChecked({}); setAllScores({});
  setActiveSiman(null); setView("home");
}

async function openSiman(simanNum) {
  await loadSimanText(simanNum);
  setActiveSiman(simanNum);
  setSeifCounts(c => ({ ...c, [simanNum]: SEIFIM.length }));
  localStorage.setItem(`ksa_seifcount_${simanNum}`, SEIFIM.length);
  setReturnToSiman(false);
}

function openSeif(i) {
  setActiveSeif(i);
  setAllProgress(p => ({ ...p, [activeSiman]: { ...p[activeSiman], [i]: p[activeSiman]?.[i] || "reading" }}));
  setView("seif");
}

function handleMastered() {
  setAllProgress(p => ({ ...p, [activeSiman]: { ...p[activeSiman], [activeSeif]: "mastered" }}));
  setReturnToSiman(true);
  setView("home");
}

function handleVocabDone() {
  setAllVocab(v => {
    const simanData = { ...(v[activeSiman] || {}) };
    simanData[activeSeif] = {};
    return { ...v, [activeSiman]: simanData };
  });
  setAllProgress(p => ({ ...p, [activeSiman]: { ...p[activeSiman], [activeSeif]: p[activeSiman]?.[activeSeif] === "mastered" ? "mastered" : "vocab_done" }}));
}

function handleQuizScore(idx, pct) {
  setAllScores(s => ({ ...s, [activeSiman]: { ...s[activeSiman], [idx]: [...(s[activeSiman]?.[idx] || []), { pct, date: new Date().toLocaleDateString() }].slice(-10) }}));
}

if (!tocLoaded) return (
  <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
    <style>{CSS}
      {`
        @keyframes kuf-pulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.1); opacity: 0.75; }
        }
        @keyframes kuf-draw {
          0%,100% { opacity: 0.35; }
          50%     { opacity: 1; }
        }
      `}
    </style>
    <div style={{ width:80, height:80, animation:"kuf-pulse 1.4s ease-in-out infinite" }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width:"100%", height:"100%" }}>
        <rect width="100" height="100" rx="20" fill="hsl(25,45%,33%)"/>
        <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite" }}
          d="M26,23 Q26,16 33,16 L70,16 Q77,16 77,23 Q77,30 70,30 L70,50 Q70,56 65,56 Q60,56 60,50 L60,30 L33,30 Q26,30 26,23 Z"
          fill="hsl(45,70%,88%)"/>
        <path style={{ animation:"kuf-draw 1.4s ease-in-out infinite 0.7s" }}
          d="M31,44 Q31,40 36,40 L40,40 Q45,40 45,44 L45,80 Q45,84 40,84 L36,84 Q31,84 31,80 Z"
          fill="hsl(45,70%,88%)"/>
      </svg>
    </div>
    <div style={{ fontFamily:"'Heebo',sans-serif", fontSize:15, color:C.muted, letterSpacing:1 }}>Loading…</div>
  </div>
);
if (!student) return <Login onLogin={load} />;
if (!subject) return <SubjectSelector student={student} onSelect={setSubject} onLogout={logout} />;
if (subject === "talmud") return (
  <TalmudHome
    student={student}
    onBack={() => setSubject(null)}
    onLogout={logout}
    talmudProgress={talmudProgress}
    talmudVocab={talmudVocab}
    onVocabSave={(key, he, en) => setTalmudVocab(v => ({ ...v, [key]: { ...(v[key]||{}), [he]: { he, en } } }))}
    onWordMastered={(key, he) => setTalmudVocab(v => { const k = { ...(v[key]||{}) }; delete k[he]; return { ...v, [key]: k }; })}
onVocabDone={(key) => setTalmudProgress(p => ({ ...p, [key]: { ...(p[key]||{}), vocab: true } }))}
onKriahDone={(key) => setTalmudProgress(p => ({ ...p, [key]: { ...(p[key]||{}), kriah: true } }))}
onMastered={(key) => setTalmudProgress(p => ({ ...p, [key]: { ...(p[key]||{}), quiz: true } }))}
    talmudAnki={talmudAnki}
onAnkiUpdate={(he, state) => setTalmudAnki(a => ({ ...a, [he]: state }))}
  />
);
if (view === "seif") return (
 <SeifStudy
  seifIdx={activeSeif}
  activeSiman={activeSiman}
  status={seifProgress[activeSeif]}
  onMastered={handleMastered}
  onBack={() => { setReturnToSiman(true); setView("home"); }}
onVocabSave={(he, en, ctx) => setAllVocab(v => {
  const key = stripNikud(he);
  const simanData = v[activeSiman] || {};
  const seifData = simanData[activeSeif] || {};
  return { ...v, [activeSiman]: { ...simanData, [activeSeif]: { ...seifData, [key]: { he, en, ctx: ctx || "" } }}};
})}
  onVocabDone={handleVocabDone}
onWordMastered={key => setAllVocab(v => {
    const simanData = { ...(v[activeSiman] || {}) };
    const seifData = { ...(simanData[activeSeif] || {}) };
    delete seifData[key];
    return { ...v, [activeSiman]: { ...simanData, [activeSeif]: seifData }};
  })}
simanVocab={allVocab[activeSiman] || {}}
  quizScores={quizScores}
  onQuizScore={handleQuizScore}
/>
  );
return (
<Home
    student={student} seifProgress={seifProgress}
onOpen={openSeif} onLogout={logout} onBack={() => setSubject(null)}
    vocab={flatVocab} checked={vocabChecked}
    onCheck={he => setAllChecked(c => ({ ...c, [activeSiman]: { ...c[activeSiman], [he]: true }}))}
    returnToSiman={returnToSiman}
    toc={toc}
    activeSiman={activeSiman}
    onOpenSiman={openSiman}
    allProgress={allProgress}
    seifCounts={seifCounts}
  />
);
}
