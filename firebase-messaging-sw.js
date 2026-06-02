// Service worker pro Firebase Cloud Messaging (push notifikace na pozadí).
// !! FIREBASE_CONFIG musí být SHODNÝ s index.html. Doplň reálné hodnoty z Firebase Console.
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyAJ05DOXqbCx7W5BcKdMfzu0o76Jp9514o',
  authDomain:        'd11-1108-jaromer---trutnov.firebaseapp.com',
  projectId:         'd11-1108-jaromer---trutnov',
  storageBucket:     'd11-1108-jaromer---trutnov.firebasestorage.app',
  messagingSenderId: '843987471450',
  appId:             '1:843987471450:web:5d551ef350fc93ee459c63'
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
