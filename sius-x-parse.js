/* WRbeta v2.9.6 小白單實驗引擎 — M4 單行語法與字元信心解析模組（UMD：Node module.exports / Browser window.WRSiusXParse）。
 * 責任：將單行 OCR 文字（與可選的 Tesseract symbols/charConf 字元級信心、像素微檢測提示）解析為結構化 ParsedRowCandidate。
 * 原則：不杜撰數字；凡無法確認的數字留 null，易混淆字／缺負號／截斷與修補線索皆結構化標記於 candidate 供 M5/M6 使用。 */
(function (root) {
  'use strict';

  // SIUS 小白單只有 8 種方向箭頭（無正中心第 9 種符號）
  var VALID_ARROWS = { '→': 1, '↗': 1, '↑': 1, '↖': 1, '←': 1, '↙': 1, '↓': 1, '↘': 1 };
  var ARROW_MAP_DIRECT = { '→': '→', '↗': '↗', '↑': '↑', '↖': '↖', '←': '←', '↙': '↙', '↓': '↓', '↘': '↘' };
  var UNICODE_ARROW_RE = /[←↑→↓↖↗↘↙⇐⇑⇒⇓⬅⬆➡⬇◀▶▲▼➚➘➙➛➜➝➞➟➠➡➢➣➤➥➦➧➨]/g;
  var CONFUSABLE_RE = /[156789]/;

  function norm(s) {
    return String(s || '')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[＊✱∗]/g, '*')
      .replace(/[－−–—]/g, '-')
      .replace(/[：]/g, ':')
      .replace(/[，]/g, ',')
      .replace(/[．。]/g, '.')
      .replace(/[／]/g, '/')
      .replace(UNICODE_ARROW_RE, ' ')
      .replace(/\t/g, ' ')
      .replace(/\u3000/g, ' ');
  }

  /* ---------- 時間輔助 ---------- */
  function tStr(mm, ss, cs) {
    return mm <= 59 && ss <= 59 ? (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss + '.' + cs : null;
  }
  function secOf(t) {
    if (t == null || t === '') return null;
    var m = String(t).trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    var s = m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    if (m[3] == null && (+m[2]) > 59) return null;
    if (m[4]) s += (+m[4]) / Math.pow(10, m[4].length);
    return s;
  }
  function fmtSec(s) {
    if (s == null || !isFinite(s)) return '—';
    s = Math.round(s);
    var m = Math.floor(s / 60), x = s % 60;
    return m + ':' + (x < 10 ? '0' : '') + x;
  }
  function gapSec(a, b) {
    if (a == null || b == null) return null;
    var g = b - a;
    if (g < -1800) g += 3600;
    return g > 0 && g < 1800 ? g : null;
  }

  /* ---------- 字元級信心映射（有 symbols / charConf 就用，沒有則回傳 null） ---------- */
  function extractNonSpaceConfs(raw, meta) {
    if (!meta) return null;
    var out = [], i, j;
    if (Array.isArray(meta.symbols) && meta.symbols.length) {
      for (i = 0; i < meta.symbols.length; i++) {
        var sym = meta.symbols[i];
        if (!sym) continue;
        var tx = String(sym.text != null ? sym.text : ''), cf = typeof sym.confidence === 'number' ? sym.confidence : null;
        for (j = 0; j < tx.length; j++) {
          if (!/\s/.test(tx[j]) && cf != null && isFinite(cf)) out.push({ ch: tx[j], c: cf });
        }
      }
      return out.length ? out : null;
    }
    if (Array.isArray(meta.charConf) && meta.charConf.length) {
      var s = String(raw || '');
      if (meta.charConf.length === s.length) {
        for (i = 0; i < s.length; i++) {
          if (!/\s/.test(s[i]) && typeof meta.charConf[i] === 'number') out.push({ ch: s[i], c: meta.charConf[i] });
        }
      } else {
        var ns = s.replace(/\s+/g, '');
        for (i = 0; i < Math.min(ns.length, meta.charConf.length); i++) {
          if (typeof meta.charConf[i] === 'number') out.push({ ch: ns[i], c: meta.charConf[i] });
        }
      }
      return out.length ? out : null;
    }
    return null;
  }

  function buildNsIndexMap(s) {
    var map = new Array(s.length), idx = 0;
    for (var i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) map[i] = -1;
      else map[i] = idx++;
    }
    return { map: map, count: idx };
  }

  function spanMinConf(nsConfs, nsMap, start, end, digitsOnly) {
    if (!nsConfs || start == null || end == null || start < 0 || end <= start) return null;
    var mn = Infinity, hit = false;
    for (var i = start; i < end && i < nsMap.map.length; i++) {
      var k = nsMap.map[i];
      if (k < 0 || k >= nsConfs.length) continue;
      if (digitsOnly && !/\d/.test(nsConfs[k].ch)) continue;
      if (nsConfs[k].c < mn) mn = nsConfs[k].c;
      hit = true;
    }
    return hit ? Math.round(mn * 100) / 100 : null;
  }

  function extractArrowRaw(rawStr) {
    var r = String(rawStr || '');
    for (var i = 0; i < r.length; i++) {
      if (ARROW_MAP_DIRECT[r[i]]) return ARROW_MAP_DIRECT[r[i]];
    }
    var m = r.match(/^\s*\d{1,2}\s+([^\d\s]\S{0,2})\s+(?:10|[1-9])/);
    return m ? m[1] : null;
  }

  /* ---------- 非射擊列解析（表頭／試射段／比賽段／小計／總分） ---------- */
  function parseNonShot(rawStr, s, meta) {
    if (/\d{1,2}\s*:\s*\d{2}\s*[.,]\s*\d{2}/.test(s)) {
      if (/^\s*[mnh]at\s*c[hp]\b/i.test(s) && !/[-~=<]?\d{1,2}\s*[.,]\s*\d{2}/.test(s.replace(/\d{1,2}\s*:\s*\d{2}\s*[.,]\s*\d{2}/, ''))) {
        return { kind: 'match' };
      }
      return null;
    }
    if (/qual\s*[il1]?\s*f|[il1]f\s*[il1{]?\s*cat\s*[il1]?\s*[o0]n/i.test(s)) return { kind: 'qual' };

    var isSub = /sub\s*t[o0]t|subtota|\bsub\b/i.test(s);
    var isTot = !isSub && /t[o0]ta[l1|)\]]|total/i.test(s);

    // 1) 小數小計／總分（步槍：「Subtota 101.7-6*」「Total 610.9-34*」）
    var m = s.match(/(\d{2,3})\s*[.,]\s*(\d)\s*[-~=]?\s*(\d{1,2})(?!\d)\s*\S?/);
    if (!m && isTot) m = s.match(/(\d{3})(\d)\s*[-~=]\s*(\d{1,2})/);
    if (!m && isSub) {
      var m2 = s.match(/(\d{2,3})\s*[.,]\s*(\d)(\d)\b/);
      if (m2) m = m2;
    }
    if (m && (isSub || isTot)) {
      var v = +(m[1] + '.' + m[2]), n = +m[3];
      if (!isTot && v < 100 && n > 9 && m[3].length === 2) n = +m[3].charAt(0);
      if (isTot ? (v <= 1100 && n <= 99) : (v <= 110 && n <= 10)) {
        return { kind: isTot ? 'total' : 'sub', dec: v, inner: n };
      }
    }

    // 2) 整數小計／總分（手槍：「Subtota 89-1*」「Subtota 82 0+」「Subtota 86-14」「Total 349-6*」）
    if (!m && (isSub || isTot)) {
      var mi = s.match(/(\d{2,3})(?:\s*[-~=]\s*|\s+)(\d{1,2})(?!\d|[.,]\d)/);
      if (mi) {
        var vi = +mi[1], ni = +mi[2];
        if (!isTot && vi < 100 && ni > 9 && mi[2].length === 2) ni = +mi[2].charAt(0);
        if (isTot ? (vi <= 1090 && ni <= 60) : (vi <= 109 && ni <= 10)) {
          return { kind: isTot ? 'total' : 'sub', dec: vi, inner: ni, int: true };
        }
      }
    }

    if (m && !isSub && !isTot && /^\s*\S{0,3}\s*\d{2,3}[.,]\d\s*-\s*\d{1,2}\s*\*?\s*$/.test(s)) {
      var vd = +(m[1] + '.' + m[2]);
      return { kind: vd > 110 ? 'total' : 'sub', dec: vd, inner: +m[3] };
    }

    if (/\b[mhn]atch\b/i.test(s) && !/\d\.\d/.test(s)) return { kind: 'match' };

    var isRifle = /a[il1]r\s*r[il1]f[l1]e|\br[il1]f[l1]e\b/i.test(s);
    var isPistol = !isRifle && (/a[il1][rl1]\s*p[il1e]st[o0][l1]?|\bp[il1]st[o0][l1]\b/i.test(s));
    var g = isRifle ? 'ar10' : isPistol ? 'ap10' : null;
    if (g) {
      var c = s.match(/(?:r[il1]f[l1]e|p[il1e]st[o0][l1]?)\s*(\d{2})/i);
      var cnt = c ? +c[1] : null;
      var cleanText = s.trim();
      if (!/(?:rifle|pistol)/i.test(cleanText)) {
        cleanText = (g === 'ar10' ? 'Air Rifle' : 'Air Pistol') + (cnt ? ' ' + cnt : '');
      }
      return { kind: 'event', gun: g, count: cnt, text: cleanText };
    }

    var d = s.match(/(\d{1,2})[.,](\d{1,2})[.,](20\d\d)\s+(\d{1,2}):(\d{2})/);
    if (d && +d[1] >= 1 && +d[1] <= 31 && +d[2] >= 1 && +d[2] <= 12 && +d[4] <= 23 && +d[5] <= 59) {
      return { kind: 'date', text: d[1] + '.' + d[2] + '.' + d[3] + ' ' + d[4] + ':' + d[5] };
    }

    var tg = s.match(/^\s*target\s+(\d{1,3}(?:\s*\/\s*\d{1,2})?)/i);
    if (tg) return { kind: 'target', text: 'Target ' + tg[1].replace(/\s+/g, '') };

    void meta;
    return null;
  }

  /* ---------- 射擊列解析 ---------- */
  // 相容骨架的寬鬆尾巴匹配，並擴充：
  //   1) 負號支援連續與 '<'（[-~=<]+，如 =-7.06、~-7.87、<10.75）；
  //   2) 時間與 X 之間容許單一非數字雜訊符號（如 ©）；
  //   3) 保留 m[6] 後緊貼 (\S?) 以相容「/ 被讀成 7」（如 4.077 17.21），絕不在 (\S?) 前吃空白以免吞掉無斜線時 Y 的首字！
  var RE_TAIL = /(\d{1,2})\s*[:;.]?\s*(\d{2})\s*[.,]\s*(\d{2})(?!\d)[.'°]?\s+(?:[©®°"']\s*)?([-~=<]+)?\s*(\d{1,2})\s*([.,])\s*(\d{2})(\S?)\s*([-~=<]+)?\s*(\d{1,2})\s*([.,])\s*(\d{2})(?!\d)/g;
  var RE_TIME = /(\d{1,2})\s*[:;.]?\s*(\d{2})\s*[.,]\s*(\d{2})(?!\d)[.,'°;:]?/g;
  var RE_NUM = /^\s*(?:[©®°"']\s*)?([-~=<]+)?\s*(\d{1,2})\s*[.,:]\s*(\d{2})(?!\d)/;
  var RE_SIGN_HINT = /^\s*(?:\/|\S)?\s*([-~=<]+)/;
  var SCORE_LETTER_MAP = { B: 8, T: 7, Q: 9, g: 9, S: 5, O: 0, D: 0 };

  function parseShotRow(rawStr, s, meta, opt) {
    opt = opt || {};
    var m, last = null, part = null;
    RE_TAIL.lastIndex = 0;
    while ((m = RE_TAIL.exec(s))) last = { m: m, idx: m.index, full: m[0] };

    var o, pre, spans = { score: null, tCore: null, tLast: null, x: null, y: null };
    var repaired = [], hints = {}, signHint = { x: null, y: null };

    if (last) {
      m = last.m;
      var tVal = tStr(+m[1], +m[2], m[3]);
      var xSign = m[4] ? -1 : 1, ySign = m[9] ? -1 : 1;
      o = {
        t: tVal,
        x: xSign * +(m[5] + '.' + m[7]),
        y: ySign * +(m[10] + '.' + m[12]),
        partial: false
      };
      signHint.x = xSign;
      signHint.y = ySign;
      pre = s.slice(0, last.idx);

      // 記錄低把握語法線索供 M5/M6 降黃參考（小數點前後異常空白、'<' 當負號、'/' 讀成數字 7）
      var sub = last.full;
      if (m[4] && m[4].indexOf('<') >= 0) hints.xLtMinus = true;
      if (m[9] && m[9].indexOf('<') >= 0) hints.yLtMinus = true;
      if (m[8] && /\d/.test(m[8])) hints.slashDigit = m[8];
      var afterTime = sub.slice(sub.indexOf(m[3]) + m[3].length);
      if (/\d\s+[.,]|\d\s*[.,]\s+\d/.test(afterTime)) hints.xySpaced = true;

      var tEndInSub = sub.indexOf(m[3]) + m[3].length;
      spans.tCore = [last.idx, last.idx + tEndInSub - 1];
      spans.tLast = [last.idx + tEndInSub - 1, last.idx + tEndInSub];
      var xPos = sub.indexOf(m[5], tEndInSub);
      if (xPos >= 0) {
        var xStart = m[4] ? sub.lastIndexOf(m[4], xPos) : xPos;
        var xDotPos = sub.indexOf(m[6], xPos + m[5].length);
        var xDecPos = sub.indexOf(m[7], xDotPos + 1);
        spans.x = [last.idx + xStart, last.idx + xDecPos + m[7].length];
        var yPos = sub.indexOf(m[10], xDecPos + m[7].length + (m[8] ? m[8].length : 0));
        if (yPos >= 0) {
          var yStart = m[9] ? sub.lastIndexOf(m[9], yPos) : yPos;
          var yDotPos = sub.indexOf(m[11], yPos + m[10].length);
          var yDecPos = sub.indexOf(m[12], yDotPos + 1);
          spans.y = [last.idx + yStart, last.idx + yDecPos + m[12].length];
        }
      }
    } else {
      RE_TIME.lastIndex = 0;
      while ((m = RE_TIME.exec(s))) part = { m: m, idx: m.index, full: m[0] };
      if (!part) return null;
      m = part.m;
      o = { t: tStr(+m[1], +m[2], m[3]), x: null, y: null, partial: true };
      var rest = s.slice(part.idx + part.full.length);
      var xm = rest.match(RE_NUM);
      if (xm) {
        var xs2 = xm[1] ? -1 : 1;
        o.x = xs2 * +(xm[2] + '.' + xm[3]);
        signHint.x = xs2;
        if (xm[1] && xm[1].indexOf('<') >= 0) hints.xLtMinus = true;
        var afterX = rest.slice(xm[0].length);
        var ym = afterX.replace(/^\S?/, '').match(RE_NUM);
        if (ym) {
          var ys2 = ym[1] ? -1 : 1;
          o.y = ys2 * +(ym[2] + '.' + ym[3]);
          signHint.y = ys2;
          if (ym[1] && ym[1].indexOf('<') >= 0) hints.yLtMinus = true;
          var remY = afterX.replace(/^\S?/, '').slice(ym[0].length);
          if (/^\d/.test(remY)) { o.y = null; hints.yTrunc = ym[0].trim() + remY.slice(0, 3); }
        } else {
          var ysh = afterX.match(RE_SIGN_HINT);
          if (ysh) signHint.y = -1;
          if (/\S/.test(afterX.replace(/^\s*\/\s*/, ''))) hints.yTrunc = afterX.trim().slice(0, 8);
        }
      } else {
        var xsh = rest.match(/^\s*([-~=<]+)/);
        if (xsh) signHint.x = -1;
        if (/\S/.test(rest)) hints.xTrunc = rest.trim().slice(0, 8);
      }
      pre = s.slice(0, part.idx);
      if (!o.t) return null;
      var tSubEnd = part.full.indexOf(m[3]) + m[3].length;
      spans.tCore = [part.idx, part.idx + tSubEnd - 1];
      spans.tLast = [part.idx + tSubEnd - 1, part.idx + tSubEnd];
    }

    if ((o.x != null && Math.abs(o.x) > 99) || (o.y != null && Math.abs(o.y) > 99)) return null;

    if (meta && meta.minusHint) {
      if (meta.minusHint.x) signHint.x = -1;
      if (meta.minusHint.y) signHint.y = -1;
    }

    o.n = null;
    o.nc = [];
    o.dec = null;
    o.star = false;
    o.P = false;
    o.raw = s;

    // 1) 小數分數（步槍 d.d，最高 10.9）
    var pm = pre.match(/(\d{1,3})\s*[.,]\s*(\d)\s*(\S{0,3})\s*(\S{0,2})\s*$/), head = pre;
    if (pm) {
      var ip = pm[1], v = +(ip.slice(-2) + '.' + pm[2]);
      if (v > 10.9) v = +(ip.slice(-1) + '.' + pm[2]);
      o.dec = v;
      var aft = (pm[3] || '') + (pm[4] || '');
      if (/[PFp]/.test(aft)) o.P = true;
      if (aft.replace(/[PFp°"']/g, '').length && v >= 10.0) o.star = true;
      var scDigitsLen = v >= 10 ? 2 : 1;
      spans.score = [pm.index + (ip.length - scDigitsLen), pm.index + pm[0].length];
      head = pre.slice(0, pm.index) + ' ' + ip.slice(0, ip.length - scDigitsLen);
    } else {
      var im = pre.match(/(\d{1,2})\s+(\d{1,2})\s*(\*?)\s*([Pp]?)\s*$/);
      if (im && +im[2] >= 1 && +im[2] <= 10) {
        o.dec = +im[2];
        o.decInt = true;
        o.star = (+im[2] === 10) && !!im[3];
        o.P = !!im[4];
        spans.score = [im.index + im[1].length, im.index + im[0].length];
        head = pre.slice(0, im.index) + ' ' + im[1];
      }
    }

    // 2) 手槍整數分數（1~10）：擴充實測吻合之內十符號（« » = - ~ % * s x + ¢ 4 #），° " ' 視為雜點而非內十；partial 無座標殘行不擴充新符號以免殘影誤對齊
    var ivRe = (!o.partial || o.x != null || o.y != null)
      ? /(?:^|[^\d])(10|[1-9])\s*([*%sx+¢4#«»=~-]?)\s*[°"']?\s*([PpF]{1,2})?\s*$/
      : /(?:^|[^\d])(10|[1-9])\s*([*sx%+¢4#]?)\s*([PpF]?)\s*$/;
    var iv = pre.match(ivRe);
    if (iv) {
      o.iv = +iv[1];
      o.istar = (o.iv === 10) && !!iv[2];
      if (iv[3]) o.P = true;
      if (!spans.score) spans.score = [iv.index, iv.index + iv[0].length];
    } else {
      // 分數被讀成相似字母且緊貼試射 P/F（如「25 & TP」「27 # BP」「4 ¢ BF」）：不猜分數，但標記試射 P 並記入 hints
      var lpm = pre.match(/(?:^|\s)([BTQRSOg])[°"']?([PpF]{1,2})\s*$/);
      if (lpm) {
        o.P = true;
        if (SCORE_LETTER_MAP[lpm[1]] != null) hints.scoreRepair = SCORE_LETTER_MAP[lpm[1]];
      } else {
        var lom = pre.match(/(?:^|\s)([BTQRS])\s*$/);
        if (lom && SCORE_LETTER_MAP[lom[1]] != null) hints.scoreRepair = SCORE_LETTER_MAP[lom[1]];
      }
    }

    // 防呆：「Mat cp 8 P 13:10.04 ...」殘影行不當成射擊行（消除 3-26 多出 Q12）
    if (o.partial && o.x == null && o.y == null && /^\s*[mnh]at\s*c[hp]\b/i.test(s)) return null;
    if (o.partial && o.dec == null && o.iv == null) return null;
    if (/(^|[^A-Za-z])P\s*$/.test(pre)) o.P = true;

    // 防呆：「pb 80 P 01:39.10 ...」中緊貼試射 P 的兩位數（>40，如 8°P 誤讀成 80 P）是環數+雜訊而非第 80 發試射
    var headForNc = head.replace(/\b[5-9]\d\s*[PpF]\s*$/, ' ');
    var re = /\d+/g, k;
    while ((k = re.exec(headForNc))) {
      var tk = k[0];
      if (tk.length > 3) continue;
      if (tk.length === 3) {
        if (+tk.slice(0, 2) >= 1) o.nc.push(+tk.slice(0, 2));
        if (+tk.slice(1) >= 1) o.nc.push(+tk.slice(1));
      } else if (+tk >= 1) {
        o.nc.push(+tk);
      }
    }
    o.n = o.nc.length ? o.nc[0] : null;

    // 3) 標註易混淆字（1/7、5/9、6/8）、正數疑似漏負號候選、箭頭與字元級信心（供 M5/M6 降黃或核對）
    var xStr = o.x != null ? Math.abs(o.x).toFixed(2) : '';
    var yStr = o.y != null ? Math.abs(o.y).toFixed(2) : '';
    o.kind = 'shot';
    o.rawOrig = String(rawStr || '');
    o.sec = secOf(o.t);
    o.scoreFmt = (o.dec != null && !o.decInt) ? 'dec' : (o.iv != null || o.decInt) ? 'int' : null;
    o.arrowRaw = extractArrowRaw(rawStr);
    o.arrow = (meta && meta.arrow && VALID_ARROWS[meta.arrow.dir]) ? { dir: meta.arrow.dir, margin: meta.arrow.margin != null ? meta.arrow.margin : 1 } : null;
    o.signHint = signHint;
    o.hasConfusable = {
      t: o.t ? CONFUSABLE_RE.test(o.t.slice(0, -1)) : false,
      tLast: o.t ? CONFUSABLE_RE.test(o.t.slice(-1)) : false,
      x: xStr ? CONFUSABLE_RE.test(xStr) : false,
      y: yStr ? CONFUSABLE_RE.test(yStr) : false
    };
    // 標記高風險正負號（讀為正值但無明確 '+'，熱感紙常漏印或漏讀 '-'）與首字 1↔7 易混淆
    if (o.x != null && o.x > 0) hints.xUnsigned = true;
    if (o.y != null && o.y > 0) hints.yUnsigned = true;
    if (o.x != null && /^1[.,]/.test(xStr)) hints.xLead17 = true;
    if (o.y != null && /^1[.,]/.test(yStr)) hints.yLead17 = true;
    o.hints = hints;

    var nsConfs = extractNonSpaceConfs(rawStr, meta);
    o.conf = null;
    o.tHint = false;
    if (nsConfs) {
      var nsMap = buildNsIndexMap(s);
      if (nsMap.count === nsConfs.length) {
        var cScore = spanMinConf(nsConfs, nsMap, spans.score && spans.score[0], spans.score && spans.score[1], true);
        var cTCore = spanMinConf(nsConfs, nsMap, spans.tCore && spans.tCore[0], spans.tCore && spans.tCore[1], true);
        var cTLast = spanMinConf(nsConfs, nsMap, spans.tLast && spans.tLast[0], spans.tLast && spans.tLast[1], true);
        var cT = (cTCore != null && cTLast != null) ? Math.min(cTCore, cTLast) : (cTCore != null ? cTCore : cTLast);
        var cX = spanMinConf(nsConfs, nsMap, spans.x && spans.x[0], spans.x && spans.x[1], false);
        var cY = spanMinConf(nsConfs, nsMap, spans.y && spans.y[0], spans.y && spans.y[1], false);
        var vals = [cScore, cTCore, cX, cY].filter(function (v2) { return v2 != null; });
        var cCoreMin = vals.length ? Math.min.apply(null, vals) : null;
        var allVals = cTLast != null && cCoreMin != null ? Math.min(cCoreMin, cTLast) : (cCoreMin != null ? cCoreMin : cTLast);
        o.conf = { min: allVals, coreMin: cCoreMin, score: cScore, t: cT, tCore: cTCore, tLast: cTLast, x: cX, y: cY };

        var thr = opt.confThr != null ? opt.confThr : 85;
        var thrConf = opt.confConfusionThr != null ? opt.confConfusionThr : 90;
        var thrTLast = opt.confTimeLastThr != null ? opt.confTimeLastThr : 85;
        if (cX != null && cX < (o.hasConfusable.x ? thrConf : thr)) repaired.push('x');
        if (cY != null && cY < (o.hasConfusable.y ? thrConf : thr)) repaired.push('y');
        if (cScore != null && cScore < thr) repaired.push('dec');
        if (cTCore != null && cTCore < thr) repaired.push('t');
        if (cTLast != null && cTLast < thrTLast && !repaired.length) o.tHint = true;
      }
    }
    o.repaired = repaired;
    if (meta && (meta.img != null || meta.kind != null || meta.edgeClipped != null)) {
      o.source = { img: meta.img != null ? meta.img : null, kind: meta.kind || null, edgeClipped: !!meta.edgeClipped };
    }
    return o;
  }

  /* ---------- 統一入口：一行 OCR 文字（或含字元信心物件）→ ParsedRowCandidate ---------- */
  function parseRow(input, opt) {
    var rawStr = '', meta = null;
    if (input && typeof input === 'object') {
      rawStr = String(input.text != null ? input.text : (input.raw != null ? input.raw : ''));
      meta = input;
    } else {
      rawStr = String(input == null ? '' : input);
      meta = (opt && typeof opt === 'object' && (opt.symbols || opt.charConf || opt.arrow || opt.minusHint || opt.edgeClipped != null)) ? opt : null;
    }
    if (!rawStr.trim()) return null;
    var s = norm(rawStr);

    var shot = parseShotRow(rawStr, s, meta, opt);
    if (shot) return shot;

    var other = parseNonShot(rawStr, s, meta);
    if (!other) return null;
    var res = Object.assign({ raw: s, rawOrig: rawStr }, other);
    if (meta && (meta.img != null || meta.kind != null || meta.edgeClipped != null)) {
      res.source = { img: meta.img != null ? meta.img : null, kind: meta.kind || null, edgeClipped: !!meta.edgeClipped };
    }
    return res;
  }

  /* ---------- 與既有 sius-x-core / sius.js 相容之薄轉接介面 ---------- */
  function parseShot(raw, meta, opt) {
    var r = parseRow(meta ? Object.assign({}, meta, { text: raw }) : raw, opt);
    return r && r.kind === 'shot' ? r : null;
  }

  function parseOther(raw) {
    var s = norm(raw);
    if (parseShotRow(raw, s, null, null)) return null;
    var o = parseNonShot(raw, s, null);
    if (!o || o.kind === 'target') return null;
    return o;
  }

  function parseLine(raw) {
    var o = parseOther(raw);
    if (o && (o.kind === 'sub' || o.kind === 'total')) return o;
    var p = parseShot(raw);
    if (!p) return null;
    var useInt = p.dec == null && p.iv != null;
    return {
      kind: 'shot',
      shot: {
        n: p.n,
        sighter: p.P,
        dec: useInt ? p.iv : p.dec,
        inner: useInt ? p.istar : p.star,
        t: p.t || '',
        x: p.x,
        y: p.y
      }
    };
  }

  var api = {
    VALID_ARROWS: VALID_ARROWS,
    norm: norm,
    tStr: tStr,
    secOf: secOf,
    fmtSec: fmtSec,
    gapSec: gapSec,
    parseRow: parseRow,
    parseShot: parseShot,
    parseOther: parseOther,
    parseLine: parseLine
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WRSiusXParse = api;
})(typeof window !== 'undefined' ? window : this);
