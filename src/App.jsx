import { useState, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, collection, onSnapshot } from "firebase/firestore";

const TEACHER_PASSWORD = "rebbe2025";

async function callClaude(user, system, max = 400) {
  const r = await fetch("http://localhost:3001/api/claude", {
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

function stripNikud(s) {
  return s.replace(/[\u0591-\u05C7]/g, "").replace(/[^\u05D0-\u05EA\s]/g, "").trim();
}

const PHRASES = [
  { he: "מִכָּל מָקוֹם", stripped: "מכל מקום", en: "nevertheless / in any case" },
  { he: "אַף עַל פִּי שֶׁ", stripped: "אף על פי ש", en: "even though" },
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

const SEIFIM = [
  { he:"צָרִיךְ לִזָּהֵר מְאֹד שֶׁלֹּא לְהוֹנוֹת אֶת חֲבֵרוֹ. וְכֹל הַמְאַנֶּה אֶת חֲבֵרוֹ, בֵּין שֶׁהַמּוֹכֵר מְאַנֶּה אֶת הַלּוֹקֵחַ, בֵּין שֶׁהַלּוֹקֵחַ מְאַנֶּה אֶת הַמּוֹכֵר, עוֹבֵר בְּלָאו, שֶׁנֶּאֱמַר, וְכִי תִמְכְּרוּ מִמְכָּר לַעֲמִיתֶךָ אוֹ קָנֹה מִיַּד עֲמִיתֶךָ אַל תּוֹנוּ אִישׁ אֶת אָחִיו. וְהִיא הַשְׁאֵלָה הָרִאשׁוֹנָה שֶׁשּׁוֹאֲלִין אֶת הָאָדָם בְּשָׁעָה שֶׁמַּכְנִיסִין אוֹתוֹ לַדִּין, נָשָׂאתָ וְנָתַתָּ בֶּאֱמוּנָה.", en:"You should be extremely careful not to deceive your fellow man. Anyone who deceives his fellow — whether a seller deceives a buyer, or a buyer deceives a seller — transgresses a negative commandment, as it is said: \"When you sell something to your neighbor, or buy from your neighbor, do not deceive one another.\" The first question a person is asked when brought before the Heavenly Court is: \"Have you always been honest in your dealings?\"" },
  { he:"כְּשֵׁם שֶׁיֵּשׁ אִסּוּר אוֹנָאָה בְּמַשָּׂא וּמַתָּן, כָּךְ יֵשׁ אִסּוּר אוֹנָאָה בִּשְׂכִירוּת וּבְקַבְּלָנוּת וּבְחִילּוּף מַטְבֵּעַ.", en:"Just as deception is forbidden in buying and selling, so is it forbidden in hiring, in working on contract, and in money changing." },
  { he:"הַנּוֹשֵׂא וְנוֹתֵן בֶּאֱמוּנָה, אֵינוֹ חוֹשֵׁשׁ לְאוֹנָאָה. כֵּיצַד. חֵפֶץ זֶה בְּכָךְ וְכָךְ לְקַחְתִּיו, כָּךְ וְכָךְ אֲנִי רוֹצֶה לְהִשְׂתַּכֵּר בּוֹ, אַף עַל פִּי שֶׁהוּא נִתְאַנָּה בִּלְקִיחָתוֹ, וְכָל הַמִּתְאַנֶּה אֵינוֹ רַשַּׁאי לְהוֹנוֹת אֲחֵרִים בִּשְׁבִיל זֶה, מִכָּל מָקוֹם זֶה מֻתָּר, שֶׁהֲרֵי זֶה כִּמְפָרֵשׁ לוֹ, שֶׁלֹּא יִסְמֹךְ עַל שְׁוִי הַמִּקָּח אֶלָּא עַל הַדָּמִים שֶׁנָּתַן הוּא בַּעֲדוֹ.", en:"If a person is candid in his dealings, he will not be guilty of deception. For example: \"I bought this article at such-and-such a price and I want to make a profit of so much.\" Even though he overpaid when he bought it, and being deceived does not entitle one to deceive others, this is nevertheless permitted — because his statement makes clear to the buyer that the price is not based on market value but on what the seller actually paid." },
  { he:"מִי שֶׁיֶּשׁ לוֹ אֵיזֶה דָּבָר לִמְכּוֹר, אָסוּר לוֹ לְיַפּוֹתוֹ כְּדֵי לְרַמּוֹת בּוֹ, כְּגוֹן לְהַשְׁקוֹת בְּהֵמָה מֵי סֻבִּין שֶׁמְּנַפְּחִין וְזוֹקְפִין שַׂעֲרוֹתֶיהָ כְּדֵי שֶׁתֵּרָאֶה שְׁמֵנָה, אוֹ לִצְבּוֹעַ כֵּלִים יְשָׁנִים כְּדֵי שֶׁיִּתְרָאוּ כַּחֲדָשִׁים, וְכָל כַּיּוֹצֵא בָּזֶה.", en:"If a person has something to sell, he is forbidden to make it look better than it really is in order to mislead the buyer. Examples: giving an animal bran-water to drink to make it swell up and look fat and healthy, or painting old utensils to make them look new. All similar deceptive practices are forbidden." },
  { he:"וְכֵן אָסוּר לְעָרֵב מְעַט פֵּרוֹת רָעִים בְּהַרְבֵּה פֵּרוֹת יָפִים כְּדֵי לְמָכְרָם בְּחֶזְקַת יָפִים, אוֹ לְעָרֵב מַשְׁקֶה רַע בְּיָפֶה. וְאִם הָיָה טַעְמוֹ נִכָּר, מֻתָּר לְעָרֵב, כִּי הַלּוֹקֵחַ יַרְגִּישׁ.", en:"Likewise, it is forbidden to mix a little bad fruit with a lot of good fruit and sell them all as good, or to mix a low-grade beverage with a better grade. But if the taste of the blended beverage can easily be detected, mixing is permitted, because the buyer will notice it." },
  { he:"מֻתָּר לְחֶנְוָנִי לְחַלֵּק קְלָיוֹת וֶאֱגוֹזִים לְתִינוֹקוֹת, כְּדֵי לְהַרְגִּילָם שֶׁיִּקְנוּ מִמֶּנּוּ. וְכֵן יָכוֹל לִמְכּוֹר בְּזוֹל יוֹתֵר מֵהַשַּׁעַר, כְּדֵי שֶׁיִּקְנוּ מִמֶּנּוּ, וְאֵין בְּנֵי הַשּׁוּק יְכוֹלִין לְעַכֵּב עָלָיו.", en:"A shopkeeper is permitted to distribute roasted kernels and nuts to children to get them into the habit of buying from him. He may also sell below the market price to attract customers, and the other merchants cannot prevent him from doing so." },
  { he:"הַמּוֹדֵד אוֹ שׁוֹקֵל חָסֵר לַחֲבֵרוֹ אוֹ אֲפִילוּ לַנָּכְרִי, עוֹבֵר בְּלָאו, שֶׁנֶּאֱמַר, לֹא תַעֲשׂוּ עָוֶל בַּמִּדָּה בַּמִּשְׁקָל וּבַמְּשׂוּרָה. וְעֹנֶשׁ הַמִּדּוֹת וְהַמִּשְׁקָלוֹת קָשֶׁה מְאֹד, שֶׁאִי אֶפְשָׁר לְמוֹדֵד אוֹ לְשׁוֹקֵל שֶׁקֶר לָשׁוּב בִּתְשׁוּבָה הֲגוּנָה, שֶׁאֵינוֹ יוֹדֵעַ מַה וּלְמִי יָשִׁיב.", en:"Anyone who gives short measure or weight, even to a non-Jew, transgresses a negative commandment, as it is said: \"Do not falsify measurements, whether in length, weight, or volume.\" The punishment is very severe, because it is impossible to repent properly — the offender does not know how much he owes or whom to compensate." },
  { he:"כְּתִיב, לֹא יִהְיֶה לְךָ בְּכִיסְךָ אֶבֶן וָאָבֶן גְּדוֹלָה וּקְטַנָּה, לֹא יִהְיֶה לְךָ בְּבֵיתְךָ אֵיפָה וְאֵיפָה גְּדוֹלָה וּקְטַנָּה. וְדָרְשׁוּ רַבּוֹתֵינוּ זִכְרוֹנָם לִבְרָכָה: לֹא יִהְיֶה לְךָ בְּכִיסְךָ מָמוֹן, מִשּׁוּם אֶבֶן וָאָבֶן. אֲבָל אֶבֶן שְׁלֵמָה וָצֶדֶק אִם יִהְיוּ בְּבֵיתְךָ, יִהְיֶה לְךָ מָמוֹן. מַה יַּעֲשֶׂה אָדָם וְיִתְעַשֵּׁר? יִשָּׂא וְיִתֵּן בֶּאֱמוּנָה, וִיְבַקֵּשׁ רַחֲמִים מִמִּי שֶׁהָעֹשֶׁר שֶׁלּוֹ.", en:"It is written: \"You must not keep two different weights in your bag, or two different measures in your house.\" Our Sages explained: you will lack money because of dishonest weights — but if you have full, just weights in your house, you will have money. What should a person do to become rich? Conduct business honestly and pray to the One to Whom all wealth belongs." },
  { he:"צָרִיךְ לִמְדּוֹד וְלִשְׁקוֹל בְּעַיִן יָפָה, שֶׁיִּהְיֶה עוֹדֵף עַל הַמִּדָּה, שֶׁנֶּאֱמַר, אֵיפָה שְׁלֵמָה וָצֶדֶק יִהְיֶה לָּךְ. מַה תַּלְמוּד לוֹמַר וָצֶדֶק? אָמְרָה תוֹרָה, צַדֵּק מִשֶּׁלְּךָ וְתֵן לוֹ.", en:"You should measure and weigh generously — give slightly more than the exact quantity, as it is said: \"You must have a full, just measure.\" What does the word 'just' imply? The Torah says: be just by giving him a little of your own." },
  { he:"צָרִיךְ לִמְדּוֹד כְּמִנְהַג הַמְּדִינָה וְלֹא יְשַׁנֶּה כְּלָל. מָקוֹם שֶׁנָּהֲגוּ לִגְדּוֹשׁ, לֹא יִמְחוֹק אֲפִילוּ בִּרְצוֹן הַלּוֹקֵחַ שֶׁפִּחֵת לוֹ מִדָּמִים. וּמָקוֹם שֶׁנָּהֲגוּ לִמְחוֹק, לֹא יִגְדּוֹשׁ אֲפִילוּ בִּרְצוֹן הַמּוֹכֵר שֶׁמּוֹסִיף לוֹ דָּמִים.", en:"You must measure according to local custom and not deviate from it. Where the custom is to give a heaping measure, you may not give a level measure even with the buyer's approval; and where the custom is a level measure, you may not give a heaping measure even when the seller is willing to charge more." },
  { he:"חַיָּבִים רָאשֵׁי הַקָּהָל לְהַעֲמִיד מְמֻנִּים שֶׁיִּהְיוּ מְחַזְּרִים עַל הַחֲנֻיּוֹת. וְכָל מִי שֶׁנִּמְצָא אִתּוֹ מִדָּה חֲסֵרָה אוֹ מִשְׁקָל חָסֵר אוֹ מֹאזְנַיִם מְקֻלְקָלִים, רַשָּׁאִים לְהַכּוֹתוֹ וּלְקָנְסוֹ כַּנִּרְאֶה בְּעֵינֵיהֶם.", en:"The leaders of the community are obligated to appoint inspectors who will check the stores. Anyone found to have deficient measures, deficient weights, or defective scales may be punished and fined as the inspectors see fit." },
  { he:"אָסוּר לְאָדָם לְהַשְׁהוֹת מִדָּה חֲסֵרָה בְּבֵיתוֹ אוֹ בַּחֲנוּתוֹ, אַף עַל פִּי שֶׁאֵינוֹ מוֹדֵד בָּהּ. וְאִם מַשְׁהֶה, עוֹבֵר בְּלָאו. וַאֲפִלּוּ לַעֲשׂוֹת אֶת הַמִּדָּה עָבִיט לְמֵי רַגְלַיִם, אָסוּר, שֶׁמָּא יָבֹא מִי שֶׁאֵינוֹ יוֹדֵעַ וְיִמְדֹּד בָּהּ.", en:"A person is forbidden to keep deficient measures in his house or store even if he does not use them — keeping them violates a negative commandment. It is even forbidden to use such a measure as a chamber pot, lest someone unknowingly use it to measure with." },
  { he:"הַמְחַזֵּר אַחַר דָּבָר לִקְנוֹתוֹ אוֹ לְשֹׂכְרוֹ, וּכְבָר הֻשְׁווּ עַל הַדָּמִים, וְקֹדֶם שֶׁגָּמְרוּ אֶת הַקִּנְיָן, בָּא אַחֵר וּקְנָאוֹ אוֹ שְׂכָרוֹ, נִקְרָא רָשָׁע. אֲבָל אִם עֲדַיִן לֹא הֻשְׁווּ עַל הַדָּמִים, מֻתָּר לְאַחֵר לִקְנוֹתוֹ.", en:"If someone seeks to buy or rent something and a price has been agreed upon — but before the transaction is complete, someone else swoops in and buys or rents it — that second person is called a rasha (wicked person). But if no price was yet agreed upon, someone else may legally buy it." },
  { he:"הַנּוֹתֵן מָעוֹת לַחֲבֵרוֹ לִקְנוֹת לוֹ קַרְקַע אוֹ מִטַּלְטְלִין, וְהָלַךְ הַשָּׁלִיחַ וְקָנָה אֶת הַחֵפֶץ בִּמְעוֹתָיו בִּשְׁבִיל עַצְמוֹ, הֲרֵי זֶה רַמָּאי. וְאִם קְנָאוֹ מִמָּעוֹת שֶׁל הַמְשַׁלֵּחַ, מְחֻיָּב לִתְּנוֹ לוֹ.", en:"If a person gives money to an agent to buy property or goods for him, and the agent uses his own money to buy it for himself, he is a swindler. But if he bought it with the principal's money, he must convey it to the principal — even if he intended to keep it for himself." },
  { he:"מִי שֶׁנָּתַן אֲפִילוּ רַק מִקְצָת דָּמִים עַל הַמִּקָּח אוֹ שֶׁרָשַׁם עַל הַמִּקָּח סִימָן בִּפְנֵי הַמּוֹכֵר, כָּל הַחוֹזֵר בּוֹ, בֵּין הַלּוֹקֵחַ בֵּין הַמּוֹכֵר, לֹא עָשָׂה מַעֲשֵׂה יִשְׂרָאֵל וְחַיָּב לְקַבֵּל מִי שֶׁפָּרַע.", en:"If anyone paid even a partial deposit or marked the article in the seller's presence, and either party backs out, that person has not acted as a Jew should — and is subject to the court's curse: \"He Who punished the generation of the Flood, of the Tower of Babel, of Sodom, and of the Egyptians who drowned in the sea — may He punish the one who does not keep his word.\"" },
  { he:"וְרָאוּי לוֹ לָאָדָם לַעֲמֹד בְּדִבּוּרוֹ, שֶׁאֲפִילוּ לֹא נָתַן עֲדַיִן מָעוֹת, וְלֹא רָשַׁם אֶת הַדָּבָר וְלֹא נִגְמַר הַקִּנְיָן, אִם הֻשְׁווּ עַל הַמְּחִיר, אֵין לְשׁוּם אֶחָד מֵהֶם לַחֲזוֹר. מִי שֶׁהוּא חוֹזֵר הֲרֵי זֶה מִמְחֻסְּרֵי אֲמָנָה, וְאֵין רוּחַ חֲכָמִים נוֹחָה הֵימֶנּוּ.", en:"A person has the moral obligation to keep his word even if no deposit was given, no mark was made, and the transaction was not completed. Once a price is agreed upon, neither party may back out. Whoever retracts is guilty of bad faith, and the spirit of the Sages does not look kindly on him." },
  { he:"וְכֵן מִי שֶׁאוֹמֵר לַחֲבֵרוֹ לִתֵּן לוֹ אֵיזֶה מַתָּנָה קְטַנָּה, שֶׁזֶּה סָמַךְ בְּדַעְתּוֹ שֶׁבְּוַדַּאי יִתֵּן לוֹ, אִם חָזַר וְלֹא נָתַן לוֹ, הֲרֵי זֶה מִמְחֻסְּרֵי אֲמָנָה. וְהָאוֹמֵר לִתֵּן לֶעָנִי, בֵּין מַתָּנָה מֻעֶטֶת בֵּין מַתָּנָה מְרֻבָּה, אֵינוֹ יָכוֹל לַחֲזוֹר בּוֹ מִן הַדִּין, מִפְּנֵי שֶׁנַּעֲשֶׂה כְּמוֹ נֵדֶר.", en:"If a person promises someone a small gift and the recipient relies on receiving it — and the donor changes his mind — he is considered lacking in honesty. A promise of a large gift may be retracted without that stigma. However, a promise to give a poor person, whether small or large, cannot legally be retracted, as it is considered like a vow." },
  { he:"הָרוֹצֶה לִמְכֹּר קַרְקַע אוֹ בַּיִת, וּבָאוּ שְׁנַיִם, כָּל אֶחָד אוֹמֵר: אֲנִי אֶקַּח בְּדָמִים אֵלּוּ. אִם הָיָה אֶחָד מֵהֶם מִיּוֹשְׁבֵי עִירוֹ וְהַשֵּׁנִי מֵעִיר אַחֶרֶת, בֶּן עִירוֹ קוֹדֵם. הָיָה אֶחָד מֵהֶם שְׁכֵנוֹ, שְׁכֵנוֹ קוֹדֵם. וְאִם הַשֵּׁנִי הוּא חֲבֵרוֹ הָרָגִיל עִמּוֹ, חֲבֵרוֹ קוֹדֵם. אֲבָל אִם הָיָה אֶחָד מֵהֶם בַּעַל הַמֶּצֶר, הוּא קוֹדֵם לְכֻלָּם.", en:"If a person wishes to sell land or a house and two buyers offer the same price: a fellow townsman takes priority over a stranger; a neighbor takes priority over a fellow townsman; a regular friend takes priority over an uninvolved neighbor. A Torah scholar takes priority even over a neighbor. But if one of the buyers owns adjacent land (baal hametzar), he takes priority over everyone — even a Torah scholar — and may reclaim the property even after it is sold." },
];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Heebo:wght@300;400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:hsl(35,25%,95%);font-family:'EB Garamond',serif;}
  .ws{cursor:pointer;border-radius:3px;padding:1px 2px;transition:background .1s;display:inline;}
  .ws:hover{background:hsl(45,90%,70%);}
  .ws.hit{background:hsl(200,80%,82%) !important;}
  .tab{background:none;border:none;cursor:pointer;padding:10px 16px;font-family:'EB Garamond',serif;font-size:15px;border-bottom:2.5px solid transparent;transition:all .2s;color:hsl(25,20%,52%);white-space:nowrap;}
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
            {popup.en && <span style={{ fontSize:11,background:"hsl(142,40%,90%)",color:"hsl(142,40%,28%)",borderRadius:20,padding:"2px 10px" }}>Saved ✓</span>}
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

function SpotCheck({ words, onPass }) {
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [passed, setPassed] = useState(0);

  const card = words[idx];

  function check() {
    const u = input.toLowerCase().trim();
    const c = card.en.toLowerCase();
    const variants = c.split(/[\/,]/).map(s => s.replace(/\(.*?\)/g, "").trim());
    const ok = variants.some(v => u === v) || variants.some(v => {
      const keys = v.split(/\s+/).filter(w => w.length > 3);
      return keys.some(k => u.includes(k));
    });
    setResult(ok ? "correct" : "wrong");
    if (ok) setPassed(p => p + 1);
  }

  function next() {
    if (idx + 1 >= words.length) { onPass(); return; }
    setIdx(i => i + 1);
    setInput("");
    setResult(null);
  }

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(35,35%,36%)" }}>
        🔍 <strong>Quick spot check</strong> — you haven't saved any vocab yet. Let's make sure you know a few key words first.
      </div>
      <div style={{ background:"white",borderRadius:14,padding:"32px 24px",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.06)",marginBottom:14 }}>
        <p style={{ fontSize:13,color:C.muted,marginBottom:16 }}>{idx+1} of {words.length}</p>
        <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:42,fontWeight:700,marginBottom:24 }}>{card.he}</div>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !result && input.trim() && check()}
          disabled={!!result}
          placeholder="Type English translation…"
          style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${result ? (result==="correct"?C.green:C.red) : C.border}`,borderRadius:9,fontFamily:"'EB Garamond',serif",fontSize:16,textAlign:"center",marginBottom:12 }}
          autoFocus
        />
        {result && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:17,fontWeight:600,color:result==="correct"?C.green:C.red,marginBottom:4 }}>{result==="correct"?"✓ Correct!":"✗ Not quite"}</div>
            <div style={{ fontSize:14,color:C.muted }}>Answer: <strong>{card.en}</strong></div>
          </div>
        )}
        {!result
          ? <Btn style={{ width:"100%" }} onClick={check} disabled={!input.trim()}>Check →</Btn>
          : <Btn style={{ width:"100%",marginTop:4 }} bg={idx+1>=words.length?C.green:C.brown} onClick={next}>{idx+1>=words.length?"Continue →":"Next →"}</Btn>}
      </div>
      <p style={{ textAlign:"center",fontSize:13,color:C.muted }}>Go back to Read tab to tap and save vocab words if needed.</p>
    </div>
  );
}
// ── SEIF VOCAB FLASHCARDS ────────────────────────────────────────────────────
function SeifCards({ seifIdx, onDone, savedVocab, vocabCompleted }) {
  const seifTokens = new Set(SEIFIM[seifIdx].he.split(/\s+/).map(w => stripNikud(w)));
  const words = Object.entries(savedVocab)
    .filter(([he]) => seifTokens.has(stripNikud(he)))
    .map(([he, en]) => ({ he, en }));

  const [knownSet, setKnownSet] = useState(new Set());
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const remaining = words.filter(w => !knownSet.has(w.he));

if (words.length === 0) {
  if (vocabCompleted) {
    return (
      <div style={{ textAlign:"center", padding:"50px 20px" }}>
        <div style={{ fontSize:36, marginBottom:10 }}>✅</div>
        <p style={{ fontSize:17, marginBottom:22 }}>No new vocab saved for this seif.</p>
        <Btn onClick={() => onDone(true)}>Continue to Content Quiz →</Btn>
      </div>
    );
  }
  const seifTokens2 = new Set(SEIFIM[seifIdx].he.split(/\s+/).map(w => stripNikud(w)));
  const spotWords = Object.entries(WORD_MAP)
    .filter(([k]) => seifTokens2.has(k))
    .slice(0, 3)
    .map(([, v]) => v);
  if (spotWords.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"50px 20px" }}>
        <div style={{ fontSize:36, marginBottom:10 }}>💡</div>
        <p style={{ fontSize:17, marginBottom:8 }}>No vocab words found for this seif.</p>
        <Btn onClick={() => onDone(true)}>Continue to Content Quiz →</Btn>
      </div>
    );
  }
  return <SpotCheck words={spotWords} onPass={() => onDone(true)} />;
}

  if (remaining.length === 0) return (
    <div style={{ textAlign:"center", padding:"50px 20px" }}>
      <div style={{ fontSize:48, marginBottom:10 }}>🎉</div>
      <p style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>All cards reviewed!</p>
      <p style={{ color:C.muted, marginBottom:22 }}>Now test yourself with the vocab quiz.</p>
      <Btn bg={C.green} onClick={() => onDone(false)}>Start Vocab Quiz →</Btn>
    </div>
  );

  const card = remaining[cardIdx % remaining.length];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{ fontSize:13, color:C.muted }}>🃏 Vocab Flashcards — Seif {seifIdx+1}</span>
        <span style={{ fontSize:13, color:C.muted }}>{knownSet.size}/{words.length} known · {remaining.length} left</span>
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3, marginBottom:18, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(knownSet.size/words.length)*100}%`, background:C.green, transition:"width .4s" }}/>
      </div>
      <div onClick={() => setFlipped(f => !f)} style={{ cursor:"pointer",background:"white",borderRadius:16,padding:"40px 24px",minHeight:190,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:"0 3px 14px rgba(0,0,0,.08)",border:`1.5px solid ${C.border}`,marginBottom:16,userSelect:"none",position:"relative" }}>
        <span style={{ position:"absolute",top:12,right:16,fontSize:11,color:C.muted,letterSpacing:1 }}>{flipped ? "ENGLISH" : "HEBREW — tap to reveal"}</span>
        {!flipped
          ? <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:38,fontWeight:700 }}>{card.he}</div>
          : <div style={{ fontSize:22,color:"hsl(25,20%,28%)",textAlign:"center",lineHeight:1.55 }}>{card.en}</div>}
      </div>
      {flipped
        ? <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <button className="opt" style={{ textAlign:"center",color:C.red,borderColor:"hsl(0,50%,75%)" }} onClick={() => { setFlipped(false); setCardIdx(i => (i+1) % remaining.length); }}>🔁 Study Again</button>
            <Btn bg={C.green} style={{ width:"100%" }} onClick={() => { setKnownSet(s => new Set([...s, card.he])); setFlipped(false); }}>✓ Got It</Btn>
          </div>
        : <p style={{ textAlign:"center",fontSize:13,color:C.muted }}>Tap the card to reveal</p>}
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
// ── VOCAB TYPING QUIZ ────────────────────────────────────────────────────────
function TypingQuiz({ seifIdx, savedVocab, onDone }) {
  const seifTokens = new Set(SEIFIM[seifIdx].he.split(/\s+/).map(w => stripNikud(w)));
  const allWords = Object.entries(savedVocab)
    .filter(([he]) => seifTokens.has(stripNikud(he)))
    .map(([he, en]) => ({ he, en }));

  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [score, setScore] = useState({ correct: 0, close: 0, wrong: 0 });
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (allWords.length === 0) onDone();
  }, []);

  if (allWords.length === 0) return null;

  const card = allWords[idx];
  const total = allWords.length;

