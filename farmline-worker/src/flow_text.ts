import type { SowKey } from "./rotation";
// Every message of the menu flow, in English, Hindi and Kiswahili. Numbers are inserted by code, never translated.

export type FlowLang = "en" | "hi" | "sw";
type Kind = "water" | "income" | "drought";

export interface FlowText {
  welcome: string;
  confirm: (place: string) => string;
  askVillage: string;
  notFoundPlace: string;
  menu: string;
  welcomeBack: string;
  askCrop: string;
  askWater: string;
  askOutlook: string;
  askPriority: string;
  checking: (place: string) => string;
  askSoil: string;
  buildsSoil: string;
  detailFoot: string;
  sow: Record<SowKey, string>;
  coverSuffix: string;
  planWater: (pct: number | null, crop: string | null, nitro: 0 | 1 | 2) => string;
  afterCrop: (crop: string) => string;
  legumesAdd: (crops: string) => string;
  lessWater: (crop: string) => string;
  and: string;
  plansHead: string;
  kind: Record<Kind, string>;
  plansFoot: string;
  noPlans: string;
  year: (y: number, crop: string, sow?: string) => string;
  water: (pct: number, crop: string) => string;
  money: (income: string, badYear: string) => string;
  moreFoot: string;
  whyRain: (place: string, pct: number) => string;
  whyKind: Record<Kind, string>;
  soilDrier: (place: string) => string;
  soilWetter: (place: string) => string;
  soilNormal: (place: string) => string;
  soilPct: (pct: number) => string;
  noRain: string;
  rainMm: (mm: number) => string;
  wait: string;
  rainComing: string;
  ok: string;
  alertsOn: string;
  alertsOff: string;
  askAnything: string;
  stopped: string;
  notUnderstood: string;
  droughtAlert: (place: string) => string;
  rainAlert: (place: string, days: number) => string;
  whyDrought: (place: string, pct: number) => string;
  whyRainAlert: (mm: number, days: number) => string;
  noWhy: string;
  forecastDown: string;
}

export const LANG_MENU = "FarmLine: Choose your language:\n1 English\n2 हिंदी\n3 Kiswahili";

const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);

