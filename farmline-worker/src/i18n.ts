import type { Lang } from "./types";

/** Every word FarmLine says, per language. Numbers are inserted by code, never translated. */
export interface Pack {
  header: (place: string) => string;
  spokenHeader: (place: string) => string;
  rain: (days: number, rain: string, normal: string, pct: string) => string;
  high: (temp: string) => string;
  drier: string;
  wetter: string;
  normal: string;
  plans: (crop: string | null) => string;
  saves: (pct: number) => string;
  income: (signed: string) => string;
  safest: (signed: string) => string;
  textCrop: string;
  then: string;
  plan: string;
  mm: string;
  inch: string;
  inchSpoken: string;
  degF: string;
  degC: string;
  help: string;
  notFound: string;
  busy: string;
  menu: string;
  askCode: string;
  askTown: string;
  askQuestion: string;
  askSpeak: string; // Whisper: where is your farm (a crop said too is used)
  checking: string; // while FarmLine prepares the answer
  noInput: string;
  goodbye: string;
  footerPlans: string;
  footerAlert: string;
  details: (i: number, rot: string, water: number, income: string, badYear: string) => string;
  alertOn: (place: string) => string;
  needPlace: string;
  noSession: string;
  alert: (place: string, pct: number) => string;
}

export const PACKS: Record<Lang, Pack> = {
  en: {
    header: (p) => `FarmLine - ${p} (NASA data)`,
    spokenHeader: (p) => `For ${p}, here is NASA data.`,
    rain: (d, r, n, pct) => `Rain, last ${d} days: ${r} (normal ${n}${pct}).`,
    high: (t) => `Average high: ${t}.`,
    drier: "Drier than normal.",
    wetter: "Wetter than normal.",
    normal: "Close to normal.",
    plans: (c) => `3 plans${c ? ` instead of ${c}` : ""}:`,
    saves: (p) => `saves ${p}% water`,
    income: (s) => `income ${s}%`,
    safest: (s) => `safest: income ${s}% even in a dry year`,
    textCrop: "Text your crop too, e.g. alfalfa.",
    then: ", then ",
    plan: "Plan",
    mm: "mm",
    inch: "in",
    inchSpoken: "inches",
    degF: " degrees Fahrenheit",
    degC: " degrees Celsius",
    help: "Hi, this is FarmLine. Text your ZIP code or town and your crop, e.g. 'alfalfa 89406 water is short'.",
    notFound: "Sorry, FarmLine could not find that place. Please check it and text again.",
    busy: "Sorry, NASA data is not reachable right now. Please try again in a few minutes.",
    menu: "Welcome to FarmLine. For English, press 1.",
    askCode: "Please type your ZIP code on the keypad, then press the pound key.",
    askTown: "Please say the name of your town or village.",
    askQuestion: "Which crop do you grow, and what is your problem? Please speak now.",
    askSpeak: "Where is your farm? After the beep, say your town or village and your country, or your ZIP or PIN code. For example: Jericho, New York.",
    checking: "Thank you. Checking NASA satellite data for your farm.",
    noInput: "Sorry, I did not hear anything.",
    goodbye: "We also sent you this as a text message. Thank you for calling FarmLine.",
    footerPlans: "Reply 1, 2 or 3 for details.",
    footerAlert: "Reply ALERT for drought alerts.",
    details: (i, rot, w, inc, bad) => `Plan ${i}: ${rot}. Water: saves ${w}%. Income: ${inc}% in a normal year, ${bad}% in a dry year.`,
    alertOn: (p) => `Drought alerts are on for ${p}. FarmLine will text you when NASA data shows a dry spell. Reply STOP to stop all messages.`,
    needPlace: "First text your ZIP code or town, then reply ALERT.",
    noSession: "Text your ZIP code or town and crop first, then reply 1, 2 or 3.",
    alert: (p, pct) => `FarmLine drought alert for ${p}: only ${pct}% of normal rain in the last 30 days (NASA data). Plan your water carefully. Reply with your crop for a new plan.`,
  },
  hi: {
    header: (p) => `FarmLine - ${p} (NASA डेटा)`,
    spokenHeader: (p) => `${p}, NASA डेटा के अनुसार।`,
    rain: (d, r, n, pct) => `पिछले ${d} दिनों में बारिश: ${r} (सामान्य ${n}${pct})।`,
    high: (t) => `औसत अधिकतम तापमान: ${t}।`,
    drier: "सामान्य से सूखा।",
    wetter: "सामान्य से ज़्यादा बारिश।",
    normal: "लगभग सामान्य।",
    plans: (c) => `${c ? c + " की जगह " : ""}3 योजनाएं:`,
    saves: (p) => `${p}% पानी की बचत`,
    income: (s) => `आय ${s}%`,
    safest: (s) => `सूखे साल में भी आय ${s}%`,
    textCrop: "अपनी फसल भी लिखें, जैसे: गेहूं",
    then: ", फिर ",
    plan: "योजना",
    mm: "मिमी",
    inch: "इंच",
    inchSpoken: "इंच",
    degF: " डिग्री फ़ारेनहाइट",
    degC: " डिग्री सेल्सियस",
    help: "नमस्ते, यह FarmLine है। अपना पिन कोड और फसल लिखें, जैसे: 'गेहूं 141001 पानी कम है'।",
    notFound: "माफ़ कीजिए, यह जगह नहीं मिली। कृपया जांच कर फिर लिखें।",
    busy: "माफ़ कीजिए, अभी NASA डेटा नहीं मिल रहा। कुछ मिनट बाद फिर कोशिश करें।",
    menu: "हिंदी के लिए 2 दबाएं।",
    askCode: "अपना पिन कोड टाइप करें, फिर हैश दबाएं।",
    askTown: "कृपया अपने गांव या शहर का नाम बोलिए।",
    askQuestion: "आप कौन सी फसल उगाते हैं, और क्या समस्या है? कृपया अब बोलिए।",
    askSpeak: "आपका खेत कहां है? बीप के बाद अपने गांव या शहर और देश का नाम, या अपना पिन कोड बोलिए। जैसे: लुधियाना, पंजाब।",
    checking: "धन्यवाद। आपके खेत के लिए NASA सैटेलाइट डेटा देखा जा रहा है।",
    noInput: "माफ़ कीजिए, कुछ सुनाई नहीं दिया।",
    goodbye: "हमने यह जानकारी SMS से भी भेजी है। FarmLine को कॉल करने के लिए धन्यवाद।",
    footerPlans: "विवरण के लिए 1, 2 या 3 भेजें।",
    footerAlert: "सूखा अलर्ट के लिए ALERT भेजें।",
    details: (i, rot, w, inc, bad) => `योजना ${i}: ${rot}। पानी: ${w}% बचत। आय: सामान्य साल में ${inc}%, सूखे साल में ${bad}%।`,
    alertOn: (p) => `${p} के लिए सूखा अलर्ट चालू है। NASA डेटा में सूखा दिखने पर FarmLine आपको SMS करेगा। सभी संदेश बंद करने के लिए STOP भेजें।`,
    needPlace: "पहले अपना पिन कोड या शहर भेजें, फिर ALERT भेजें।",
    noSession: "पहले अपना पिन कोड या शहर और फसल भेजें, फिर 1, 2 या 3 भेजें।",
    alert: (p, pct) => `${p} के लिए FarmLine सूखा अलर्ट: पिछले 30 दिनों में सामान्य की सिर्फ ${pct}% बारिश (NASA डेटा)। पानी की योजना सावधानी से बनाएं। नई योजना के लिए अपनी फसल भेजें।`,
  },
  ur: {
    header: (p) => `FarmLine - ${p} (NASA ڈیٹا)`,
    spokenHeader: (p) => `${p}، NASA ڈیٹا کے مطابق۔`,
    rain: (d, r, n, pct) => `پچھلے ${d} دنوں میں بارش: ${r} (معمول ${n}${pct})۔`,
    high: (t) => `اوسط زیادہ سے زیادہ درجہ حرارت: ${t}۔`,
    drier: "معمول سے زیادہ خشک۔",
    wetter: "معمول سے زیادہ بارش۔",
    normal: "تقریباً معمول کے مطابق۔",
    plans: (c) => `${c ? c + " کی جگہ " : ""}3 منصوبے:`,
    saves: (p) => `${p}% پانی کی بچت`,
    income: (s) => `آمدنی ${s}%`,
    safest: (s) => `خشک سال میں بھی آمدنی ${s}%`,
    textCrop: "اپنی فصل بھی لکھیں، جیسے: گندم",
    then: "، پھر ",
    plan: "منصوبہ",
    mm: "ملی میٹر",
    inch: "انچ",
    inchSpoken: "انچ",
    degF: " ڈگری فارن ہائیٹ",
    degC: " ڈگری سیلسیس",
    help: "السلام علیکم، یہ FarmLine ہے۔ اپنے شہر یا گاؤں کا نام اور فصل لکھیں، جیسے: 'گندم فیصل آباد پانی کم ہے'۔",
    notFound: "معذرت، یہ جگہ نہیں ملی۔ براہ کرم دیکھ کر دوبارہ لکھیں۔",
    busy: "معذرت، ابھی NASA ڈیٹا دستیاب نہیں۔ چند منٹ بعد دوبارہ کوشش کریں۔",
    menu: "اردو کے لیے 3 دبائیں۔",
    askCode: "براہ کرم اپنے شہر یا گاؤں کا نام بولیں۔",
    askTown: "براہ کرم اپنے شہر یا گاؤں کا نام بولیں۔",
    askQuestion: "آپ کون سی فصل اگاتے ہیں، اور کیا مسئلہ ہے؟ براہ کرم اب بولیں۔",
    askSpeak: "آپ کا کھیت کہاں ہے؟ بیپ کے بعد اپنے گاؤں یا شہر اور ملک کا نام بولیں۔ جیسے: فیصل آباد، پنجاب۔",
    checking: "شکریہ۔ آپ کے کھیت کے لیے NASA سیٹلائٹ ڈیٹا دیکھا جا رہا ہے۔",
    noInput: "معذرت، کچھ سنائی نہیں دیا۔",
    goodbye: "ہم نے یہ معلومات SMS سے بھی بھیج دی ہیں۔ FarmLine کو کال کرنے کا شکریہ۔",
    footerPlans: "تفصیل کے لیے 1، 2 یا 3 بھیجیں۔",
    footerAlert: "خشک سالی الرٹ کے لیے ALERT بھیجیں۔",
    details: (i, rot, w, inc, bad) => `منصوبہ ${i}: ${rot}۔ پانی: ${w}% بچت۔ آمدنی: عام سال میں ${inc}%، خشک سال میں ${bad}%۔`,
    alertOn: (p) => `${p} کے لیے خشک سالی الرٹ آن ہے۔ NASA ڈیٹا میں خشکی نظر آنے پر FarmLine آپ کو SMS کرے گا۔ تمام پیغامات بند کرنے کے لیے STOP بھیجیں۔`,
    needPlace: "پہلے اپنا شہر یا گاؤں بھیجیں، پھر ALERT بھیجیں۔",
    noSession: "پہلے اپنا شہر اور فصل بھیجیں، پھر 1، 2 یا 3 بھیجیں۔",
    alert: (p, pct) => `${p} کے لیے FarmLine خشک سالی الرٹ: پچھلے 30 دنوں میں معمول کی صرف ${pct}% بارش (NASA ڈیٹا)۔ پانی کا منصوبہ احتیاط سے بنائیں۔ نئے منصوبے کے لیے اپنی فصل بھیجیں۔`,
  },
  sw: {
    header: (p) => `FarmLine - ${p} (data ya NASA)`,
    spokenHeader: (p) => `Kwa ${p}, hizi ni data za NASA.`,
    rain: (d, r, n, pct) => `Mvua, siku ${d} zilizopita: ${r} (kawaida ${n}${pct}).`,
    high: (t) => `Wastani wa joto la juu: ${t}.`,
    drier: "Kavu kuliko kawaida.",
    wetter: "Mvua zaidi kuliko kawaida.",
    normal: "Karibu na kawaida.",
    plans: (c) => `Mipango 3${c ? ` badala ya ${c}` : ""}:`,
    saves: (p) => `inaokoa maji ${p}%`,
    income: (s) => `mapato ${s}%`,
    safest: (s) => `salama zaidi: mapato ${s}% hata mwaka wa ukame`,
    textCrop: "Tuma pia zao lako, mfano: mahindi.",
    then: ", kisha ",
    plan: "Mpango",
    mm: "mm",
    inch: "in",
    inchSpoken: "inchi",
    degF: " nyuzi Fahrenheit",
    degC: " nyuzi joto",
    help: "Habari, hii ni FarmLine. Tuma jina la mji wako na zao lako, mfano: 'mahindi Nakuru maji ni kidogo'.",
    notFound: "Samahani, FarmLine haikupata mahali hapo. Tafadhali angalia na utume tena.",
    busy: "Samahani, data za NASA hazipatikani sasa. Jaribu tena baada ya dakika chache.",
    menu: "Kwa Kiswahili, bonyeza 3.",
    askCode: "Tafadhali sema jina la mji au kijiji chako.",
    askTown: "Tafadhali sema jina la mji au kijiji chako.",
    askQuestion: "Unalima zao gani, na tatizo lako ni nini? Tafadhali ongea sasa.",
    askSpeak: "Shamba lako liko wapi? Baada ya mlio, sema jina la mji au kijiji chako na nchi yako. Kwa mfano: Nakuru, Kenya.",
    checking: "Asante. Tunaangalia data za setilaiti za NASA kwa shamba lako.",
    noInput: "Samahani, sikusikia chochote.",
    goodbye: "Tumekutumia pia ujumbe huu kwa SMS. Asante kwa kupiga FarmLine.",
    footerPlans: "Tuma 1, 2 au 3 kwa maelezo.",
    footerAlert: "Tuma ALERT kupata tahadhari za ukame.",
    details: (i, rot, w, inc, bad) => `Mpango ${i}: ${rot}. Maji: inaokoa ${w}%. Mapato: ${inc}% mwaka wa kawaida, ${bad}% mwaka wa ukame.`,
    alertOn: (p) => `Tahadhari za ukame zimewashwa kwa ${p}. FarmLine itakutumia SMS data ya NASA ikionyesha ukame. Tuma STOP kusimamisha ujumbe wote.`,
    needPlace: "Kwanza tuma jina la mji wako, kisha tuma ALERT.",
    noSession: "Kwanza tuma mji wako na zao lako, kisha tuma 1, 2 au 3.",
    alert: (p, pct) => `Tahadhari ya ukame ya FarmLine kwa ${p}: mvua ni ${pct}% tu ya kawaida katika siku 30 zilizopita (data ya NASA). Panga maji yako kwa uangalifu. Tuma zao lako kupata mpango mpya.`,
  },
};

