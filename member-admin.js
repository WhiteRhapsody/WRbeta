/* WRbeta 會員：管理頁（admins/{uid} 才看得到：會員清單、停權／解除、改會員 ID、撤銷分享、刪資料、作弊碼與群組）
 * 2026-11-19 模組分割（純搬移）：原本在 member.js 同一個函式裡；共用名稱掛在 window.WRMemberParts（MP.名稱），對外仍是 window.WRMember（在 member.js）。
 */
(function (MP, root) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var GROUPS = MP.GROUPS, midCheck = MP.midCheck, normCode = MP.normCode, codeLenOk = MP.codeLenOk, codeHash = MP.codeHash, parsePerks = MP.parsePerks, parseMids = MP.parseMids,
    D = MP.D, $ = MP.$, esc = MP.esc, toast = MP.toast, ask = MP.ask, S = MP.S, errText = MP.errText, show = MP.show, uid = MP.uid;
  // 給其他模組用（函式）
  MP.loadAdmin = loadAdmin; MP.renderAdmin = renderAdmin;

  // ---------- 7) 管理員畫面（admins/{uid} 存在才顯示） ----------
  function loadAdmin() {
    if (!S.admin) return Promise.resolve();
    S.adm = S.adm || { codes: [], pending: [], granted: [], roles: [] };
    return Promise.all([
      MP.BE.listCodes().then(function (a) { S.adm.codes = a.sort(function (x, y) { return y.createdMs - x.createdMs; }); }),
      MP.BE.listRedemptions('pending').then(function (a) { S.adm.pending = a; }),
      MP.BE.listRedemptions('granted').then(function (a) { S.adm.granted = a; }),
      MP.BE.listRoles().then(function (a) { S.adm.roles = a; }),
      MP.BE.listProfiles().then(function (a) { S.adm.people = a.sort(function (x, y) { return String(x.mid).localeCompare(String(y.mid)); }); }),
      MP.BE.listSuspended().then(function (a) { S.adm.held = a; })
    ]).catch(function (e) { toast(wrT('member.couldnt_load_admin_data', [errText(e)]), 3600); }).then(function () { renderAdmin(true); });
  }
  function codeLabel(h) { var c = S.adm && S.adm.codes.filter(function (x) { return x.id === h; })[0]; return c ? (c.label || wrT('member.no_note')) : String(h).slice(0, 8) + '…'; }
  function audText(a) { if (!a) return ''; return a.type === 'all' ? wrT('member.everyone') : a.type === 'users' ? wrT('member.specific', [(a.mids || []).join(wrT('core.x_3'))]) : wrT('member.groups', [(a.groups || []).map(function (g) { return GROUPS[g] || g; }).join(wrT('core.x_3'))]); }
  function renderAdmin(on) {
    var c = show('mbAdmin', on); if (!c || !on) return;
    if (!S.adm) { c.innerHTML = wrT('member.admin_only_you_can_see'); $('mbAdmOpen').onclick = function () { S.adm = { codes: [], pending: [], granted: [], roles: [] }; loadAdmin(); }; return; }
    var A = S.adm, gchk = function (name) { return Object.keys(GROUPS).map(function (g) { return '<label class="mb-ck"><input type="checkbox" name="' + name + '" value="' + g + '">' + GROUPS[g] + '</label>'; }).join(''); };
    // v2.3.0：標題（🛠 管理員 · 只有你看得到 · 重新整理）放最上面，會員區塊接在標題下面
    var h = wrT('member.admin_only_you_can_see_2', [gchk('admG')]), cut = h.indexOf('</div>') + 6;
    h = h.slice(0, cut) + peopleHTML() + h.slice(cut);
    h += wrT('member.pending', [A.pending.length, A.pending.length ? A.pending.map(function (r) { return wrT('member.approve_reject', [esc(r.id), esc(r.mid), esc(codeLabel(r.code))]); }).join('') : wrT('member.no_pending_requests')]);
    h += wrT('member.cheat_codes', [A.codes.length, A.codes.length ? A.codes.map(function (x) { return wrT('member.delete', [esc(x.id), esc(x.label || wrT('member.no_note')), x.active ? '' : wrT('member.disabled'), esc((x.perks || []).join(', ')), esc(audText(x.audience)), x.needsApproval ? wrT('member.needs_approval') : '', x.active ? wrT('member.disable') : wrT('member.enable')]); }).join('') : wrT('member.no_cheat_codes_yet')]);
    h += wrT('member.active', [A.granted.length, A.granted.length ? A.granted.map(function (r) { return wrT('member.revoke', [esc(r.id), esc(r.mid), esc(codeLabel(r.code))]); }).join('') : wrT('member.nobody_has_redeemed_one_yet')]);
    h += wrT('member.groups_judges_coaches_member_id', [gchk('admR'), A.roles.length ? A.roles.map(function (r) { return '<div class="mb-fr"><span class="mb-sht"><b>' + esc(r.mid || r.id) + '</b><small>' + esc((r.groups || []).map(function (g) { return GROUPS[g] || g; }).join(wrT('core.x_3'))) + '</small></span></div>'; }).join('') : '']);
    c.innerHTML = h;
    $('mbAdmReload').onclick = loadAdmin;
    $('admAud').onchange = function () { $('admMidsRow').hidden = this.value !== 'users'; $('admGrpRow').hidden = this.value !== 'groups'; };
    $('admCreate').onclick = adminCreate;
    $('admRoleSave').onclick = adminRole;
    c.querySelectorAll('[data-rid] [data-d]').forEach(function (b) { b.onclick = function () { var rid = b.closest('[data-rid]').dataset.rid; MP.BE.decide(rid, b.dataset.d).then(function () { toast({ granted: wrT('member.approved'), rejected: wrT('member.rejected'), revoked: wrT('member.withdrawn') }[b.dataset.d]); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); }); }; });
    c.querySelectorAll('.mb-code [data-c]').forEach(function (b) {
      var h2 = b.closest('.mb-code').dataset.h, x = A.codes.filter(function (y) { return y.id === h2; })[0];
      b.onclick = function () {
        if (b.dataset.c === 'tog') MP.BE.setCodeActive(h2, !x.active).then(function () { toast(x.active ? wrT('member.disabled_2') : wrT('member.enabled')); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); });
        else ask(wrT('member.delete_cheat_code_people_who', [x.label || '']), function () { MP.BE.deleteCode(h2).then(function () { toast(wrT('member.deleted')); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); }); }, null, { yes: wrT('app.delete'), danger: true });
      };
    });
    c.querySelectorAll('.mb-person').forEach(function (row) { bindPerson(row); });
  }
  function peopleHTML() {
    var list = (S.adm && S.adm.people) || [], held = {};
    ((S.adm && S.adm.held) || []).forEach(function (x) { held[x.id] = true; });
    var rows = list.map(function (p) {
      var on = !!held[p.id], self = p.id === uid();
      return '<div class="mb-fr mb-person" data-uid="' + esc(p.id) + '" data-low="' + esc(p.midLower || '') + '" data-held="' + (on ? '1' : '0') + '"><span class="mb-sht"><b>' + esc(p.mid) + '</b><small>' + esc(p.id) + (on ? ' · ' + esc(wrT('member.suspended_badge')) : '') + (self ? ' · ' + esc(wrT('member.admin_thats_you')) : '') + '</small></span>'
        + (self ? '' : '<button type="button" data-act="hold">' + esc(wrT(on ? 'member.unsuspend' : 'member.suspend')) + '</button>')
        + '<input data-act="newid" maxlength="20" placeholder="' + esc(wrT('member.new_id')) + '" aria-label="' + esc(wrT('member.new_id')) + '">'
        + '<button type="button" data-act="id">' + esc(wrT('member.change_id')) + '</button>'
        + '<button type="button" data-act="shares">' + esc(wrT('member.revoke_shares')) + '</button>'
        + (self ? '' : '<button type="button" data-act="wipe">' + esc(wrT('member.wipe_data')) + '</button>')
        + '</div>';
    }).join('');
    return '<details class="mb-adm" open><summary>' + esc(wrT('member.admin_people')) + '</summary><p class="mb-note">' + esc(wrT('member.admin_console_only')) + '</p>'
      + (rows || '<p>' + esc(wrT('member.admin_no_members')) + '</p>') + '</details>';
  }
  function bindPerson(row) {
    var uid = row.dataset.uid, low = row.dataset.low, mid = (row.querySelector('b') || {}).textContent || '';
    function fail(e) { toast(wrT('member.not_completed', [msgOf(e)]), 3600); }
    var holdBtn = row.querySelector('[data-act=hold]');
    if (holdBtn) holdBtn.onclick = function () {
      var on = row.getAttribute('data-held') !== '1';
      ask(wrT(on ? 'member.suspend_confirm' : 'member.unsuspend_confirm', [mid]), function () {
        MP.BE.setSuspended(uid, on).then(function () { toast(wrT(on ? 'member.suspended_ok' : 'member.unsuspended_ok')); return loadAdmin(); }, fail);
      }, null, { yes: wrT(on ? 'member.suspend' : 'member.unsuspend'), danger: on });
    };
    row.querySelector('[data-act=id]').onclick = function () {
      var v = row.querySelector('[data-act=newid]').value.trim();
      if (!midCheck(v).ok) { toast(wrT('member.invalid_member_id_format')); return; }
      MP.BE.adminSetMid(uid, low, v).then(function () { toast(wrT('member.id_changed', [v])); return loadAdmin(); }, fail);
    };
    row.querySelector('[data-act=shares]').onclick = function () {
      ask(wrT('member.revoke_confirm', [mid]), function () {
        MP.BE.revokeOwnedShares(uid).then(function (n) { toast(wrT('member.shares_revoked', [n])); return loadAdmin(); }, fail);
      }, null, { yes: wrT('member.revoke_shares'), danger: true });
    };
    var wipeBtn = row.querySelector('[data-act=wipe]');
    if (wipeBtn) wipeBtn.onclick = function () {
      ask(wrT('member.wipe_confirm', [mid]), function () {
        // v2.3.0：先停權再刪（不然對方手機還登入著，同步時會把本機紀錄又傳上來）；停權保留，之後可手動解除
        var gate = row.getAttribute('data-held') === '1' ? Promise.resolve() : MP.BE.setSuspended(uid, true);
        gate.then(function () { return MP.BE.adminWipe(uid); }).then(function () { toast(wrT('member.wiped'), 3600); return loadAdmin(); }, function (e) { fail(e); loadAdmin(); });
      }, null, { yes: wrT('app.delete'), danger: true });
    };
  }
  function checked(name) { return [].slice.call(D.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; }); }
  function resolveMids(mids) { return Promise.all(mids.map(function (m) { return MP.BE.nameOwner(m.toLowerCase()).then(function (u) { return { mid: m, uid: u }; }); })); }
  function msgOf(e) { return e && e.message && !e.code ? e.message : errText(e); }
  function adminCreate() {
    var raw = $('admCode').value, perks = parsePerks($('admPerks').value), aud = $('admAud').value, mids = parseMids($('admMids').value), groups = checked('admG');
    if (!codeLenOk(raw)) { toast(wrT('member.the_code_needs_at_least')); return; }
    if (!perks.length) { toast(wrT('member.enter_at_least_one_perk')); return; }
    if (aud === 'users' && !mids.length) { toast(wrT('member.please_enter_a_member_id_2')); return; }
    if (aud === 'groups' && !groups.length) { toast(wrT('member.please_check_a_group')); return; }
    var btn = $('admCreate'); btn.disabled = true;
    Promise.all([codeHash(raw), aud === 'users' ? resolveMids(mids) : Promise.resolve([])]).then(function (r) {
      var h = r[0], miss = r[1].filter(function (x) { return !x.uid; });
      if (miss.length) throw { message: wrT('member.members_not_found', [miss.map(function (x) { return x.mid; }).join(wrT('core.x_3'))]) };
      return MP.BE.getCode(h).then(function (old) {
        if (old) throw { message: wrT('member.this_code_already_exists', [old.label || wrT('member.no_note_2')]) };
        return MP.BE.createCode(h, { perks: perks, audience: { type: aud, uids: r[1].map(function (x) { return x.uid; }), mids: r[1].map(function (x) { return x.mid; }), groups: aud === 'groups' ? groups : [] }, needsApproval: $('admApprove').checked, active: true, label: $('admLabel').value.trim().slice(0, 60) });
      });
    }).then(function () { toast(wrT('member.cheat_code_created_the_plain'), 3600); return loadAdmin(); }, function (e) { btn.disabled = false; toast(wrT('member.not_created', [msgOf(e)]), 3600); });
  }
  function adminRole() {
    var mid = $('admRoleMid').value.trim(), groups = checked('admR');
    if (!midCheck(mid).ok) { toast(wrT('member.invalid_member_id_format')); return; }
    MP.BE.nameOwner(mid.toLowerCase()).then(function (u) {
      if (!u) throw { message: wrT('member.member_not_found', [mid]) };
      return MP.BE.setRole(u, groups, mid);
    }).then(function () { toast(groups.length ? wrT('member.x_3', [mid, groups.map(function (g) { return GROUPS[g]; }).join(wrT('core.x_3'))]) : wrT('member.removed_s_groups', [mid])); return loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [msgOf(e)]), 3600); });
  }
})(window.WRMemberParts = window.WRMemberParts || {}, window);
