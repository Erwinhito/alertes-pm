// Petites briques communes : requêtes réseau, HTML vers texte, travail en parallèle.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(url, { method = 'GET', headers = {}, body, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.text();
    } catch (err) {
      if (err.fatal || attempt >= retries) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
}

export const getText = (url, opts) => request(url, opts);
export const getJson = async (url, opts) => JSON.parse(await request(url, opts));
export const postJson = async (url, data, headers = {}) =>
  JSON.parse(await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(data),
  }));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', bull: '•', pound: '£', euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê' };

export function decodeEntities(text = '') {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1].toLowerCase() === 'x';
      const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Transforme le HTML des offres en texte simple. L'app n'affiche que du texte :
// aucun code venu d'un site externe ne peut donc s'exécuter chez toi.
export function htmlToText(html = '') {
  let text = decodeEntities(html); // certaines sources encodent leur HTML deux fois
  text = text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

export const CITIES = ['London', 'Paris', 'Dublin'];
export const QUERY = 'product manager';
export { sleep };