/** Words a farmer might use for each crop, in all four languages. */
export const CROP_WORDS: Record<string, string[]> = {
  alfalfa: ["alfalfa", "lucerne", "रिजका", "لوسرن", "برسیم", "alfafa"],
  wheat: ["wheat", "gehun", "gehu", "gandum", "गेहूं", "गेहूँ", "گندم", "ngano", "trigo", "blé", "ble"],
  rice: ["rice", "paddy", "dhan", "chawal", "धान", "चावल", "چاول", "دھان", "mpunga", "mchele", "arroz", "riz"],
  maize: ["maize", "corn", "makka", "makai", "मक्का", "مکئی", "mahindi", "maíz", "maiz", "milho", "maïs", "mais"],
  cotton: ["cotton", "kapas", "कपास", "کپاس", "pamba", "algodón", "algodon", "algodão", "coton"],
  sugarcane: ["sugarcane", "ganna", "गन्ना", "گنا", "miwa", "caña", "cana", "cana-de-açúcar"],
  barley: ["barley", "jau", "जौ", "shayiri", "cebada", "cevada", "orge"],
  sorghum: ["sorghum", "jowar", "ज्वार", "جوار", "mtama", "sorgo"],
  soybean: ["soybean", "soya", "सोयाबीन", "سویابین", "soja"],
  "dry beans": ["beans", "rajma", "lobia", "राजमा", "لوبیا", "maharagwe", "frijol", "frijoles", "feijão", "feijao", "haricots"],
  chickpea: ["chickpea", "chana", "चना", "چنا", "dengu", "garbanzo", "grão-de-bico"],
  mustard: ["mustard", "sarson", "सरसों", "سرسوں", "haradali"],
  potato: ["potato", "aloo", "आलू", "آلو", "viazi", "papa", "papas", "patata", "batata", "pomme"],
  onion: ["onion", "pyaz", "प्याज", "پیاز", "kitunguu", "cebolla", "cebola", "oignon"],
};

