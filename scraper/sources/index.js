// Un connecteur par système de recrutement.
// Chaque connecteur renvoie { jobs, raw } : `raw` est le nombre d'offres vues avant filtrage,
// ce qui permet de repérer un connecteur cassé (0 offre brute = suspect).
// Une offre : { sourceId, title, locations[], url, postedAt, text, needsDetail? }
// `detail(job, company)` complète le texte, seulement pour les offres qui passent le filtre.
import { CITIES, QUERY, getJson, getText, htmlToText, postJson, sleep } from '../lib.js';
import { citiesIn, isWantedTitle } from '../filter.js';

const iso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const fromUnix = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

const greenhouse = {
  async list({ board }) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
    return data.jobs.map((j) => ({
      sourceId: String(j.id),
      title: j.title,
      locations: [j.location?.name, ...(j.offices ?? []).map((o) => o.location || o.name)].filter(Boolean),
      url: j.absolute_url,
      postedAt: iso(j.first_published || j.updated_at),
    }));
  },
  async detail(job, { board }) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${job.sourceId}?pay_transparency=true`);
    const pay = (data.pay_input_ranges ?? []).map((r) => `Salary ${r.currency_type} ${r.min_cents / 100} - ${r.currency_type} ${r.max_cents / 100}`).join('\n');
    return { text: `${htmlToText(data.content)}\n${pay}`.trim() };
  },
};

const lever = {
  async list({ board }) {
    const data = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return data.map((j) => ({
      sourceId: j.id,
      title: j.text,
      locations: [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean),
      url: j.hostedUrl,
      postedAt: iso(j.createdAt),
      text: [htmlToText(j.description), ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), htmlToText(j.additional)].join('\n\n'),
    }));
  },
};

const ashby = {
  async list({ board }) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
    return data.jobs.filter((j) => j.isListed !== false).map((j) => ({
      sourceId: j.id,
      title: j.title,
      locations: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean),
      url: j.jobUrl,
      postedAt: iso(j.publishedAt),
      text: `${j.descriptionPlain || htmlToText(j.descriptionHtml)}\n\nCompensation: ${j.compensation?.compensationTierSummary ?? ''}`.trim(),
    }));
  },
};

const amazon = {
  async list() {
    const jobs = [];
    for (const country of ['GBR', 'FRA', 'IRL']) {
      for (let offset = 0; offset < 300; offset += 100) {
        const data = await getJson(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(QUERY)}&normalized_country_code%5B%5D=${country}&result_limit=100&offset=${offset}&sort=recent`);
        for (const j of data.jobs ?? []) {
          jobs.push({
            sourceId: j.id_icims || j.id,
            title: j.title,
            locations: [j.normalized_location || j.location, j.location, ...(j.locations ?? []).map(locationName)].filter(Boolean),
            url: `https://www.amazon.jobs${j.job_path}`,
            postedAt: iso(j.posted_date),
            text: htmlToText(`${j.description}<br><br><b>Basic qualifications</b><br>${j.basic_qualifications}<br><br><b>Preferred qualifications</b><br>${j.preferred_qualifications}`),
          });
        }
        if (!data.jobs?.length || data.jobs.length < 100) break;
      }
    }
    return jobs;
  },
};
function locationName(raw) {
  try { return JSON.parse(raw).normalizedLocation; } catch { return typeof raw === 'string' ? raw : null; }
}

const eightfold = {
  async list({ host, domain }) {
    const jobs = [];
    for (const city of CITIES) {
      for (let start = 0; start < 60; start += 10) {
        const data = await getJson(`https://${host}/api/apply/v2/jobs?domain=${domain}&query=${encodeURIComponent(QUERY)}&location=${city}&start=${start}&num=10`);
        for (const j of data.positions ?? []) {
          jobs.push({
            sourceId: String(j.id),
            title: j.name,
            locations: j.locations?.length ? j.locations : [j.location],
            url: j.canonicalPositionUrl,
            postedAt: fromUnix(j.t_create),
            text: htmlToText(j.job_description),
          });
        }
        if ((data.positions ?? []).length < 10) break;
      }
    }
    return jobs;
  },
};

