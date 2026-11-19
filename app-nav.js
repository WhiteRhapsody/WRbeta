/* WRbeta 導覽：Pro／Lite 模式切換、主題、說明分頁、「設定/說明」子標籤、功能切換（A 圖示列／B 浮動按鈕／C 左右滑動）、A 圖示列鼓起底座
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var T = App.T, NS = App.NS, $ = App.$, f2 = App.f2, prefs = App.prefs, savePrefs = App.savePrefs, renderPredict = App.renderPredict,
    THEME_NAME = App.THEME_NAME, setLiteTheme = App.setLiteTheme, liteLayout = App.liteLayout, renderGhost = App.renderGhost, toast = App.toast,
    showTab = App.showTab;
  // 給其他模組用（函式）
  App.setMode = setMode; App.pickIsHeic = pickIsHeic; App.renderAbout = renderAbout; App.navBulge = navBulge;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'stSub', { get: function () { return stSub; }, set: function (v) { stSub = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'nav', { get: function () { return nav; }, set: function (v) { nav = v; }, enumerable: true, configurable: true });

  // ---------- Pro / Lite 模式切換（記在 prefs，存不了就只在記憶體） ----------
  function setMode(m, quiet) {
    m = m === 'lite' ? 'lite' : 'pro';
    document.body.classList.toggle('lite', m === 'lite');
    document.querySelectorAll('#modeToggle button').forEach(function (b) { var on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (prefs.ui !== m) { prefs.ui = m; savePrefs(); }
    if (typeof nav !== 'undefined' && nav) nav.modeChanged(); // v1.5.0：功能列只在 Pro（Lite 有自己的步驟列）
    if (document.body.classList.contains('on-ghost')) renderGhost();
    if (!quiet) { renderPredict(); liteLayout(); toast(m === 'lite' ? wrT('app.switched_to_lite') : wrT('app.switched_to_pro')); }
  }
  document.querySelectorAll('#modeToggle button').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
  $('liteThemeSel').onchange = function () { setLiteTheme(this.value); toast(wrT('app.theme_changed')); };
  document.querySelectorAll('#themeGrid [data-th]').forEach(function (b) { b.onclick = function () { setLiteTheme(b.dataset.th); liteLayout(); toast(wrT('app.theme', [THEME_NAME[b.dataset.th]])); }; });
  // 主題動畫（預設開；系統減少動態效果時一律不動）
  $('fxAnimTg').checked = prefs.fxAnim !== false; if (window.WRFx) WRFx.setEnabled(prefs.fxAnim !== false);
  $('fxAnimTg').onchange = function () { prefs.fxAnim = this.checked; savePrefs(); if (window.WRFx) WRFx.setEnabled(this.checked); toast(this.checked ? wrT('app.theme_animation_on') : wrT('app.theme_animation_off')); };
  // Lite 預報頁右下的調色盤按鈕 → 底部單手選單（說明分頁的下拉選單也保留）
  (function () {
    var sh = $('liteThemeSheet'), names = THEME_NAME;
    function close() { sh.hidden = true; document.body.classList.remove('lt-sheet-open'); $('liteThemeBtn').focus({ preventScroll: true }); }
    $('liteThemeBtn').onclick = function () { sh.hidden = false; document.body.classList.add('lt-sheet-open'); var b = sh.querySelector('.on') || sh.querySelector('[data-th]'); if (b) b.focus({ preventScroll: true }); };
    sh.querySelectorAll('[data-th]').forEach(function (b) { b.onclick = function () { setLiteTheme(b.dataset.th); liteLayout(); toast(wrT('app.theme_2', [names[b.dataset.th]])); close(); }; });
    sh.querySelector('.lt-sheet-x').onclick = close;
    sh.addEventListener('click', function (e) { if (e.target === sh) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && !sh.hidden) close(); });
  })();
  // Lite 底部「更多」：外觀、紀錄、多張分析、說明與帳號、切到 Pro（Lite 隱藏上方分頁列，都從這裡進）
  (function () {
    var sh = $('liteMoreSheet');
    function close() { sh.hidden = true; }
    $('liteMoreBtn').onclick = function () { sh.hidden = false; var b = sh.querySelector('[data-act]'); if (b) b.focus({ preventScroll: true }); };
    sh.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.act; close();
        if (a === 'theme') $('liteThemeBtn').onclick();
        else if (a === 'pro') { setMode('pro'); showTab('predict'); }
        else { showTab(a); window.scrollTo(0, 0); }
      };
    });
    sh.querySelector('.lt-sheet-x').onclick = close;
    sh.addEventListener('click', function (e) { if (e.target === sh) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && !sh.hidden) close(); });
  })();

  // 選照片：「從檔案選」可以選到任何檔案，先確認是圖片；HEIC（三星「高效率相片」）Chrome 多半無法解碼，給清楚的說明
  function pickIsHeic(f) { return /heic|heif/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || ''); }

  // ---------- 說明 ----------
  function renderAbout() {
    var rows = function (t) { var h = ''; for (var n = 10; n >= 1; n--) h += '<tr><td>' + n + '</td><td>' + t.ringDiam[n] + '</td><td>' + f2(t.ringDiam[n] / 2 + t.pellet / 2) + '</td></tr>'; return h; };
    $('aboutText').innerHTML =
      wrT('app.version_privacy_policy_how_to', [App.APP_NAME, App.APP_LABEL, App.APP_VERSION, rows(T.ap10), rows(T.ar10)]);
  }

  // ---------- v1.7.0「設定/說明」子標籤：設定｜說明（記住上次看的；樣式跟主題，切換方式跟 A/B/C） ----------
  // A／B／Lite：點標籤切換（A 底線分頁、B 膠囊）；C：點標籤或在頁面上左右滑（標籤下有小圓點），規則見 nav 的 tEnd。
  var ST_SUBS = ['set', 'acct', 'help']; // v1.8.0：中間多了「帳號」
  var stSub = (function () {
    var S = $('tab-about'), P = $('stPanes'), cur = ST_SUBS.indexOf(prefs.aboutSub) >= 0 ? prefs.aboutSub : 'set', anim = 0;
    function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function set(name, o) {
      o = o || {}; if (ST_SUBS.indexOf(name) < 0) name = 'set';
      var old = cur; cur = name; S.setAttribute('data-sub', name);
      document.querySelectorAll('#stTabs [data-sub]').forEach(function (b) { var on = b.dataset.sub === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      document.querySelectorAll('#tab-about .st-dots i').forEach(function (d) { d.classList.toggle('on', d.dataset.sub === name); });
      $('stPaneSet').hidden = name !== 'set'; $('stPaneAcct').hidden = name !== 'acct'; $('stPaneHelp').hidden = name !== 'help';
      if (name === 'acct' && old !== name) { try { App.renderAcct(); } catch (e) {} }
      if (prefs.aboutSub !== name) { prefs.aboutSub = name; savePrefs(); }
      if (old !== name && o.dir && !reduced()) {
        clearTimeout(anim); P.style.transition = 'none'; P.style.transform = 'translateX(' + (o.dir * 22) + '%)'; P.style.opacity = '0.2'; void P.offsetWidth;
        P.style.transition = 'transform .26s cubic-bezier(.2,.8,.3,1),opacity .22s'; P.style.transform = ''; P.style.opacity = '';
        anim = setTimeout(function () { P.style.transition = ''; }, 300);
      }
      if (old !== name && !o.noScroll && App.curTab === 'about') { var h = $('stTabs'), top = h.getBoundingClientRect().top; if (top < 0) window.scrollTo(0, Math.max(0, window.scrollY + top - 70)); }
    }
    function canStep(dir) { var i = ST_SUBS.indexOf(cur) + dir; return i >= 0 && i < ST_SUBS.length; }
    function step(dir) { if (!canStep(dir)) return false; set(ST_SUBS[ST_SUBS.indexOf(cur) + dir], { dir: dir }); return true; }
    function drag(dx) { if (reduced()) return; P.style.transition = 'none'; P.style.transform = 'translateX(' + (dx * 0.5).toFixed(1) + 'px)'; P.style.opacity = String(1 - Math.min(0.4, Math.abs(dx) / 600)); }
    function dragEnd() { if (!P.style.transform && !P.style.opacity) return; P.style.transition = 'transform .2s cubic-bezier(.2,.8,.3,1),opacity .2s'; P.style.transform = ''; P.style.opacity = ''; clearTimeout(anim); anim = setTimeout(function () { P.style.transition = ''; }, 240); }
    document.querySelectorAll('#stTabs [data-sub]').forEach(function (b) {
      b.onclick = function () { var d = ST_SUBS.indexOf(b.dataset.sub) - ST_SUBS.indexOf(cur); set(b.dataset.sub, { dir: d }); };
      b.onkeydown = function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); if (step(e.key === 'ArrowRight' ? 1 : -1)) document.querySelector('#stTabs [data-sub="' + cur + '"]').focus(); } };
    });
    set(cur, { noScroll: true });
    return { get cur() { return cur; }, set: set, step: step, canStep: canStep, drag: drag, dragEnd: dragEnd };
  })();

  // ---------- v1.5.0 功能切換（只在 Pro；Lite 用底部步驟列）：A 底部圖示列／B 浮動按鈕／C 左右滑動 ----------
  // A（預設）：閒置 3 秒淡出（opacity 300ms，隱藏時不能按）；在靶面以外輕輕一滑（或從畫面下方往上滑）就淡入。點靶面、雙指縮放不會叫出來。
  // B：右下角浮動圓鈕，按一下往上展開 5 個功能（順序同 NAV_ORDER）。C：在靶面以外左右滑動換功能，上方小圓點顯示目前位置。
  // 設定存在 prefs.nav（'a'｜'b'｜'c'）與 prefs.navAutoHide（預設 true）。
  // v1.8.0：順序改成 預報·對照／鬼影／分析（中間）／紀錄／設定/說明；打開 App 預設在「分析」
  var NAV_ORDER = ['predict', 'ghost', 'analysis', 'records', 'about'];
  var NAV_NAME = { predict: wrT('app.call_check'), analysis: wrT('app.analysis_2'), records: wrT('app.records'), ghost: wrT('app.ghost_2'), about: wrT('app.settings') };
  var nav = (function () {
    var N = $('wrNav'), H = $('wrNavHandle'), fab = $('wrFab'), scrim = $('wrFabScrim'), B = document.body, M = document.querySelector('main');
    var HIDE_MS = 3000, hideT = 0, holding = false, keyboard = false, style = 'a', autoHide = prefs.navAutoHide !== false, g = null, anim = 0;
    // 不算「滑動」的起點：靶面、照片、彈出視窗、可橫向捲動的區塊、輸入元件、功能列本身
    var NO_SWIPE = 'svg.target,svg.lite-photo,.photobox,.lt-sheet,.modal-bg,input,textarea,select,#wrNav,.wr-fab-wrap,.wr-navc,table,.ana-chips,.ana-strip,.ana-photobox,.ana-dock,.wr-pop,.lay-bar,.lay-editing [data-mod],.lite-rounds,.gh-strip,.dk-eye';
    function pro() { return !B.classList.contains('lite'); }
    function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function isHidden() { return B.classList.contains('nav-hidden'); }
    function setHidden(h) { B.classList.toggle('nav-hidden', !!h); N.setAttribute('aria-hidden', h ? 'true' : 'false'); }
    function arm() {
      clearTimeout(hideT);
      if (style !== 'a' || !autoHide) return;
      hideT = setTimeout(function () {
        if (holding || (keyboard && N.contains(document.activeElement)) || !pro()) { arm(); return; }
        setHidden(true);
      }, HIDE_MS);
    }
    function reveal() { if (style !== 'a') return; setHidden(false); arm(); }
    function openFab(o) {
      o = !!o && style === 'b';
      B.classList.toggle('fab-open', o); fab.setAttribute('aria-expanded', o ? 'true' : 'false');
      if (o) { var a = N.querySelector('button.active') || N.querySelector('button'); if (a) try { a.focus({ preventScroll: true }); } catch (e) {} }
    }
    function syncSettings() {
      document.querySelectorAll('#navStyleSeg [data-nav]').forEach(function (b) { var on = b.dataset.nav === style; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      var ah = $('navAutoHide'); if (ah) { ah.checked = autoHide; ah.disabled = style !== 'a'; }
      var row = $('navAutoHideRow'); if (row) row.classList.toggle('dim', style !== 'a');
    }
    function setStyle(st, quiet) {
      st = ['a', 'b', 'c'].indexOf(st) >= 0 ? st : 'a'; style = st; $('stTabs').setAttribute('data-nav', st);
      ['a', 'b', 'c'].forEach(function (k) { B.classList.toggle('nav-' + k, k === st); });
      openFab(false); cDragEnd(true); setHidden(false); arm(); syncSettings();
      if (prefs.nav !== st) { prefs.nav = st; savePrefs(); }
      if (!quiet) toast({ a: wrT('app.navigation_a_bottom_icon_bar'), b: wrT('app.navigation_b_floating_button_bottom'), c: wrT('app.navigation_c_swipe_left_right') }[st]);
    }
    function setAuto(on) { autoHide = !!on; prefs.navAutoHide = autoHide; savePrefs(); syncSettings(); setHidden(false); arm(); }
    function sync(name) {
      var i = NAV_ORDER.indexOf(name); if (i < 0) return;
      var btn = N.querySelector('button[data-tab="' + name + '"]');
      // B：圓鈕顯示目前功能的圖示＋名稱
      var ic = fab.querySelector('.wr-fab-ic'), sv = btn && btn.querySelector('svg');
      if (ic && sv) ic.innerHTML = sv.outerHTML;
      $('wrFabLbl').textContent = NAV_NAME[name]; fab.setAttribute('aria-label', wrT('app.menu_current', [NAV_NAME[name]]));
      // C：目前頁名＋兩側淡淡顯示左右鄰居
      $('navcCur').textContent = NAV_NAME[name];
      $('navcPrev').textContent = i > 0 ? '‹ ' + NAV_NAME[NAV_ORDER[i - 1]] : '';
      $('navcNext').textContent = i < NAV_ORDER.length - 1 ? NAV_NAME[NAV_ORDER[i + 1]] + ' ›' : '';
      document.querySelectorAll('#wrNavC .navc-dots button').forEach(function (d) { var on = d.dataset.tab === name; d.classList.toggle('on', on); d.setAttribute('aria-selected', on ? 'true' : 'false'); });
      if (style === 'a' && !isHidden()) arm();
    }
    function go(name) { openFab(false); var old = App.curTab; showTab(name); if (old !== name || name === 'predict') window.scrollTo(0, 0); }
    N.querySelectorAll('button[data-tab]').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); if (style === 'b' || style === 'c') window.scrollTo(0, 0); }; });
    document.querySelectorAll('#wrNavC .navc-dots button').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); window.scrollTo(0, 0); }; });
    $('navcPrev').onclick = function () { cStep(-1); }; $('navcNext').onclick = function () { cStep(1); };
    fab.onclick = function () { openFab(!B.classList.contains('fab-open')); };
    scrim.onclick = function () { openFab(false); };
    H.onclick = function () { reveal(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && B.classList.contains('fab-open')) { openFab(false); try { fab.focus({ preventScroll: true }); } catch (x) {} } });
    // 按著功能列時不要淡出；放開後重新計時
    N.addEventListener('pointerdown', function () { keyboard = false; holding = true; clearTimeout(hideT); }, { passive: true });
    document.addEventListener('pointerup', function () { if (holding) { holding = false; arm(); } }, { passive: true, capture: true });
    document.addEventListener('pointercancel', function () { if (holding) { holding = false; arm(); } }, { passive: true, capture: true });
    N.addEventListener('focusin', function () { if (style === 'a') reveal(); });
    N.addEventListener('focusout', function () { arm(); });

    // --- C：左右滑動的畫面跟手（只動 main 的 transform／opacity） ---
    function cDrag(dx) {
      if (reduced()) return;
      var i = NAV_ORDER.indexOf(App.curTab), edge = (dx > 0 && i === 0) || (dx < 0 && i === NAV_ORDER.length - 1);
      var d = edge ? dx * 0.18 : dx * 0.55;
      M.style.transition = 'none'; M.style.transform = 'translateX(' + d.toFixed(1) + 'px)'; M.style.opacity = String(1 - Math.min(0.35, Math.abs(d) / (window.innerWidth || 400)));
      B.classList.toggle('navc-peek-prev', dx > 24 && !edge); B.classList.toggle('navc-peek-next', dx < -24 && !edge);
    }
    function cDragEnd(instant) {
      B.classList.remove('navc-peek-prev', 'navc-peek-next');
      if (!M.style.transform && !M.style.opacity) return;
      if (instant || reduced()) { M.style.transition = ''; M.style.transform = ''; M.style.opacity = ''; return; }
      M.style.transition = 'transform .22s cubic-bezier(.2,.8,.3,1),opacity .22s'; M.style.transform = ''; M.style.opacity = '';
      clearTimeout(anim); anim = setTimeout(function () { M.style.transition = ''; }, 260);
    }
    function cStep(dir) {
      var i = NAV_ORDER.indexOf(App.curTab) + dir;
      if (i < 0 || i >= NAV_ORDER.length) { cDragEnd(); return false; }
      var to = NAV_ORDER[i];
      if (to === 'about') stSub.set(dir > 0 ? 'set' : 'help', { noScroll: true }); // 從左邊滑進來＝先到「設定」（最靠近的子標籤）
      B.classList.remove('navc-peek-prev', 'navc-peek-next');
      if (reduced()) { M.style.transform = ''; M.style.opacity = ''; showTab(to); window.scrollTo(0, 0); return true; }
      clearTimeout(anim);
      M.style.transition = 'transform .15s ease-in,opacity .15s ease-in'; M.style.transform = 'translateX(' + (-dir * 38) + '%)'; M.style.opacity = '0';
      anim = setTimeout(function () {
        showTab(to); window.scrollTo(0, 0);
        M.style.transition = 'none'; M.style.transform = 'translateX(' + (dir * 30) + '%)'; void M.offsetWidth;
        M.style.transition = 'transform .24s cubic-bezier(.2,.8,.3,1),opacity .24s'; M.style.transform = ''; M.style.opacity = '';
        anim = setTimeout(function () { M.style.transition = ''; }, 280);
      }, 150);
      return true;
    }

    // --- 手勢（觸控事件，全部 passive，不擋捲動與靶面縮放） ---
    function canStart(el, x) {
      if (!el || !el.closest) return false;
      if (el.closest(NO_SWIPE)) return false;
      return true;
    }
    document.addEventListener('touchstart', function (e) {
      if (!pro() || e.touches.length !== 1) { if (g && g.dir === 'h') { cDragEnd(); stSub.dragEnd(); } g = null; return; }
      var t = e.touches[0], W = window.innerWidth || 400;
      g = { x: t.clientX, y: t.clientY, t: Date.now(), ok: canStart(e.target), edge: t.clientX < 18 || t.clientX > W - 18, bottom: t.clientY > (window.innerHeight || 800) - 96, dir: null, done: false };
      // 從畫面最下方（功能列的位置）開始的一滑，即使起點剛好在別的元素上也算
      if (!g.ok && g.bottom && !(e.target.closest && e.target.closest('svg.target,svg.lite-photo,.photobox,.modal-bg,.lt-sheet'))) g.ok = true;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!g) return;
      if (e.touches.length !== 1) { if (g.dir === 'h') { cDragEnd(); stSub.dragEnd(); } g = null; return; }
      var t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (style === 'a') {
        if (!g.done && g.ok && isHidden() && (Math.hypot(dx, dy) >= 18 || (g.bottom && dy <= -10))) { g.done = true; reveal(); }
        else if (!g.done && g.ok && !isHidden() && Math.hypot(dx, dy) >= 18) { g.done = true; arm(); }
      } else if (style === 'c' && g.ok && !g.edge) {
        if (!g.dir) { if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) g.dir = 'h'; else if (Math.abs(dy) > 12) g.dir = 'v'; }
        if (g.dir === 'h') { if (App.curTab === 'about' && stSub.canStep(dx < 0 ? 1 : -1)) { g.sub = true; cDragEnd(true); stSub.drag(dx); } else { if (g.sub) { g.sub = false; stSub.dragEnd(); } cDrag(dx); } }
      }
    }, { passive: true, capture: true });
    function tEnd(e) {
      if (!g) return; var G = g; g = null;
      if (style !== 'c' || G.dir !== 'h') return;
      var t = e.changedTouches && e.changedTouches[0]; if (!t || e.type === 'touchcancel') { cDragEnd(); stSub.dragEnd(); return; }
      var dx = t.clientX - G.x, dt = Math.max(1, Date.now() - G.t), W = window.innerWidth || 400;
      // v1.7.0：在「設定/說明」裡左右滑＝先換子標籤（設定 ⇄ 帳號 ⇄ 說明）；已經在最邊的子標籤再往外滑，才換到相鄰的功能頁
      if (Math.abs(dx) > Math.max(56, W * 0.2) || (Math.abs(dx) > 32 && Math.abs(dx) / dt > 0.45)) { var dir = dx < 0 ? 1 : -1; if (App.curTab === 'about' && stSub.step(dir)) { cDragEnd(true); return; } stSub.dragEnd(); cStep(dir); } else { cDragEnd(); stSub.dragEnd(); }
    }
    document.addEventListener('touchend', tEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', tEnd, { passive: true, capture: true });
    // 電腦（滑鼠）：滑到畫面最下方、或在靶面以外捲動滾輪＝叫出功能列
    document.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' && style === 'a' && pro() && isHidden() && e.clientY > (window.innerHeight || 800) - 56) reveal(); }, { passive: true }); // 只算真的滑鼠（觸控點擊產生的相容滑鼠事件不算）
    document.addEventListener('wheel', function (e) { if (style === 'a' && pro() && isHidden() && canStart(e.target)) reveal(); }, { passive: true });

    // 設定（設定/說明 › 設定 › 介面設定）
    document.querySelectorAll('#navStyleSeg [data-nav]').forEach(function (b) { b.onclick = function () { setStyle(b.dataset.nav); }; });
    $('navAutoHide').onchange = function () { setAuto(this.checked); toast(this.checked ? wrT('app.bottom_icon_bar_auto_hide') : wrT('app.bottom_icon_bar_always_show')); };
    function modeChanged() { openFab(false); cDragEnd(true); setHidden(false); arm(); setHdr(); }
    // C 的小圓點列黏在標題列下面：量一下標題列實際高度（含瀏海安全區）
    function setHdr() { var h = document.querySelector('header'); if (h) document.documentElement.style.setProperty('--hdr-h', h.offsetHeight + 'px'); }
    window.addEventListener('resize', setHdr); setHdr();
    setStyle(prefs.nav, true);
    return {
      get style() { return style; }, get hidden() { return isHidden(); }, get autoHide() { return autoHide; }, get fabOpen() { return B.classList.contains('fab-open'); },
      setStyle: setStyle, setAutoHide: setAuto, reveal: reveal, hide: function () { clearTimeout(hideT); if (style === 'a') setHidden(true); },
      openFab: openFab, sync: sync, step: cStep, modeChanged: modeChanged, go: go, HIDE_MS: HIDE_MS
    };
  })();

  /* ---------- v2.0.0：A 圖示列的底座在中間「分析」後面往上鼓起一個圓弧（一整條連續的外框＋陰影） ----------
     做法：底座本身的背景／框線／陰影改成透明，改畫一個 SVG 路徑：
       .nv-bz-fill：同樣的背景（var(--nv-tx),var(--nv-base)＋毛玻璃），用 clip-path:path() 剪成鼓起的形狀
       .nv-bz-line：同一條路徑的框線（顏色＝主題原本的框線色）
       .nv-bz：drop-shadow 濾鏡＝主題原本的外陰影（沿著鼓起的形狀走）
     主題、字級、視窗大小、功能切換樣式改變都會重算；Lite、B、C 樣式不畫（body 沒有 nv-bulge 就跟 v1.8 一樣） */
  var NB = { sig: '', raf: 0 };
  function splitShadows(v) { var out = [], d = 0, cur = ''; for (var i = 0; i < v.length; i++) { var ch = v[i]; if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  function shadowFilter(v) {
    if (!v || v === 'none') return '';
    return splitShadows(v).filter(function (x) { return !/\binset\b/.test(x); }).map(function (x) {
      var col = (x.match(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/i) || ['rgba(0,0,0,.25)'])[0], n = x.replace(col, '').match(/-?[\d.]+px/g) || [];
      return 'drop-shadow(' + (n[0] || '0px') + ' ' + (n[1] || '0px') + ' ' + (parseFloat(n[2] || '0') * 0.6).toFixed(1) + 'px ' + col + ')';
    }).join(' ');
  }
  function bulgePath(W, H, R, cx, a, top) {
    var h = 14, f = 20, x0 = cx - a - f, x1 = cx - a + 4, x2 = cx + a - 4, x3 = cx + a + f, mx = (x0 + x1) / 2, my = (x2 + x3) / 2, o = top;
    R = Math.min(R, H / 2, W / 2);
    var r = function (v) { return Math.round(v * 10) / 10; };
    return 'M' + r(R) + ',' + o + ' L' + r(x0) + ',' + o + ' C' + r(mx) + ',' + o + ' ' + r(mx) + ',' + r(o - h) + ' ' + r(x1) + ',' + r(o - h) +
      ' Q' + r(cx) + ',' + r(o - h - 5) + ' ' + r(x2) + ',' + r(o - h) + ' C' + r(my) + ',' + r(o - h) + ' ' + r(my) + ',' + o + ' ' + r(x3) + ',' + o +
      ' L' + r(W - R) + ',' + o + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(W) + ',' + r(o + R) + ' L' + r(W) + ',' + r(o + H - R) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(W - R) + ',' + r(o + H) +
      ' L' + r(R) + ',' + r(o + H) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 0,' + r(o + H - R) + ' L0,' + r(o + R) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(R) + ',' + o + ' Z';
  }
  function navBulge() {
    NB.raf = 0;
    var Bd = document.body, inn = document.querySelector('#wrNav .wr-nav-in'), main = inn && inn.querySelector('.nv-main');
    var ok = inn && main && !Bd.classList.contains('lite') && Bd.classList.contains('nav-a') && window.CSS && CSS.supports && CSS.supports('clip-path', 'path("M0,0 L1,1 Z")');
    if (!ok) { if (Bd.classList.contains('nv-bulge')) Bd.classList.remove('nv-bulge'); NB.sig = ''; return; }
    var had = Bd.classList.contains('nv-bulge'); if (had) Bd.classList.remove('nv-bulge');
    var cs = getComputedStyle(inn), bd = cs.borderTopColor, sh = cs.boxShadow, R = parseFloat(cs.borderTopLeftRadius) || 18, rr = inn.getBoundingClientRect();
    Bd.classList.add('nv-bulge');
    var mr = main.getBoundingClientRect(), W = rr.width, H = rr.height;
    if (W < 40 || H < 20) { Bd.classList.remove('nv-bulge'); NB.sig = ''; return; }
    var cx = mr.left + mr.width / 2 - rr.left, a = mr.width / 2 + 6, sig = [Math.round(W), Math.round(H), Math.round(cx), Math.round(a), R, bd, sh].join('|');
    var bz = inn.querySelector('.nv-bz');
    if (sig === NB.sig && bz) return;
    NB.sig = sig;
    if (!bz) {
      bz = document.createElement('div'); bz.className = 'nv-bz'; bz.setAttribute('aria-hidden', 'true');
      bz.innerHTML = '<div class="nv-bz-fill"></div><svg class="nv-bz-line" xmlns="' + NS + '"><path class="nv-bz-hl"/><path class="nv-bz-bd"/></svg>';
      inn.insertBefore(bz, inn.firstChild);
    }
    var TOP = 24, d = bulgePath(W, H, R, cx, a, TOP);
    bz.style.width = W + 'px'; bz.style.height = H + 'px'; bz.style.filter = shadowFilter(sh);
    var fill = bz.firstChild, svg = bz.lastChild;
    fill.style.height = (H + TOP) + 'px'; fill.style.top = -TOP + 'px'; fill.style.clipPath = fill.style.webkitClipPath = 'path("' + d + '")';
    svg.setAttribute('width', W); svg.setAttribute('height', H + TOP); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + TOP)); svg.style.top = -TOP + 'px';
    svg.querySelector('.nv-bz-bd').setAttribute('d', d); svg.querySelector('.nv-bz-bd').setAttribute('stroke', bd);
    svg.querySelector('.nv-bz-hl').setAttribute('d', d);
  }
  function navBulgeSoon() { if (!NB.raf) NB.raf = requestAnimationFrame(navBulge); }
  (function () {
    var lastCls = '';
    var strip = function (c) { return c.replace(/\b(nav-hidden|nv-bulge|mb-[\w-]+|fab-open|nav-reveal[\w-]*|dragging[\w-]*)\b/g, '').replace(/\s+/g, ' ').trim(); };
    try { new MutationObserver(function () { var c = strip(document.body.className); if (c !== lastCls) { lastCls = c; NB.sig = ''; navBulgeSoon(); } }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }); } catch (e) {}
    try { var inn = document.querySelector('#wrNav .wr-nav-in'); if (inn && window.ResizeObserver) new ResizeObserver(navBulgeSoon).observe(inn); } catch (e) {}
    window.addEventListener('resize', navBulgeSoon);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(navBulgeSoon);
    navBulge(); setTimeout(navBulgeSoon, 400);
  })();
})(window.WRApp = window.WRApp || {});
