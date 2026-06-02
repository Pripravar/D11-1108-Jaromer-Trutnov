// Service worker pro Firebase Cloud Messaging (push notifikace na pozadí).
// !! FIREBASE_CONFIG musí být SHODNÝ s index.html. Doplň reálné hodnoty z Firebase Console.
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'DOPLNIT',
  authDomain:        'PROJEKT.firebaseapp.com',
  projectId:         'PROJEKT',
  storageBucket:     'PROJEKT.firebasestorage.app',
  messagingSenderId: 'DOPLNIT',
  appId:             'DOPLNIT'
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  var n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || 'D11 Jaroměř – Trutnov', {
    body: n.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: (payload && payload.data) || {}
  });
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
    if(clients.openWindow) return clients.openWindow('./index.html');
  }));
});
