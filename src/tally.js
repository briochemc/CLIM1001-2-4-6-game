// What one finished session contributes to the class tally. Used by the worker when a
// player finishes and by scripts/grade.mjs when it rebuilds the tally after grading.
//
// Keys:
//   finished                       people who wrote down a rule
//   graded                         ...whose rule has been checked
//   verdict:V                      checked people whose rule was V (same | different)
//   conf:C|verdict:V               ...split by how sure they said they were
//   verdict:V|tests:K              ...split by how many sets they tested
//   verdict:V|tests:K|no           how many of those sets did not fit, summed
//
// Only checked sessions feed the charts, so every chart is over the same people.
// Instructors' sessions are counted under keys prefixed "staff|", so student numbers
// never include them; instructors can view students, staff, or both.

export function tallyRows(session) {
  const rows = [['finished', 1]];
  const v = session.verdict;
  if (v) {
    rows.push(
      ['graded', 1],
      [`verdict:${v}`, 1],
      [`conf:${session.confidence}|verdict:${v}`, 1],
      [`verdict:${v}|tests:${session.n_attempts}`, 1],
    );
    if (session.n_no > 0) rows.push([`verdict:${v}|tests:${session.n_attempts}|no`, session.n_no]);
  }
  const prefix = session.role === 'instructor' ? 'staff|' : '';
  return rows.map(([key, n]) => [prefix + key, n]);
}
