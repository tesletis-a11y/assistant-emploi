/**
 * fetch-offres.js
 * ------------------------------------------------------------
 * Se connecte à l'API officielle "Offres d'emploi" de France Travail
 * (ex Pôle emploi), lance plusieurs recherches selon les profils de
 * métiers voulus, et écrit le résultat dans offres.json à la racine
 * du projet. Ce fichier est ensuite lu automatiquement par index.html.
 *
 * Ce script est fait pour être exécuté :
 *   - soit automatiquement chaque jour par GitHub Actions (voir
 *     .github/workflows/sync-offres.yml)
 *   - soit à la main sur ton ordinateur si tu as Node.js installé :
 *       FT_CLIENT_ID=xxx FT_CLIENT_SECRET=yyy node scripts/fetch-offres.js
 *
 * Il n'expose JAMAIS le client_secret au navigateur : ce script tourne
 * côté serveur (GitHub Actions ou ta machine), jamais dans la page web.
 * ------------------------------------------------------------
 */

import { writeFile } from "node:fs/promises";

// ---------- CONFIGURATION (à adapter si besoin) ----------

// Identifiants de l'application francetravail.io — jamais écrits en dur ici,
// toujours fournis via variables d'environnement / secrets.
const CLIENT_ID = process.env.FT_CLIENT_ID;
const CLIENT_SECRET = process.env.FT_CLIENT_SECRET;

// Code INSEE de la commune de référence (Vinça = 66230). Change-le si besoin.
const COMMUNE_INSEE = process.env.FT_COMMUNE || "66230";

// Rayon de recherche en kilomètres autour de la commune. En zone rurale, un
// rayon plus large est nécessaire pour capter suffisamment d'offres (50 km
// couvre notamment Perpignan depuis Vinça). Ajuste selon ce que tu es prêt
// à faire comme trajet.
const DISTANCE_KM = Number(process.env.FT_DISTANCE_KM || 50);

// Coordonnées de Vinça, utilisées uniquement pour estimer un temps de
// trajet approximatif (pas fourni tel quel par l'API).
const ORIGIN = { lat: 42.6461, lon: 2.5294 };

// Vitesse moyenne supposée pour convertir une distance à vol d'oiseau
// en une estimation TRÈS grossière de temps de trajet en minutes.
// C'est une approximation : vérifie toujours le vrai trajet toi-même.
const AVG_SPEED_KMH = Number(process.env.FT_AVG_SPEED_KMH || 50);

// Types de contrats recherchés (codes France Travail) :
// CDI, CDD, MIS (intérim), SAI (saisonnier), LIB (libéral), etc.
const TYPES_CONTRAT = (process.env.FT_TYPES_CONTRAT || "CDD,MIS,CDI").split(",");

// Profils de recherche : mots-clés courts (1-2 mots), correspondant à tes
// priorités. Plus il y a de mots dans motsCles, plus la recherche devient
// stricte (l'offre doit contenir TOUS les mots) — mieux vaut rester large
// ici et laisser le scoring de l'appli affiner ensuite.
const PROFILES = [
  { name: "Recouvrement / contentieux", motsCles: "recouvrement" },
  { name: "Gestion administrative", motsCles: "gestionnaire administratif" },
  { name: "Banque / back-office", motsCles: "back-office" },
  { name: "Organismes sociaux", motsCles: "gestionnaire prestations" },
];

const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const SCOPE = "api_offresdemploiv2 o2dsoffre";

// ---------- FONCTIONS ----------

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "FT_CLIENT_ID et FT_CLIENT_SECRET doivent être définis (secrets GitHub ou variables d'environnement)."
    );
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Échec de l'authentification France Travail : ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function searchOffers(token, profile) {
  const params = new URLSearchParams({
    motsCles: profile.motsCles,
    commune: COMMUNE_INSEE,
    distance: String(DISTANCE_KM),
    typeContrat: TYPES_CONTRAT.join(","),
    sort: "1", // tri par date de création décroissante
  });
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  // L'API répond :
  //  200/206 = résultats trouvés (206 si pagination partielle)
  //  204     = recherche réussie mais aucune offre ne correspond (normal, pas une erreur)
  if (res.status === 204) {
    return [];
  }
  if (res.status !== 200 && res.status !== 206) {
    console.error(`⚠️ Recherche "${profile.name}" a échoué : ${res.status} ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return (data.resultats || []).map((o) => normalizeOffer(o, profile.name));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractSalaryNet(salaireLibelle) {
  if (!salaireLibelle) return 0;
  // Cherche le plus petit nombre mentionné (ex: "Mensuel de 1800.0 Euros à 2000.0 Euros")
  const nums = salaireLibelle.match(/\d+([.,]\d+)?/g);
  if (!nums) return 0;
  return Math.round(parseFloat(nums[0].replace(",", ".")));
}

function normalizeOffer(o, profileName) {
  const lat = o.lieuTravail?.latitude;
  const lon = o.lieuTravail?.longitude;
  let minutes = 0;
  if (lat && lon) {
    const km = haversineKm(ORIGIN.lat, ORIGIN.lon, lat, lon);
    minutes = Math.round((km / AVG_SPEED_KMH) * 60);
  }
  return {
    externalId: o.id,
    title: o.intitule || "Poste sans intitulé",
    company: o.entreprise?.nom || "Entreprise non précisée",
    source: "France Travail",
    profil: profileName,
    location: o.lieuTravail?.libelle || "Lieu non précisé",
    minutes: minutes || undefined,
    contract: o.typeContratLibelle || o.typeContrat || "",
    salaryNet: extractSalaryNet(o.salaire?.libelle) || 0,
    hours: o.dureeTravailLibelle || "",
    description: o.description || "",
    url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
    created: o.dateCreation ? new Date(o.dateCreation).toLocaleDateString("fr-FR") : "",
  };
}

function dedupe(offers) {
  const seen = new Map();
  for (const o of offers) {
    if (!seen.has(o.externalId)) seen.set(o.externalId, o);
  }
  return [...seen.values()];
}

async function main() {
  console.log("Authentification à France Travail…");
  const token = await getAccessToken();

  let all = [];
  for (const profile of PROFILES) {
    console.log(`Recherche : ${profile.name}`);
    const results = await searchOffers(token, profile);
    console.log(`  → ${results.length} offre(s) trouvée(s)`);
    all = all.concat(results);
    // Respecte le quota de l'API (max 4 appels/seconde/application).
    await new Promise((r) => setTimeout(r, 400));
  }

  const offres = dedupe(all);
  const output = {
    generatedAt: new Date().toISOString(),
    source: "France Travail (API officielle)",
    communeInsee: COMMUNE_INSEE,
    distanceKm: DISTANCE_KM,
    count: offres.length,
    offres,
  };

  await writeFile(new URL("../offres.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(`✅ ${offres.length} offre(s) unique(s) écrite(s) dans offres.json`);
}

main().catch((err) => {
  console.error("❌ Erreur :", err.message);
  process.exit(1);
});