function isCloseEnough(userAnswer, correctAnswer) {
  const u = userAnswer.toLowerCase().trim();
  const c = correctAnswer.toLowerCase().trim();
  if (u === c) return "correct";

  const variants = c.split(/[\/,]/).map(s => s.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "").trim());
  if (variants.some(v => u === v)) return "correct";

  const stopWords = new Set(["the","a","an","to","of","in","and","or","for","from","his","her","its","one","who","not","be","is","are","was"]);
  const userWords = u.split(/\s+/).filter(w => !stopWords.has(w));
  const correctWords = variants.join(" ").split(/\s+/).filter(w => !stopWords.has(w));

  const hasSynonymMatch = userWords.some(uw => correctWords.some(cw => inSameGroup(uw, cw)));
  if (hasSynonymMatch) return "close";

  const keyWords = correctWords.filter(w => w.length > 2);
  const matchCount = keyWords.filter(kw => u.includes(kw)).length;
  if (keyWords.length > 0 && matchCount >= Math.ceil(keyWords.length * 0.4)) return "close";

  for (const v of variants) {
    if (v.length >= 4 && u.length >= 4 && (u.startsWith(v.slice(0,4)) || v.startsWith(u.slice(0,4)))) return "close";
  }

  return "wrong";
}

  function checkAnswer() {
    const res = isCloseEnough(input, card.en);
    setResult(res);
    setScore(s => ({ ...s, [res]: s[res] + 1 }));
  }

  function next() {
    if (idx + 1 >= total) { setFinished(true); return; }
    setIdx(i => i + 1);
    setInput("");
    setResult(null);
  }

  if (finished) {
    const passed = (score.correct + score.close) / total >= 0.6;
    return (
      <div style={{ textAlign:"center", padding:"40px 20px" }}>
        <div style={{ fontSize:48, marginBottom:10 }}>{passed ? "🎉" : "📖"}</div>
        <h3 style={{ fontSize:22, marginBottom:6 }}>Vocab Quiz Complete!</h3>
        <div style={{ fontSize:17, color:C.muted, marginBottom:4 }}>✓ {score.correct} · ~ {score.close} · ✗ {score.wrong}</div>
        <div style={{ fontSize:15, color:C.muted, marginBottom:24 }}>{passed ? "Great — ready for the content quiz!" : "You can redo it or move on."}</div>
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          <button className="opt" style={{ width:"auto",padding:"10px 18px" }} onClick={() => { setIdx(0); setInput(""); setResult(null); setScore({correct:0,close:0,wrong:0}); setFinished(false); }}>🔁 Redo Vocab Quiz</button>
          <Btn bg={C.green} onClick={onDone}>Continue to Content Quiz →</Btn>
        </div>
      </div>
    );
  }

  const resultColor = result === "correct" ? C.green : result === "close" ? "hsl(45,70%,40%)" : C.red;
  const resultMsg = result === "correct" ? "✓ Correct!" : result === "close" ? "~ Close enough!" : "✗ Not quite";

  return (
    <div>
      <div style={{ background:"hsl(210,60%,93%)",border:"1px solid hsl(210,50%,78%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(210,40%,30%)" }}>
        ✏️ <strong>Vocab Quiz</strong> — type the English · {idx + 1} of {total}
      </div>
      <div style={{ height:5, background:C.border, borderRadius:3, marginBottom:16, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(idx/total)*100}%`, background:"hsl(210,55%,55%)", transition:"width .4s" }}/>
      </div>
      <div style={{ background:"white",borderRadius:14,padding:"32px 24px",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.06)",marginBottom:14 }}>
        <div dir="rtl" style={{ fontFamily:"'Heebo',sans-serif",fontSize:42,fontWeight:700,marginBottom:24 }}>{card.he}</div>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !result && input.trim() && checkAnswer()}
          disabled={!!result}
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
          ? <Btn style={{ width:"100%" }} onClick={checkAnswer} disabled={!input.trim()}>Check →</Btn>
          : <Btn style={{ width:"100%" }} bg={idx + 1 >= total ? C.green : C.brown} onClick={next}>
              {idx + 1 >= total ? "See Results →" : "Next →"}
            </Btn>}
      </div>
      <div style={{ textAlign:"center",fontSize:13,color:C.muted }}>✓ {score.correct} · ~ {score.close} · ✗ {score.wrong}</div>
    </div>
  );
}

// ── SEIF CONTENT QUIZ ─────────────────────────────────────────────────────────
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
      `Quiz Modern Orthodox high school students on ONE seif of Kitzur Shulchan Aruch.\n\nSeif ${seifIdx+1} (Hebrew): ${seif.he}\nSeif ${seifIdx+1} (English): ${seif.en}\n\nCreate exactly 3 questions with 4 answer choices (A–D). Make them VARIED:\n- 1 basic comprehension question (what does this seif say?)\n- 1 practical scenario question (what would you do if...)\n- 1 application question (which of these situations applies this halacha?)\nDo NOT repeat similar phrasing across questions. Each question must test something different.\nReturn ONLY valid JSON array:\n[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"..."}]`,
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
  const passed = pct >= 67;

  return (
    <div>
      <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"hsl(35,35%,36%)" }}>
        📝 <strong>Content Quiz — Seif {seifIdx+1}</strong> · Need 2/3 (67%) to master
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
        : <div style={{ background:"white",borderRadius:14,padding:24,textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize:42,marginBottom:8 }}>{passed ? "🏆" : "📖"}</div>
            <div style={{ fontSize:34,fontWeight:700,color:passed?C.green:C.brown }}>{score}/{quiz.length}</div>
            <div style={{ color:C.muted,marginTop:4,fontSize:15 }}>{passed ? "Seif mastered! Next seif unlocked ✓" : `${pct}% — need 67% to pass`}</div>
            <div style={{ display:"flex",gap:10,justifyContent:"center",marginTop:16 }}>
              {passed
                ? <Btn bg={C.green} onClick={() => onPass(pct)}>Continue ›</Btn>
                : <>
                    <button className="opt" style={{ flex:1,textAlign:"center" }} onClick={() => setRetryKey(k => k+1)}>Retry Quiz</button>
                    <Btn style={{ flex:1 }} onClick={onReview}>Review Seif</Btn>
                  </>}
            </div>
          </div>}
    </div>
  );
}

// ── GLOBAL VOCAB FLASHDECK ───────────────────────────────────────────────────
function FlashDeck({ vocab, checked, onCheck }) {
  const entries = Object.entries(vocab).filter(([k]) => !checked[k]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
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
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
        <span style={{ fontSize:13,color:C.muted }}>{doneCount} checked off</span>
        <span style={{ fontSize:13,color:C.muted }}>{entries.length} remaining of {total}</span>
      </div>
      <div style={{ height:5,background:C.border,borderRadius:3,marginBottom:18,overflow:"hidden" }}>
        <div style={{ height:"100%",width:`${(doneCount/total)*100}%`,background:C.green,transition:"width .4s" }}/>
      </div>
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
    </div>
  );
}

// ── TEACHER DASHBOARD ────────────────────────────────────────────────────────
function TeacherDash({ onBack }) {
  const [pw, setPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function login() {
    if (pw !== TEACHER_PASSWORD) { setErr("Incorrect password."); return; }
    setAuthed(true);
  }

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "students"),
      (snapshot) => { setStudents(snapshot.docs.map(d => d.data())); setLoading(false); },
      (error) => { console.error("Teacher snapshot error:", error); setLoading(false); }
    );
    return () => unsubscribe();
  }, [authed]);

  const mc = s => Object.values(s.seifProgress || {}).filter(v => v === "mastered").length;

  if (!authed) return (
    <div style={{ minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <style>{CSS}</style>
      <div style={{ background:"white",borderRadius:18,padding:"40px 36px",maxWidth:380,width:"90%",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,.1)" }}>
        <div style={{ fontSize:40,marginBottom:10 }}>🔐</div>
        <h2 style={{ fontFamily:"'Heebo',sans-serif",fontSize:22,marginBottom:4 }}>Teacher Dashboard</h2>
        <p style={{ color:C.muted,fontSize:14,marginBottom:22 }}>Enter teacher password to view student progress</p>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Password" style={{ width:"100%",padding:"11px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"'EB Garamond',serif",fontSize:16,marginBottom:10,textAlign:"center" }} autoFocus />
        {err && <p style={{ color:C.red,fontSize:13,marginBottom:8 }}>{err}</p>}
        <Btn style={{ width:"100%" }} onClick={login}>Enter →</Btn>
        <button onClick={onBack} style={{ background:"none",border:"none",cursor:"pointer",marginTop:14,color:C.muted,fontFamily:"inherit",fontSize:14 }}>← Back</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh",background:C.bg }}>
      <style>{CSS}</style>
      <div style={{ maxWidth:800,margin:"0 auto",padding:"32px 20px" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Heebo',sans-serif",fontSize:28,fontWeight:700 }}>Teacher Dashboard</h1>
            <p style={{ color:C.muted,fontSize:14 }}>
              {loading ? "Loading…" : `${students.length} student${students.length !== 1 ? "s" : ""}`}
              {" "}· Siman 62 — אונאה ומשא ומתן{" "}
              <span style={{ fontSize:11,color:C.green }}>● Live</span>
            </p>
          </div>
          <button onClick={onBack} style={{ background:"none",border:`1.5px solid ${C.border}`,borderRadius:9,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:C.muted }}>← Back</button>
        </div>
        {loading && <div style={{ textAlign:"center",padding:"60px 0",color:C.muted }}>Loading students…</div>}
        {!loading && students.length === 0 && <div style={{ textAlign:"center",padding:"60px 0",color:C.muted }}>No students have logged in yet.</div>}
        {!loading && students.sort((a, b) => mc(b) - mc(a)).map(s => {
          const n = mc(s); const pct = Math.round(n / 18 * 100);
          return (
            <div key={s.email} style={{ background:"white",borderRadius:14,padding:"18px 20px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <div>
                  <div style={{ fontWeight:600,fontSize:17 }}>{s.name}</div>
                  <div style={{ fontSize:13,color:C.muted }}>{s.email}</div>
                  <div style={{ fontSize:12,color:C.muted,marginTop:2 }}>Last seen: {s.lastSeen ? new Date(s.lastSeen).toLocaleDateString() : "—"}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:22,fontWeight:700,color:pct===100?C.green:C.brown }}>{n}/18</div>
                  <div style={{ fontSize:12,color:C.muted }}>seifim mastered</div>
                </div>
              </div>
              <div style={{ height:7,background:C.bg,borderRadius:4,overflow:"hidden",marginBottom:10 }}>
                <div style={{ height:"100%",width:`${pct}%`,background:pct===100?C.green:C.gold,transition:"width .4s" }}/>
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
                {Array.from({ length:18 }, (_, i) => {
                  const st = (s.seifProgress || {})[i];
                  return <div key={i} style={{ width:28,height:28,borderRadius:5,background:st==="mastered"?C.green:st?"hsl(210,60%,80%)":C.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:st==="mastered"?"white":"hsl(25,10%,60%)",fontWeight:600 }}>{st === "mastered" ? "✓" : i+1}</div>;
                })}
              </div>
              {Object.keys(s.quizScores || {}).length > 0 && (
                <div style={{ marginTop:8,fontSize:12,color:C.muted }}>
                  Quiz scores: {Object.entries(s.quizScores || {}).map(([i, arr]) => `Seif ${parseInt(i)+1}: ${arr.slice(-1)[0]?.pct}%`).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SEIF STUDY VIEW ──────────────────────────────────────────────────────────
function SeifStudy({ seifIdx, status, onMastered, onBack, onVocabSave, savedVocab, onVocabDone, quizScores, onQuizScore }) {
  const [tab, setTab] = useState("read");
  const [vocabStage, setVocabStage] = useState("init");
  const [popup, setPopup] = useState(null);
  const seif = SEIFIM[seifIdx];
  const mastered = status === "mastered";
  const vocabDone = status === "vocab_done" || mastered;

  // Reset vocab stage whenever we enter a new seif
  useEffect(() => { setVocabStage("cards"); setTab("read"); }, [seifIdx]);

  function handleWord(e) {
    e.stopPropagation();
    const raw = e.target.innerText?.trim();
    if (!raw || raw.length < 2) return;
    const s = stripNikud(raw);
    for (const ph of PHRASES) {
      if (ph.stripped.split(" ").includes(s)) {
        setPopup({ he:ph.he, en:ph.en }); onVocabSave(ph.he, ph.en); return;
      }
    }
    const m = WORD_MAP[s];
    if (m) { setPopup({ he:m.he, en:m.en }); onVocabSave(m.he, m.en); return; }
    setPopup({ he:raw, en:null, loading:true });
    callClaude(`Translate the Hebrew word "${raw}" from Kitzur Shulchan Aruch. Only the English, 1–6 words.`, "Reply with ONLY the English translation.", 80)
      .then(d => { const t = d.trim(); setPopup(p => p?.he === raw ? { ...p, en:t, loading:false } : p); onVocabSave(raw, t); })
      .catch(() => setPopup(p => p?.he === raw ? { ...p, en:"(translation unavailable)", loading:false } : p));
  }

  const seifTokens = new Set(seif.he.split(/\s+/).map(w => stripNikud(w)));
  const hasVocab = Object.keys(savedVocab).some(he => seifTokens.has(stripNikud(he)));

  const badge = mastered
    ? <span style={{ background:"hsl(142,40%,90%)",color:"hsl(142,40%,28%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>✓ Mastered</span>
    : vocabDone
    ? <span style={{ background:"hsl(210,60%,90%)",color:"hsl(210,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>Vocab ✓ → Quiz</span>
    : <span style={{ background:"hsl(45,70%,90%)",color:"hsl(35,50%,32%)",borderRadius:20,padding:"3px 12px",fontSize:12 }}>In Progress</span>;

  return (
    <div style={{ minHeight:"100vh",background:C.bg }} onClick={() => setPopup(null)}>
      <style>{CSS}</style>
      <div style={{ position:"sticky",top:0,zIndex:100,background:"hsl(35,22%,91%)",borderBottom:`1.5px solid ${C.border}` }}>
        <div style={{ maxWidth:720,margin:"0 auto",padding:"10px 18px" }}>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
            <button onClick={onBack} style={{ background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:C.muted }}>← All Seifim</button>
            <div style={{ fontFamily:"'Heebo',sans-serif",fontSize:15,fontWeight:700 }}>סימן סב · סעיף {seifIdx+1}</div>
            {badge}
          </div>
          <div style={{ display:"flex",borderTop:`1px solid ${C.border}` }}>
            {[
              ["read","📖 Read"],
              ["vocab","🃏 Vocab" + (vocabDone?" ✓":"")],
              ["quiz","📝 Content Quiz" + (mastered?" ✓":"")]
            ].map(([id, lbl]) => (
              <button key={id} className={`tab${tab===id?" on":""}`} onClick={e => { e.stopPropagation(); setTab(id); }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:720,margin:"0 auto",padding:"20px 18px 120px" }}>

        {/* ── READ ── */}
        {tab === "read" && <>
          <div style={{ background:"hsl(45,70%,93%)",border:"1px solid hsl(45,50%,75%)",borderRadius:9,padding:"9px 14px",marginBottom:14,fontSize:13,color:"hsl(35,35%,36%)" }}>
            💡 <strong>Tap a word</strong> for its translation · <strong>Tap the English box</strong> to reveal the full translation
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

        {/* ── VOCAB ── */}
{tab === "vocab" && (
  vocabStage === "typing"
    ? <TypingQuiz
        key="typing"
        seifIdx={seifIdx}
        savedVocab={savedVocab}
        onDone={() => { onVocabDone(); setVocabStage("init"); setTab("quiz"); }}
      />
    : <SeifCards
        key={vocabStage}
        seifIdx={seifIdx}
        savedVocab={savedVocab}
        vocabCompleted={vocabDone}
        onDone={(skipToContent) => {
          if (skipToContent) { onVocabDone(); setVocabStage("init"); setTab("quiz"); }
          else { setVocabStage("typing"); }
        }}
      />
)}

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
function Home({ student, seifProgress, onOpen, onTeacher, onLogout, vocab, checked, onCheck }) {
  const [simanOpen, setSimanOpen] = useState(false);
  const [tab, setTab] = useState("study");
  const mastered = Object.values(seifProgress).filter(v => v === "mastered").length;
  const pct = Math.round(mastered / 18 * 100);

  return (
    <div style={{ minHeight:"100vh",background:C.bg }}>
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
              <button onClick={onTeacher} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.muted }}>🔐 Teacher</button>
              <button onClick={onLogout} style={{ background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:C.muted }}>Switch</button>
            </div>
          </div>
        </div>

        {/* Siman list — for now just one */}
        {!simanOpen ? (
          <div>
            <p style={{ fontSize:13,color:C.muted,marginBottom:12,letterSpacing:2,textTransform:"uppercase" }}>Select a Siman</p>
            <div onClick={() => setSimanOpen(true)} style={{ background:"white",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,.07)",cursor:"pointer",borderLeft:`4px solid ${mastered===18?C.green:C.gold}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ fontFamily:"'Heebo',sans-serif",fontSize:18,fontWeight:700,marginBottom:2 }}>סימן סב</div>
                <div style={{ fontSize:14,color:C.muted }}>אונאה ומשא ומתן · Ona'ah & Business Ethics</div>
                <div style={{ fontSize:12,color:mastered===18?C.green:C.brown,marginTop:4,fontWeight:600 }}>{mastered}/18 seifim mastered</div>
              </div>
              <span style={{ fontSize:22,color:C.muted }}>›</span>
            </div>
          </div>
        ) : (
          <div>
            {/* Back + Siman header */}
            <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:16 }}>
              <button onClick={() => setSimanOpen(false)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:14,color:C.muted,fontFamily:"inherit" }}>← All Simanim</button>
              <div>
                <div style={{ fontFamily:"'Heebo',sans-serif",fontSize:20,fontWeight:700,lineHeight:1 }}>סימן סב</div>
                <div style={{ fontSize:13,color:C.muted }}>Ona'ah & Business Ethics</div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ background:"white",borderRadius:12,padding:"14px 18px",marginBottom:16,boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
                <span style={{ fontWeight:600,fontSize:15 }}>Progress</span>
                <span style={{ fontWeight:700,color:mastered===18?C.green:C.brown }}>{mastered}/18 mastered</span>
              </div>
              <div style={{ height:8,background:C.bg,borderRadius:4,overflow:"hidden" }}>
                <div style={{ height:"100%",width:`${pct}%`,background:mastered===18?C.green:C.gold,transition:"width .5s" }}/>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display:"flex",borderBottom:`1.5px solid ${C.border}`,marginBottom:18 }}>
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
                            {!unlocked ? "🔒" : isMastered ? "✓" : inProg ? "●" : "○"} סעיף {i+1}
                          </span>
                          <span style={{ fontSize:12,color:isMastered?C.green:inProg?"hsl(35,35%,45%)":unlocked?C.muted:"hsl(35,10%,60%)" }}>
                            {isMastered ? "Mastered" : inProg ? (st==="vocab_done"?"Vocab done – quiz next":"Reading…") : "Locked"}
                          </span>
                        </div>
                        <p style={{ fontSize:14,color:C.muted,lineHeight:1.4 }}>{seif.en.slice(0,85)}…</p>
                      </div>
                      {unlocked && <span style={{ color:C.muted,fontSize:18,marginLeft:10 }}>›</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "reference" && <Reference />}
            {tab === "flashcards" && <FlashDeck vocab={vocab} checked={checked} onCheck={onCheck} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin, onTeacher }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState("email");
  const [returning, setReturning] = useState(null);
  const [checking, setChecking] = useState(false);

  async function checkEmail() {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return;
    setChecking(true);
    const existing = await loadStudent(e);
    setChecking(false);
    if (existing) { setReturning(existing); setStep("welcome"); }
    else setStep("name");
  }

  async function create() {
    if (!name.trim()) return;
    const profile = { email: email.trim().toLowerCase(), name: name.trim() };
    await saveStudent(profile.email, { name: profile.name, email: profile.email, seifProgress: {}, savedVocab: {}, vocabChecked: {}, quizScores: {} });
    onLogin(profile);
  }

  return (
    <div style={{ minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <style>{CSS}</style>
      <div style={{ background:"white",borderRadius:20,padding:"40px 36px",maxWidth:400,width:"92%",textAlign:"center",boxShadow:"0 4px 24px rgba(0,0,0,.1)" }}>
        <div style={{ fontSize:44,marginBottom:10 }}>📖</div>
        <h2 style={{ fontFamily:"'Heebo',sans-serif",fontSize:26,fontWeight:700,marginBottom:4 }}>קיצור שולחן ערוך</h2>
        <p style={{ color:C.muted,fontSize:15,marginBottom:26 }}>Fluency Trainer · Siman 62</p>

        {step === "email" && <>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && checkEmail()} placeholder="School email address" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:12,textAlign:"center" }} autoFocus />
          <Btn style={{ width:"100%" }} onClick={checkEmail} disabled={!email.includes("@") || checking}>{checking ? "Checking…" : "Continue →"}</Btn>
        </>}

        {step === "name" && <>
          <p style={{ fontSize:14,color:C.muted,marginBottom:14 }}>New account for <strong>{email}</strong></p>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} placeholder="Your full name" style={{ width:"100%",padding:"12px 14px",border:`1.5px solid ${C.border}`,borderRadius:9,fontFamily:"inherit",fontSize:16,marginBottom:12,textAlign:"center" }} autoFocus />
          <Btn style={{ width:"100%" }} onClick={create} disabled={!name.trim()}>Create Account →</Btn>
          <button onClick={() => setStep("email")} style={{ background:"none",border:"none",cursor:"pointer",marginTop:10,color:C.muted,fontFamily:"inherit",fontSize:13 }}>← Back</button>
        </>}

        {step === "welcome" && returning && <>
          <div style={{ background:"hsl(142,40%,94%)",borderRadius:12,padding:"14px 18px",marginBottom:20 }}>
            <div style={{ fontSize:13,color:C.muted }}>Welcome back,</div>
            <div style={{ fontSize:20,fontWeight:600,color:"hsl(142,40%,28%)" }}>{returning.name}</div>
          </div>
          <Btn style={{ width:"100%" }} bg={C.green} onClick={() => onLogin(returning)}>Continue Learning →</Btn>
          <button onClick={() => { setStep("email"); setEmail(""); setReturning(null); }} style={{ background:"none",border:"none",cursor:"pointer",marginTop:10,color:C.muted,fontFamily:"inherit",fontSize:13 }}>Different student</button>
        </>}

        <div style={{ borderTop:`1px solid ${C.border}`,marginTop:24,paddingTop:16 }}>
          <button onClick={onTeacher} style={{ width:"100%",background:"none",border:`1px solid hsl(35,20%,78%)`,borderRadius:8,padding:"9px 18px",cursor:"pointer",color:"hsl(25,25%,48%)",fontFamily:"'EB Garamond',serif",fontSize:14 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "hsl(25,35%,55%)"; e.currentTarget.style.color = "hsl(25,35%,30%)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "hsl(35,20%,78%)"; e.currentTarget.style.color = "hsl(25,25%,48%)"; }}>
            🔐 Teacher Login
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [student, setStudent]           = useState(null);
  const [view, setView]                 = useState("home");
  const [activeSeif, setActiveSeif]     = useState(0);
  const [seifProgress, setSeifProgress] = useState({});
  const [savedVocab, setSavedVocab]     = useState({});
  const [vocabChecked, setVocabChecked] = useState({});
  const [quizScores, setQuizScores]     = useState({});

  async function load(profile) {
    setStudent(profile);
    const data = await loadStudent(profile.email);
    if (data) {
      setSeifProgress(data.seifProgress || {});
      setSavedVocab(data.savedVocab || {});
      setVocabChecked(data.vocabChecked || {});
      setQuizScores(data.quizScores || {});
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
    saveTimeout(student.email, { name: student.name, email: student.email, seifProgress, savedVocab, vocabChecked, quizScores });
  }, [student, seifProgress, savedVocab, vocabChecked, quizScores, saveTimeout]);

  function logout() {
    setStudent(null); setSeifProgress({}); setSavedVocab({});
    setVocabChecked({}); setQuizScores({}); setView("home");
  }

  function openSeif(i) {
    setActiveSeif(i);
    setSeifProgress(p => ({ ...p, [i]: p[i] || "reading" }));
    setView("seif");
  }

  function handleMastered() {
    setSeifProgress(p => ({ ...p, [activeSeif]: "mastered" }));
    setView("home");
  }

function handleVocabDone() {
  // Clear this seif's vocab words so next round starts completely fresh
  const seifTokens = new Set(SEIFIM[activeSeif].he.split(/\s+/).map(w => stripNikud(w)));
  setSavedVocab(v => {
    const updated = { ...v };
    Object.keys(updated).forEach(he => {
      if (seifTokens.has(stripNikud(he))) delete updated[he];
    });
    return updated;
  });
  setSeifProgress(p => ({ ...p, [activeSeif]: p[activeSeif] === "mastered" ? "mastered" : "vocab_done" }));
}

  function handleQuizScore(idx, pct) {
    setQuizScores(s => ({ ...s, [idx]: [...(s[idx] || []), { pct, date: new Date().toLocaleDateString() }].slice(-10) }));
  }

  if (!student) return <Login onLogin={load} onTeacher={() => setView("teacher")} />;
  if (view === "teacher") return <TeacherDash onBack={() => setView("home")} />;
  if (view === "seif") return (
    <SeifStudy
      seifIdx={activeSeif}
      status={seifProgress[activeSeif]}
      onMastered={handleMastered}
      onBack={() => setView("home")}
      onVocabSave={(he, en) => setSavedVocab(v => ({ ...v, [he]: en }))}
      onVocabDone={handleVocabDone}
      savedVocab={savedVocab}
      quizScores={quizScores}
      onQuizScore={handleQuizScore}
    />
  );
  return (
    <Home
      student={student} seifProgress={seifProgress}
      onOpen={openSeif} onTeacher={() => setView("teacher")} onLogout={logout}
      vocab={savedVocab} checked={vocabChecked}
      onCheck={he => setVocabChecked(c => ({ ...c, [he]: true }))}
    />
  );
}