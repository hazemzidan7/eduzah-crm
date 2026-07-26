/** XP / levels / badges — single source of truth for learner gamification */

export const XP_ENROLL = 50;
export const XP_LESSON = 15;
export const XP_COURSE_COMPLETE = 100;

export const BADGE_FIRST_COURSE = "first_course";
export const BADGE_LESSON_10 = "lessons_10";
export const BADGE_COURSE_COMPLETE = "course_graduate";

export function levelFromXp(xp) {
  const x = Math.max(0, Number(xp) || 0);
  return Math.min(99, 1 + Math.floor(x / 200));
}

export function xpIntoCurrentLevel(xp) {
  const x = Math.max(0, Number(xp) || 0);
  const lvl = levelFromXp(x);
  const start = (lvl - 1) * 200;
  const end = lvl * 200;
  const pct = end > start ? Math.round(((x - start) / (end - start)) * 100) : 0;
  return { level: lvl, pct: Math.min(100, Math.max(0, pct)), nextAt: end };
}

function pushNotif(user, message) {
  const prev = Array.isArray(user.userNotifications) ? user.userNotifications : [];
  const row = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    createdAt: new Date().toISOString(),
    read: false,
  };
  return [...prev, row].slice(-25);
}

/** In-app message without XP (registration, enrollment workflow, etc.) */
export function appendPlainNotification(user, message) {
  return pushNotif(user, message);
}

/** Call when user gains a *new* enrollment row (not duplicate). */
export function patchAfterEnroll(user, courseTitle) {
  const prevEc = user.enrolledCourses || [];
  const wasFirst = prevEc.length === 0;
  const xp = (user.xp || 0) + XP_ENROLL;
  const level = levelFromXp(xp);
  const badges = new Set([...(user.badges || [])]);
  if (wasFirst) badges.add(BADGE_FIRST_COURSE);
  const userNotifications = pushNotif(
    user,
    `+${XP_ENROLL} XP — ${courseTitle || "كورس جديد"}`,
  );
  return { xp, level, badges: [...badges], userNotifications };
}

/** Call when a lesson index is newly marked complete. */
export function patchAfterLesson(user, totalLessonsCompletedAcrossCourses) {
  const xp = (user.xp || 0) + XP_LESSON;
  const level = levelFromXp(xp);
  const badges = new Set([...(user.badges || [])]);
  if (totalLessonsCompletedAcrossCourses >= 10) badges.add(BADGE_LESSON_10);
  const userNotifications = pushNotif(user, `+${XP_LESSON} XP — درس مكتمل`);
  return { xp, level, badges: [...badges], userNotifications };
}

/** When course progress hits 100%. */
export function patchCourseComplete(user, courseTitle) {
  if ((user.badges || []).includes(BADGE_COURSE_COMPLETE)) {
    /* still grant XP once per completion event — caller should avoid duplicate */
  }
  const xp = (user.xp || 0) + XP_COURSE_COMPLETE;
  const level = levelFromXp(xp);
  const badges = new Set([...(user.badges || []), BADGE_COURSE_COMPLETE]);
  const userNotifications = pushNotif(
    user,
    `+${XP_COURSE_COMPLETE} XP — أتممت ${courseTitle || "الكورس"}`,
  );
  return { xp, level, badges: [...badges], userNotifications };
}