const microsoft = {
  // Microsoft bloque vite les requêtes répétées : recherche courte, une ville à la fois.
  async list() {
    const jobs = [];
    for (const city of CITIES) {
      const { data } = await getJson(`https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=product&location=${city}&start=0`);
      for (const j of data?.positions ?? []) {
        jobs.push({
          sourceId: String(j.id),
          title: j.name,
          locations: [...(j.standardizedLocations ?? []), ...(j.locations ?? [])],
          url: `https://apply.careers.microsoft.com${j.positionUrl}`,
          postedAt: fromUnix(j.postedTs),
        });
      }
      await sleep(1500);
    }
    return jobs;
  },
  async detail(job) {
    const { data } = await getJson(`https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=${job.sourceId}&domain=microsoft.com&hl=en`);
    return { text: htmlToText(data.jobDescription) };
  },
};

const oracle = {
  async list({ host, site }) {
    const base = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations`;
    const finder = (extra = '') => `&finder=findReqs;siteNumber=${site},facetsList=LOCATIONS,limit=25,keyword=%22${encodeURIComponent(QUERY)}%22,sortBy=POSTING_DATES_DESC${extra}`;
    const first = (await getJson(base + finder())).items[0];
    const facets = (first.locationsFacet ?? []).filter((f) => citiesIn(f.Name).length || /united kingdom|france|ireland/i.test(f.Name));
    const facetId = (f) => f.Id;
    const jobs = [];
    for (const facet of facets) {
      for (let offset = 0; offset < 200; offset += 25) {
        const item = (await getJson(base + finder(`,lastSelectedFacet=LOCATIONS,selectedLocationsFacet=${facetId(facet)},offset=${offset}`))).items[0];
        const rows = item.requisitionList ?? [];
        for (const j of rows) {
          jobs.push({
            sourceId: j.Id,
            title: j.Title,
            locations: [j.PrimaryLocation, ...(j.secondaryLocations ?? []).map((l) => l.Name)].filter(Boolean),
            url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
            postedAt: iso(j.PostedDate),
          });
        }
        if (rows.length < 25) break;
      }
    }
    return jobs;
  },
  async detail(job, { host, site }) {
    const data = await getJson(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${job.sourceId}%22,siteNumber=${site}`);
    const d = data.items?.[0] ?? {};
    return { text: htmlToText([d.ExternalDescriptionStr, d.ExternalResponsibilitiesStr, d.ExternalQualificationsStr].filter(Boolean).join('<br><br>')) };
  },
};

// Workday range ses filtres de lieu dans un arbre : on y cherche nos 3 villes.
function workdayCityFacets(facets, found = [], parent) {
  for (const facet of facets ?? []) {
    const name = facet.facetParameter ?? parent;
    for (const value of facet.values ?? []) {
      if (value.values) workdayCityFacets([value], found, name);
      else if (name === 'locations' && citiesIn(value.descriptor).length) found.push(value.id);
    }
  }
  return found;
}

const workday = {
  async list({ tenant, pod, site }) {
    const root = `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;
    const search = (appliedFacets, offset) => postJson(`${root}/jobs`, { appliedFacets, limit: 20, offset, searchText: QUERY });
    const cityIds = workdayCityFacets((await search({}, 0)).facets);
    if (!cityIds.length) throw new Error('filtre de villes introuvable');
    const jobs = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const rows = (await search({ locations: cityIds }, offset)).jobPostings ?? [];
      for (const j of rows) {
        const location = j.locationsText ?? j.bulletFields?.[1];
        jobs.push({
          sourceId: j.externalPath,
          title: j.title,
          locations: [location],
          // Le filtre garantit la ville, mais « 2 Locations » cache la liste exacte.
          needsDetail: !citiesIn(location).length,
          url: `https://${tenant}.${pod}.myworkdayjobs.com/${site}${j.externalPath}`,
        });
      }
      if (rows.length < 20) break;
    }
    return jobs;
  },
  async detail(job, { tenant, pod, site }) {
    const data = await getJson(`https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${job.sourceId}`, { headers: { Accept: 'application/json' } });
    const info = data.jobPostingInfo ?? {};
    return {
      text: htmlToText(info.jobDescription),
      locations: [info.location, ...(info.additionalLocations ?? []), info.jobRequisitionLocation?.descriptor].filter(Boolean),
      postedAt: iso(info.startDate),
      url: info.externalUrl || job.url,
    };
  },
};

