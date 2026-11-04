import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExperience, extractSalary } from './extract.js';
import { titleVerdict, citiesIn } from './filter.js';
import { htmlToText } from './lib.js';

test('expérience : formulations anglaises', () => {
  assert.equal(extractExperience('You have 3+ years of product management experience.').min, 3);
  assert.equal(extractExperience('Minimum of 5 years of experience as a Product Manager').min, 5);
  assert.equal(extractExperience('2-4 years of experience in product roles').label, '2 à 4 ans');
  assert.equal(extractExperience('Three years of experience in product management').min, 3);
  assert.equal(extractExperience('At least 4 yrs experience in fintech').min, 4);
});

test('expérience : formulations françaises', () => {
  assert.equal(extractExperience("Vous avez 3 ans d'expérience minimum en tant que Product Manager.").min, 3);
  assert.equal(extractExperience("Au moins 5 années d'expérience en gestion de produit").min, 5);
  assert.equal(extractExperience("De 3 à 5 ans d'expérience").label, '3 à 5 ans');
});

test("expérience : ignore l'âge de l'entreprise et prend le minimum", () => {
  assert.equal(extractExperience('For over 150 years, our company has grown with customers.'), null);
  assert.equal(extractExperience('We have 20 years of history as a company.'), null);
  assert.equal(extractExperience('3+ years in product management. 5+ years in product management preferred.').min, 3);
  assert.equal(extractExperience('A great role with a great team.'), null);
});

test('salaire : Londres en livres', () => {
  assert.equal(extractSalary('The salary range is £70,000 - £90,000 per annum.', ['Londres']).label, '£70k à £90k');
  assert.equal(extractSalary('£70k-£90k plus bonus', ['Londres']).label, '£70k à £90k');
  assert.equal(extractSalary('Base salary: GBP 85,000', ['Londres']).label, '£85k');
});

test('salaire : Paris et Dublin en euros', () => {
  assert.equal(extractSalary('Rémunération : 60 000 € à 80 000 € brut par an', ['Paris']).label, '60 à 80 k€');
  assert.equal(extractSalary('Salaire : 65k€ - 75k€ brut', ['Paris']).label, '65 à 75 k€');
  assert.equal(extractSalary('Salary: €75,000 – €95,000', ['Dublin']).label, '75 à 95 k€');
});

test('salaire : aucun faux positif', () => {
  assert.equal(extractSalary('US base pay range: $150,000 - $190,000 per year.', ['Londres']), null);
  assert.equal(extractSalary('The company raised £50,000,000 in funding.', ['Londres']), null);
  assert.equal(extractSalary('We process €200 million of revenue, with €5,000,000 raised', ['Paris']), null);
  assert.equal(extractSalary('Gym allowance of £500 per year.', ['Londres']), null);
  assert.equal(extractSalary('No figures here.', ['Paris']), null);
});

test('titres gardés', () => {
  for (const title of ['Product Manager', 'Associate Product Manager', 'Product Manager, Payments', 'Technical Product Manager', 'Chef de produit digital', 'Cheffe de Produit', 'Product Manager II', 'AI Product Manager', 'Associate, Product Manager', 'Product Manager - Associate', 'Kinexys Digital Assets - Product Manager - Senior Associate', 'Margin Services Product Manager - Associate or Vice President', 'Product Management, Associate, London']) {
    assert.equal(titleVerdict(title), 'ok', title);
  }
});

test('titres écartés', () => {
  for (const [title, why] of [
    ['Product Marketing Manager', 'role'], ['Senior Product Manager', 'senior'], ['Sr. Product Manager', 'senior'],
    ['Lead Product Manager', 'senior'], ['Group Product Manager, Data/ML', 'senior'], ['Director of Product', 'role'],
    ['Project Manager', 'role'], ['Technical Program Manager', 'role'], ['Account Executive, Product Sales', 'role'],
    ['Staff Product Manager', 'senior'], ['Principal Product Manager', 'senior'], ['Product Manager, Vice President', 'senior'],
    ['Associate Product Manager BS/MS Intern, 2027', 'intern'], ['Stage - Chef de produit', 'intern'],
    ['Associate Product Marketing Manager BS/MS Intern, 2027', 'role'],
    ['Product Manager, Executive Director', 'senior'],
  ]) assert.equal(titleVerdict(title), why, title);
});

test('villes', () => {
  assert.deepEqual(citiesIn('London, UK'), ['Londres']);
  assert.deepEqual(citiesIn('Paris, France'), ['Paris']);
  assert.deepEqual(citiesIn(['Dublin, Ireland', 'Hamburg, Germany', 'Paris, France']).sort(), ['Dublin', 'Paris']);
  assert.deepEqual(citiesIn('London, Ontario, Canada'), []);
  assert.deepEqual(citiesIn('Paris, TX'), []);
  assert.deepEqual(citiesIn('Dublin, Ohio'), []);
  assert.deepEqual(citiesIn('EMEA'), []);
  assert.deepEqual(citiesIn('Remote'), []);
  assert.deepEqual(citiesIn('Canary Wharf, 1 Churchill Place'), ['Londres']);
});

test('HTML vers texte', () => {
  const out = htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script>');
  assert.match(out, /Hello world/);
  assert.match(out, /• One/);
  assert.doesNotMatch(out, /alert/);
  assert.equal(htmlToText('&lt;p&gt;Encodé&lt;/p&gt;'), 'Encodé');
});

test('notifications : une par offre, résumé au-delà de 5', async () => {
  const { messagesFor } = await import('./push.js');
  const offer = (n) => ({ id: `a b-${n}`, company: `Boite${n}`, title: 'Product Manager', cities: ['Paris'] });
  const few = messagesFor([offer(1), offer(2)]);
  assert.equal(few.length, 2);
  assert.equal(few[0].url, './#/job/a%20b-1');
  const many = messagesFor([1, 2, 3, 4, 5, 6].map(offer));
  assert.equal(many.length, 1);
  assert.match(many[0].title, /^6 nouvelles offres/);
});
