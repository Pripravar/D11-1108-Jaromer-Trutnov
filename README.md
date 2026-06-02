# D11 1108 Jaroměř – Trutnov — mapa stavby (úsek km 129,3–133)

Mobilní webová aplikace (velín) pro úsek sdružení **km 129,300 – 133,000** stavby
D11 1108. Jednosouborový `index.html` + Firebase backend + Leaflet/Mapy.cz mapa
+ PDF panel výkresů po staničení.

Repo: `Pripravar/D11-1108-Jaromer-Trutnov`

## Stav

Hotovo a naplněno daty:
- **Osa** `GPX_POINTS` — 107 bodů, oříznuto na úsek ZÚ→KÚ (km 129,3–133).
- **Kalibrace** `CALIB_POINTS` — 6 reálných bodů z `D11 ZU a KU` (ZÚ 129,3 → KÚ 133,0;
  všechny leží ≤15 m od osy). `KM_START=129,300`, `KM_END=133,000`.
- **DOCS_SITUACE** — situace SO 101 díl 12–14 (km 128,8–133,0).
- **DOCS_PP** — podélný profil SO 101 díl 6–7.
- **DOCS_VPR** — vzorové řezy SO 101.
- **STAVEBNI_OBJEKTY** — páteř SO 101 (km 129,3–133,0).
- **DOPLNKY_SO** — 8 bodových objektů v úseku (SO 124, 124.1, 125, 135, 149, 160, 161, 167);
  u SO 160/161 je km **přibližné** (`/* km PŘIBLIŽNÉ – ověřit */`).
- **PDF** — 13 výkresů (~24 MB) v `pdf/SO_xxx/`.
- **MAPY_API_KEY** vyplněn.
- PWA: `manifest.json`, `service-worker.js`, `firebase-messaging-sw.js`, Cloud Function (`GH_REPO` vyplněn).

## Co ještě doplnit (placeholdery `DOPLNIT`)

V `index.html` (~ř. 1227):
- `FIREBASE_CONFIG` (apiKey, messagingSenderId, appId, …) + `FIREBASE_URL` + `FIREBASE_VAPID_KEY`
  — z Firebase Console. **Stejné hodnoty i v `firebase-messaging-sw.js`.**
- `UPLOAD_FN_URL` — po deployi Cloud Function (nahradit `PROJEKT` názvem Firebase projektu).

V `cloud-function/index.js`: token přes `firebase functions:secrets:set GITHUB_TOKEN`.

## Pozn. k podkladům

- V `podklady` jsou jen **SO 1xx** (komunikace). Mosty/tunel SO 2xx, kanalizace 3xx,
  VO 4xx atd. nejsou → ty vrstvy jsou prázdné.
- `DOCS_DZ / CHPR / KLAD / TZ` prázdné — v PDPS SO 1xx pro ně nejsou samostatné výkresy.
- Před úpravou souboru v repu vždy git tag `<filename>-RRRR-MM-DD-HH-MM`.
