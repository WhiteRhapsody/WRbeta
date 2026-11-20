/* WRbeta 鬼影模式畫面（邏輯在 ghost.js）
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, $ = App.$, f1 = App.f1, f2 = App.f2, store = App.store, saveSessions = App.saveSessions, prefs = App.prefs,
    savePrefs = App.savePrefs, isAna = App.isAna, el = App.el, drawTarget = App.drawTarget, labelSize = App.labelSize, previewMark = App.previewMark,
    offsetText = App.offsetText, LF = App.LF, zClamp = App.zClamp, scoreColor = App.scoreColor, attachZoom = App.attachZoom, vib = App.vib,
    liftPx = App.liftPx, ask = App.ask, toast = App.toast;
  // 給其他模組用（函式）
  App.renderGhost = renderGhost; App.ghLayout = ghLayout;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'G', { get: function () { return G; }, set: function (v) { G = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'LS_GCUR', { get: function () { return LS_GCUR; }, set: function (v) { LS_GCUR = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'gcur', { get: function () { return gcur; }, set: function (v) { gcur = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'ghView', { get: function () { return ghView; }, set: function (v) { ghView = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'ghPrev', { get: function () { return ghPrev; }, set: function (v) { ghPrev = v; }, enumerable: true, configurable: true });

  // ---------- 鬼影模式（v1.4.0；Lite 從「更多」進入、Pro 是「鬼影」分頁；邏輯在 src/ghost.js） ----------
  // 60 發＝6 輪 × 10 發，手動點靶面記錄；灰色孔＝上一次同一發、虛線圈＝下一發的鬼影。存成一般紀錄（kind:'forecast'、mode:'ghost'）。
  var G = window.BMGhost, LS_GCUR = 'bm_ghost_cur_v1';
  var ghSvg = $('ghSvg'), gcur = null, ghView = null, ghTid = null, ghPrev = null, ghOn = prefs.ghostOn !== false, ghOpen = !!prefs.ghostColl;
  function ghT() { return T[gcur.targetId] || T.ap10; }
  function ghEnsure() {
    if (gcur && App.sessions.indexOf(gcur) < 0 && G.countShots(gcur)) gcur = null; // 被刪掉了
    if (!gcur) {
      var id = store.get(LS_GCUR);
      gcur = App.sessions.filter(function (s) { return s.id === id && G.isGhost(s); })[0] || null;
      if (gcur && gcur.ghost && gcur.ghost.done) gcur = null;
    }
    if (!gcur) { gcur = G.newSession(App.cur.targetId); gcur.ghost.src = prefs.ghostSrc === 'round' ? 'round' : 'prev'; }
    if (!G.countShots(gcur) && gcur.targetId !== App.cur.targetId) { gcur.targetId = App.cur.targetId; ghView = null; }
    return gcur;
  }
  function ghPersist() {
    var i = App.sessions.indexOf(gcur);
    if (i < 0) { i = App.sessions.findIndex(function (s) { return s.id === gcur.id; }); }
    if (i < 0) App.sessions.unshift(gcur); else App.sessions[i] = gcur;
    gcur.updated = new Date().toISOString();
    saveSessions(App.sessions); store.set(LS_GCUR, gcur.id);
  }
  function ghRef() { return G.pickRef(App.sessions, gcur); }
  function ghSrc() { return gcur.ghost && gcur.ghost.src === 'round' ? 'round' : 'prev'; }
  function ghSlots() { return G.ghostSlots(gcur, ghRef(), ghSrc()); }
  function ghResetView() { var c = ghT().cardSize; ghView = { cx: 0, cy: 0, E: c }; ghTid = gcur.targetId; }
  function ghClamp() { var c = ghT().cardSize; zClamp(ghView, { x0: -c / 2, y0: -c / 2, w: c, h: c }, 10); }
  function ghApplyView() {
    var v = ghView; ghSvg.setAttribute('viewBox', (v.cx - v.E / 2) + ' ' + (v.cy - v.E / 2) + ' ' + v.E + ' ' + v.E); ghSvg.dataset.extent = v.E;
    var z = ghT().cardSize / v.E, b = $('ghZoomBadge'); b.textContent = (Math.round(z * 10) / 10) + '×'; b.classList.toggle('show', z > 1.05); $('ghFit').disabled = z <= 1.05;
  }
  function ghDot(g, p, num, cls, r, txtCls) {
    var E = +ghSvg.dataset.extent, gg = el('g', {}, g);
    el('circle', { cx: p.x, cy: -p.y, r: r, 'class': cls, 'stroke-width': Math.max(0.12, E * 0.003) }, gg);
    if (num != null) {
      var fs = labelSize(ghSvg) * 0.9;
      var tx = el('text', { x: p.x, y: -p.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': txtCls || 'gh-num', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx.textContent = num;
    }
    return gg;
  }
  function ghSign(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + f2(Math.abs(v)); }
  function ghDelta(v) { return v == null ? '' : '<span class="gh-d ' + (v > 0.005 ? 'up' : v < -0.005 ? 'dn' : 'eq') + '">' + (v > 0.005 ? '▲' : v < -0.005 ? '▼' : '') + ghSign(v) + '</span>'; }
  function renderGhostTarget(gs, S) {
    if (!ghView || ghTid !== gcur.targetId) ghResetView();
    var t = ghT(), R = t.pellet / 2, k = G.curRound(gcur), n = S.next;
    drawTarget(ghSvg, t, 1); ghClamp(); ghApplyView();
    var g = ghSvg.querySelector('#marks'), lines = ghSvg.querySelector('#lines');
    if (ghOn) {
      if (prefs.ghostWhole && !document.body.classList.contains('lite')) {
        for (var i = 0; i < G.PER; i++) { var w = gs[k * G.PER + i]; if (w && k * G.PER + i !== n) ghDot(lines, w, k * G.PER + i + 1, 'gh-whole', R, 'gh-num-w'); }
      }
      var nx = n != null ? G.ghostAt(gs, n + 1) : null;
      if (nx && n + 1 < (k + 1) * G.PER) ghDot(lines, nx, null, 'gh-next', R);
      var gh = G.ghostAt(gs, n);
      if (gh) ghDot(lines, gh, n + 1, 'gh-ghost', R, 'gh-num-g');
    }
    G.roundShots(gcur, k).forEach(function (p, i) { ghDot(g, p, k * G.PER + i + 1, 'act-c', R, 'gh-num-me'); });
    if (ghPrev) previewMark(ghSvg, ghPrev, 'act-c', t);
  }
  function renderGhostRail(S, gs) {
    var lite = document.body.classList.contains('lite'), k = S.round, rr = S.rounds[k], src = ghSrc();
    var pl = src === 'round' ? wrT('app.previous_series') : wrT('app.last_time'), h = '';
    var pips = ''; for (var i = 0; i < G.ROUNDS; i++) pips += '<i class="' + (i < k || S.rounds[i].done && i !== k ? 'd' : i === k ? 'on' : '') + '"></i>';
    var prevAll = src === 'round' ? (k > 0 ? S.rounds[k - 1].cur : null) : S.prevAll;
    var tot = S.cur ? S.cur.total : 0, totD = S.cur ? f1(S.cur.totalDec) : '0.0';
    var coll = '<button type="button" class="gh-coll' + (ghOpen ? ' open' : '') + '" id="ghColl" aria-expanded="' + ghOpen + '">' + (ghOpen ?
      wrT('app.total_shots_60', [tot, totD, S.shots, S.prevAll && src === 'prev' ? wrT('app.last_total_shots', [S.prevAll.total, S.prevAll.n]) : '']) :
      wrT('app.total_shots_tap_to_open')) + '</button>';
    if (lite) {
      h += wrT('app.series_6', [k + 1, pips]);
      h += wrT('app.avg', [pl, prevAll ? f2(prevAll.avg) : '—', src === 'round' ? wrT('app.series_n', [k]) : prevAll ? wrT('app.shots_4', [prevAll.n]) : wrT('app.no_record')]);
      h += wrT('app.current_avg', [S.cur ? f2(S.cur.avg) : '—', S.diff != null ? wrT('app.vs_at_same_point', [ghDelta(S.diff), pl]) : '<div class="s">&nbsp;</div>']);
      h += wrT('app.series_this_time', [k + 1, pl, rr.prevSame ? f2(rr.prevSame.avg) : rr.prev ? f2(rr.prev.avg) : '—', rr.cur ? f2(rr.cur.avg) : '—', rr.diff != null ? ghDelta(rr.diff) : '']);
      h += coll;
    } else {
      h += wrT('app.current_series_6_overall_avg', [k + 1, pips, pl, prevAll ? f2(prevAll.avg) : '—', src === 'round' ? wrT('app.series_n', [k]) : prevAll ? wrT('app.shots_4', [prevAll.n]) : wrT('app.no_record'), S.cur ? f2(S.cur.avg) : '—', S.diff != null ? wrT('app.vs_at_same_point_2', [ghDelta(S.diff), pl, f2(S.prevSame.avg)]) : '&nbsp;']);
      var tb = wrT('app.series_avg_this_avg_diff', [pl]);
      S.rounds.forEach(function (r) {
        var pv = src === 'round' ? (r.k > 0 ? S.rounds[r.k - 1].cur : null) : r.prev, cv = r.cur;
        var d = cv && r.prevSame ? cv.avg - r.prevSame.avg : null;
        var bw = function (v) { return v ? Math.max(4, Math.min(100, (v.avg - 7) / 3.9 * 100)).toFixed(0) : 0; };
        tb += wrT('app.series', [r.k === k ? 'on' : '', r.k + 1, r.k * 10 + 1, r.k * 10 + 10, pv ? f2(pv.avg) : '—', cv ? f2(cv.avg) : '—', d != null ? ghDelta(d) : '', bw(pv), bw(cv)]);
      });
      h += tb + '</table>' + coll;
    }
    $('ghRail').innerHTML = h; if (window.WRLayout) WRLayout.refresh();
    $('ghColl').onclick = function () { ghOpen = !ghOpen; prefs.ghostColl = ghOpen; savePrefs(); renderGhost(); };
  }
  function renderGhostStrip(S, gs) {
    var t = ghT(), k = S.round, cells = G.strip(t, gcur, gs, k), src = ghSrc();
    var h = wrT('app.series_shots_top_row_this', [k + 1, k * 10 + 1, k * 10 + 10, src === 'round' ? wrT('app.previous_series') : wrT('app.last_time')]);
    cells.forEach(function (c) {
      var me = c.me, col = me ? scoreColor(me.dec) : null, isCur = c.n === S.next;
      h += '<div class="gh-cell' + (isCur ? ' cur' : '') + '"><div class="n">' + (c.n + 1) + '</div>' +
        '<div class="me' + (me ? '' : isCur ? ' now' : ' empty') + '"' + (me ? ' style="background:' + col.bg + ';color:' + col.fg + '"' : '') + '>' + (me ? f1(me.dec) : isCur ? '●' : '') + '</div>' +
        '<div class="gs">' + (c.gh ? f1(c.gh.dec) : '—') + '</div></div>';
    });
    $('ghStrip').innerHTML = h + '</div>';
  }
  function renderGhostBig(S, gs) {
    var t = ghT(), n = S.next, box = $('ghBig'), src = ghSrc(), pl = src === 'round' ? wrT('app.previous_series') : wrT('app.last_time');
    var p = ghPrev, idx = n, lbl;
    if (p) lbl = wrT('app.shot_holding', [n + 1]);
    else {
      var me = G.slots(gcur), last = -1; for (var i = G.TOTAL - 1; i >= 0; i--) if (me[i]) { last = i; break; }
      if (last >= 0) { p = me[last]; idx = last; lbl = wrT('app.shot_2', [last + 1]); }
    }
    if (!p) {
      box.className = 'gh-big empty';
      box.innerHTML = '<div class="bv">—</div><div class="bk">' + (n != null ? wrT('app.shot_hold_the_target_to', [n + 1]) : wrT('app.all_10_shots_in_this')) + '</div>';
      return;
    }
    var s = C.scoreShot(t, p.x, p.y), col = scoreColor(s.dec), gh = G.ghostAt(gs, idx), cmp = '';
    if (gh) {
      var gsx = C.scoreShot(t, gh.x, gh.y), dd = s.dec - gsx.dec;
      cmp = wrT('app.shot_diff', [pl, idx + 1, f1(gsx.dec), dd >= 0 ? '+' : '−', f1(Math.abs(dd)), offsetText(p.x - gh.x, p.y - gh.y)]);
    } else if (ghOn) cmp = '<div class="cmp">' + (S.hasGhost || src === 'round' ? wrT('app.has_no_shot', [pl, idx + 1]) : wrT('app.no_record_to_compare_yet')) + '</div>';
    box.className = 'gh-big' + (ghPrev ? ' live' : '');
    box.style.setProperty('--score', col.bg); box.style.setProperty('--score-hi', col.hi || col.bg); box.style.setProperty('--score-fg', col.fg); box.style.setProperty('--score-lbl', col.lbl);
    box.innerHTML = wrT('app.ring', [f1(s.dec), lbl, s.inner ? wrT('app.inner_10_2') : '', s.ring, cmp]);
  }
  function renderGhost() {
    if (!G || !$('ghostView')) return;
    ghEnsure();
    var gs = ghSlots(), t = ghT(), S = G.summary(t, gcur, gs), k = S.round, src = ghSrc(), ref = ghRef(), lite = document.body.classList.contains('lite');
    var V = $('ghostView'); V.dataset.src = src; V.classList.toggle('gh-off', !ghOn);
    renderGhostTarget(gs, S); renderGhostRail(S, gs); renderGhostStrip(S, gs); renderGhostBig(S, gs);
    // 沒有可對照的紀錄：不畫鬼影，只提示（照常可以記錄）
    var empty = $('ghEmpty'), em = '';
    if (src === 'prev' && !ref) em = wrT('app.no_previous_record_yet_shoot');
    else if (src === 'round' && k === 0) em = wrT('app.series_1_has_no_previous');
    empty.innerHTML = em; empty.hidden = !em || !!ghPrev || (S.shots > 0 && src === 'prev');
    var inR = G.roundShots(gcur, k).length, done = !!(gcur.ghost && gcur.ghost.done);
    $('ghHint').innerHTML = done ? wrT('app.60_shots_done_saved_to') : wrT('app.series_2', [k + 1, S.next != null ? wrT('app.shot_total_60_hold_the', [S.next + 1, S.shots]) : wrT('app.all_10_shots_done_tap', [k + 1])]);
    $('ghFinishLbl').textContent = done ? wrT('app.start_a_new_set') : k >= G.ROUNDS - 1 ? wrT('app.finish_series_6_save') : wrT('app.finish_series', [k + 1]);
    $('ghFinishSub').textContent = done ? wrT('app.60_shots') : inR + '/10';
    $('ghProg').style.transform = 'scaleX(' + (done ? 1 : inR / G.PER).toFixed(2) + ')';
    $('ghFinish').classList.toggle('soft', !done && !inR);
    $('ghUndo').disabled = done || !inR;
    var tg = $('ghToggle'); tg.setAttribute('aria-checked', ghOn ? 'true' : 'false'); tg.classList.toggle('on', ghOn);
    document.querySelectorAll('#ghOpts .gh-seg button').forEach(function (b) { var on = b.dataset.src === src; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var sel = $('ghRef'), cands = G.candidates(App.sessions, gcur), hs = '';
    cands.forEach(function (s, i) { hs += wrT('app.shots_5', [App.esc(s.id), G.isGhost(s) ? '👻 ' : isAna(s) ? wrT('app.analysis') : wrT('app.call'), App.esc(App.recTitle(s)), G.countShots(s), i === 0 ? wrT('app.latest') : '']); });
    sel.innerHTML = hs || wrT('app.no_record_to_compare'); sel.disabled = !cands.length; if (ref) sel.value = ref.id;
    $('ghRefRow').classList.toggle('dim', src !== 'prev');
    $('ghWhole').checked = !!prefs.ghostWhole;
    if (!lite && !$('ghOpts').dataset.touched) $('ghOpts').open = true;
    if (document.activeElement !== $('ghName')) $('ghName').value = gcur.name || '';
    var Code = window.BMCode, rec = LF.toAnalysisRecord(gcur), code = null;
    try { code = rec && Code ? Code.encode(rec) : null; } catch (e) { code = null; }
    $('ghCopyCode').disabled = !code;
    $('ghCodeInfo').textContent = code ? wrT('app.record_code_characters_series_of', [code.length, rec.sheets.length]) : '';
    ghLayout();
  }
  // Lite 直向：靶面＝寬度扣掉右側 84px 資訊欄，高度不超過可用空間
  function ghLayout() {
    var V = $('ghostView'); if (!V || !V.offsetParent) return;
    var tg = $('ghTg');
    if (!document.body.classList.contains('lite')) { tg.style.width = ''; tg.style.height = ''; return; }
    var W = V.clientWidth, size = Math.floor(Math.max(180, Math.min(W - 84 - 8, window.innerHeight * 0.42)));
    tg.style.width = size + 'px'; tg.style.height = size + 'px';
  }
  window.addEventListener('resize', function () { if (document.body.classList.contains('on-ghost')) ghLayout(); });
  attachZoom(ghSvg, {
    active: function () { return true; },
    view: function () { return ghView; }, clamp: ghClamp, apply: ghApplyView, render: function () { renderGhost(); },
    lift: function () { return liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) {
      ghPrev = { x: r.x, y: -r.y }; previewMark(ghSvg, ghPrev, 'act-c', ghT());
      var S = G.summary(ghT(), gcur, ghSlots()); renderGhostBig(S, ghSlots()); $('ghEmpty').hidden = true;
    },
    up: function (r) {
      var m = { x: r.x, y: -r.y }, half = ghT().cardSize / 2 + 1; ghPrev = null;
      if (Math.abs(m.x) > half || Math.abs(m.y) > half) { renderGhost(); return; }
      if (gcur.ghost && gcur.ghost.done) { toast(wrT('app.60_shots_done_tap_start')); renderGhost(); return; }
      var q = G.addShot(gcur, m);
      if (!q) { toast(wrT('app.all_10_shots_of_series', [G.curRound(gcur) + 1, G.curRound(gcur) + 1])); renderGhost(); return; }
      ghPersist(); vib(); renderGhost();
    },
    cancel: function () { ghPrev = null; renderGhost(); }
  });
  $('ghFit').onclick = function () { ghResetView(); renderGhost(); };
  $('ghUndo').onclick = function () { if (G.undo(gcur)) { ghPersist(); renderGhost(); } };
  $('ghToggle').onclick = function () { ghOn = !ghOn; prefs.ghostOn = ghOn; savePrefs(); renderGhost(); toast(ghOn ? wrT('app.ghost_on') : wrT('app.ghost_off')); };
  function ghNew() { var src = ghSrc(); gcur = G.newSession(gcur.targetId); gcur.ghost.src = src; ghView = null; ghPrev = null; store.set(LS_GCUR, gcur.id); renderGhost(); toast(wrT('app.new_set_series_1_started')); }
  $('ghFinish').onclick = function () {
    if (gcur.ghost && gcur.ghost.done) { ghNew(); return; }
    var k = G.curRound(gcur), inR = G.roundShots(gcur, k).length;
    function go() {
      var r = G.finishRound(gcur); ghPersist(); App.renderRecords();
      if (r.done) { renderGhost(); toast(wrT('app.60_shots_done_saved_to_2')); } else { renderGhost(); toast(wrT('app.series_started', [r.round + 1])); }
      window.scrollTo(0, 0);
    }
    if (!inR) { toast(wrT('app.no_shots_in_this_series')); return; }
    if (inR < G.PER) ask(wrT('app.series_has_only_shots_finish', [k + 1, inR]), go); else go();
  };
  document.querySelectorAll('#ghOpts .gh-seg button').forEach(function (b) { b.onclick = function () { gcur.ghost = gcur.ghost || {}; gcur.ghost.src = b.dataset.src; prefs.ghostSrc = b.dataset.src; savePrefs(); if (G.countShots(gcur)) ghPersist(); renderGhost(); }; });
  $('ghRef').onchange = function () { gcur.ghost = gcur.ghost || {}; gcur.ghost.ref = this.value || null; if (G.countShots(gcur)) ghPersist(); renderGhost(); toast(wrT('app.ghost_now_uses_this_record')); };
  $('ghWhole').onchange = function () { prefs.ghostWhole = this.checked; savePrefs(); renderGhost(); };
  $('ghOpts').addEventListener('toggle', function () { this.dataset.touched = '1'; });
  $('ghName').onchange = function () { gcur.name = this.value.trim().slice(0, 60); if (G.countShots(gcur)) ghPersist(); toast(wrT('app.name_saved')); };
  $('ghCopyCode').onclick = function () {
    if (!App.rcOk()) return;
    var Code = window.BMCode, rec = LF.toAnalysisRecord(gcur), code = rec && Code && Code.encode(rec);
    if (!code) { toast(wrT('app.no_shots_to_copy_yet')); return; }
    App.copyText(code, wrT('app.record_code_copied_characters', [code.length]));
  };
  $('ghNew').onclick = function () { if (G.countShots(gcur) && !(gcur.ghost && gcur.ghost.done)) ask(wrT('app.this_set_has_been_saved_2'), ghNew); else ghNew(); };
})(window.WRApp = window.WRApp || {});