export const FLOW: Record<FlowLang, FlowText> = {
  en: {
    welcome: "Welcome to FarmLine. I'm here to help you plan your crops using NASA satellite data on rain, soil and weather for your area. It's free, and you can reply anytime.\nTo start, send your country and PIN or ZIP code, or your village name.\nExample: India 413512",
    confirm: (p) => `Is your farm near ${p}?\n1 Yes\n2 No`,
    askVillage: "Send your village name.",
    notFoundPlace: "I could not find that place. Send your village name.",
    menu: "What do you need?\n1 Plan my next 3 years of crops\n2 Get drought and flood alerts\n3 Ask anything else",
    welcomeBack: "Welcome back. ",
    askCrop: "What is growing now, or what did you just harvest?",
    askWater: "Is your field watered?\n1 Irrigated\n2 Rain only",
    askOutlook: "How much water do you expect next season?\n1 Same\n2 Less\n3 Much less",
    askPriority: "What matters most?\n1 Save water\n2 Most income\n3 Safest in a bad year",
    checking: (p) => `Checking 25 years of NASA data for your farm near ${p}...`,
    askSoil: "How is your soil?\n1 Good\n2 Tired or low yields\n3 Don’t know",
    buildsSoil: ", builds soil",
    detailFoot: "Reply WHY or MENU.",
    sow: { may: "sow in May", oct: "sow in October", spring: "sow in spring", nov: "sow in November", apr: "sow in April", sep: "sow in September", rains: "sow at the start of the rains", dry: "sow after the rains end" },
    coverSuffix: " cover crop",
    planWater: (pct, c, n) => {
      const nit = n === 2 ? " and adds nitrogen to tired soil" : n === 1 ? " and adds nitrogen to the soil" : "";
      if (pct === null || !c) return n ? `Adds nitrogen to the soil.` : "";
      if (Math.abs(pct) < 5) return `Uses about the same water as ${c}${nit}.`;
      return pct > 0 ? `Uses about ${pct}% less water than ${c}${nit}.` : `Uses about ${-pct}% more water than ${c}${nit}.`;
    },
    afterCrop: (c) => `After ${c}, your soil needs nitrogen back.`,
    legumesAdd: (l) => `${l} add it naturally.`,
    lessWater: (c) => `These crops need less water than ${c}.`,
    and: " and ",
    plansHead: "3 plans for the next 3 years:",
    kind: { water: "least water", income: "most income", drought: "safest in a dry year" },
    plansFoot: "Reply 1, 2 or 3 for details, or WHY.",
    noPlans: "Crop plans aren't ready right now. Your NASA data:",
    year: (y, c, sow) => `Year ${y}: ${c}${sow ? `, ${sow}` : ""}.`,
    water: (pct, c) => (pct >= 0 ? `Uses about ${pct}% less water than ${c}.` : `Uses about ${-pct}% more water than ${c}.`),
    money: (i, b) => `Income ${i}%, in a dry year ${b}%.`,
    moreFoot: "Reply MENU for more.",
    whyRain: (p, pct) => `NASA data: rain near ${p} in the last 30 days was ${pct}% of normal.`,
    whyKind: {
      water: "This plan needs the least water, so it suits a dry season.",
      income: "This plan earns the most if the rain holds.",
      drought: "This plan keeps the most income even in a dry year.",
    },
    soilDrier: (p) => `Soil near ${p} is drier than most years.`,
    soilWetter: (p) => `Soil near ${p} is wetter than usual.`,
    soilNormal: (p) => `Soil moisture near ${p} is normal.`,
    soilPct: (pct) => `NASA soil moisture: ${pct}%.`,
    noRain: "No rain is expected this week.",
    rainMm: (mm) => `About ${mm} mm of rain is expected this week.`,
    wait: "Wait 5-7 days to sow, or water first.",
    rainComing: "Rain is coming: sow after it, no need to water now.",
    ok: "Moisture is fine: a good time to sow. Water only if the topsoil is dry.",
    alertsOn: "You are signed up for alerts.\nWe will text you if a drought or heavy rain is coming.\nReply STOP ALERTS to cancel.",
    alertsOff: "Alerts are off. Reply MENU for more.",
    askAnything: "Type your question.",
    stopped: "You will not get any more messages. Text START to come back.",
    notUnderstood: "Sorry, I did not understand. Reply MENU.",
    droughtAlert: (p) => `Alert: Dry spell near ${p}.\nHold off sowing for 5 days.\nReply WHY.`,
    rainAlert: (p, d) => `Alert: Heavy rain expected near ${p} in ${d} days.\nClear drains and delay spraying.\nReply WHY.`,
    whyDrought: (p, pct) => `NASA data: rain near ${p} in the last 30 days was only ${pct}% of normal.`,
    whyRainAlert: (mm, d) => `The forecast shows about ${mm} mm of rain in the next ${d} days.`,
    noWhy: "Ask for a plan or alert first, then reply WHY. Reply MENU.",
    forecastDown: "The rain forecast isn't available right now.",
  },
  hi: {
    welcome: "FarmLine में आपका स्वागत है। हम NASA सैटेलाइट के बारिश, मिट्टी और मौसम के डेटा से आपकी फसल की योजना बनाने में मदद करते हैं। यह मुफ़्त है, आप कभी भी जवाब दे सकते हैं।\nशुरू करने के लिए अपना देश और पिन कोड भेजें, या गांव का नाम।\nउदाहरण: India 413512",
    confirm: (p) => `क्या आपका खेत ${p} के पास है?\n1 हाँ\n2 नहीं`,
    askVillage: "अपने गांव का नाम भेजें।",
    notFoundPlace: "वह जगह नहीं मिली। अपने गांव का नाम भेजें।",
    menu: "आपको क्या चाहिए?\n1 अगले 3 साल की फसल योजना\n2 सूखा और बाढ़ अलर्ट पाएं\n3 कुछ और पूछें",
    welcomeBack: "फिर से स्वागत है। ",
    askCrop: "अभी खेत में क्या उग रहा है, या आपने अभी क्या काटा?",
    askWater: "क्या आपके खेत में सिंचाई होती है?\n1 सिंचित\n2 सिर्फ़ बारिश",
    askOutlook: "अगले सीज़न में कितना पानी मिलने की उम्मीद है?\n1 उतना ही\n2 कम\n3 बहुत कम",
    askPriority: "सबसे ज़रूरी क्या है?\n1 पानी बचाना\n2 सबसे ज़्यादा आमदनी\n3 खराब साल में सबसे सुरक्षित",
    checking: (p) => `${p} के पास आपके खेत के लिए 25 साल का NASA डेटा देखा जा रहा है...`,
    askSoil: "आपकी मिट्टी कैसी है?\n1 अच्छी\n2 थकी हुई या कम पैदावार\n3 पता नहीं",
    buildsSoil: ", मिट्टी सुधारता है",
    detailFoot: "WHY या MENU भेजें।",
    sow: { may: "मई में बोएं", oct: "अक्टूबर में बोएं", spring: "वसंत में बोएं", nov: "नवंबर में बोएं", apr: "अप्रैल में बोएं", sep: "सितंबर में बोएं", rains: "बारिश शुरू होने पर बोएं (खरीफ)", dry: "बारिश खत्म होने के बाद बोएं (रबी)" },
    coverSuffix: " (हरी खाद)",
    planWater: (pct, c, n) => {
      const nit = n === 2 ? " और थकी मिट्टी में नाइट्रोजन लौटाता है" : n === 1 ? " और मिट्टी में नाइट्रोजन जोड़ता है" : "";
      if (pct === null || !c) return n ? "मिट्टी में नाइट्रोजन जोड़ता है।" : "";
      if (Math.abs(pct) < 5) return `${c} जितना ही पानी लेता है${nit}।`;
      return pct > 0 ? `${c} से करीब ${pct}% कम पानी लेता है${nit}।` : `${c} से करीब ${-pct}% ज़्यादा पानी लेता है${nit}।`;
    },
    afterCrop: (c) => `${c} के बाद मिट्टी को नाइट्रोजन वापस चाहिए।`,
    legumesAdd: (l) => `${l} इसे प्राकृतिक रूप से लौटाते हैं।`,
    lessWater: (c) => `इन फसलों को ${c} से कम पानी चाहिए।`,
    and: " और ",
    plansHead: "अगले 3 साल के लिए 3 योजनाएं:",
    kind: { water: "सबसे कम पानी", income: "सबसे ज़्यादा आमदनी", drought: "सूखे साल में सबसे सुरक्षित" },
    plansFoot: "जानकारी के लिए 1, 2 या 3 भेजें, या WHY।",
    noPlans: "फसल योजनाएं अभी तैयार नहीं हैं। आपका NASA डेटा:",
    year: (y, c, sow) => `साल ${y}: ${c}${sow ? `, ${sow}` : ""}।`,
    water: (pct, c) => (pct >= 0 ? `${c} से लगभग ${pct}% कम पानी।` : `${c} से लगभग ${-pct}% ज़्यादा पानी।`),
    money: (i, b) => `आमदनी ${i}%, सूखे साल में ${b}%।`,
    moreFoot: "और जानकारी के लिए MENU भेजें।",
    whyRain: (p, pct) => `NASA डेटा: पिछले 30 दिनों में ${p} के पास बारिश सामान्य की ${pct}% रही।`,
    whyKind: {
      water: "इस योजना में सबसे कम पानी लगता है, इसलिए सूखे मौसम में ठीक है।",
      income: "बारिश ठीक रहे तो यह योजना सबसे ज़्यादा कमाई देती है।",
      drought: "सूखे साल में भी यह योजना सबसे ज़्यादा आमदनी बचाती है।",
    },
    soilDrier: (p) => `${p} के पास मिट्टी ज़्यादातर सालों से सूखी है।`,
    soilWetter: (p) => `${p} के पास मिट्टी सामान्य से ज़्यादा गीली है।`,
    soilNormal: (p) => `${p} के पास मिट्टी में नमी सामान्य है।`,
    soilPct: (pct) => `NASA मिट्टी की नमी: ${pct}%।`,
    noRain: "इस हफ़्ते बारिश की उम्मीद नहीं है।",
    rainMm: (mm) => `इस हफ़्ते लगभग ${mm} मिमी बारिश की उम्मीद है।`,
    wait: "बुवाई 5-7 दिन रुककर करें, या पहले सिंचाई करें।",
    rainComing: "बारिश आने वाली है: उसके बाद बुवाई करें, अभी सिंचाई की ज़रूरत नहीं।",
    ok: "नमी ठीक है: बुवाई का अच्छा समय है। ऊपर की मिट्टी सूखी हो तभी सिंचाई करें।",
    alertsOn: "आप अलर्ट के लिए जुड़ गए हैं।\nसूखा या भारी बारिश आने पर हम आपको SMS करेंगे।\nरद्द करने के लिए STOP ALERTS भेजें।",
    alertsOff: "अलर्ट बंद हैं। और जानकारी के लिए MENU भेजें।",
    askAnything: "अपना सवाल लिखें।",
    stopped: "अब आपको कोई संदेश नहीं मिलेगा। वापस आने के लिए START भेजें।",
    notUnderstood: "माफ़ कीजिए, समझ नहीं आया। MENU भेजें।",
    droughtAlert: (p) => `अलर्ट: ${p} के पास सूखा।\n5 दिन बुवाई रोकें।\nWHY भेजें।`,
    rainAlert: (p, d) => `अलर्ट: ${d} दिन में ${p} के पास भारी बारिश की संभावना।\nनालियां साफ़ करें और छिड़काव टालें।\nWHY भेजें।`,
    whyDrought: (p, pct) => `NASA डेटा: पिछले 30 दिनों में ${p} के पास बारिश सामान्य की सिर्फ़ ${pct}% रही।`,
    whyRainAlert: (mm, d) => `पूर्वानुमान: अगले ${d} दिनों में लगभग ${mm} मिमी बारिश।`,
    noWhy: "पहले योजना या अलर्ट लें, फिर WHY भेजें। MENU भेजें।",
    forecastDown: "बारिश का पूर्वानुमान अभी उपलब्ध नहीं है।",
  },
  sw: {
    welcome: "Karibu FarmLine. Nitakusaidia kupanga mazao yako kwa kutumia data za setilaiti za NASA kuhusu mvua, udongo na hali ya hewa ya eneo lako. Ni bure, na unaweza kujibu wakati wowote.\nKuanza, tuma nchi yako na jina la mji au kijiji.\nMfano: Kenya Nakuru",
    confirm: (p) => `Je, shamba lako liko karibu na ${p}?\n1 Ndiyo\n2 Hapana`,
    askVillage: "Tuma jina la kijiji chako.",
    notFoundPlace: "Sikupata mahali hapo. Tuma jina la kijiji chako.",
    menu: "Unahitaji nini?\n1 Panga mazao ya miaka 3 ijayo\n2 Pata tahadhari za ukame na mafuriko\n3 Uliza swali lingine",
    welcomeBack: "Karibu tena. ",
    askCrop: "Nini kinaota sasa, au umevuna nini karibuni?",
    askWater: "Je, shamba lako linamwagiliwa?\n1 Linamwagiliwa\n2 Mvua tu",
    askOutlook: "Unatarajia maji kiasi gani msimu ujao?\n1 Sawa na sasa\n2 Kidogo\n3 Kidogo sana",
    askPriority: "Nini ni muhimu zaidi?\n1 Kuokoa maji\n2 Mapato zaidi\n3 Salama zaidi mwaka mbaya",
    checking: (p) => `Tunaangalia data za NASA za miaka 25 kwa shamba lako karibu na ${p}...`,
    askSoil: "Udongo wako ukoje?\n1 Mzuri\n2 Umechoka au mavuno kidogo\n3 Sijui",
    buildsSoil: ", hujenga udongo",
    detailFoot: "Jibu WHY au MENU.",
    sow: { may: "panda Mei", oct: "panda Oktoba", spring: "panda majira ya kuchipua", nov: "panda Novemba", apr: "panda Aprili", sep: "panda Septemba", rains: "panda mvua zikianza", dry: "panda baada ya mvua kuisha" },
    coverSuffix: " (zao la kufunika udongo)",
    planWater: (pct, c, n) => {
      const nit = n === 2 ? " na huongeza nitrojeni kwenye udongo uliochoka" : n === 1 ? " na huongeza nitrojeni kwenye udongo" : "";
      if (pct === null || !c) return n ? "Huongeza nitrojeni kwenye udongo." : "";
      if (Math.abs(pct) < 5) return `Hutumia maji karibu sawa na ${c}${nit}.`;
      return pct > 0 ? `Hutumia karibu ${pct}% maji kidogo kuliko ${c}${nit}.` : `Hutumia karibu ${-pct}% maji zaidi kuliko ${c}${nit}.`;
    },
    afterCrop: (c) => `Baada ya ${c}, udongo wako unahitaji nitrojeni tena.`,
    legumesAdd: (l) => `${l} huirudisha kwa asili.`,
    lessWater: (c) => `Mazao haya yanahitaji maji kidogo kuliko ${c}.`,
    and: " na ",
    plansHead: "Mipango 3 kwa miaka 3 ijayo:",
    kind: { water: "maji kidogo zaidi", income: "mapato zaidi", drought: "salama zaidi mwaka wa ukame" },
    plansFoot: "Jibu 1, 2 au 3 kwa maelezo, au WHY.",
    noPlans: "Mipango ya mazao haiko tayari sasa. Data yako ya NASA:",
    year: (y, c, sow) => `Mwaka ${y}: ${c}${sow ? `, ${sow}` : ""}.`,
    water: (pct, c) => (pct >= 0 ? `Hutumia karibu ${pct}% maji kidogo kuliko ${c}.` : `Hutumia karibu ${-pct}% maji zaidi kuliko ${c}.`),
    money: (i, b) => `Mapato ${i}%, mwaka wa ukame ${b}%.`,
    moreFoot: "Jibu MENU kwa zaidi.",
    whyRain: (p, pct) => `Data za NASA: mvua karibu na ${p} siku 30 zilizopita ilikuwa ${pct}% ya kawaida.`,
    whyKind: {
      water: "Mpango huu unahitaji maji kidogo zaidi, hivyo unafaa msimu mkavu.",
      income: "Mpango huu unaleta mapato zaidi mvua ikiwa nzuri.",
      drought: "Mpango huu unalinda mapato hata mwaka wa ukame.",
    },
    soilDrier: (p) => `Udongo karibu na ${p} ni mkavu kuliko miaka mingi.`,
    soilWetter: (p) => `Udongo karibu na ${p} una unyevu kuliko kawaida.`,
    soilNormal: (p) => `Unyevu wa udongo karibu na ${p} ni wa kawaida.`,
    soilPct: (pct) => `Unyevu wa udongo (NASA): ${pct}%.`,
    noRain: "Hakuna mvua inayotarajiwa wiki hii.",
    rainMm: (mm) => `Mvua ya karibu ${mm} mm inatarajiwa wiki hii.`,
    wait: "Subiri siku 5-7 kabla ya kupanda, au mwagilia kwanza.",
    rainComing: "Mvua inakuja: panda baada yake, hakuna haja ya kumwagilia sasa.",
    ok: "Unyevu ni mzuri: ni wakati mzuri wa kupanda. Mwagilia tu udongo wa juu ukiwa mkavu.",
    alertsOn: "Umejiandikisha kupata tahadhari.\nTutakutumia SMS ukame au mvua kubwa ikija.\nJibu STOP ALERTS kusitisha.",
    alertsOff: "Tahadhari zimezimwa. Jibu MENU kwa zaidi.",
    askAnything: "Andika swali lako.",
    stopped: "Hutapokea ujumbe zaidi. Tuma START kurudi.",
    notUnderstood: "Samahani, sikuelewa. Jibu MENU.",
    droughtAlert: (p) => `Tahadhari: Ukame karibu na ${p}.\nSubiri siku 5 kabla ya kupanda.\nJibu WHY.`,
    rainAlert: (p, d) => `Tahadhari: Mvua kubwa inatarajiwa karibu na ${p} ndani ya siku ${d}.\nSafisha mitaro na ahirisha kunyunyizia dawa.\nJibu WHY.`,
    whyDrought: (p, pct) => `Data za NASA: mvua karibu na ${p} siku 30 zilizopita ilikuwa ${pct}% tu ya kawaida.`,
    whyRainAlert: (mm, d) => `Utabiri: mvua ya karibu ${mm} mm katika siku ${d} zijazo.`,
    noWhy: "Omba mpango au tahadhari kwanza, kisha jibu WHY. Jibu MENU.",
    forecastDown: "Utabiri wa mvua haupatikani sasa hivi.",
  },
};

export { signed };
