// Automatic grading of the rules players write down.
//
// A player's text is normalised (lower case, punctuation stripped) and matched against
// the patterns for the hidden rule they played. Patterns that mean "a stricter rule than
// the real one" are tried first, because "even numbers going up" mentions going up too.
// Anything that matches nothing is left for a person: run `npm run grade` daily, grade
// the leftovers by hand, and add a pattern here whenever several say the same thing.
// The grading script re-runs these over old sessions, so a new pattern needs no redeploy
// to catch up; deploying just lets new players see their result straight away.
//
// The starting set comes from the categories reported in the 2-4-6 literature
// (Wason 1960; Tweney et al. 1980; Vallée-Tourangeau et al. 1995): almost everyone who
// misses announces "even numbers", "increasing by two" or "equal intervals".

const W = (s) => new RegExp(`\\b(?:${s})\\b`);

export const PATTERNS = {
  ascending: {
    // Signs the player added a condition the real rule does not have.
    different: [
      { id: 'even', re: W('even|odd') },
      { id: 'by-two', re: /(?:\b(?:by|of|in|add|adding|plus|up|step|steps|interval|intervals|difference|gap|gaps|increment|increments|jump|jumps)\s*(?:of\s*)?(?:two|2)\b)|\+\s*2\b|\b2\s*(?:apart|more|higher|bigger|larger)\b/ },
      { id: 'by-n', re: /\b(?:by|of|add|adding|plus|step|steps|interval|intervals|difference|gap|gaps|increment|increments)\s*(?:of\s*)?(?:one|1|three|3|four|4|five|5|ten|10|\d+)\b/ },
      { id: 'equal-steps', re: /\b(?:same|equal|constant|fixed|regular|common|identical|uniform)\s+(?:amount|amounts|difference|differences|interval|intervals|step|steps|gap|gaps|increment|increments|spacing|increase|distance|jump|jumps)\b|\b(?:evenly|equally|regularly)\s+spaced\b|\barithmetic\b|\blinear\b|\bconsecutive\b/ },
      { id: 'multiples', re: W('multiple|multiples|double|doubles|doubled|doubling|times|factor|factors|divisible|square|squares|prime|primes') },
      { id: 'positive', re: W('positive|natural|non negative|nonnegative|above zero|greater than zero|more than zero') },
      { id: 'middle-average', re: /\b(?:middle|second|2nd)\b.*\b(?:average|mean|midpoint|half ?way)\b|\b(?:average|mean)\b.*\b(?:middle|second|2nd)\b/ },
      { id: 'sum', re: /\bsum\b|\badds? up\b|\btotal\b|\bfirst (?:two|2)\b.*\b(?:equal|equals|make|makes|give|gives)\b/ },
      { id: 'bounded', re: /\b(?:less|smaller|lower|fewer) than \d+\b|\b(?:under|below|at most|no more than|up to|max|maximum) \d+\b|\bbetween \d+ and \d+\b|\bsingle digit\b|\bdigits?\b/ },
    ],
    // Ways of saying "any three numbers in increasing order".
    same: [
      { id: 'increasing', re: W('increase|increases|increasing|increased|ascend|ascends|ascending|rise|rises|rising|grow|grows|growing|climb|climbs|climbing') },
      { id: 'going-up', re: /\b(?:go|goes|going|get|gets|getting|become|becomes|becoming|keep|keeps|keeping)\s+(?:up|bigger|larger|higher|greater)\b|\bgo(?:es|ing)? up(?:wards?)?\b|\bupwards?\b/ },
      { id: 'bigger-than-previous', re: /\b(?:bigger|larger|greater|higher|more)\s+than\s+(?:the\s+)?(?:previous|last|one before|preceding|earlier|first|second|before|prior)\b|\b(?:smaller|lower|less)\s+than\s+(?:the\s+)?(?:next|following|one after|later|second|third|after)\b/ },
      { id: 'each-bigger', re: /\b(?:each|every|next|following|subsequent|successive|later)\b.*\b(?:bigger|larger|greater|higher)\b/ },
      { id: 'small-to-large', re: /\b(?:small|smallest|low|lowest|little)\s+to\s+(?:big|biggest|large|largest|high|highest)\b|\bleft to right\b.*\b(?:bigger|larger|greater|higher)\b/ },
      { id: 'in-order', re: /\b(?:ascending|increasing|numerical|numeric|size|rising)\s+order\b|\bordered\b|\bsorted\b/ },
      { id: 'a-lt-b-lt-c', re: /\b[a-z]\s*<\s*[a-z]\s*<\s*[a-z]\b|\b(?:first|1st)\s*<\s*(?:second|2nd)\b|\bx\s*<\s*y\b/ },
    ],
  },
  // Other hidden rules have no patterns yet, so every answer waits for a person.
  distinct: { different: [], same: [] },
  positive: { different: [], same: [] },
  lastLargest: { different: [], same: [] },
};

// Words that turn a restriction into its opposite ("does not have to be even",
// "not necessarily by two", "any gap"). When one of these sits in a text that also
// matches a stricter-rule pattern, a person should read it.
const NEGATION = /\b(?:not|no|never|don t|dont|doesn t|doesnt|isn t|isnt|needn t|neednt|need not|without|regardless|irrespective|whatever|any|anything|doesn t matter|doesnt matter|does not matter|not necessarily|not always|not just|not only|more than just|or more|or greater|or larger|or bigger|at least|any amount|however much)\b/;

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'/g, ' ')
    .replace(/[^a-z0-9+<>\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grade a written rule against the hidden rule the player was given.
 * @returns {{verdict: 'same'|'different', id: string} | null} null means "a person should decide".
 */
export function gradeText(rule, text) {
  const p = PATTERNS[rule];
  const t = normalize(text);
  if (!p || !t) return null;

  const stricter = p.different.find((x) => x.re.test(t));
  if (stricter) return NEGATION.test(t) ? null : { verdict: 'different', id: stricter.id };

  const match = p.same.find((x) => x.re.test(t));
  if (match) return { verdict: 'same', id: match.id };
  return null;
}
