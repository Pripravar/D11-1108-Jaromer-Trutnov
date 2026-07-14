/* ════════════════════════════════════════════════════════════════
   CLOUD FUNCTION – odesílání push notifikací
   - Sleduje /notifikace_fronta v Realtime Database
   - Pro každý nový záznam pošle FCM zprávu příjemcům
   - Po odeslání záznam smaže (aby fronta nerostla)

   DEPLOYMENT:
     1. Nainstaluj Node.js (verze 18+) a Firebase CLI:
          npm install -g firebase-tools
     2. V této složce (cloud-function) spusť:
          npm install
          firebase login
          firebase init functions      (vyber existující projekt sulice-zelivec)
          ...ale tento soubor index.js si chraň – pokud Firebase zeptal,
             zda přepsat, řekni N (Ne), nebo prostě překopíruj zpět.
     3. Deploy:
          firebase deploy --only functions

   POŽADAVKY: plán Firebase 'Blaze' (pay-as-you-go), free tier pokryje
   stovky notifikací denně bez nákladů. Stačí jednou zadat platební kartu
   v Firebase Console - dokud nepřekročíš limit, žádné poplatky.
   ════════════════════════════════════════════════════════════════ */

// firebase-functions v6 vyžaduje explicitní /v1 import pro starší API (.ref().onCreate())
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();

// Funkce musí běžet ve stejné oblasti jako Realtime DB (europe-west1).
exports.sendTaskNotifications = functions
  .region('europe-west1')
  .database
  .ref('/notifikace_fronta/{id}')
  .onCreate(async (snap, context) => {
    const rec = snap.val();
    if(!rec) return null;

    // Sestavit titulek a tělo zprávy podle typu
    let title = 'D11 1108 Jaroměř – Trutnov';
    let body  = '';
    let recipientUids = [];

    if(rec.typ === 'novy') {
      title = '✅ Nový úkol';
      body = (rec.zadalName || 'Někdo') + ' ti zadal: ' + (rec.title || '');
      recipientUids = (rec.prirazeno || []).map(p => p.uid).filter(Boolean);
    } else if(rec.typ === 'hotovo') {
      title = '🎉 Úkol hotov';
      body = 'Úkol "' + (rec.title || '') + '" byl označen jako hotový.';
      // Posíláme zadavateli (pokud zadavatel != ten, kdo úkol dokončil - tady jsme záměrně laxní)
      if(rec.zadalUid) recipientUids.push(rec.zadalUid);
    } else if(rec.typ === 'komentar') {
      const by = rec.byName || 'Někdo';
      title = '💬 ' + by + ' – komentář';
      body = (rec.cmtText ? rec.cmtText : 'Komentář') + ' · úkol "' + (rec.title || '') + '"';
      // Posíláme zadavateli, všem přiřazeným I @zmíněným (i když nejsou přiřazení)
      if(rec.zadalUid) recipientUids.push(rec.zadalUid);
      (rec.prirazeno || []).forEach(p => { if(p.uid) recipientUids.push(p.uid); });
      (rec.mentions || []).forEach(uid => { if(uid) recipientUids.push(uid); });
    } else if(rec.typ === 'foto_komentar') {
      const by = rec.byName || 'Někdo';
      title = '💬 ' + by + ' – komentář k fotce';
      body = rec.cmtText ? rec.cmtText : 'Nový komentář k fotce';
      // Příjemce spočítal klient (autor fotky + dřívější komentující + @zmínění, bez sebe)
      (rec.recipientUids || []).forEach(uid => { if(uid) recipientUids.push(uid); });
    }

    // Odstranit duplicity
    recipientUids = [...new Set(recipientUids)];

    if(recipientUids.length === 0) {
      console.log('Žádní příjemci, mažu záznam.');
      return snap.ref.remove();
    }

    // PRIORITA: nízká u nového úkolu = žádný push (jen tiše v aplikaci)
    const prio = rec.priorita || 'normalni';
    if(prio === 'nizka' && rec.typ === 'novy') {
      console.log('Nízká priorita – push se neposílá.');
      return snap.ref.remove();
    }

    // Najít FCM tokeny příjemců
    const usersSnap = await db.ref('/uzivatele').once('value');
    const users = usersSnap.val() || {};
    const tokens = [];
    recipientUids.forEach(uid => {
      const u = users[uid];
      if(u && u.fcmToken) tokens.push(u.fcmToken);
    });

    if(tokens.length === 0) {
      console.log('Žádné FCM tokeny u příjemců.');
      return snap.ref.remove();
    }

    // Připravit zprávu
    const message = {
      notification: { title, body },
      data: {
        taskId: rec.taskId || '',
        fotoKey: rec.fotoKey || '',
        typ:    rec.typ    || '',
        priorita: prio
      },
      tokens: tokens
    };

    // VYSOKÁ priorita = důraznější doručení napříč platformami (best-effort)
    if(prio === 'vysoka') {
      message.android = { priority: 'high', notification: { priority: 'max' } };
      message.apns = {
        headers: { 'apns-priority': '10' },
        payload: { aps: { 'interruption-level': 'time-sensitive' } }
      };
      message.webpush = { headers: { Urgency: 'high' }, notification: { requireInteraction: true } };
    }

    try {
      const resp = await admin.messaging().sendEachForMulticast(message);
      console.log('FCM odesláno:', resp.successCount, '/', tokens.length);
      // Smazat neplatné tokeny
      const cleanupPromises = [];
      resp.responses.forEach((r, idx) => {
        if(!r.success) {
          const err = r.error;
          const badToken = tokens[idx];
          if(err && (err.code === 'messaging/invalid-registration-token' ||
                     err.code === 'messaging/registration-token-not-registered')) {
            // Najít uživatele, kdo má tento token, a smazat ho
            Object.keys(users).forEach(uid => {
              if(users[uid] && users[uid].fcmToken === badToken) {
                cleanupPromises.push(db.ref('/uzivatele/' + uid + '/fcmToken').remove());
              }
            });
          }
        }
      });
      await Promise.all(cleanupPromises);
    } catch(e) {
      console.error('Chyba odeslání FCM:', e);
    }

    return snap.ref.remove();
  });

