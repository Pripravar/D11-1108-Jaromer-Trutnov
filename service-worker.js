// Service worker pro D11 Jaroměř – Trutnov (PWA app shell).
// Strategie: network-first pro index.html (vždy čerstvá appka po pull-to-refresh),
// cache-first jako fallback při výpadku sítě. PDF a dlaždice se NEcacheují.
// Verzi zvyš při každém deployi, ať se stará cache invaliduje.
var CACHE = 'd11-app-v26-fcm27';
var SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL).catch(function(){}); }));
});

self.addEventListener('message', function(e){
  if(e.data === 'skipWaiting'){ self.skipWaiting(); }
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  // Necacheovat PDF, fotky, mapové dlaždice a externí API.
  if(url.origin !== self.location.origin || /\.(pdf|jpg|jpeg|png|webp)$/i.test(url.pathname)) return;
  // index.html / navigace: network-first.
  if(req.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/')){
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); });
        return res;
      }).catch(function(){ return caches.match(req).then(function(m){ return m || caches.match('./index.html'); }); })
    );
    return;
  }
  // ostatní same-origin: cache-first.
  e.respondWith(caches.match(req).then(function(m){ return m || fetch(req); }));
});

// ── Push notifikace (Web Push / FCM) – sjednoceno se šablonou ──
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {
    try { data = { notification: { title: 'Notifikace', body: event.data.text() } }; } catch(_) {}
  }
  var n = data.notification || {};
  var title = n.title || 'D11 – most Jaroměř–Trutnov';
  var options = {
    body:    n.body || '',
    icon:    n.icon || './manifest.json',
    badge:   n.badge,
    data:    data.data || {},
    tag:     (data.data && data.data.taskId) || 'stavba-notify',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options).then(function(){
    try{ if(self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge(); }catch(e){}
  }));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var taskId = event.notification.data && event.notification.data.taskId;
  var url = './' + (taskId ? ('#task=' + encodeURIComponent(taskId)) : '');
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
      for(var i=0; i<list.length; i++) {
        var c = list[i];
        if(c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          c.focus();
          if('navigate' in c) c.navigate(url);
          return;
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
