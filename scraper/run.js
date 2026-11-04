// Chef d'orchestre : collecte, filtre, compare avec le dernier passage, notifie.
//   node scraper/run.js                 scan normal
//   node scraper/run.js --dry-run       n'écrit rien et n'envoie rien
//   node scraper/run.js --only=Google,Amazon --verbose
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapPool } from './lib.js';
import { citiesIn, isWantedTitle } from './filter.js';
import { extractExperience, extractSalary } from './extract.js';
import { isCandidate, sourceFor } from './sources/index.js';
import { notify } from './push.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').map((s) => s.trim().toLowerCase());

const MAX_YEARS = 8; // au-delà, l'offre n'est plus Junior / Product Manager
const DESCRIPTION_LIMIT = 12_000;
const PATHS = {
  companies: resolve(ROOT, 'config/companies.json'),
  state: resolve(ROOT, 'data/state.json'),
  jobs: resolve(ROOT, 'web/data/jobs.json'),
  status: resolve(ROOT, 'web/data/status.json'),
};

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const log = (...parts) => VERBOSE && console.log(...parts);

function slug(text) {
  return text.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildOffer(company, job) {
  const cities = citiesIn(job.locations);
  if (!cities.length || !isWantedTitle(job.title)) return null;
  const experience = extractExperience(job.text ?? '');
  // On écarte si même le plus petit chiffre de l'annonce est trop haut.
  if (experience && experience.lowest >= MAX_YEARS) {
    log(`  écartée (${experience.lowest} ans) : ${company.name} - ${job.title}`);
    return null;
  }
  const salary = extractSalary(job.text ?? '', cities);
  return {
    id: `${slug(company.name)}-${slug(String(job.sourceId)).slice(-48)}`,
    company: company.name,
    category: company.category,
    title: job.title.trim(),
    cities,
    url: job.url,
    postedAt: job.postedAt ?? null,
    salary: salary ? { label: salary.label, sentence: salary.sentence } : null,
    experience: experience ? { label: experience.label, sentence: experience.sentence } : null,
    description: (job.text ?? '').slice(0, DESCRIPTION_LIMIT),
  };
}

async function scanCompany(company, knownById) {
  const source = sourceFor(company);
  const listed = await source.list(company);
  const unique = [...new Map(listed.map((j) => [String(j.sourceId), j])).values()];
  const candidates = unique.filter(isCandidate);
  const offers = await mapPool(candidates, 3, async (job) => {
    const id = `${slug(company.name)}-${slug(String(job.sourceId)).slice(-48)}`;
    const known = knownById.get(id);
    // Offre déjà connue : on réutilise son texte pour ne pas re-solliciter le site.
    if (known && !job.needsDetail) return { ...known, postedAt: job.postedAt ?? known.postedAt };
    const merged = source.detail ? { ...job, ...(await source.detail(job, company)) } : job;
    return buildOffer(company, merged);
  });
  return { raw: unique.length, offers: offers.filter(Boolean) };
}

const companies = JSON.parse(readFileSync(PATHS.companies, 'utf8'))
  .filter((c) => !ONLY || ONLY.includes(c.name.toLowerCase()));

const state = readJson(PATHS.state, { seen: {}, seededCompanies: [] });
const previousJobs = readJson(PATHS.jobs, { jobs: [] }).jobs;
const previousStatus = new Map(readJson(PATHS.status, { sources: [] }).sources.map((s) => [s.company, s]));
const knownById = new Map(previousJobs.map((j) => [j.id, j]));
const now = new Date().toISOString();

const results = await mapPool(companies, 6, async (company) => {
  if (!company.source) return { company, covered: false };
  try {
    const started = Date.now();
    const { raw, offers } = await scanCompany(company, knownById);
    log(`${company.name.padEnd(16)} ${String(raw).padStart(4)} vues  ${String(offers.length).padStart(3)} gardées  ${Date.now() - started} ms`);
    return { company, covered: true, ok: true, raw, offers };
  } catch (err) {
    console.error(`ÉCHEC ${company.name} : ${err.message}`);
    return { company, covered: true, ok: false, error: err.message };
  }
});

const jobs = [];
const fresh = [];
const seeded = new Set(state.seededCompanies);
const scanned = new Set(results.filter((r) => r.ok).map((r) => r.company.name));

for (const job of previousJobs) {
  // Une source en panne ne doit pas effacer ses offres ; une boîte hors de ce scan non plus.
  if (!scanned.has(job.company)) jobs.push(job);
}
for (const result of results) {
  if (!result.ok) continue;
  const name = result.company.name;
  const firstScanOfCompany = !seeded.has(name);
  for (const offer of result.offers) {
    const firstSeenAt = state.seen[offer.id] ?? now;
    if (!state.seen[offer.id]) {
      state.seen[offer.id] = now;
      if (!firstScanOfCompany) fresh.push(offer);
    }
    jobs.push({ ...offer, firstSeenAt });
  }
  seeded.add(name);
}
state.seededCompanies = [...seeded].sort();

const ageKey = (job) => job.firstSeenAt ?? '';
jobs.sort((a, b) => ageKey(b).localeCompare(ageKey(a)) || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));

const sources = results.map(({ company, covered, ok, raw, offers, error }) => {
  const previous = previousStatus.get(company.name);
  return {
    company: company.name,
    category: company.category,
    state: !covered ? 'uncovered' : ok ? (raw === 0 ? 'empty' : 'ok') : 'error',
    raw: raw ?? null,
    kept: offers?.length ?? null,
    error: error ?? null,
    lastSuccess: ok ? now : previous?.lastSuccess ?? null,
  };
});

// Un scan partiel (--only) ne doit pas effacer l'état des autres boîtes.
const scannedNames = new Set(sources.map((s) => s.company));
const allSources = [...sources, ...[...previousStatus.values()].filter((s) => !scannedNames.has(s.company))];

console.log(`${jobs.length} offres au total, ${fresh.length} nouvelles, ${sources.filter((s) => s.state === 'error').length} source(s) en échec.`);
if (VERBOSE) {
  for (const job of jobs) {
    console.log(`  [${job.cities.join('/')}] ${job.company} - ${job.title} | ${job.salary?.label ?? 'salaire ?'} | ${job.experience?.label ?? 'exp ?'}`);
  }
}

if (!DRY) {
  mkdirSync(dirname(PATHS.state), { recursive: true });
  mkdirSync(dirname(PATHS.jobs), { recursive: true });
  writeFileSync(PATHS.state, `${JSON.stringify(state, null, 1)}\n`);
  writeFileSync(PATHS.jobs, `${JSON.stringify({ updatedAt: now, jobs }, null, 1)}\n`);
  writeFileSync(PATHS.status, `${JSON.stringify({ updatedAt: now, sources: allSources }, null, 1)}\n`);
  await notify(fresh);
}
