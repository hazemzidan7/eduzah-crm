import { createContext, useContext, useState, useEffect } from "react";

const LangCtx = createContext(null);
const LANG_KEY = "eduzah-lang";

function readStoredLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "ar" || v === "en") return v;
  } catch { /* ignore */ }
  return "ar";
}

export const TRANS = {
  ar: {
    // Navbar
    home:"الرئيسية", courses:"الكورسات", news:"الأخبار", services:"الخدمات",
    login:"دخول", register:"سجّل", logout:"خروج", dashboard:"داشبورد",
    myCourses:"كورساتي", myExams:"امتحاناتي", myStudents:"الطلاب",
    adminLabel:"مدير", instructorLabel:"مدرب", studentLabel:"طالب",
    // Landing
    hero_badge:"شركة سوفتوير متخصصة في التدريبات التقنية",
    hero_h1:"Eduzah", hero_h1b:"شركة سوفتوير وتدريب تقني",
    hero_sub:"شركة Eduzah متخصصة في تقديم التدريبات في مجالات تطوير البرمجيات، الذكاء الاصطناعي، وتقنيات المعلومات — بأيدي مدربين خبراء ومناهج عملية احترافية.",
    explore:"استعرض الكورسات", joinFree:"انضم مجاناً",
    featuredSec:"كورسات مميزة", topPrograms:"أفضل برامجنا",
    handpicked:"كورسات مختارة بعناية من فريقنا",
    viewAll:"عرض الكل ←", latestNewsSec:"آخر الأخبار", allNews:"كل الأخبار ←",
    studentStories:"قصص الطلاب", whatTheySay:"ماذا قالوا؟",
    readyCTA:"جاهز لتطوير مسيرتك أو مؤسستك؟", join5000:"انضم لأكثر من 5,000 متدرب اختاروا Eduzah",
    getStarted:"ابدأ الآن", browseCourses:"استعرض الكورسات",
    quickLinks:"روابط سريعة", contactLabel:"تواصل معنا",
    // Services
    servicesHero:"حلول البرمجيات والخدمات",
    servicesSub:"مواقع وتطبيقات وحلول ذكاء اصطناعي مخصصة لعملك",
    learnMore:"اعرف أكثر ←", needProject:"محتاج مشروع مخصص؟",
    contactWA:"تواصل عبر واتساب", backToServices:"← رجوع للخدمات",
    techUsed:"التقنيات المستخدمة", whatWeOffer:"ما نقدمه",
    ourProcess:"طريقة عملنا", whyUs:"لماذا Eduzah؟",
    // Courses
    allPrograms:"كل البرامج", trainingCourses:"الكورسات التدريبية",
    enrollNow:"سجّل الآن", continueLearning:"متابعة ▶",
    // Auth
    welcomeBack:"مرحباً بعودتك", emailLabel:"البريد الإلكتروني",
    passwordLabel:"كلمة المرور", loginBtn:"دخول",
    noAccount:"مش عندك حساب؟", registerNowLink:"سجّل دلوقتي",
    joinEduzah:"انضم لـ Eduzah", nameLabel:"الاسم الكامل",
    phoneLabel:"الهاتف", accountType:"نوع الحساب",
    createAccBtn:"إنشاء الحساب", haveAccount:"عندك حساب؟", loginLink:"سجّل دخولك",
    pendingNote:"حسابك سيُراجع من قِبَل المدير خلال 24 ساعة",
    accountCreated:"تم إنشاء حسابك!", waitAdmin:"في انتظار موافقة الإدارة.",
    fillAll:"كمّل البيانات كلها",
    // Labels
    location:"الموقع", phone:"الهاتف", email:"البريد الإلكتروني",
    trainees:"متدرب", partners:"مؤسسة شريكة", rating:"تقييم", years:"سنوات",
    recorded:"مسجّل", liveOnline:"أونلاين مباشر", offline:"حضوري",
    featured:"مميز", completed:"مكتمل", or:"أو", weeks:"أسبوع",
    hours:"ساعة", projects:"مشروع", reviews:"تقييم",
    announcement:"إعلان", achievement:"إنجاز", partnership:"شراكة",
    update:"تحديث", event:"حدث",
    adminRole:"مدير", trainerRole:"مدرب", studentRole:"طالب",
  },
  en: {
    // Navbar
    home:"Home", courses:"Courses", news:"News", services:"Services",
    login:"Login", register:"Register", logout:"Logout", dashboard:"Dashboard",
    myCourses:"My Courses", myExams:"My Exams", myStudents:"Students",
    adminLabel:"Admin", instructorLabel:"Instructor", studentLabel:"Student",
    // Landing
    hero_badge:"Software Company Specialized in Technical Training",
    hero_h1:"Eduzah", hero_h1b:"Software & Technical Training",
    hero_sub:"Eduzah is a software company specialized in technical training across software development, AI, and information technology — delivered by expert instructors with hands-on curricula.",
    explore:"Explore Courses", joinFree:"Join Free",
    featuredSec:"FEATURED COURSES", topPrograms:"Our Top Programs",
    handpicked:"Handpicked courses by our team",
    viewAll:"View All →", latestNewsSec:"LATEST NEWS", allNews:"All News →",
    studentStories:"STUDENT STORIES", whatTheySay:"What They Say",
    readyCTA:"Ready to Elevate Your Career or Organization?", join5000:"Join 5,000+ trainees who chose Eduzah",
    getStarted:"Get Started", browseCourses:"Browse Courses",
    quickLinks:"Quick Links", contactLabel:"Contact",
    // Services
    servicesHero:"Software Solutions & Services",
    servicesSub:"Custom software, web apps, and AI solutions for your business",
    learnMore:"Learn More →", needProject:"Need a Custom Project?",
    contactWA:"Contact on WhatsApp", backToServices:"← Back to Services",
    techUsed:"Technologies Used", whatWeOffer:"What We Offer",
    ourProcess:"Our Process", whyUs:"Why Eduzah?",
    // Courses
    allPrograms:"ALL PROGRAMS", trainingCourses:"Training Courses",
    enrollNow:"Enroll Now", continueLearning:"Continue ▶",
    // Auth
    welcomeBack:"Welcome Back", emailLabel:"Email Address",
    passwordLabel:"Password", loginBtn:"Login",
    noAccount:"Don't have an account?", registerNowLink:"Register Now",
    joinEduzah:"Join Eduzah", nameLabel:"Full Name",
    phoneLabel:"Phone Number", accountType:"Account Type",
    createAccBtn:"Create Account", haveAccount:"Already have an account?", loginLink:"Login",
    pendingNote:"Your account will be reviewed by the Admin within 24 hours",
    accountCreated:"Account Created!", waitAdmin:"Waiting for Admin approval.",
    fillAll:"Please fill all required fields",
    // Labels
    location:"Location", phone:"Phone", email:"Email",
    trainees:"Trainees", partners:"Partners", rating:"Rating", years:"Years",
    recorded:"Recorded", liveOnline:"Live Online", offline:"Offline",
    featured:"Featured", completed:"completed", or:"or", weeks:"weeks",
    hours:"hours", projects:"projects", reviews:"reviews",
    announcement:"Announcement", achievement:"Achievement", partnership:"Partnership",
    update:"Update", event:"Event",
    adminRole:"Admin", trainerRole:"Trainer", studentRole:"Student",
  }
};

export function LangProvider({ children }) {
  const [lang, setLang] = useState(readStoredLang);

  useEffect(() => {
    document.documentElement.dir  = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch { /* ignore */ }
  }, [lang]);

  const toggle = () => setLang(l => l === "ar" ? "en" : "ar");
  const t = (key) => TRANS[lang][key] ?? key;

  return (
    <LangCtx.Provider value={{ lang, toggle, t }}>
      {children}
    </LangCtx.Provider>
  );
}
export const useLang = () => useContext(LangCtx);
