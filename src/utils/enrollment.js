/** Parallel list of course ids for Firestore rules (enrollment checks). */
export function courseIdsFromEnrolled(enrolledCourses) {
  if (!enrolledCourses?.length) return [];
  return [...new Set(enrolledCourses.map((e) => e.courseId).filter(Boolean))];
}