/** Crop names in each language (falls back to English for anything not listed). */
export const CROP_NAMES: Record<Exclude<Lang, "en">, Record<string, string>> = {
  hi: { alfalfa: "रिजका", wheat: "गेहूं", rice: "धान", maize: "मक्का", cotton: "कपास", sugarcane: "गन्ना", barley: "जौ", sorghum: "ज्वार", soybean: "सोयाबीन", "dry beans": "राजमा", chickpea: "चना", mustard: "सरसों", potato: "आलू", onion: "प्याज", safflower: "कुसुम", "mung bean": "मूंग", millet: "बाजरा", beans: "राजमा", groundnut: "मूंगफली", corn: "मक्का", tomato: "टमाटर", clover: "बरसीम", oats: "जई", lentil: "मसूर", "cover crop": "हरी खाद" },
  ur: { alfalfa: "لوسرن", wheat: "گندم", rice: "دھان", maize: "مکئی", cotton: "کپاس", sugarcane: "گنا", barley: "جو", sorghum: "جوار", soybean: "سویابین", "dry beans": "لوبیا", chickpea: "چنا", mustard: "سرسوں", potato: "آلو", onion: "پیاز", safflower: "کسم", "mung bean": "مونگ", millet: "باجرہ", beans: "لوبیا", groundnut: "مونگ پھلی", corn: "مکئی", tomato: "ٹماٹر", clover: "برسیم", oats: "جئی", lentil: "مسور", "cover crop": "سبز کھاد" },
  sw: { alfalfa: "alfalfa", wheat: "ngano", rice: "mpunga", maize: "mahindi", cotton: "pamba", sugarcane: "miwa", barley: "shayiri", sorghum: "mtama", soybean: "soya", "dry beans": "maharagwe", chickpea: "dengu", mustard: "haradali", potato: "viazi", onion: "kitunguu", "mung bean": "choroko", millet: "uwele", beans: "maharagwe", groundnut: "karanga", corn: "mahindi", tomato: "nyanya", clover: "klova", oats: "oti", lentil: "adesi", "cover crop": "zao la kufunika udongo" },
};