const google = {
  async list() {
    const jobs = [];
    for (const city of CITIES) {
      for (let page = 1; page <= 3; page++) {
        const html = await getText(`https://www.google.com/about/careers/applications/jobs/results/?q=%22${encodeURIComponent(QUERY)}%22&location=${city}&page=${page}`);
        const block = html.match(/AF_initDataCallback\(\{key: 'ds:1'[\s\S]*?data:([\s\S]*?), sideChannel/);
        if (!block) throw new Error('format Google inconnu');
        const rows = JSON.parse(block[1])[0] ?? [];
        for (const r of rows) {
          jobs.push({
            sourceId: r[0],
            title: r[1],
            locations: (r[9] ?? []).map((l) => l[0]),
            url: `https://www.google.com/about/careers/applications/jobs/results/${r[0]}`,
            postedAt: fromUnix(r[12]?.[0]),
            text: htmlToText([r[10]?.[1], '<b>Responsibilities</b>', r[3]?.[1], r[4]?.[1], r[19]?.[1]].filter(Boolean).join('<br>')),
          });
        }
        if (rows.length < 20) break;
      }
    }
    return jobs;
  },
};

const apple = {
  async list() {
    const jobs = [];
    for (const city of ['united-kingdom-GBR', 'france-FRAC', 'ireland-IRL']) {
      for (let page = 1; page <= 3; page++) {
        const html = await getText(`https://jobs.apple.com/en-gb/search?search=${encodeURIComponent(QUERY)}&location=${city}&page=${page}`);
        const blob = html.match(/__staticRouterHydrationData = JSON\.parse\("([\s\S]*?)"\);?\s*<\/script>/);
        if (!blob) throw new Error('format Apple inconnu');
        const state = JSON.parse(JSON.parse(`"${blob[1]}"`));
        const rows = state.loaderData?.search?.searchResults ?? [];
        for (const j of rows) {
          jobs.push({
            sourceId: j.positionId || j.id,
            title: j.postingTitle,
            locations: (j.locations ?? []).map((l) => l.name),
            url: `https://jobs.apple.com/en-gb/details/${j.positionId}/${j.transformedPostingTitle ?? ''}`,
            postedAt: iso(j.postDateInGMT || j.postingDate),
            text: htmlToText(j.jobSummary),
          });
        }
        if (rows.length < 20) break;
      }
    }
    return jobs;
  },
};

const jibe = {
  async list({ host }) {
    const jobs = [];
    for (let page = 1; page <= 5; page++) {
      const data = await getJson(`https://${host}/api/jobs?keywords=${encodeURIComponent(QUERY)}&page=${page}&limit=100`);
      const rows = data.jobs ?? [];
      for (const { data: j } of rows) {
        jobs.push({
          sourceId: j.req_id || j.slug,
          title: j.title,
          locations: [j.full_location, j.location_name, j.city].filter(Boolean),
          url: `https://${host}/jobs/${j.slug}?lang=en-us`,
          postedAt: iso(j.posted_date),
          text: htmlToText([j.description, j.responsibilities, j.qualifications].filter(Boolean).join('<br><br>')),
        });
      }
      if (rows.length < 100) break;
    }
    return jobs;
  },
};

const goldmanApi = 'https://api-higher.gs.com/gateway/api/v1/graphql';
const goldman = {
  async list() {
    const query = 'query GetRoles($searchQueryInput: RoleSearchQueryInput!){roleSearch(searchQueryInput:$searchQueryInput){totalCount items{roleId jobTitle locations{city country} externalSource{sourceId}}}}';
    const jobs = [];
    for (let pageNumber = 0; pageNumber < 8; pageNumber++) {
      const data = await postJson(goldmanApi, { query, variables: { searchQueryInput: { page: { pageSize: 50, pageNumber }, sort: { sortStrategy: 'RELEVANCE', sortOrder: 'DESC' }, filters: [], experiences: ['EARLY_CAREER', 'PROFESSIONAL'], searchTerm: QUERY } } });
      const rows = data.data?.roleSearch?.items ?? [];
      for (const j of rows) {
        jobs.push({
          sourceId: j.externalSource?.sourceId || j.roleId,
          title: j.jobTitle,
          locations: (j.locations ?? []).map((l) => `${l.city}, ${l.country}`),
          url: `https://higher.gs.com/roles/${j.externalSource?.sourceId || j.roleId}`,
        });
      }
      if (rows.length < 50) break;
    }
    return jobs;
  },
  async detail(job) {
    const data = await postJson(goldmanApi, { query: 'query($id:String!){role(externalSourceId:$id){descriptionHtml}}', variables: { id: job.sourceId } });
    return { text: htmlToText(data.data?.role?.descriptionHtml) };
  },
};

const successfactors = {
  async list({ host }) {
    const jobs = [];
    for (const city of CITIES) {
      const html = await getText(`https://${host}/ey/search/?q=${encodeURIComponent(QUERY)}&locationsearch=${city}`);
      for (const [row] of html.matchAll(/<tr class="data-row[\s\S]*?<\/tr>/g)) {
        const link = row.match(/href="(\/[^"]*\/job\/[^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
        const location = row.match(/class="jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
        if (!link) continue;
        jobs.push({
          sourceId: link[1].match(/(\d{6,})\/?$/)?.[1] ?? link[1],
          title: htmlToText(link[2]),
          locations: [htmlToText(location ?? '')],
          url: `https://${host}${link[1]}`,
        });
      }
    }
    return jobs;
  },
  async detail(job) {
    const html = await getText(job.url);
    const body = html.match(/class="jobdescription"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/)?.[1];
    return body ? { text: htmlToText(body) } : {};
  },
};

// Le site embarque ses données dans `phApp.ddo = {...};` : on lit cet objet.
function phenomData(html) {
  const start = html.indexOf('phApp.ddo = {');
  if (start < 0) throw new Error('format Phenom inconnu');
  const open = html.indexOf('{', start);
  let depth = 0, inString = false, escaped = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return JSON.parse(html.slice(open, i + 1));
  }
  throw new Error('format Phenom inconnu');
}

const phenom = {
  async list({ host }) {
    const jobs = [];
    for (let from = 0; from < 100; from += 10) {
      const html = await getText(`https://${host}/global/en/search-results?keywords=${encodeURIComponent(QUERY)}&from=${from}&s=1`);
      const rows = phenomData(html).eagerLoadRefineSearch?.data?.jobs ?? [];
      for (const j of rows) {
        jobs.push({
          sourceId: j.jobId || j.jobSeqNo,
          title: j.title,
          locations: [...(j.multi_location ?? []), j.location, j.cityStateCountry, j.city].filter(Boolean),
          url: `https://${host}/global/en/job/${j.jobId}`,
          postedAt: iso(j.postedDate),
          text: j.descriptionTeaser,
        });
      }
      if (rows.length < 10) break;
    }
    return jobs;
  },
  async detail(job) {
    const html = await getText(job.url);
    const description = phenomData(html).jobDetail?.data?.job?.description;
    return description ? { text: htmlToText(description) } : {};
  },
};

const SOURCES = { greenhouse, lever, ashby, amazon, eightfold, microsoft, oracle, workday, google, apple, jibe, goldman, successfactors, phenom };

export function sourceFor(company) {
  return SOURCES[company.source];
}

// Garde-fou pratique : ne demande le détail que pour les offres qui peuvent nous intéresser.
export const isCandidate = (job) => isWantedTitle(job.title) && (job.needsDetail || citiesIn(job.locations).length > 0);
