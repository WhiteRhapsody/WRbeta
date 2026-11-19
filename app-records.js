/* WRbeta 紀錄頁＋分析紀錄碼（複製／分享／貼上還原、匯出匯入）
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, LS_CUR = App.LS_CUR, $ = App.$, f1 = App.f1, f2 = App.f2, store = App.store, saveSessions = App.saveSessions,
    SCHEMA_V = App.SCHEMA_V, isAna = App.isAna, newSession = App.newSession, newAnalysis = App.newAnalysis, fmtTW = App.fmtTW, anaShots = App.anaShots,
    persist = App.persist, drawTarget = App.drawTarget, drawShot = App.drawShot, G = App.G, LS_GCUR = App.LS_GCUR, photo = App.photo,
    LS_ACUR = App.LS_ACUR, requestPersist = App.requestPersist, fillAnaCalRing = App.fillAnaCalRing, trTag = App.trTag, esc = App.esc,
    lineChart = App.lineChart, renderAnalysis = App.renderAnalysis, ask = App.ask, toast = App.toast, showTab = App.showTab;
  // 給其他模組用（函式）
  App.copyText = copyText; App.updateAnaCodeInfo = updateAnaCodeInfo; App.restoreCodes = restoreCodes; App.drawRecord = drawRecord;
  App.recMetaHTML = recMetaHTML; App.recTitle = recTitle; App.renderRecords = renderRecords;

  // ---------- 分析紀錄碼 ----------
  function anaShotCount(s) {
    var n = 0, i;
    for (i = 0; i < ((s && s.sheets) || []).length; i++) n += (s.sheets[i].shots || []).length;
    return n;
  }
  function anaRecords() {
    return App.sessions.filter(function (s) { return isAna(s) && anaShotCount(s); }).sort(function (a, b) { return Date.parse(a.created) - Date.parse(b.created); });
  }
  function copyText(text, okMsg) {
    function done() { toast(okMsg); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast(wrT('app.copy_failed_use_share_or')); }
      ta.remove();
    }
  }
  function updateAnaCodeInfo() {
    var info = $('anaCodeInfo'), Code = window.BMCode, n = anaShotCount(App.acur), code = null;
    if (!$('anaShareCode').dataset.ready) {
      $('anaShareCode').dataset.ready = '1';
      if (navigator.share) $('anaShareCode').hidden = false;
    }
    $('anaCopyCode').disabled = !n;
    $('anaShareCode').disabled = !n;
    var all = anaRecords();
    $('anaCopyAllCodes').disabled = !all.length;
    if (!Code) { info.textContent = ''; return; }
    if (n) { try { code = Code.encode(App.acur); } catch (e) { code = null; } }
    if (code && all.length > 1) info.textContent = wrT('app.this_record_characters_saved_analyses', [code.length, all.length]);
    else if (code) info.textContent = wrT('app.this_record_characters', [code.length]);
    else if (all.length) info.textContent = wrT('app.analysis_records_saved_copy_them', [all.length]);
    else info.textContent = wrT('app.after_analyzing_you_can_copy');
  }
  $('anaCopyCode').onclick = function () {
    var Code = window.BMCode, code = Code && Code.encode(App.acur);
    if (!code) { toast(wrT('app.no_analysis_to_copy_yet')); return; }
    copyText(code, wrT('app.record_code_copied_characters_2', [code.length]));
  };
  $('anaShareCode').onclick = function () {
    var Code = window.BMCode, code = Code && Code.encode(App.acur);
    if (!code) { toast(wrT('app.no_analysis_to_share_yet')); return; }
    try { navigator.share({ title: wrT('app.wrbeta_record_code'), text: code }); } catch (e) { copyText(code, wrT('app.record_code_copied_characters_2', [code.length])); }
  };
  $('anaCopyAllCodes').onclick = function () {
    var Code = window.BMCode, list = anaRecords(), code = Code && Code.encodeMany(list);
    if (!code) { toast(wrT('app.no_analysis_records_to_copy')); return; }
    copyText(code, wrT('app.copied_analysis_record_codes_characters', [list.length, code.length]));
  };
  function showPasteBox(on) {
    $('anaPasteBox').hidden = !on;
    if (on) { $('anaPasteArea').value = ''; setTimeout(function () { $('anaPasteArea').focus(); }, 0); }
  }
  $('anaPasteCode').onclick = function () { showPasteBox(true); };
  $('anaPasteCancel').onclick = function () { showPasteBox(false); };
  $('anaPasteGo').onclick = function () {
    var added = restoreCodes($('anaPasteArea').value), ana;
    if (!added) return;
    ana = added.filter(isAna);
    if (ana.length) {
      App.acur = ana[ana.length - 1];
      App.anaPhotos = {}; App.anaSel = 'all';
      store.set(LS_ACUR, App.acur.id);
    }
    showPasteBox(false);
    renderAnalysis(); renderRecords();
  };
  /* v1.8.0：貼上紀錄碼還原（分析頁與紀錄頁共用）；分析、預報、鬼影都可以，重複的略過。回傳新增的紀錄（失敗＝null） */
  function restoreCodes(text) {
    var Code = window.BMCode, r, i, added, now = new Date().toISOString();
    if (!Code) { toast(wrT('app.couldnt_restore')); return null; }
    if (!stripWait(text)) { toast(wrT('app.paste_a_record_code_first')); return null; }
    r = Code.merge(App.sessions, text);
    if (!r.added.length && !r.skipped && !r.invalid) { toast(wrT('app.no_record_code_found')); return null; }
    added = r.added.slice().sort(function (a, b) { return Date.parse(a.created) - Date.parse(b.created); });
    for (i = 0; i < added.length; i++) { delete added[i].hash; added[i].updated = now; App.sessions.unshift(added[i]); } // updated＝現在：登入雲端時會上傳
    if (added.length) { saveSessions(App.sessions); requestPersist(); }
    toast((added.length ? wrT('app.restored', [added.length]) : wrT('app.nothing_new')) + (r.skipped ? wrT('app.skipped_duplicates', [r.skipped]) : '') + (r.invalid ? wrT('app.invalid', [r.invalid]) : ''), 3200);
    return added;
  }
  function stripWait(text) { return String(text || '').replace(/\s+/g, ''); }

  // ---------- 紀錄 ----------
  var recPick = {}; // 勾選要比較的紀錄 id
  function recShots(s) { // 比較用的彈著：分析＝全部張；預報＝有實際彈著用實際，否則用預報
    if (isAna(s)) return { shots: anaShots(s), src: wrT('app.analysis_2') };
    if (s.actuals && s.actuals.length) return { shots: s.actuals, src: wrT('app.actual') };
    return { shots: s.preds || [], src: wrT('app.call_2') };
  }
  function recCode(s) { var Code = window.BMCode; if (!Code) return null; try { return Code.encode(s); } catch (e) { return null; } }
  function recAllCodes() { var s = '', n = 0; App.sessions.forEach(function (x) { var c = recCode(x); if (c) { s += c; n++; } }); return { code: s, n: n }; }
  function updateRecCodeInfo() {
    var a = recAllCodes(), info = $('recCodeInfo'); if (!info) return;
    $('recCopyAll').disabled = !a.n; $('recShareAll').disabled = !a.n;
    info.textContent = a.n ? wrT('app.records_characters_coordinates_0_01mm', [a.n, a.code.length]) : wrT('app.each_shots_coordinates_relative_to');
  }
  if (navigator.share) $('recShareAll').hidden = false;
  $('recCopyAll').onclick = function () { var a = recAllCodes(); if (!a.n) { toast(wrT('app.no_records_to_copy_yet')); return; } copyText(a.code, wrT('app.copied_record_codes_characters', [a.n, a.code.length])); };
  $('recShareAll').onclick = function () { var a = recAllCodes(); if (!a.n) { toast(wrT('app.no_records_to_share_yet')); return; } try { navigator.share({ title: wrT('app.wrbeta_record_code'), text: a.code }); } catch (e) { copyText(a.code, wrT('app.copied_record_codes', [a.n])); } };
  function showRecPaste(on) { $('recPasteBox').hidden = !on; if (on) { $('recPasteArea').value = ''; setTimeout(function () { $('recPasteArea').focus(); }, 0); } }
  $('recPaste').onclick = function () { showRecPaste($('recPasteBox').hidden); };
  $('recPasteCancel').onclick = function () { showRecPaste(false); };
  $('recPasteGo').onclick = function () { var added = restoreCodes($('recPasteArea').value); if (!added) return; showRecPaste(false); App.renderAll(); };
  /* v2.0.0：好友分享的唯讀檢視（member.js）：把一筆紀錄畫在 ISSF 靶面上（分析＝全部彈孔；預報＝實際彈著＋預報點） */
  function drawRecord(svg, s) {
    var t = T[s.targetId] || T.ap10; drawTarget(svg, t, 1);
    var g = svg.querySelector('#marks'), pel = t.pellet, shots = isAna(s) ? anaShots(s) : (s.actuals || []);
    if (!isAna(s)) (s.preds || []).forEach(function (p, i) { drawShot(g, svg, p, i + 1, 'pred-c', pel); });
    shots.forEach(function (p, i) { drawShot(g, svg, p, i + 1, 'act-c', pel); });
  }
  function recMetaHTML(s) {
    var t = T[s.targetId] || T.ap10, rs = recShots(s), st = C.analyzeShots(t, rs.shots), h = '<div class="pf-stats">';
    var box = function (k, v, u) { return '<div class="pf-st"><small>' + k + '</small><b>' + v + (u ? '<i>' + u + '</i>' : '') + '</b></div>'; };
    h += box(wrT('app.target_type'), esc(t.name)) + box(wrT('app.shots'), st.n, wrT('app.shots_7'));
    if (st.n) h += box(wrT('app.total'), wrT('app.x_7', [st.total, f1(st.totalDec)])) + box(wrT('app.average_2'), f2(st.avgDec)) + (st.n > 1 ? box(wrT('app.group_size_2'), f1(st.groupSize), 'mm') : '');
    if (!isAna(s) && s.preds && s.preds.length && s.actuals && s.actuals.length) { var cmp = C.comparePredictions(t, s.preds, s.actuals, s.pairMode || 'optimal'); if (cmp.m) h += box(wrT('app.avg_call_error'), f2(cmp.meanErr), 'mm'); }
    return wrT('app.data', [h, isAna(s) ? wrT('app.analysis_targets', [(s.sheets || []).length]) : G.isGhost(s) ? wrT('app.ghost_training') : wrT('app.calls_blue_call_red_actual'), rs.src]);
  }
  function recKindLabel(s) { return isAna(s) ? wrT('app.analysis_2') : (G.isGhost(s) ? wrT('app.ghost') : wrT('app.call_2')); }
  function recTitle(s) { return (s.name && s.name.trim()) || recKindLabel(s) + ' ' + fmtTW(s.created).replace(/^\d{4}\//, ''); }
  function renderRecords() {
    var box = $('recordList');
    Object.keys(recPick).forEach(function (id) { if (!App.sessions.some(function (x) { return x.id === id; })) delete recPick[id]; });
    updateCmpBtn(); updateRecCodeInfo();
    if (!App.sessions.length) { box.innerHTML = wrT('app.no_records_yet_2'); return; }
    box.innerHTML = '';
    App.sessions.forEach(function (s) {
      var t = T[s.targetId] || T.ap10, ana = isAna(s), gho = G.isGhost(s), isCur = ana ? s.id === App.acur.id : gho ? !!(App.gcur && s.id === App.gcur.id) : s.id === App.cur.id;
      var div = document.createElement('div'); div.className = 'rec' + (isCur ? ' cur' : '') + (ana ? ' ana' : ''); div.dataset.id = s.id;
      var meta = '';
      if (ana) {
        var as = C.analyzeShots(t, anaShots(s));
        meta = wrT('app.targets_shots', [(s.sheets || []).length, as.n, as.n ? wrT('app.total_avg', [as.total, f1(as.totalDec), f2(as.avgDec), as.n > 1 ? wrT('app.group_mm_2', [f1(as.groupSize)]) : '']) : '']);
      } else if (gho) {
        var gsS = C.computeStats(t, s.actuals), gr = G.curRound(s) + 1;
        meta = wrT('app.60_shot_training_shots', [s.ghost && s.ghost.done ? wrT('app.done') : wrT('app.series_n', [gr]), gsS.n, gsS.n ? wrT('app.total_avg_2', [gsS.total, f1(gsS.totalDec), f2(gsS.avgDec)]) : '']);
      } else {
        var ps = C.computeStats(t, s.preds), xs = C.computeStats(t, s.actuals), cmp = C.comparePredictions(t, s.preds, s.actuals, s.pairMode || 'optimal');
        meta = wrT('app.calls_actual', [ps.n, ps.n ? wrT('app.x', [ps.total, f1(ps.totalDec)]) : '', xs.n, xs.n ? wrT('app.x', [xs.total, f1(xs.totalDec)]) : '', cmp.m ? wrT('app.avg_call_error_mm', [f2(cmp.meanErr)]) : '']);
      }
      div.innerHTML = wrT('app.x_8', [recPick[s.id] ? ' checked' : '', ana ? 'b-ana' : gho ? 'b-gh' : 'b-fc', ana ? wrT('app.analysis_2') : gho ? wrT('app.ghost') : wrT('app.call_2'), esc(fmtTW(s.created)), t.name, isCur ? wrT('app.current') : '', meta]);
      div.querySelector('.rec-chk').onchange = function () { if (this.checked) recPick[s.id] = 1; else delete recPick[s.id]; updateCmpBtn(); };
      var name = document.createElement('input'); name.className = 'rec-name'; name.placeholder = wrT('app.custom_name'); name.value = s.name != null && s.name !== '' ? s.name : (s.note || ''); name.setAttribute('aria-label', wrT('app.record_name'));
      name.onchange = function () { s.name = name.value.trim(); s.updated = new Date().toISOString(); if (!ana) s.note = s.note || ''; if (ana && s.id === App.acur.id) App.acur.name = s.name; saveSessions(App.sessions); renderRecords(); toast(wrT('app.name_updated')); };
      var open = document.createElement('button'); open.textContent = wrT('app.open');
      open.onclick = function () {
        if (ana) { App.acur = s; App.anaPhotos = {}; App.anaSel = 'all'; store.set(LS_ACUR, s.id); fillAnaCalRing(); renderAnalysis(); showTab('analysis'); }
        else if (gho) { App.gcur = s; App.ghView = null; App.ghPrev = null; store.set(LS_GCUR, s.id); showTab('ghost'); window.scrollTo(0, 0); }
        else { App.cur = s; store.set(LS_CUR, s.id); $('targetSel').value = s.targetId; photo.reset(); App.renderAll(); showTab('predict'); }
      };
      var del = document.createElement('button'); del.textContent = wrT('app.delete'); del.className = 'warn';
      del.onclick = function () {
        ask(wrT('app.delete_2', [recTitle(s)]), function () {
          App.sessions = App.sessions.filter(function (x) { return x.id !== s.id; }); delete recPick[s.id];
          try { if (window.WRCloud && window.WRCloud.remove) window.WRCloud.remove(s.id); } catch (e) {}
          if (ana && s.id === App.acur.id) { App.acur = newAnalysis(App.acur.targetId); App.anaPhotos = {}; App.anaSel = 'all'; }
          if (gho && App.gcur && s.id === App.gcur.id) { App.gcur = null; App.ghView = null; }
          if (!ana && !gho && s.id === App.cur.id) { App.cur = App.sessions.filter(function (x) { return !isAna(x) && !G.isGhost(x); })[0] || newSession(); if (App.sessions.indexOf(App.cur) < 0) App.sessions.push(App.cur); }
          persist(); App.renderAll();
        });
      };
      var r = document.createElement('div'); r.className = 'row'; r.appendChild(name); r.appendChild(open); r.appendChild(del);
      div.appendChild(r);
      // v2.0.0：分享給好友（唯讀）；登入並建立會員資料後才出現
      var WM = window.WRMember;
      if (WM && WM.canShare() && recCode(s)) {
        var sr = document.createElement('div'); sr.className = 'rec-share';
        var sh = WM.sharesOf(s.id), nTo = 0; sh.forEach(function (x) { nTo += (x.to || []).length; });
        var sb = document.createElement('button'); sb.type = 'button'; sb.className = 'rc-share'; sb.innerHTML = wrT('app.share_with_friends');
        sb.onclick = function () { WM.shareRecord(s); };
        sr.appendChild(sb);
        if (nTo) { var si = document.createElement('span'); si.className = 'rc-shared'; si.textContent = wrT('app.shared_with', [nTo]); sr.appendChild(si); }
        div.appendChild(sr);
      }
      // v1.8.0：每筆紀錄都顯示自己的紀錄碼（座標系統 A），可以單獨複製
      var code = recCode(s), cl = document.createElement('div'); cl.className = 'rec-code';
      if (code) {
        cl.innerHTML = wrT('app.chars', [esc(code.slice(0, 22)), code.length]);
        var cb = document.createElement('button'); cb.type = 'button'; cb.className = 'rc-copy'; cb.textContent = wrT('app.copy_record_code');
        cb.onclick = function () { copyText(code, wrT('app.copied_the_record_code_of', [recTitle(s), code.length])); };
        cl.appendChild(cb);
      } else cl.innerHTML = wrT('app.no_shots_yet_no_record');
      div.appendChild(cl); box.appendChild(div);
    });
  }
  function updateCmpBtn() {
    var n = Object.keys(recPick).length;
    $('recCmpBtn').disabled = n < 2; $('recCmpBtn').textContent = n ? wrT('app.compare_selected', [n]) : wrT('app.compare_selected_records');
    $('recCmpInfo').textContent = n < 2 ? wrT('app.select_2_or_more_records') : '';
  }
  $('recCmpClear').onclick = function () { recPick = {}; $('recCompare').innerHTML = ''; renderRecords(); };
  $('recCmpBtn').onclick = function () { renderRecCompare(); var c = $('recCompare'); if (c.scrollIntoView) c.scrollIntoView({ block: 'start' }); };
  function renderRecCompare() {
    var list = App.sessions.filter(function (s) { return recPick[s.id]; }).sort(function (a, b) { return a.created < b.created ? -1 : 1; });
    if (list.length < 2) { $('recCompare').innerHTML = ''; return; }
    var rows = list.map(function (s) { var t = T[s.targetId] || T.ap10, rs = recShots(s); return { s: s, t: t, src: rs.src, st: C.analyzeShots(t, rs.shots) }; });
    var mixed = rows.some(function (r) { return r.t.id !== rows[0].t.id; });
    var best = function (vals, hiGood) { var v = vals.filter(function (x) { return x != null; }); if (v.length < 2) return null; return hiGood ? Math.max.apply(null, v) : Math.min.apply(null, v); };
    var M = [
      [wrT('app.type_data'), function (r) { return wrT('app.x', [recKindLabel(r.s), r.src]); }],
      [wrT('app.target_type'), function (r) { return r.t.short; }],
      [wrT('app.shots'), function (r) { return r.st.n; }],
      [wrT('app.avg_decimal'), function (r) { return r.st.n ? f2(r.st.avgDec) : '—'; }, function (r) { return r.st.n ? r.st.avgDec : null; }, true],
      [wrT('app.avg_integer'), function (r) { return r.st.n ? f2(r.st.avg) : '—'; }, function (r) { return r.st.n ? r.st.avg : null; }, true],
      [wrT('app.60_shot_projection'), function (r) { return r.st.n ? wrT('app.x_9', [r.st.proj60, f1(r.st.proj60Dec)]) : '—'; }, function (r) { return r.st.n ? r.st.proj60Dec : null; }, true],
      [wrT('app.inner_10s_ratio'), function (r) { return r.st.n ? wrT('app.x_10', [r.st.inner, Math.round(r.st.inner / r.st.n * 100)]) : '—'; }, function (r) { return r.st.n ? r.st.inner / r.st.n : null; }, true],
      [wrT('app.10s_ratio'), function (r) { return r.st.n ? Math.round(r.st.counts[10] / r.st.n * 100) + '%' : '—'; }, function (r) { return r.st.n ? r.st.counts[10] / r.st.n : null; }, true],
      [wrT('app.group_size'), function (r) { return r.st.n > 1 ? f1(r.st.groupSize) + 'mm' : '—'; }, function (r) { return r.st.n > 1 ? r.st.groupSize : null; }, false],
      [wrT('app.mean_offset'), function (r) { return r.st.n ? wrT('app.mm_2', [wrT.dir(r.st.direction), f1(Math.hypot(r.st.meanX, r.st.meanY))]) : '—'; }, function (r) { return r.st.n ? Math.hypot(r.st.meanX, r.st.meanY) : null; }, false],
      [wrT('app.mean_distance_from_center'), function (r) { return r.st.n ? f1(r.st.meanR) + 'mm' : '—'; }, function (r) { return r.st.n ? r.st.meanR : null; }, false],
      [wrT('app.std_dev_decimal'), function (r) { return r.st.n > 1 ? f2(r.st.sdDec) : '—'; }, function (r) { return r.st.n > 1 ? r.st.sdDec : null; }, false],
      [wrT('app.avg_without_worst_shot'), function (r) { return r.st.n > 1 ? f2(r.st.avgDecExWorst) : '—'; }, function (r) { return r.st.n > 1 ? r.st.avgDecExWorst : null; }, true],
      [wrT('app.outliers_2'), function (r) { return r.st.outliers.threshold == null ? '—' : r.st.outliers.idx.length; }],
      [wrT('app.below_7'), function (r) { return r.st.counts.below7; }]
    ];
    var h = wrT('app.compare_records_by_date_close', [list.length, mixed ? wrT('app.the_selected_records_use_different') : '', rows.map(function (r) { return '<th><div class="rc-name">' + esc(recTitle(r.s)) + '</div><div class="rc-date">' + esc(fmtTW(r.s.created)) + '</div></th>'; }).join('')]);
    M.forEach(function (m) {
      var vals = m[2] ? rows.map(m[2]) : null, b = vals ? best(vals, m[3]) : null;
      h += '<tr><th>' + m[0] + '</th>' + rows.map(function (r, i) { var good = b != null && vals[i] != null && Math.abs(vals[i] - b) < 1e-9; return '<td' + (good ? ' class="best"' : '') + '>' + m[1](r) + '</td>'; }).join('') + '</tr>';
    });
    h += wrT('app.green_best_record_in_that');
    var lab = rows.map(function (r) { var d = fmtTW(r.s.created); return d.slice(5, 10); });
    var avg = rows.map(function (r) { return r.st.avgDec; }), grp = rows.map(function (r) { return r.st.groupSize; }), sd = rows.map(function (r) { return r.st.sdDec; });
    var tr = C.trend(avg);
    h += wrT('app.trend_across_dates_avg_decimal', [trTag(tr, true), lineChart(avg, lab, { trend: true, title: wrT('app.average_trend') })]);
    h += wrT('app.group_size_mm_smaller_is', [trTag(C.trend(grp, 1), false), lineChart(grp, lab, { trend: true, dp: 0, minSpan: 4, color: '#e8590c', title: wrT('app.group_size_trend') })]);
    h += wrT('app.std_dev_smaller_is_steadier', [trTag(C.trend(sd, 0.05), false), lineChart(sd, lab, { dp: 2, minSpan: 0.2, color: '#2b8a3e', title: wrT('app.std_dev') })]);
    $('recCompare').innerHTML = h;
    $('recCmpClose').onclick = function () { $('recCompare').innerHTML = ''; };
  }
  $('exportAll').onclick = function () {
    var blob = new Blob([JSON.stringify({ app: 'WRbeta', appVersion: App.APP_VERSION, version: SCHEMA_V, schema: wrT('app.sessions_kind_forecast_analysis_coordinates'), exported: new Date().toISOString(), sessions: App.sessions }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = wrT('app.wrbeta_records_json', [new Date().toISOString().slice(0, 10)]); a.click(); setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  };
  $('importFile').onchange = function () {
    var f = this.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () {
      try { var data = JSON.parse(rd.result); var add = (data.sessions || []).filter(function (s) { return s.id && T[s.targetId] && (isAna(s) ? Array.isArray(s.sheets) : Array.isArray(s.preds)) && !App.sessions.some(function (x) { return x.id === s.id; }); });
        add.forEach(function (s) { if (!isAna(s)) { s.actuals = s.actuals || []; } if (!s.updated) s.updated = new Date().toISOString(); });
        App.sessions = App.sessions.concat(add); saveSessions(App.sessions); renderRecords(); toast(wrT('app.imported_sets', [add.length])); } catch (e) { toast(wrT('app.invalid_file_format')); }
    };
    rd.readAsText(f); this.value = '';
  };
})(window.WRApp = window.WRApp || {});