/** Common words that mark a Latin-script message as Swahili, or as Roman Hindi/Urdu ("roman"). */
export const MARKERS: Record<"roman" | "sw" | "latin", string[]> = {
  // Spanish, Portuguese and French farm words: these get a Gemini-translated reply in the farmer's language.
  latin: ["poca", "poco", "lluvia", "agua", "sequía", "sequia", "cultivo", "cosecha", "siembra", "sembrar", "tierra", "qué", "que", "mi", "es", "hay", "falta", "pouca", "pouco", "chuva", "água", "seca", "plantar", "colheita", "minha", "meu", "não", "pluie", "eau", "peu", "sécheresse", "récolte", "mon", "ma", "pas", "est", "champ"],
  roman: ["pani", "paani", "kam", "hai", "hain", "mera", "meri", "mere", "kya", "kaise", "lagaun", "lagau", "lagana", "fasal", "khet", "barish", "zameen", "kheti", "nahi", "bahut", "aur", "mein", "raha", "rahi", "chahiye"],
  sw: ["maji", "nini", "panda", "nipande", "shamba", "mvua", "habari", "nina", "zao", "ukame", "kidogo", "ni", "na", "yangu", "mahindi", "ngano", "maharagwe", "nilime"],
};

/** Words that are never a place name, used when guessing the town from a message. */
export const STOPWORDS = new Set([
  ...MARKERS.roman, ...MARKERS.sw, ...MARKERS.latin,
  "the", "and", "my", "is", "are", "water", "short", "low", "what", "should", "plant", "grow", "help", "hello", "hi", "near", "farm", "field", "crop", "rain", "dry", "drought", "need", "want", "too", "very", "little", "much", "getting", "cut",
  "karibu", "katika", "kwa", "paas", "zila",
  "پانی", "میرا", "میری", "کیا", "فصل", "کھیت", "بارش", "زمین", "چاہیے", "لگاؤں", "بہت", "نہیں", "اور", "میں",
  "पानी", "मेरा", "मेरी", "क्या", "फसल", "फ़सल", "खेत", "बारिश", "ज़मीन", "चाहिए", "लगाऊं", "बहुत", "नहीं", "और", "में",
]);
