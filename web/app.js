import { VAPID_PUBLIC_KEY } from './config.js';

const app = document.getElementById('app');
const CITIES = ['Paris', 'Londres', 'Dublin'];
const CATEGORIES = ['Tech', 'Banque', 'Conseil'];
const NEW_FOR_MS = 48 * 3600 * 1000;

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ }
  },
};

let data = { jobs: [], updatedAt: null };
let status = { sources: [] };
let loadFailed = false;
let refreshing = false;
let refreshNote = null;
let refreshFailed = false;
let refreshNoteTimer = null;
const filters = store.get('filters', { city: null, category: null });

// Petit assistant : le texte passe toujours par textContent, jamais en HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

function linkedinUrl(job) {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function timeAgo(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function updatedLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const isNew = (job) => job.firstSeenAt && Date.now() - new Date(job.firstSeenAt) < NEW_FOR_MS;

function chip(label, active, onclick) {
  return el('button', { class: 'chip', 'aria-pressed': String(active), onclick }, label);
}

function toggleFilter(key, value) {
  filters[key] = filters[key] === value ? null : value;
  store.set('filters', filters);
  render();
}

function jobCard(job) {
  return el('a', { class: 'card', href: `#/job/${encodeURIComponent(job.id)}` },
    el('div', { class: 'card-top' },
      el('span', { class: 'company' }, job.company),
      isNew(job) ? el('span', { class: 'new' }, 'Nouveau') : el('span', {}, timeAgo(job.postedAt ?? job.firstSeenAt))),
    el('div', { class: 'title' }, job.title),
    el('div', { class: 'facts' },
      el('span', {}, job.cities.join(', ')),
      job.salary ? el('b', {}, job.salary.label) : null,
      job.experience ? el('span', {}, job.experience.label) : null));
}

function alertBanner() {
  if (store.get('pushCode', null) || !pushSupported() && !isIos()) return null;
  return el('a', { class: 'notice', href: '#/settings', style: 'text-decoration:none' },
    el('strong', {}, 'Activer les alertes'),
    "Reçois une notification dès qu'une nouvelle offre sort.");
}

function listView() {
  const jobs = data.jobs.filter((job) =>
    (!filters.city || job.cities.includes(filters.city)) && (!filters.category || job.category === filters.category));
  const count = `${jobs.length} offre${jobs.length > 1 ? 's' : ''}`;
  return [
    el('header', { class: 'top' },
      el('div', {},
        el('h1', {}, 'Alertes PM'),
        el('p', { class: 'sub' }, data.updatedAt ? `${count} · mis à jour le ${updatedLabel(data.updatedAt)}` : count),
        refreshNote ? el('p', { class: `sub refresh-note${refreshFailed ? ' failed' : ''}`, id: 'refresh-note' }, refreshNote) : null),
      el('div', { class: 'top-actions' },
        el('button', {
          class: 'icon-btn refresh',
          'aria-label': 'Actualiser les offres',
          'aria-busy': String(refreshing),
          onclick: refresh,
        }, el('span', { 'aria-hidden': 'true' }, '↻')),
        el('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Réglages et sources', style: 'text-decoration:none' }, 'Réglages'))),
    el('div', { class: 'filters' },
      CITIES.map((city) => chip(city, filters.city === city, () => toggleFilter('city', city))),
      el('span', { class: 'divider' }),
      CATEGORIES.map((cat) => chip(cat, filters.category === cat, () => toggleFilter('category', cat)))),
    alertBanner(),
    loadFailed ? el('p', { class: 'empty' }, 'Impossible de charger les offres. Vérifie ta connexion.') : null,
    !loadFailed && !jobs.length ? el('p', { class: 'empty' }, 'Aucune offre pour ces filtres en ce moment.') : null,
    jobs.map(jobCard),
  ];
}

function stat(label, value, fallback) {
  return el('div', { class: value ? 'stat' : 'stat unknown' },
    el('span', {}, label),
    el('b', {}, value ?? fallback));
}

function jobView(id) {
  const job = data.jobs.find((item) => item.id === id);
  if (!job) {
    return [
      el('header', { class: 'top' }, el('a', { class: 'icon-btn back', href: '#/', style: 'text-decoration:none' }, '‹ Offres')),
      el('p', { class: 'empty' }, "Cette offre n'est plus en ligne."),
    ];
  }
  const applyUrl = safeUrl(job.url);
  const quote = job.experience?.sentence || job.salary?.sentence;
  return el('div', { class: 'with-bar' },
    el('header', { class: 'top' }, el('a', { class: 'icon-btn back', href: '#/', style: 'text-decoration:none' }, '‹ Offres')),
    el('div', { class: 'hero' },
      stat('Salaire', job.salary?.label, 'Non communiqué'),
      stat('Expérience', job.experience?.label, 'À vérifier')),
    quote ? el('p', { class: 'quote' }, `Dans l'annonce : « ${quote} »`) : null,
    el('div', { class: 'detail-head' },
      el('div', { class: 'company' }, `${job.company} · ${job.category}`),
      el('h1', {}, job.title),
      el('div', { class: 'meta' }, [job.cities.join(', '), job.postedAt ? `publiée ${timeAgo(job.postedAt)}` : null].filter(Boolean).join(' · '))),
    el('h2', {}, 'Description'),
    el('div', { class: 'description' }, job.description || "Description indisponible. Ouvre l'offre pour la lire."),
    el('div', { class: 'apply-bar' },
      el('div', { class: 'apply-inner' },
        el('a', { class: 'btn ghost', href: linkedinUrl(job), target: '_blank', rel: 'noopener' }, 'LinkedIn'),
        applyUrl ? el('a', { class: 'btn', href: applyUrl, target: '_blank', rel: 'noopener' }, 'Apply') : null)));
}

function urlBase64ToUint8Array(value) {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function enableAlerts() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    store.set('pushError', "Notifications refusées. Autorise-les dans Réglages iPhone > Notifications > Alertes PM.");
    return render();
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  store.set('pushCode', JSON.stringify(subscription));
  store.set('pushError', null);
  render();
}

function alertsPanel() {
  const code = store.get('pushCode', null);
  const error = store.get('pushError', null);
  if (isIos() && !isInstalled()) {
    return el('section', { class: 'panel' },
      el('h2', {}, 'Installer sur ton iPhone'),
      el('p', {}, "Sur iPhone, les alertes marchent une fois l'app installée."),
      el('ol', {},
        el('li', {}, 'Ouvre cette page dans Safari.'),
        el('li', {}, 'Touche le bouton Partager.'),
        el('li', {}, 'Choisis « Sur l\'écran d\'accueil ».'),
        el('li', {}, "Ouvre l'app depuis sa nouvelle icône, puis reviens ici.")));
  }
  if (!pushSupported()) {
    return el('section', { class: 'panel' }, el('h2', {}, 'Alertes'), el('p', {}, 'Ce navigateur ne gère pas les notifications.'));
  }
  if (!code) {
    return el('section', { class: 'panel' },
      el('h2', {}, 'Alertes'),
      el('p', {}, "Étape 1 : autorise les notifications sur ce téléphone."),
      error ? el('p', { class: 'error' }, error) : null,
      el('button', { class: 'btn', style: 'width:100%', onclick: () => enableAlerts().catch((err) => { store.set('pushError', err.message); render(); }) }, 'Activer les alertes'));
  }
  const area = el('textarea', { readonly: 'true', 'aria-label': 'Code de notification' });
  area.value = code;
  return el('section', { class: 'panel' },
    el('h2', {}, 'Alertes activées'),
    el('p', {}, 'Étape 2 : copie ce code, puis colle-le dans le secret GitHub PUSH_SUBSCRIPTION. À faire une seule fois.'),
    area,
    el('button', {
      class: 'btn',
      style: 'width:100%',
      onclick: async (event) => {
        await navigator.clipboard.writeText(code);
        event.target.textContent = 'Copié';
      },
    }, 'Copier le code'));
}

const STATE_LABEL = { uncovered: 'Non couverte', error: 'En panne', empty: 'Aucune offre lue' };

function sourceRow(source) {
  const info = source.state === 'ok'
    ? `${source.kept} offre${source.kept > 1 ? 's' : ''} sur ${source.raw} lues`
    : STATE_LABEL[source.state];
  const tone = { error: 'error', empty: 'warn' }[source.state];
  return el('div', { class: 'source' },
    el('span', {}, source.company),
    el('small', { class: tone }, info));
}

function settingsView() {
  const order = { error: 0, empty: 1, ok: 2, uncovered: 3 };
  const sources = [...status.sources].sort((a, b) => order[a.state] - order[b.state] || a.company.localeCompare(b.company));
  const uncovered = sources.filter((s) => s.state === 'uncovered').length;
  return [
    el('header', { class: 'top' }, el('a', { class: 'icon-btn back', href: '#/', style: 'text-decoration:none' }, '‹ Offres')),
    alertsPanel(),
    el('section', { class: 'panel' },
      el('h2', {}, 'État des sources'),
      el('p', { class: 'sub' }, `Dernier scan : ${updatedLabel(status.updatedAt) || 'pas encore fait'}. ${uncovered} boîtes ne sont pas surveillées.`),
      sources.map(sourceRow)),
  ];
}

function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const jobMatch = hash.match(/^\/job\/(.+)$/);
  let view;
  if (jobMatch) view = jobView(decodeURIComponent(jobMatch[1]));
  else if (hash === '/settings') view = settingsView();
  else view = listView();
  app.replaceChildren(...[view].flat(Infinity).filter(Boolean));
}

