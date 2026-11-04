# Alertes PM

Une app iPhone qui t'alerte dès qu'une boîte prestigieuse publie une offre de Product Manager à Paris, Londres ou Dublin.

## Mise en route (15 minutes)

Tu as besoin de ton Mac et de ton iPhone.

### 1. Mettre le projet sur GitHub

1. Crée un compte gratuit sur [github.com](https://github.com/signup).
2. Crée un dépôt **public** nommé `alertes-pm`, sans README.
3. Dans ce dossier, sur ton Mac, lance les commandes ci-dessous en remplaçant `TON-PSEUDO` :

```bash
git config user.name "TON-PSEUDO"
git config user.email "TON-PSEUDO@users.noreply.github.com"
git add -A
git commit -m "Première version"
git remote add origin https://github.com/TON-PSEUDO/alertes-pm.git
git push -u origin main
```

### 2. Allumer l'app

1. Sur GitHub, va dans **Settings > Pages**.
2. Dans **Source**, choisis **GitHub Actions**.
3. Va dans **Actions**, ouvre **Scan des offres**, puis clique sur **Run workflow**.

L'app sera ensuite en ligne sur `https://TON-PSEUDO.github.io/alertes-pm/`.

### 3. Ajouter les 2 clés secrètes

Va dans **Settings > Secrets and variables > Actions**, puis **New repository secret**.
Les valeurs sont dans le fichier `.env` de ce dossier. Ce fichier reste sur ton Mac et n'est jamais envoyé sur GitHub.

| Nom du secret | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | la ligne `VAPID_PUBLIC_KEY` de `.env`, sans le nom ni le `=` |
| `VAPID_PRIVATE_KEY` | la ligne `VAPID_PRIVATE_KEY` de `.env`, sans le nom ni le `=` |

### 4. Installer sur l'iPhone

1. Ouvre l'adresse de l'app dans **Safari**.
2. Touche **Partager**, puis **Sur l'écran d'accueil**.
3. Ouvre l'app depuis sa nouvelle icône.
4. Va dans **Réglages**, touche **Activer les alertes**, puis autorise.
5. Touche **Copier le code**.

### 5. Relier ton iPhone au robot

Ajoute un troisième secret GitHub nommé `PUSH_SUBSCRIPTION`, avec le code copié comme valeur.

C'est terminé. Pour tester, ajoute `PUSH_SUBSCRIPTION` dans `.env` sur une seule ligne, puis lance :

```bash
node --env-file=.env scraper/push-test.js
```

## Modifier la liste des boîtes

Tout est dans `config/companies.json`. Pour retirer une boîte, supprime sa ligne.
Ajouter une boîte demande de connaître son système de recrutement : le plus simple est de me le demander.

## Les règles de tri

- **Gardé** : Product Manager, Associate Product Manager, APM, Chef de produit.
- **Écarté** : Senior, Lead, Staff, Principal, Group, Director, Head of, VP, stages, alternances, et les offres demandant 8 ans ou plus.
- En banque, « Senior Associate » et « Associate or Vice President » sont gardés, car ce sont des niveaux intermédiaires.

## Limites connues

- **Boîtes non surveillées** : Meta, Uber, Revolut, Mistral, BNP Paribas, HSBC, KPMG, Deloitte, McKinsey, Bain. L'écran Réglages affiche cette liste en direct.
- **Microsoft** bloque vite les recherches répétées : seule une recherche courte par ville est faite, donc certaines offres peuvent manquer.
- **Salaire** : il n'est affiché que s'il figure dans l'annonce, dans la monnaie de la ville. Une fourchette en dollars sur une offre à Londres est ignorée.
- **Délai** : compte jusqu'à environ une heure entre la publication et l'alerte.
- **Sites qui changent** : si une boîte modifie son site, son connecteur peut casser. Elle apparaît alors « En panne » dans Réglages, sans bloquer les autres.

## Commandes utiles

```bash
npm test
```

```bash
npm run scan:dry
```

```bash
npm run web
```
