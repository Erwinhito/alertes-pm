// Décide quelles offres on garde : le bon métier, le bon niveau, la bonne ville.
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ROLE = /\bproduct manager\b|\bproduct management\b.*\b(associate|analyst)\b|\b(associate|analyst)\b.*\bproduct management\b|\bapm\b|\bchef(fe)? de produits?\b/;
const WRONG_ROLE = /product marketing|marketing product|\bpmm\b|project manager|program(me)? manager|account (executive|manager)|product sales|sales manager|product support|product specialist|chef de produit marketing/;
const INTERN = /\bintern(ship)?\b|\bstage\b|\bstagiaire\b|\balternan|\bapprenti|\bwerkstudent\b|\bplacement\b|\bco-?op\b/;
const TOO_SENIOR = /\bsenior\b|\bsr\b|\bsnr\b|\blead\b(?! generation)|\bstaff\b|\bprincipal\b|\bgroup\b|\bdirector\b|\bdirecteur\b|\bdirectrice\b|\bhead of\b|\bvp\b|(?<!assistant )\bvice president\b|\bchief\b|\bexecutive director\b|\bmanaging director\b|\bpartner\b/;

export function titleVerdict(title) {
  const t = norm(title).replace(/[.,/()|–—-]+/g, ' ').replace(/\s+/g, ' ');
  if (!ROLE.test(t)) return 'role';
  if (WRONG_ROLE.test(t)) return 'role';
  if (INTERN.test(t)) return 'intern';
  // En banque, « Senior Associate » est un niveau intermédiaire, pas un poste senior.
  // « Associate or Vice President » est ouvert au niveau Associate : on le garde aussi.
  const level = t.replace(/\bsenior associate\b/g, 'associate').replace(/\bassociate (or|and) vice president\b/g, 'associate');
  if (TOO_SENIOR.test(level)) return 'senior';
  return 'ok';
}

export const isWantedTitle = (title) => titleVerdict(title) === 'ok';

const CITY_PATTERNS = [
  ['Londres', /\blondon\b|\blondres\b|\bcanary wharf\b/],
  ['Paris', /\bparis\b/],
  ['Dublin', /\bdublin\b/],
];

// « London, Ontario » ou « Paris, Texas » ne sont pas les villes recherchées.
const FALSE_CITY = /london,? (ontario|on\b|ca\b|canada|kentucky|ky\b)|new london|londonderry|paris,? (texas|tx\b|tennessee|tn\b|ontario)|dublin,? (ohio|oh\b|california|ca\b|georgia|ga\b)/;

export function citiesIn(locations) {
  const list = Array.isArray(locations) ? locations : [locations];
  const found = new Set();
  for (const location of list) {
    const text = norm(location || '');
    if (FALSE_CITY.test(text)) continue;
    for (const [city, pattern] of CITY_PATTERNS) if (pattern.test(text)) found.add(city);
  }
  return [...found];
}
