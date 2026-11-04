// Va chercher le salaire et l'expérience dans le texte de l'offre.
// Règle d'or : si on n'est pas sûr, on ne met rien. Jamais de chiffre inventé.

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10 };
const toNumber = (value) => (value === undefined ? undefined : /^\d/.test(value) ? Number(value) : NUMBER_WORDS[value.toLowerCase()]);
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|deux|trois|quatre|cinq|sept|huit|neuf|dix)';

const YEAR_PATTERNS = [
  new RegExp(`${NUM}\\s*(?:\\+\\s*)?(?:-|–|—|to|à|a|and|et)\\s*${NUM}\\s*\\+?\\s*(?:years?|yrs?|ans|années|annees)`, 'gi'),
  new RegExp(`${NUM}\\s*\\+?\\s*(?:\\(\\d+\\)\\s*)?(?:or more\\s*|ou plus\\s*)?(?:years?|yrs?|ans|années|annees)`, 'gi'),
];

const EXPERIENCE_CONTEXT = /experience|expérience|track record|background|worked|working in|as a product|in product|product management|en tant que|dans (le|un|une)/i;
const NOT_CANDIDATE = /\b(company|founded|history|for over|depuis plus|since|anniversary|heritage|old|years? ago|il y a|years? of (innovation|growth|history)|ans d'histoire)\b/i;
const CANDIDATE_CONTEXT = /\byou\b|\byour\b|required|requirement|qualifications?|minimum|at least|must have|ideally|vous|votre|requis|minimum|au moins/i;

function sentences(text) {
  return text.split(/\n+|(?<=[.;!?])\s+(?=[A-ZÀ-Ý•])/).map((s) => s.trim()).filter(Boolean);
}

export function extractExperience(text = '') {
  const candidates = [];
  for (const sentence of sentences(text)) {
    if (!EXPERIENCE_CONTEXT.test(sentence)) continue;
    if (sentence.length > 400) continue;
    const blockedHistory = NOT_CANDIDATE.test(sentence) && !CANDIDATE_CONTEXT.test(sentence);
    if (blockedHistory) continue;
    let matched = null;
    for (const pattern of YEAR_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(sentence);
      if (!m) continue;
      const a = toNumber(m[1]);
      const b = m[2] !== undefined ? toNumber(m[2]) : undefined;
      if (a === undefined) continue;
      matched = { min: a, max: b !== undefined && b > a ? b : undefined, open: /\+|or more|ou plus/i.test(m[0]) };
      break;
    }
    if (!matched || matched.min < 1 || matched.min > 20) continue;
    candidates.push({
      ...matched,
      sentence: sentence.replace(/^[•\-\s]+/, '').slice(0, 220),
      product: /product|produit/i.test(sentence),
      index: candidates.length,
    });
  }
  if (!candidates.length) return null;
  // La phrase qui parle de produit est la plus parlante. Entre plusieurs, on prend la plus basse :
  // « 2+ ans requis, 5+ ans idéalement » veut dire 2.
  const pool = candidates.some((c) => c.product) ? candidates.filter((c) => c.product) : candidates;
  const best = pool.reduce((low, c) => (c.min < low.min ? c : low));
  const lowest = Math.min(...candidates.map((c) => c.min));
  return {
    label: best.max ? `${best.min} à ${best.max} ans` : `${best.min}${best.open || !best.max ? ' ans et +' : ' ans'}`,
    min: best.min,
    lowest,
    sentence: best.sentence,
  };
}

const SALARY_WORDS = /salary|salaire|pay range|base pay|compensation|rémunération|remuneration|package|per annum|p\.a\.|annual|par an|\/an\b|brut|gross|ote\b/i;
const NOT_SALARY = /million|billion|milliard|\bmn\b|\bbn\b|revenue|funding|raised|chiffre d'affaires|customers|turnover|levée/i;

// Monnaie attendue par ville : une fourchette en dollars sur une offre à Londres
// concerne en général les USA, on ne l'affiche donc pas.
const CURRENCY_FOR_CITY = { Londres: ['£'], Paris: ['€'], Dublin: ['€'] };

function parseAmount(raw, kFlag) {
  const digits = raw.replace(/[\s  .,](?=\d{3}\b)/g, '').replace(',', '.');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const annual = kFlag ? value * 1000 : value;
  return annual >= 20_000 && annual <= 600_000 ? Math.round(annual) : null;
}

function amountsIn(sentence) {
  const found = [];
  const AMOUNT = '(\\d{1,3}(?:[\\s\\u00a0\\u202f.,]\\d{3})+|\\d{2,6}(?:[.,]\\d)?)\\s*([kK])?';
  const before = new RegExp(`(£|€|GBP|EUR)\\s*${AMOUNT}`, 'g');
  const after = new RegExp(`${AMOUNT}\\s*(£|€|GBP|EUR|euros?|pounds?)(?![a-z])`, 'gi');
  for (const m of sentence.matchAll(before)) {
    const value = parseAmount(m[2], m[3]);
    if (value) found.push({ value, currency: /£|GBP/.test(m[1]) ? '£' : '€', index: m.index });
  }
  for (const m of sentence.matchAll(after)) {
    const value = parseAmount(m[1], m[2]);
    if (value) found.push({ value, currency: /£|GBP|pound/i.test(m[3]) ? '£' : '€', index: m.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

const thousands = (value) => {
  const k = value / 1000;
  return Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
};
const money = (value, currency) => (currency === '£' ? `£${thousands(value)}k` : `${thousands(value)} k€`);
const moneyRange = (low, high, currency) =>
  (currency === '£' ? `${money(low, '£')} à ${money(high, '£')}` : `${thousands(low)} à ${thousands(high)} k€`);

export function extractSalary(text = '', cities = []) {
  const allowed = new Set(cities.flatMap((city) => CURRENCY_FOR_CITY[city] ?? []));
  for (const sentence of sentences(text)) {
    if (sentence.length > 500 || NOT_SALARY.test(sentence)) continue;
    const amounts = amountsIn(sentence).filter((a) => !allowed.size || allowed.has(a.currency));
    if (!amounts.length) continue;
    const hasWord = SALARY_WORDS.test(sentence);
    const first = amounts[0];
    const second = amounts.find((a) => a !== first && a.currency === first.currency && a.value > first.value);
    if (second && (hasWord || second.value / first.value < 2.5)) {
      return { label: moneyRange(first.value, second.value, first.currency), sentence: sentence.slice(0, 220) };
    }
    if (hasWord) return { label: money(first.value, first.currency), sentence: sentence.slice(0, 220) };
  }
  return null;
}
