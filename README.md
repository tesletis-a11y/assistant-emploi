# Mon Assistant Emploi — guide de mise en place

Ce dossier contient ton application, plus un connecteur vers l'**API officielle
et gratuite de France Travail**, qui va chercher chaque jour, tout seul, les
offres qui correspondent à ton profil.

## Ce que ça fait concrètement

- Chaque jour, un petit programme (hébergé gratuitement par GitHub, pas sur
  ton ordinateur) interroge France Travail avec tes critères et écrit le
  résultat dans un fichier `offres.json`.
- Quand tu ouvres `index.html` (ton appli), elle lit ce fichier et ajoute
  automatiquement les nouvelles offres, sans écraser celles que tu as déjà
  classées ou notées.
- Indeed, LinkedIn et HelloWork n'ont **pas** d'API publique ouverte à ce
  type d'usage : elles restent en ajout manuel (copier-coller l'annonce dans
  le bouton "➕ Ajouter une offre").

Il y a **trois étapes** : (1) obtenir un accès France Travail, (2) mettre le
projet sur GitHub, (3) activer l'automatisation. Ça prend environ 20-30
minutes la première fois, et ensuite tu n'as plus rien à faire.

---

## Étape 1 — Obtenir tes identifiants France Travail (gratuit)

1. Va sur **https://francetravail.io** et crée un compte (bouton "Se
   connecter" / "Créer un compte").
2. Une fois connecté, va dans ton espace **"Mes applications"** et clique sur
   **"Créer une application"**. Donne-lui un nom, par exemple
   `assistant-emploi-perso`.
3. Dans la liste des API disponibles, associe à ton application l'API
   **"Offres d'emploi v2"**.
4. Une fois l'application créée, tu obtiens deux informations à garder
   précieusement (ne les partage à personne, ne les mets jamais directement
   dans le fichier `index.html`) :
   - un **Identifiant client** (`client_id`)
   - une **Clé secrète** (`client_secret`)

---

## Étape 2 — Mettre le projet sur GitHub

GitHub est un service gratuit qui va héberger ton appli et exécuter la
synchronisation quotidienne à ta place.

1. Crée un compte sur **https://github.com** (gratuit).
2. Clique sur **"New repository"** (nouveau dépôt). Donne-lui un nom, par
   exemple `assistant-emploi`. Laisse-le en **Public** (nécessaire pour la
   version gratuite de l'hébergement de pages — voir la note vie privée
   ci-dessous), puis clique sur "Create repository".
3. Sur la page du dépôt vide, clique sur **"uploading an existing file"** et
   dépose tous les fichiers et dossiers de ce projet (`index.html`,
   `offres.json`, le dossier `scripts`, le dossier `.github`). Valide
   l'envoi ("Commit changes").

### Ajouter tes identifiants en secret (jamais dans le code)

4. Dans le dépôt, va dans **Settings → Secrets and variables → Actions**.
5. Clique sur **"New repository secret"** et crée :
   - Nom : `FT_CLIENT_ID` → valeur : ton identifiant client
   - Nom : `FT_CLIENT_SECRET` → valeur : ta clé secrète

### Activer l'hébergement de l'appli (GitHub Pages)

6. Va dans **Settings → Pages**.
7. Dans "Build and deployment", choisis **Source : Deploy from a branch**,
   branche **main**, dossier **/ (root)**, puis "Save".
8. Au bout de 1-2 minutes, GitHub te donne une adresse du type
   `https://ton-pseudo.github.io/assistant-emploi/` — c'est l'adresse de ton
   appli, utilisable depuis ton téléphone ou ton ordinateur.

> ⚠️ **Note vie privée** : avec un dépôt gratuit "Public", n'importe qui
> connaissant cette adresse exacte peut voir ton appli (elle n'apparaît pas
> dans les moteurs de recherche, mais l'URL n'est pas secrète). Si tu
> préfères que ce soit strictement privé, deux options : garder le dépôt
> privé et lancer `index.html` uniquement en local sur ton ordinateur (tu
> perds l'accès depuis ton téléphone), ou passer sur un plan GitHub payant
> qui autorise les Pages privées. À toi de voir selon ce que tu préfères.

---

## Étape 3 — Lancer la première synchronisation

1. Dans ton dépôt GitHub, va dans l'onglet **Actions**.
2. Clique sur le workflow **"Synchronisation quotidienne France Travail"**.
3. Clique sur **"Run workflow"** pour la lancer une première fois
   immédiatement (elle se relancera ensuite automatiquement chaque jour vers
   6h-8h du matin, heure française).
4. Après une minute, rafraîchis la page de ton appli (`.../index.html` ou
   l'adresse GitHub Pages) : les nouvelles offres apparaissent.

---

## Réglages que tu peux ajuster

Dans `scripts/fetch-offres.js`, tout en haut :

- `FT_COMMUNE` : code INSEE de ta ville de référence (actuellement Vinça =
  `66230`).
- `FT_DISTANCE_KM` : rayon de recherche en kilomètres (actuellement 35).
- `FT_TYPES_CONTRAT` : types de contrats recherchés (`CDD,MIS,CDI` — `MIS` =
  intérim).
- La liste `PROFILES` : les mots-clés recherchés chaque jour. Tu peux en
  ajouter, en retirer, ou changer les mots.

Ces réglages peuvent aussi être modifiés sans toucher au code, via
**Settings → Secrets and variables → Actions → Variables**, en ajoutant des
variables du même nom.

---

## Limites à connaître

- Le temps de trajet affiché est une **estimation approximative** (distance
  à vol d'oiseau convertie en minutes), pas un calcul d'itinéraire réel —
  vérifie toi-même les trajets qui t'intéressent vraiment.
- Le salaire est extrait automatiquement du texte de l'annonce quand c'est
  possible ; s'il n'est pas mentionné par le recruteur, il reste à 0 (à
  vérifier).
- Cette automatisation ne couvre que France Travail. Pour Indeed, LinkedIn,
  HelloWork ou "La Sécu recrute", continue d'utiliser le bouton "➕ Ajouter
  une offre" en collant le texte de l'annonce : le moteur de scoring
  l'analysera exactement de la même façon.
