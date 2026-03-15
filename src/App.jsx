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
      model: "claude-sonnet-4-20250514",
      max_tokens: max,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const d = await r.json();
  return d.content[0].text;
}

async function callWhisper(audioBlob, language = null) {
  if (language === "he") {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    const r = await fetch("https://ksa-app-production.up.railway.app/api/soniox-he", {
      method: "POST",
      body: formData
    });
    const d = await r.json();
    console.log("soniox response:", JSON.stringify(d));
    return d.text || "";
  }
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
      `Correct answer: "${correctAnswer}"\nStudent answer: "${userAnswer}"\n\nIs the student's answer correct, close (synonymous/same meaning), or wrong? Reply with exactly one word: correct, close, or wrong.`,
      "You are grading a Hebrew vocabulary quiz. Be generous with synonyms and paraphrases. Reply with only one word: correct, close, or wrong.",
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
    <Btn bg={C.green} style={{ width:"100%", marginBottom:10 }} onClick={onDone}>Go to Content Quiz →</Btn>
<Btn style={{ width:"100%" }} onClick={onBack}>← Back to Seif</Btn>
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
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
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
  }, [seifIdx, retryKey]);

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
  const [heResponse, enResponse] = await Promise.all([
    callClaude(
`A student read this Hebrew text aloud and translated into English as they went.\n\nExpected Hebrew text: "${heText}"\nSoniox Hebrew transcript: "${heTranscript}"\n\nCompare ONLY the Hebrew words in the transcript against the expected text. Completely ignore any English words that appear — the student was translating as they read and some English may bleed through.\n\nIMPORTANT: Accept all phonetic variants — sin/shin, alef/ayin, kaf/kuf, tet/tav, vav/bet confusion and spacing differences are all fine. Only penalize for words with clearly different roots or large sections that are entirely missing.\n\nA fluent reader who reads all words correctly should score 85-95%. Only deduct for genuinely wrong or skipped words.\n\nCOVERAGE RULE: If fewer than half the Hebrew words appear, cap at 50%.\n\nRespond ONLY in this exact format:\nSCORE: [0-100]\nFEEDBACK: [one encouraging sentence noting what was good and what to improve]`,
"You are a generous Hebrew teacher grading oral Hebrew reading. The transcript is Hebrew-only from a dedicated Hebrew transcription service. Grade on coverage and root accuracy only. Accept all phonetic variants. A student who reads everything correctly scores 85+. Reply ONLY in the exact format specified.",
      300
    ),
    callClaude(
      `A student read a Hebrew text aloud and translated it into English as they went.\n\nExpected English translation: "${enText}"\nStudent's English (extracted from transcript): "${enTranscript}"\n\nGrade ONLY the English translation accuracy. Be generous — this is an oral assessment by a fluent student. Award high marks if the core meaning and key concepts are conveyed, even if the wording differs. Only penalize for clearly wrong or missing concepts.\n\nCOVERAGE RULE: If the student clearly only translated part of the text, cap the score at 50%.\n\nRespond ONLY in this exact format:\nSCORE: [0-100]\nFEEDBACK: [one encouraging sentence noting what was good and what to improve]`,
      "You are a very generous Hebrew teacher grading an oral English translation. There are many valid ways to translate Hebrew — grade on meaning, not exact wording. A fluent student who conveys the correct meaning in natural English should score 70%. Only deduct points for genuinely wrong or missing concepts, not for different but valid phrasings. Reply ONLY in the exact format specified.",
      150
    )
  ]);

  const heScore = parseInt(heResponse.match(/SCORE:\s*(\d+)/)?.[1] || 0);
  const heFeedback = heResponse.match(/FEEDBACK:\s*(.+)/)?.[1] || "";
  const enScore = parseInt(enResponse.match(/SCORE:\s*(\d+)/)?.[1] || 0);
  const enFeedback = enResponse.match(/FEEDBACK:\s*(.+)/)?.[1] || "";

