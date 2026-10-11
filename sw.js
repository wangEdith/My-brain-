/* 圈问 · 离线缓存：只缓存页面文件和 PDF 引擎，AI 请求一律直连，不经过缓存 */
var VERSION = 'quanwen-v4';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'ai.js', 'db.js', 'notes.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var pdfjs = url.hostname === 'cdnjs.cloudflare.com' && url.pathname.indexOf('/pdf.js/') >= 0;
  if (!sameOrigin && !pdfjs) return;
  /* 先给缓存，同时后台更新（页面文件改了，下次打开就是新的） */
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: false }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