async function load() {
  try {
    const [jobs, sources] = await Promise.all(['data/jobs.json', 'data/status.json'].map(async (path) => {
      const response = await fetch(`${path}?t=${Date.now()}`);
      if (!response.ok) throw new Error(path);
      return response.json();
    }));
    data = jobs;
    status = sources;
    loadFailed = false;
    render();
    return true;
  } catch {
    loadFailed = !data.jobs.length;
    render();
    return false;
  }
}

// Recharge ce que le robot a publié. Il ne relance pas de scan : ça demanderait
// de mettre une clé GitHub dans cette page, qui est publique.
async function refresh() {
  if (refreshing) return;
  const known = new Set(data.jobs.map((job) => job.id));
  clearTimeout(refreshNoteTimer);
  refreshing = true;
  refreshNote = null;
  render();
  const ok = await load();
  const added = data.jobs.filter((job) => !known.has(job.id)).length;
  refreshing = false;
  refreshFailed = !ok;
  if (!ok) refreshNote = 'Actualisation impossible. Vérifie ta connexion.';
  else if (added) refreshNote = `${added} nouvelle${added > 1 ? 's' : ''} offre${added > 1 ? 's' : ''}`;
  else refreshNote = 'Déjà à jour';
  render();
  refreshNoteTimer = setTimeout(() => {
    refreshNote = null;
    document.getElementById('refresh-note')?.remove();
  }, 4000);
}

addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'open') location.hash = new URL(event.data.url).hash;
  });
}

render();
load();