/* ════════════════════════════════════════════════════════════════
   SCHEDULED FUNKCE – připomínky u úkolů (čas / před termínem)
   - Běží každých 15 min (Cloud Scheduler + Pub/Sub)
   - Projde /ukoly, najde ty s pripominka.at <= teď a sent !== true
   - Pošle push zadavateli + přiřazeným, označí pripominka.sent = true
   DEPLOY (uživatel): povol Cloud Scheduler + Pub/Sub API, pak
     firebase deploy --only functions:checkReminders
   ════════════════════════════════════════════════════════════════ */
exports.checkReminders = functions
  .region('europe-west1')
  .pubsub.schedule('every 15 minutes')
  .timeZone('Europe/Prague')
  .onRun(async () => {
    const now = Date.now();
    const tasksSnap = await db.ref('/ukoly').once('value');
    const tasks = tasksSnap.val() || {};
    const usersSnap = await db.ref('/uzivatele').once('value');
    const users = usersSnap.val() || {};

    const jobs = [];
    Object.keys(tasks).forEach(id => {
      const t = tasks[id];
      if(!t || !t.pripominka) return;
      const p = t.pripominka;
      if(p.sent === true) return;
      if(t.stav === 'done') return;
      if((p.typ !== 'cas' && p.typ !== 'pred')) return;   // geo řeší klient
      if(!p.at || p.at > now) return;                     // ještě není čas
      if(now - p.at > 24*3600*1000) {                     // starší 24 h – jen označit, neposílat
        jobs.push(db.ref('/ukoly/' + id + '/pripominka/sent').set(true));
        return;
      }

      // Příjemci = zadavatel + přiřazení
      let uids = [];
      if(t.zadalUid) uids.push(t.zadalUid);
      (t.prirazeno || []).forEach(a => { if(a && a.uid) uids.push(a.uid); });
      uids = [...new Set(uids)];

      const tokens = [];
      uids.forEach(uid => { const u = users[uid]; if(u && u.fcmToken) tokens.push(u.fcmToken); });

      if(tokens.length > 0) {
        const message = {
          notification: { title: '🔔 Připomínka úkolu', body: (t.title || 'Úkol') + ' – blíží se termín.' },
          data: { taskId: id, typ: 'pripominka' },
          android: { priority: 'high', notification: { priority: 'max' } },
          apns: { headers: { 'apns-priority': '10' }, payload: { aps: { 'interruption-level': 'time-sensitive' } } },
          webpush: { headers: { Urgency: 'high' }, notification: { requireInteraction: true } },
          tokens: tokens
        };
        jobs.push(
          admin.messaging().sendEachForMulticast(message)
            .then(() => db.ref('/ukoly/' + id + '/pripominka/sent').set(true))
            .catch(e => { console.error('Připomínka FCM chyba:', e); })
        );
      } else {
        // Nikdo nemá token – označit jako odeslané, ať to nezkouší donekonečna
        jobs.push(db.ref('/ukoly/' + id + '/pripominka/sent').set(true));
      }
    });

    await Promise.all(jobs);
    console.log('checkReminders: zpracováno ' + jobs.length + ' připomínek.');
    return null;
  });

