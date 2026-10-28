/**
 * fetch-offres.js
 * ------------------------------------------------------------
 * Se connecte à l'API officielle "Offres d'emploi" de France Travail,
 * lance les recherches décrites dans config.json (à la racine du projet)
 * et écrit le résultat dans offres.json, lu ensuite par index.html.
 *
 * Tes critères de recherche (ville, rayon, contrats, mots-clés) se
 * modifient dans config.json, depuis la page "Collecte" de l'appli :
 * pas besoin de toucher à ce fichier.
 *
 * Exécuté chaque jour par GitHub Actions, et aussi à chaque modification
 * de config.json. Le client_secret n'est jamais exposé au navigateur.
 * ------------------------------------------------------------
 */

import { readFile, writeFile } from "node:fs/promises";

// Identifiants de l'application francetravail.io : fournis par les secrets GitHub.
const CLIENT_ID = process.env.FT_CLIENT_ID;
const CLIENT_SECRET = process.env.FT_CLIENT_SECRET;

// Coordonnées de Vinça, utilisées uniquement pour estimer un temps de trajet
// approximatif depuis ton domicile (pas fourni tel quel par l'API).
const ORIGIN = { lat: 42.6461, lon: 2.5294 };

// Vitesse moyenne supposée pour convertir une distance à vol d'oiseau en minutes.
const AVG_SPEED_KMH = Number(process.env.FT_AVG_SPEED_KMH || 38);

// Valeurs utilisées si config.json est absent.
const DEFAULT_CONFIG = {
  communeInsee: "66230",
  distanceKm: 70,
  typesContrat: ["CDD", "MIS", "CDI"],
  profils: [
    { nom: "Recouvrement / contentieux", motsCles: "recouvrement" },
    { nom: "Contentieux / juridique", motsCles: "contentieux" },
    { nom: "Gestion administrative", motsCles: "gestionnaire administratif" },
    { nom: "Banque / back-office", motsCles: "back-office" },
    { nom: "Organismes sociaux (CAF, CPAM...)", motsCles: "gestionnaire prestations" },
    { nom: "Assistanat administratif", motsCles: "assistant administratif" },
    { nom: "Secrétariat", motsCles: "secrétaire" },
    { nom: "Agent administratif", motsCles: "agent administratif" },
  ],
};
const CONTRATS_AUTORISES = ["CDI", "CDD", "MIS"];

const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const SCOPE = "api_offresdemploiv2 o2dsoffre";

// ---------- CONFIGURATION ----------

async function loadConfig() {
  let fromFile = {};
  try {
    fromFile = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf-8"));
    console.log("config.json chargé.");
  } catch (e) {
    if (e.code === "ENOENT") console.log("config.json absent : valeurs par défaut utilisées.");
    else throw new Error(`config.json est illisible (erreur de syntaxe ?) : ${e.message}`);
  }
  const cfg = { ...DEFAULT_CONFIG, ...fromFile };

  if (!/^(\d{5}|2[AB]\d{3})$/i.test(String(cfg.communeInsee))) {
    throw new Error(`config.json : "communeInsee" doit être un code INSEE à 5 chiffres (reçu : ${cfg.communeInsee}).`);
  }
  cfg.distanceKm = Number(cfg.distanceKm);
  if (!(cfg.distanceKm > 0 && cfg.distanceKm <= 200)) {
    throw new Error(`config.json : "distanceKm" doit être compris entre 1 et 200 (reçu : ${cfg.distanceKm}).`);
  }
  if (!Array.isArray(cfg.typesContrat) || cfg.typesContrat.length === 0) {
    throw new Error('config.json : "typesContrat" doit contenir au moins un contrat (CDI, CDD, MIS).');
  }
  cfg.typesContrat = cfg.typesContrat.map((t) => String(t).toUpperCase());
  for (const t of cfg.typesContrat) {
    if (!CONTRATS_AUTORISES.includes(t)) {
      throw new Error(`config.json : contrat "${t}" inconnu (valeurs possibles : ${CONTRATS_AUTORISES.join(", ")}).`);
    }
  }
  if (!Array.isArray(cfg.profils) || cfg.profils.length === 0) {
    throw new Error('config.json : "profils" doit contenir au moins une recherche.');
  }
  cfg.profils = cfg.profils.map((p, i) => {
    const nom = String(p?.nom ?? "").trim();
    const motsCles = String(p?.motsCles ?? "").trim();
    if (!nom || !motsCles) throw new Error(`config.json : la recherche n°${i + 1} doit avoir un "nom" et des "motsCles".`);
    return { nom, motsCles };
  });
  return cfg;
}

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

