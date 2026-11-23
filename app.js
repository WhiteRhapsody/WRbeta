(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var T = App.T, $ = App.$, storageOK = App.storageOK, prefs = App.prefs, savePrefs = App.savePrefs, newSession = App.newSession,
    persist = App.persist, PV = App.PV, renderPredict = App.renderPredict, liteStep = App.liteStep, LITE_THEMES = App.LITE_THEMES,
    THEME_NAME = App.THEME_NAME, setLiteTheme = App.setLiteTheme, liteLayout = App.liteLayout, renderLite = App.renderLite,
    setLiteStep = App.setLiteStep, renderGhost = App.renderGhost, setMode = App.setMode, photo = App.photo, renderCompare = App.renderCompare,
    CV = App.CV, anaPZ = App.anaPZ, anaSetView = App.anaSetView, AV = App.AV, anaChangeTarget = App.anaChangeTarget,
    renderAnalysis = App.renderAnalysis, restoreCodes = App.restoreCodes, drawRecord = App.drawRecord, recMetaHTML = App.recMetaHTML,
    renderRecords = App.renderRecords, renderAbout = App.renderAbout, ask = App.ask, toast = App.toast, showTab = App.showTab, stSub = App.stSub,
    nav = App.nav, fillCalRing = App.fillCalRing, navBulge = App.navBulge;
  // 給其他模組用（函式）
  App.syncTargetSel = syncTargetSel; App.renderAll = renderAll;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'APP_NAME', { get: function () { return APP_NAME; }, set: function (v) { APP_NAME = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'APP_VERSION', { get: function () { return APP_VERSION; }, set: function (v) { APP_VERSION = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'APP_LABEL', { get: function () { return APP_LABEL; }, set: function (v) { APP_LABEL = v; }, enumerable: true, configurable: true });
  // App 名稱與版本：只改這裡（標題列、說明分頁、匯出檔都讀這兩個常數）
  var APP_NAME = 'WRbeta', APP_VERSION = 'v2.9.1', APP_LABEL = 'beta v2.9.1'; // v2.0.0：畫面上顯示「beta v2.0」；v2.0.1（新圖示）顯示「beta v2.0.1」
  try { var _v = document.getElementById('appVer'); if (_v) _v.textContent = APP_LABEL; var _a = document.getElementById('aboutVer'); if (_a) _a.textContent = wrT('app.x', [APP_LABEL, APP_VERSION]); document.title = APP_NAME; } catch (e) {}
  var tsel = $('targetSel');
  Object.keys(T).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = T[k].name; tsel.appendChild(o); });
  // v1.6.0：右上角靶種選單會看目前分頁——在「分析」分頁改的是分析的靶種（分析頁不再有自己的選單）
  function syncTargetSel() { var ana = App.curTab === 'analysis'; tsel.value = ana ? App.acur.targetId : App.cur.targetId; tsel.setAttribute('aria-label', ana ? wrT('app.analysis_target_type') : wrT('app.target_type')); tsel.title = ana ? wrT('app.analysis_target_type_changing_it') : wrT('app.target_type'); }
  tsel.onchange = function () {
    var id = tsel.value;
    if (App.curTab === 'analysis') { tsel.value = App.acur.targetId; anaChangeTarget(id); syncTargetSel(); return; }
    function go() { prefs.targetId = id; savePrefs(); persist(); photo.reset(); PV.reset(); CV.reset(); renderAll(); }
    if (App.cur.preds.length || App.cur.actuals.length) {
      tsel.value = App.cur.targetId;
      ask(wrT('app.this_set_already_has_shots'), function () { App.cur = newSession(id); App.sessions.unshift(App.cur); go(); });
    } else { App.cur.targetId = id; go(); }
  };
  function renderAll() { renderAnalysis(); syncTargetSel(); $('pairMode').value = App.cur.pairMode || (App.cur.actuals.some(function (a) { return a.src === 'auto'; }) ? 'optimal' : 'order'); fillCalRing(); renderPredict(); renderCompare(); renderRecords(); if (document.body.classList.contains('on-ghost')) renderGhost(); if (typeof App.acctState !== 'undefined' && App.curTab === 'about' && stSub.cur === 'acct') { try { App.renderAcct(); } catch (e) {} } }
  try { var nj = $('nojsNotice'); if (nj) nj.style.display = 'none'; } catch (e) {}
  if (!storageOK) { var sw = $('storageNotice'); if (sw) sw.style.display = ''; }
  setLiteTheme(App.liteTheme, true); setMode(prefs.ui, true); document.body.classList.add('on-predict'); nav.sync('predict'); renderAbout(); persist(true); renderAll(); liteLayout();
  if (window.WRLayout) WRLayout.init({ toast: toast, ask: ask });
  // v1.7.0：分析頁拍照按鈕自動收邊（dock.js）；設定在「設定/說明 › 設定 › 介面設定」
  if (window.WRDock) {
    WRDock.init({ enabled: prefs.dockAutoHide !== false, active: function () { return App.curTab === 'analysis'; }, toast: toast });
    $('dockAutoHide').checked = prefs.dockAutoHide !== false;
    $('dockAutoHide').onchange = function () { prefs.dockAutoHide = this.checked; savePrefs(); WRDock.setEnabled(this.checked); toast(this.checked ? wrT('app.camera_buttons_tuck_to_the') : wrT('app.camera_buttons_always_show')); };
    $('dockResetSet').onclick = function () { WRDock.home(); };
  }
  // v1.8.0：Pro 打開 App 預設在「分析」（Lite 照舊從三步驟的預報開始）
  // v2.2.0：換語言會重新載入；回到原本的分頁（「設定」子標籤由 prefs.aboutSub 記住）
  var _langTab = null; try { _langTab = sessionStorage.getItem('wr_lang_tab'); sessionStorage.removeItem('wr_lang_tab'); } catch (e) {}
  if (_langTab && document.getElementById('tab-' + _langTab)) { showTab(_langTab); window.scrollTo(0, 0); }
  else if (!document.body.classList.contains('lite')) { showTab('analysis'); window.scrollTo(0, 0); }
  // v2.2.0：「設定 › 介面設定 › 語言 / Language」
  (function () {
    var seg = $('langSeg'); if (!seg || !window.wrT) return;
    var cur = wrT.lang(); if ($('langHint')) $('langHint').textContent = wrT('app.lang_hint');
    seg.querySelectorAll('[data-lang]').forEach(function (b) {
      var on = b.dataset.lang === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.onclick = function () { if (b.dataset.lang === wrT.lang()) return; try { sessionStorage.setItem('wr_lang_tab', App.curTab || 'about'); } catch (e) {} toast(wrT('app.lang_switching')); setTimeout(function () { wrT.setLang(b.dataset.lang); }, 60); };
    });
  })();
  window.BMApp = { version: APP_VERSION, get cur() { return App.cur; }, get acur() { return App.acur; }, get anaSel() { return App.anaSel; }, set anaSel(v) { App.anaSel = v; renderAnalysis(); }, renderAnalysis: function () { renderAnalysis(); }, get anaPhotos() { return App.anaPhotos; }, get anaBusy() { return App.anaBusy; }, get sessions() { return App.sessions; }, photo: photo, renderAll: renderAll, setMode: setMode, setLiteTheme: setLiteTheme, liteLayout: liteLayout, get mode() { return document.body.classList.contains('lite') ? 'lite' : 'pro'; }, get liteView() { return App.liteView; }, get liteStep() { return liteStep(); }, setLiteStep: setLiteStep, get litePhoto() { return App.lp; }, get liteSel() { return App.liteSel; }, renderLite: function () { renderLite(); }, get gcur() { return App.gcur; }, renderGhost: function () { renderGhost(); }, showTab: function (n) { showTab(n); }, get ghostPreview() { return App.ghPrev; }, nav: nav, get tab() { return App.curTab; }, predZoom: function (z) { PV.zoom(z); renderPredict(); }, cmpZoom: function (z) { CV.zoom(z); renderCompare(); }, get predView() { return PV.v; },
    // v1.6.0
    get anaView() { return App.anaView; }, setAnaView: function (v) { anaSetView(v); }, anaZoom: function (z) { AV.zoom(z); renderAnalysis(); }, get anaViewBox() { return AV.v; }, get anaPZ() { return anaPZ; }, themes: LITE_THEMES.slice(), themeName: THEME_NAME, get theme() { return App.liteTheme; },
    // v1.7.0
    stSub: stSub, get aboutSub() { return stSub.cur; }, dock: window.WRDock,
    // v2.6.0 額外分頁（站長頁；之後的管理員頁）
    stTabs: { enable: function (n, on) { stSub.enable(n, on); }, get list() { return stSub.list; } },
    // v1.8.0
    renderAcct: function (st) { App.renderAcct(st); }, profileStats: function () { return App.profileStats(); }, restoreCodes: function (t) { return restoreCodes(t); },
    // v2.0.0（member.js 用）
    label: APP_LABEL, anaOpenRO: function (r, o) { return App.anaOpenRO(r, o); }, anaSaveCopy: function (r, x) { return App.anaSaveCopy(r, x); }, recTitle: function (r) { return App.recTitle(r); }, toast: toast, ask: ask, drawRecord: drawRecord, recMetaHTML: recMetaHTML, renderRecShare: function () { if (App.curTab === 'records') renderRecords(); }, navBulge: function () { navBulge(); },
    // v2.9.0（member-friends.js 用）：好友刪除／收回分享 → 移除本機保存的那份
    removeRecords: function (ids) { return App.removeRecords(ids); } };
})(window.WRApp = window.WRApp || {});