/* ════════════════════════════════════════════════════════════════
   HTTPS FUNKCE – upload fotky do GitHubu (token zůstává na serveru)
   - Klient pošle POST { filename, content (base64 JPEG) } + Firebase ID token
   - Funkce ověří přihlášení, validuje jméno souboru a commitne do repa
   - GitHub token je v Secret Manageru, NIKDY v prohlížeči

   NASTAVENÍ TOKENU (jednou):
     firebase functions:secrets:set GITHUB_TOKEN
       → vlož NOVÝ fine-grained PAT (repo Sulice---Zelivec, Contents: Read&Write)
   DEPLOY:
     firebase deploy --only functions
   URL po deployi:
     https://europe-west1-sulice-zelivec.cloudfunctions.net/uploadFoto
   ════════════════════════════════════════════════════════════════ */
const GH_REPO     = 'Pripravar/D11-1108-Jaromer-Trutnov'; /* DOPLNIT: přesný název repa nové stavby */
const GH_BRANCH   = 'main';
const ALLOW_ORIGIN = 'https://pripravar.github.io'; /* origin GitHub Pages (CORS) */

exports.uploadFoto = functions
  .region('europe-west1')
  .runWith({ secrets: ['GITHUB_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    // 1) Ověřit přihlášeného uživatele (Firebase ID token)
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch(e) {
      res.status(401).json({ error: 'Neplatné přihlášení' }); return;
    }

    // 2) Validovat vstup
    const body = req.body || {};
    const filename = String(body.filename || '');
    const content  = String(body.content  || '');
    // jen bezpečné názvy: písmena, číslice, tečka, podtržítko, pomlčka, volitelně jedna
    // podsložka (např. "standalone/"), končí .jpg/.jpeg/.png. Bez ".." a bez úvodního "/".
    if(!/^([A-Za-z0-9_-]+\/)?[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(filename)) {
      res.status(400).json({ error: 'Neplatné jméno souboru' }); return;
    }
    if(!content || content.length > 12 * 1024 * 1024) { // ~9 MB binárně
      res.status(400).json({ error: 'Chybí nebo příliš velký obsah' }); return;
    }

    // 3) Commit do GitHubu (token ze Secret Manageru)
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/photos/' + filename;
    try {
      const ghResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + process.env.GITHUB_TOKEN,
          'Content-Type':  'application/json',
          'User-Agent':    'sulice-zelivec-fn'
        },
        body: JSON.stringify({ message: 'Foto: ' + filename, content: content, branch: GH_BRANCH })
      });
      const data = await ghResp.json();
      if(ghResp.ok && data && data.content && data.content.download_url) {
        res.status(200).json({ download_url: data.content.download_url });
      } else {
        console.error('GitHub upload err:', ghResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.message) || 'GitHub upload selhal' });
      }
    } catch(e) {
      console.error('uploadFoto výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při uploadu' });
    }
  });

