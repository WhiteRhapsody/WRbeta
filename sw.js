// WRbeta service worker
// 更新策略：網頁本體（HTML、JS、CSS、manifest）一律「先抓網路，失敗才用快取」→ 有網路時永遠是最新版；
// 圖示等靜態檔才用快取優先。安裝時用 cache:'reload' 跳過 HTTP 快取（GitHub Pages 會快取 10 分鐘），避免把舊檔存進新快取。
// 新版啟用後：刪掉所有舊快取（含 bm-v3/v4 時代的），接管頁面，並讓開著的舊頁面自動重新載入一次。
var VERSION = 'v2.9.4';
var CACHE = 'wrbeta-' + VERSION;
var SHELL = ['./', 'index.html', 'i18n/zh-TW.js', 'i18n/en.js', 'i18n/i18n.js', 'privacy-en.html', 'style.css', 'core.js', 'recordcode.js', 'liteflow.js', 'vision.js', 'firebase-config.js', 'cloud.js', 'member.js', 'member-friends.js', 'member-admin.js', 'ghost.js', 'press.js', 'crosshair.js', 'themes.css', 'themefx.js', 'layout.js', 'dock.js', 'app-base.js', 'app-forecast.js', 'app-lite.js', 'app-ghost.js', 'app-photo.js', 'app-mods.js', 'app-analysis.js', 'sius-img.js', 'sius.js', 'sius-ocr.js', 'app-sius.js', 'app-records.js', 'app-nav.js', 'app.js', 'app-account.js', 'app-back.js', 'app-coach.js', 'app-home.js', 'pdf-report.js', 'pdf-export.js', 'manifest.webmanifest', 'privacy.html'];
// v2.9.3 小白單 OCR 引擎（vendor/tesseract/，約 7 MB）：第一次按「小白單」才下載，存在獨立的快取，換版時不刪（檔名不變＝內容不變；換 tesseract 版本就改 OCR_CACHE）
var OCR_CACHE = 'wrbeta-ocr-tess7.0.0';
var STATIC = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'fonts/wr-chakra-700.woff', 'fonts/wr-rajdhani-700.woff', 'fonts/wr-saira-700.woff', 'fonts/wr-orbitron-800.woff', 'fonts/wr-playfair-700.woff', 'fonts/wr-dearmrpotter.woff', 'fonts/wr-tinos-700.woff'];
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.concat(STATIC).map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    }));
  }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    var old = ks.filter(function (k) { return k !== CACHE && k !== OCR_CACHE; });
    return Promise.all(old.map(function (k) { return caches.delete(k); })).then(function () { return self.clients.claim(); }).then(function () {
      if (!old.length) return;
      // 從舊版升級：舊版的頁面不會自己更新，幫它重新載入一次
      return self.clients.matchAll({ type: 'window' }).then(function (cs) {
        cs.forEach(function (c) { try { if (c.navigate) c.navigate(c.url); } catch (err) {} });
      });
    });
  }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
function isShell(req) {
  if (req.mode === 'navigate') return true;
  var p = new URL(req.url).pathname;
  return /\/$|\.(html|js|css|webmanifest)$/.test(p);
}
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (/\/vendor\/tesseract\//.test(new URL(req.url).pathname)) {
    e.respondWith(caches.open(OCR_CACHE).then(function (c) { return c.match(req, { ignoreSearch: true }).then(function (r) { return r || fetch(req).then(function (r2) { if (r2 && r2.ok) c.put(req, r2.clone()); return r2; }); }); }));
    return;
  }
  if (isShell(req)) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (r) {
      if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req.mode === 'navigate' ? 'index.html' : req, cp); }); }
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) { return r || fetch(req); }));
});
