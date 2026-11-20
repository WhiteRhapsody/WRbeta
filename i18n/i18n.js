/* WRbeta v2.2.0 多語言（window.wrT）
 * wrT(key, params)：依目前語言回傳文字；params 是陣列（{0}{1}…）或物件（{name}）。找不到時退回繁體中文，再退回 key 本身。
 * 語言：localStorage 'wr_lang'（使用者在「設定 › 介面設定 › 語言 / Language」選的）＞瀏覽器語言（zh* → 繁體中文，其他 → English）。
 * 切換語言＝存起來後重新載入頁面（紀錄、目前分頁都保留）。index.html 的靜態文字由 applyStatic() 依 zh-TW 原文對照翻譯（h.* key）。
 * 新增語言：加一個 i18n/<代碼>.js，並在 LANGS 加一筆。也可在 Node 使用（測試用；預設繁體中文）。 */
(function (root) {
  'use strict';
  var D = root.WR_I18N_DICT = root.WR_I18N_DICT || {};
  if (typeof require === 'function' && typeof module !== 'undefined') { try { if (!D['zh-TW']) require('./zh-TW.js'); if (!D.en) require('./en.js'); } catch (e) {} }
  var LANGS = [{ id: 'zh-TW', name: '繁體中文', html: 'zh-Hant-TW' }, { id: 'en', name: 'English', html: 'en' }];
  var LS = 'wr_lang';
  function has(id) { return LANGS.some(function (l) { return l.id === id; }); }
  function fromNavigator() {
    if (!root.document) return (typeof process !== 'undefined' && process.env && process.env.WR_LANG) || 'zh-TW'; // Node（測試）：預設繁體中文
    try { var n = (root.navigator && ((root.navigator.languages && root.navigator.languages[0]) || root.navigator.language)) || ''; if (!n) return 'zh-TW'; return /^zh/i.test(n) ? 'zh-TW' : 'en'; } catch (e) { return 'zh-TW'; }
  }
  function stored() { try { var s = root.localStorage && root.localStorage.getItem(LS); return s && has(s) ? s : null; } catch (e) { return null; } }
  var lang = stored() || fromNavigator();
  function fmt(s, p) {
    return s.replace(/\{\{|\}\}|\{(\w+)\}/g, function (m, k) {
      if (m === '{{') return '{'; if (m === '}}') return '}';
      var v = p == null ? undefined : p[k];
      return v == null ? '' : String(v);
    });
  }
  function wrT(key, p) {
    var d = D[lang] || {}, s = d[key];
    if (s == null) s = (D['zh-TW'] || {})[key];
    if (s == null) return key;
    var out = fmt(s, p);
    // 英文單複數：「1 shots」→「1 shot」（只處理數字 1 後面接常見名詞；其他語言之後要的話在這裡加）
    if (lang === 'en' && p != null) out = out.replace(PLURAL1, '$11$2 $3');
    return out;
  }
  var PLURAL1 = /(^|[^\w.,\-\u2013\/])1((?:<\/b>)?) (hole|shot|call|target|record|round|photo|friend|character|minute|day|time|set|sheet|second|comment|request|member|share)s\b/g;
  // 核心模組回傳的代碼（方向「偏左上」、趨勢「上升」…）→ 顯示文字
  var DIR = { '右': 'right', '左': 'left', '上': 'high', '下': 'low' };
  wrT.dir = function (code) {
    if (code == null || lang === 'zh-TW') return code;
    if (code === '置中') return wrT('v.置中');
    var m = /^偏?([右左]?)([上下]?)$/.exec(code); if (!m) return wrT.v(code);
    return [DIR[m[2]], DIR[m[1]]].filter(Boolean).join(' ');
  };
  wrT.v = function (code) { if (code == null || lang === 'zh-TW') return code; var s = (D[lang] || {})['v.' + code]; return s == null ? code : s; };
  wrT.lang = function () { return lang; };
  // v2.7.0：暫時用指定語言跑 fn（PDF 匯出可以選跟 App 不同的語言；fn 必須是同步的）
  wrT.withLang = function (id, fn) { if (!has(id)) return fn(); var old = lang; lang = id; try { return fn(); } finally { lang = old; } };
  wrT.langs = function () { return LANGS.slice(); };
  wrT.htmlLang = function () { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === lang) return LANGS[i].html; return lang; };
  wrT.isEn = function () { return lang === 'en'; };
  wrT.locale = function () { return lang === 'zh-TW' ? 'zh-TW' : 'en-US'; };
  wrT.setLang = function (id, noReload) {
    if (!has(id)) return false;
    try { root.localStorage.setItem(LS, id); } catch (e) {}
    if (id === lang) return false;
    lang = id;
    if (!noReload && root.location) root.location.reload();
    return true;
  };
  wrT.followDevice = function () { try { root.localStorage.removeItem(LS); } catch (e) {} };
  wrT.fmt = fmt;
  // index.html 靜態文字：用 zh-TW 原文（去掉多餘空白）查 h.* key
  var REV = null, ATTRS = ['aria-label', 'title', 'placeholder', 'data-mod-name', 'alt'];
  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function rev() {
    if (REV) return REV; REV = {}; var z = D['zh-TW'] || {};
    for (var k in z) if (k.charAt(0) === 'h' && k.charAt(1) === '.') REV[norm(z[k])] = k;
    return REV;
  }
  wrT.staticKey = function (zh) { return rev()[norm(zh)] || null; };
  wrT.applyStatic = function (node) {
    var doc = root.document; if (!doc) return;
    doc.documentElement.setAttribute('lang', wrT.htmlLang());
    doc.documentElement.classList.toggle('wr-lang-en', lang === 'en');
    if (lang === 'zh-TW') return;
    node = node || doc.body; if (!node) return;
    var R = rev(), CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
    var w = doc.createTreeWalker(node, 4 /* SHOW_TEXT */, null), t, list = [];
    while ((t = w.nextNode())) { var pn = t.parentNode && t.parentNode.nodeName; if (pn === 'SCRIPT' || pn === 'STYLE') continue; if (CJK.test(t.nodeValue)) list.push(t); }
    list.forEach(function (t) {
      var v = t.nodeValue, k = R[norm(v)]; if (!k) return;
      var lead = /^\s*/.exec(v)[0], tail = /\s*$/.exec(v)[0];
      t.nodeValue = lead + wrT(k) + tail;
    });
    var els = node.querySelectorAll('[' + ATTRS.join('],[') + ']');
    for (var i = 0; i < els.length; i++) ATTRS.forEach(function (a) {
      var v = els[i].getAttribute(a); if (!v || !CJK.test(v)) return; var k = R[norm(v)]; if (k) els[i].setAttribute(a, wrT(k));
    });
  };
  root.wrT = wrT;
  if (root.document && root.document.body) { try { wrT.applyStatic(); } catch (e) {} } // 網頁：script 在 body 最後，載入時就把靜態文字換掉
  if (typeof module !== 'undefined' && module.exports) module.exports = wrT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