/* ════════════════════════════════════════════════════════════════
   HTTPS FUNKCE – upload PDF výkresu do GitHubu (token na serveru)
   - Klient pošle POST { filename, content (base64 PDF) } + Firebase ID token
   - Commit do repa pod  pdf/uploads/<filename>  (servíruje se jako ostatní výkresy)
   - Stejný GitHub token (Secret GITHUB_TOKEN) i CORS origin jako uploadFoto
   - LIMIT: Cloud Function přijme request do ~10 MB, takže PDF do ~7 MB.
   DEPLOY (spustí uživatel):
     firebase deploy --only functions:uploadVykres
   URL po deployi:
     https://europe-west1-d11-1108-jaromer---trutnov.cloudfunctions.net/uploadVykres
   ════════════════════════════════════════════════════════════════ */
exports.uploadVykres = functions
  .region('europe-west1')
  .runWith({ secrets: ['GITHUB_TOKEN'] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if(req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if(req.method !== 'POST')    { res.status(405).json({ error: 'Jen POST' }); return; }

    // 1) Ověřit přihlášeného uživatele (Firebase ID token)
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if(!idToken) { res.status(401).json({ error: 'Chybí přihlášení' }); return; }
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch(e) {
      res.status(401).json({ error: 'Neplatné přihlášení' }); return;
    }

    // 2) Validovat vstup – jen .pdf, volitelně jedna podsložka (např. "SO_135/")
    const body = req.body || {};
    const filename = String(body.filename || '');
    const content  = String(body.content  || '');
    if(!/^([A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+\.pdf$/i.test(filename)) {
      res.status(400).json({ error: 'Neplatné jméno souboru (jen .pdf)' }); return;
    }
    if(!content || content.length > 10 * 1024 * 1024) { // ~7,5 MB binárně
      res.status(400).json({ error: 'Chybí obsah, nebo je PDF příliš velké (max ~7 MB)' }); return;
    }

    // 3) Commit do GitHubu (token ze Secret Manageru)
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/pdf/uploads/' + filename;
    try {
      const ghResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + process.env.GITHUB_TOKEN,
          'Content-Type':  'application/json',
          'User-Agent':    'd11-1108-fn'
        },
        body: JSON.stringify({ message: 'Výkres: ' + filename, content: content, branch: GH_BRANCH })
      });
      const data = await ghResp.json();
      if(ghResp.ok && data && data.content && data.content.download_url) {
        res.status(200).json({ download_url: data.content.download_url });
      } else {
        console.error('GitHub vykres upload err:', ghResp.status, JSON.stringify(data));
        res.status(502).json({ error: (data && data.message) || 'GitHub upload selhal' });
      }
    } catch(e) {
      console.error('uploadVykres výjimka:', e);
      res.status(500).json({ error: 'Chyba serveru při uploadu' });
    }
  });

/* ════════════════════════════════════════════════════════════════
   NAPLÁNOVANÁ FUNKCE – denní záloha celé Realtime Database do Storage
   - Jednou denně uloží celý strom DB jako JSON do PRIVÁTNÍHO Firebase Storage
     (zalohy/db-<den>.json + zalohy/db-latest.json).
   - Kryje textová data (deník, poznámky, úkoly, KZP, podpisy, metadata fotek).
     Samotné soubory fotek/PDF kryje GitHub repo (git historie).
   - Bez GITHUB_TOKENu, jen admin SDK. NIKDY nezálohovat DB do veřejného repa.

   PŘED DEPLOYEM (uživatel): Firebase Console → Build → Storage → Get started
     (vytvoří default bucket; bez něj funkce spadne na chybějícím bucketu).
   DEPLOY (uživatel): firebase deploy --only functions:backupDatabase
     (1. deploy naplánované funkce zapne Cloud Scheduler API + Pub/Sub API.)
   ════════════════════════════════════════════════════════════════ */
exports.backupDatabase = functions
  .region('europe-west1')
  .pubsub.schedule('every 24 hours').timeZone('Europe/Prague')
  .onRun(async () => {
    const data = (await admin.database().ref('/').once('value')).val() || {};
    const json = JSON.stringify(data);
    const stamp = new Date().toISOString().slice(0, 10);
    const bucket = admin.storage().bucket();
    const opts = { contentType: 'application/json', resumable: false };
    await bucket.file('zalohy/db-' + stamp + '.json').save(json, opts);
    await bucket.file('zalohy/db-latest.json').save(json, opts);
    console.log('Záloha DB uložena: zalohy/db-' + stamp + '.json');
    return null;
  });