return { heScore, heFeedback, enScore, enFeedback, passed: heScore >= 70 && enScore >= 70 };
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
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
      <div style={{ textAlign:"center", padding:"14px", background:"hsl(35,30%,97%)", borderRadius:10 }}>
        <div style={{ fontSize:11, color:C.muted, letterSpacing:1, marginBottom:4 }}>HEBREW READING</div>
        <div style={{ fontSize:36, fontWeight:700, color:result.heScore>=70?C.green:C.red }}>{result.heScore}%</div>
        <p style={{ fontSize:12, color:C.muted, marginTop:6, fontStyle:"italic", lineHeight:1.4 }}>{result.heFeedback}</p>
      </div>
      <div style={{ textAlign:"center", padding:"14px", background:"hsl(35,30%,97%)", borderRadius:10 }}>
        <div style={{ fontSize:11, color:C.muted, letterSpacing:1, marginBottom:4 }}>ENGLISH TRANSLATION</div>
        <div style={{ fontSize:36, fontWeight:700, color:result.enScore>=70?C.green:C.red }}>{result.enScore}%</div>
        <p style={{ fontSize:12, color:C.muted, marginTop:6, fontStyle:"italic", lineHeight:1.4 }}>{result.enFeedback}</p>
      </div>
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
  `Context (do not translate): "${seif.he}"\n\nTranslate the word "${raw}" as it is used in that context. Reply with ONLY the English translation of that specific word, 1-4 words, nothing else. Don't include translations of the surrounding words that are used to establish context.`,
  "You are a Hebrew translator. Reply with ONLY the English translation. No labels, no punctuation, no explanation, no Hebrew.", 40
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
function Home({ student, seifProgress, onOpen, onLogout, vocab, checked, onCheck, returnToSiman, toc, activeSiman, onOpenSiman, allProgress, seifCounts }) {
  const [simanOpen, setSimanOpen] = useState(returnToSiman);
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
            <div style={{ fontSize:11,letterSpacing:4,textTransform:"uppercase",color:C.muted,marginBottom:4 }}>Judaic Studies · Fluency</div>
            <h1 style={{ fontFamily:"'Heebo',sans-serif",fontSize:32,fontWeight:700,lineHeight:1 }}>קיצור שולחן ערוך</h1>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:600,fontSize:15 }}>{student.name}</div>
            <div style={{ fontSize:12,color:C.muted }}>{student.email}</div>
            <div style={{ display:"flex",gap:6,justifyContent:"flex-end",marginTop:6 }}>
              <button onClick={onLogout} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.muted }}>Switch</button>
            </div>
          </div>
        </div>

        {/* Siman list — for now just one */}
        {!simanOpen ? (
  <div>
<p style={{ fontSize:13,color:C.muted,marginBottom:12,letterSpacing:2,textTransform:"uppercase" }}>Select a Siman</p>
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
                  const unlocked = i === 0 || seifProgress[i-1] === "mastered";
                  const isMastered = st === "mastered";
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
// ── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState("email");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");

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
        <h2 style={{ fontFamily:"'Heebo',sans-serif",fontSize:26,fontWeight:700,marginBottom:4 }}>קיצור שולחן ערוך</h2>
        <p style={{ color:C.muted,fontSize:15,marginBottom:26 }}>Fluency Trainer</p>

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
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Password" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:12,textAlign:"center" }} autoFocus />
          {err && <p style={{ color:C.red,fontSize:13,marginBottom:8 }}>{err}</p>}
          <Btn style={{ width:"100%" }} bg={C.green} onClick={login} disabled={!password.trim() || checking}>{checking ? "Signing in…" : "Sign In →"}</Btn>
          <button onClick={() => { setStep("email"); setErr(""); }} style={{ background:"none",border:"none",cursor:"pointer",marginTop:10,color:C.muted,fontFamily:"inherit",fontSize:13 }}>← Back</button>
        </>}

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
const [returnToSiman, setReturnToSiman] = useState(false);
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
  saveTimeout(student.email, { name: student.name, email: student.email, allProgress, allVocab, allChecked, allScores });
}, [student, allProgress, allVocab, allChecked, allScores, saveTimeout]);

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
onOpen={openSeif} onLogout={logout}
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