async function searchOffers(token, profil, cfg) {
  const params = new URLSearchParams({
    motsCles: profil.motsCles,
    commune: cfg.communeInsee,
    distance: String(cfg.distanceKm),
    typeContrat: cfg.typesContrat.join(","),
    sort: "1", // tri par date de création décroissante
  });
  let res;
  try {
    res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    console.error(`⚠️ Recherche "${profil.nom}" impossible (réseau) : ${e.message}`);
    return { offers: [], failed: true };
  }
  // 200/206 = résultats ; 204 = aucune offre ne correspond (normal, pas une erreur)
  if (res.status === 204) return { offers: [], failed: false };
  if (res.status !== 200 && res.status !== 206) {
    console.error(`⚠️ Recherche "${profil.nom}" a échoué : ${res.status} ${await res.text()}`);
    return { offers: [], failed: true };
  }
  const data = await res.json();
  return { offers: (data.resultats || []).map((o) => normalizeOffer(o, profil.nom)), failed: false };
}

/**
 * Vérifie que le code saisi est bien un code INSEE de commune (et pas un code postal),
 * grâce à l'API officielle geo.api.gouv.fr. Si ce service est injoignable, on continue.
 */
class ConfigError extends Error {}
async function checkCommune(cfg) {
  const base = "https://geo.api.gouv.fr/communes";
  try {
    const res = await fetch(`${base}/${encodeURIComponent(cfg.communeInsee)}?fields=nom,code`);
    if (res.status === 404) {
      let hint = "";
      try {
        const r2 = await fetch(`${base}?codePostal=${encodeURIComponent(cfg.communeInsee)}&fields=nom,code`);
        if (r2.ok) {
          const list = await r2.json();
          if (Array.isArray(list) && list.length) {
            hint = ` ${cfg.communeInsee} est un code postal. Code(s) INSEE correspondant(s) : ${list
              .map((c) => `${c.code} (${c.nom})`)
              .join(", ")}.`;
          }
        }
      } catch (_) {}
      throw new ConfigError(
        `config.json : "${cfg.communeInsee}" n'existe pas comme code INSEE de commune.${hint} Il faut le code INSEE, pas le code postal.`
      );
    }
    if (!res.ok) {
      console.warn(`⚠️ Vérification du code commune impossible (geo.api.gouv.fr : ${res.status}), on continue.`);
      return;
    }
    const c = await res.json();
    console.log(`Commune de référence : ${c.nom} (INSEE ${c.code}).`);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    console.warn(`⚠️ Vérification du code commune impossible (${e.message}), on continue.`);
  }
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

/**
 * Lit le libellé de salaire France Travail (ex. "Mensuel de 1800.0 Euros à
 * 2000.0 Euros sur 12.0 mois", "Annuel de 28000 Euros", "Horaire de 12.5 Euros")
 * et le convertit en BRUT MENSUEL ÉQUIVALENT SUR 12 MOIS, temps plein.
 * Renvoie {} si le libellé n'est pas exploitable.
 */
export function parseSalary(libelle) {
  if (!libelle) return {};
  const raw = String(libelle).trim();
  const num = (s) => parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  const m = raw.match(
    /(mensuel|annuel|horaire)\s+de\s+([\d\s.,]+?)\s*(?:euros?|€)(?:\s+à\s+([\d\s.,]+?)\s*(?:euros?|€))?(?:\s+sur\s+([\d.,]+)\s*mois)?/i
  );
  if (!m) return { salaryRaw: raw };
  const type = m[1].toLowerCase();
  const a = num(m[2]);
  const b = m[3] ? num(m[3]) : a;
  const months = m[4] ? num(m[4]) : 12;
  if (!isFinite(a) || !isFinite(b)) return { salaryRaw: raw };
  const conv = (v) => {
    if (type === "mensuel") return (v * months) / 12;
    if (type === "annuel") return v / 12;
    return v * 151.67; // horaire, 35 h/semaine
  };
  const lo = Math.round(Math.min(conv(a), conv(b)));
  const hi = Math.round(Math.max(conv(a), conv(b)));
  if (lo < 500 || hi > 20000) return { salaryRaw: raw }; // valeur improbable : on ignore
  return { salaryMinBrut: lo, salaryMaxBrut: hi, salaryRaw: raw };
}

function normalizeOffer(o, profileName) {
  const lat = o.lieuTravail?.latitude;
  const lon = o.lieuTravail?.longitude;
  let minutes, distanceKm;
  if (lat && lon) {
    const km = haversineKm(ORIGIN.lat, ORIGIN.lon, lat, lon);
    distanceKm = Math.round(km);
    minutes = Math.round((km / AVG_SPEED_KMH) * 60);
  }
  return {
    externalId: o.id,
    title: o.intitule || "Poste sans intitulé",
    company: o.entreprise?.nom || "Entreprise non précisée",
    source: "France Travail",
    profil: profileName,
    location: o.lieuTravail?.libelle || "Lieu non précisé",
    minutes,
    distanceKm,
    contract: o.typeContratLibelle || o.typeContrat || "",
    ...parseSalary(o.salaire?.libelle),
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
  const cfg = await loadConfig();
  console.log(
    `Critères : commune ${cfg.communeInsee}, rayon ${cfg.distanceKm} km, contrats ${cfg.typesContrat.join("/")}, ${cfg.profils.length} recherche(s).`
  );
  await checkCommune(cfg);
  console.log("Authentification à France Travail…");
  const token = await getAccessToken();

  let all = [];
  let failed = 0;
  for (const profil of cfg.profils) {
    console.log(`Recherche : ${profil.nom} (${profil.motsCles})`);
    const r = await searchOffers(token, profil, cfg);
    console.log(`  → ${r.offers.length} offre(s) trouvée(s)${r.failed ? " (recherche en échec)" : ""}`);
    if (r.failed) failed++;
    all = all.concat(r.offers);
    // Respecte le quota de l'API (max 4 appels/seconde/application).
    await new Promise((r2) => setTimeout(r2, 400));
  }

  // Si TOUTES les recherches ont échoué, on s'arrête en erreur sans toucher à offres.json
  // (sinon un fichier vide remplacerait les offres existantes sans que personne ne le voie).
  if (failed === cfg.profils.length) {
    throw new Error(
      `Les ${failed} recherche(s) ont échoué : offres.json n'a pas été modifié. Voir les messages ci-dessus (critères de config.json ?).`
    );
  }
  if (failed > 0) console.warn(`⚠️ ${failed} recherche(s) sur ${cfg.profils.length} en échec : résultats partiels.`);

  const offres = dedupe(all);
  const output = {
    generatedAt: new Date().toISOString(),
    source: "France Travail (API officielle)",
    configUsed: {
      communeInsee: cfg.communeInsee,
      distanceKm: cfg.distanceKm,
      typesContrat: cfg.typesContrat,
      profils: cfg.profils.map((p) => `${p.nom} (${p.motsCles})`),
    },
    count: offres.length,
    offres,
  };

  await writeFile(new URL("../offres.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(`✅ ${offres.length} offre(s) unique(s) écrite(s) dans offres.json`);
}

// Ne lance la collecte que si le fichier est exécuté directement (pas lors d'un import de test).
if (import.meta.url === new URL(process.argv[1], "file://").href) {
  main().catch((err) => {
    console.error("❌ Erreur :", err.message);
    process.exit(1);
  });
}
