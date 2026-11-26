/* WRbeta 紀錄碼（分析）：座標系統 A
 * 只存彈孔相對靶心的位置（0.01mm），不存照片。還原後重新計算分數與統計。
 *
 * 壓縮：範圍編碼（range/arithmetic coder）＋內建射擊機率模型（版號獨立，之後可用真實紀錄重新調參）。
 *   - MPI（群中心）用「多數靠近靶心」的先驗
 *   - 彈孔用相對 MPI 的徑向／二維分布（軸向近似為離散 Laplace，尺度隨靶種有 ISSF 先驗）
 *   - 同一筆內自適應更新尺度
 * 混淆：固定金鑰的 XOR 流（這是混淆，不是加密；金鑰在程式裡，無法當作保密通訊）。
 * 分段：每段有獨特開頭、長度與校驗，可直接接在一起；空白與換行會被忽略。
 *
 * v1.8.0：也能存「預報」紀錄（含 Lite 多輪；v3.0 beta 起鬼影拿掉，舊鬼影碼解成一般預報）——第一個 4 位元（模型版號）＝2 代表預報紀錄（沿用模型 1 的數字）：
 *   靶種、建立時間（分）、名稱、模式（一般／鬼影）、配對方式、目前輪次、每輪的預報發數與實際發數，
 *   之後是「預報點」一組、「實際彈著」一組，各自用群中心＋相對座標（0.01mm）的同一套機率模型編碼。
 *   舊版 App（v1.7.x）看到這種碼會當作無效略過，不會出錯。
 */
(function (root) {
  'use strict';

  var FORMAT = 1;
  var MODEL_VER = 1;
  var FC_VER = 2; /* 第一個 4 位元＝2：預報紀錄（v1.8.0） */
  var MARK = '*A1';
  /* 複製貼上安全的 86 字元字母表（不含空白、引號、反斜線、<>& 與開頭符號 *） */
  var ALPH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%()+,-./:;=?@[]^_{|}~';
  var BASE = ALPH.length; // 86
  var AIDX = (function () { var m = {}; for (var i = 0; i < ALPH.length; i++) m[ALPH[i]] = i; return m; })();
  var TARGET_IDS = ['ap10', 'ar10'];
  var TOT = 4096; /* 機率總頻，必須為 2 的冪方便對半 */

  /* 模型表（「資料庫」）：可在不改編碼器的情況下單獨改數字。單位皆為 0.01mm。
   * 先驗依 ISSF 10m 空氣手槍／步槍靶尺寸與常見彈著群設定，之後可用真實紀錄重新調參。 */
  var MODELS = {
    1: {
      /* MPI 先驗尺度（離散 Laplace）：瞄具偏差通常在數 mm 到十幾 mm */
      mpiScale: { ap10: 1200, ar10: 500, _default: 1200 },
      /* 彈孔相對 MPI 的起始尺度（未編碼側資訊、未適應前） */
      shotScale: { ap10: 600, ar10: 220, _default: 600 },
      /* 對數尺度桶（編碼側資訊用，讓解碼端一開始就對準這組的群大小） */
      scaleBuckets: [50, 70, 100, 140, 200, 280, 400, 560, 800, 1100, 1600, 2200, 3200, 4500, 6400, 9000],
      /* 各桶先驗權重（會正規化）。手槍群較大，步槍較緊。 */
      scalePrior: {
        ap10: [1, 1, 2, 3, 5, 8, 12, 14, 12, 8, 5, 3, 2, 1, 1, 1],
        ar10: [3, 5, 10, 14, 14, 10, 6, 4, 2, 2, 1, 1, 1, 1, 1, 1],
        _default: [2, 2, 3, 4, 6, 8, 10, 10, 8, 6, 4, 3, 2, 2, 1, 1]
      },
      adaptN0: 6,
      scaleMin: 20,
      scaleMax: 25000,
      /* 下一張紙的 MPI 相對上一張：通常只會小幅移動 */
      sheetMpiScale: 400
    }
  };

  function modelOf(ver) { return MODELS[ver] || null; }
  function tgtKey(id) { return TARGET_IDS.indexOf(id) >= 0 ? id : '_default'; }
  function lookup(map, id) { return (map && (map[id] || map._default)) || map; }

  /* ---------- 整數雜湊／校驗／混淆（混淆，不是加密） ---------- */
  var KEY0 = 0xA5C3D917; /* 由 App 名稱派生的固定種子，公開於程式碼中 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  function scramble(bytes, nonce) {
    var rng = mulberry32((KEY0 ^ (nonce >>> 0)) >>> 0);
    var o = new Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) o[i] = bytes[i] ^ (rng() & 255);
    return o;
  }
  /* CRC-16-CCITT：3 個字母表字元盛得下（86^3 > 2^16），足以偵測貼上時的單一字元錯誤 */
  function crc16(bytes) {
    var c = 0xFFFF, i, b;
    for (i = 0; i < bytes.length; i++) {
      c ^= bytes[i] << 8;
      for (b = 0; b < 8; b++) c = (c & 0x8000) ? (((c << 1) ^ 0x1021) & 0xFFFF) : ((c << 1) & 0xFFFF);
    }
    return c;
  }
  function fnv1a(str) {
    var h = 0x811C9DC5, i;
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* ---------- 字母表 ---------- */
  function toDigits(n, k) {
    var s = '', i, d;
    n = Math.floor(n);
    if (n < 0) n = 0;
    for (i = 0; i < k; i++) { d = n % BASE; s = ALPH[d] + s; n = Math.floor(n / BASE); }
    return s;
  }
  function fromDigits(s) {
    var n = 0, i, d;
    for (i = 0; i < s.length; i++) { d = AIDX[s[i]]; if (d == null) return null; n = n * BASE + d; }
    return n;
  }
  function alphaLenFor(n) {
    if (n <= 0) return 0;
    var p = 1n, k = 0, N = 1n << (8n * BigInt(n)), B = BigInt(BASE);
    while (p < N) { p *= B; k++; }
    return k;
  }
  function bytesToAlpha(bytes) {
    var n = bytes.length, v = 0n, i;
    for (i = 0; i < n; i++) v = (v << 8n) + BigInt(bytes[i]);
    return toDigits(n, 2) + toDigitsBig(v, alphaLenFor(n));
  }
  function toDigitsBig(n, k) {
    var s = '', i, d, B = BigInt(BASE);
    for (i = 0; i < k; i++) { d = Number(n % B); s = ALPH[d] + s; n = n / B; }
    return s;
  }
  function fromDigitsBig(s) {
    var n = 0n, i, d, B = BigInt(BASE);
    for (i = 0; i < s.length; i++) { d = AIDX[s[i]]; if (d == null) return null; n = n * B + BigInt(d); }
    return n;
  }
  function alphaToBytes(s) {
    if (!s || s.length < 2) return null;
    var n = fromDigits(s.slice(0, 2));
    if (n == null || n < 0) return null;
    if (n === 0) return [];
    var k = alphaLenFor(n);
    if (s.length < 2 + k) return null;
    var v = fromDigitsBig(s.slice(2, 2 + k));
    if (v == null) return null;
    var out = new Array(n), i;
    for (i = n - 1; i >= 0; i--) { out[i] = Number(v & 0xFFn); v >>= 8n; }
    return out;
  }

  /* ---------- 範圍／算術編碼器（Witten–Neal–Cleary，位元輸出） ---------- */
  var AC_MAX = 0xFFFFFFFF, AC_HALF = 0x80000000, AC_QTR = 0x40000000;

  function BitWriter() { this.bytes = []; this.acc = 0; this.n = 0; }
  BitWriter.prototype.write = function (bit) {
    this.acc = (this.acc << 1) | (bit ? 1 : 0);
    this.n++;
    if (this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
  };
  BitWriter.prototype.end = function () {
    if (this.n) this.bytes.push(this.acc << (8 - this.n));
    return this.bytes;
  };
  function BitReader(bytes) { this.bytes = bytes; this.i = 0; this.n = 0; this.acc = 0; }
  BitReader.prototype.read = function () {
    if (this.n === 0) { this.acc = this.i < this.bytes.length ? this.bytes[this.i++] : 0; this.n = 8; }
    this.n--;
    return (this.acc >> this.n) & 1;
  };

  function AcEnc() {
    this.low = 0; this.high = AC_MAX; this.follow = 0; this.bits = new BitWriter();
  }
  AcEnc.prototype.outBit = function (bit) {
    this.bits.write(bit);
    while (this.follow > 0) { this.bits.write(bit ? 0 : 1); this.follow--; }
  };
  AcEnc.prototype.encode = function (cumLow, cumHigh, total) {
    var range = this.high - this.low + 1;
    this.high = this.low + Math.floor(range * cumHigh / total) - 1;
    this.low = this.low + Math.floor(range * cumLow / total);
    for (;;) {
      if (this.high < AC_HALF) this.outBit(0);
      else if (this.low >= AC_HALF) { this.outBit(1); this.low -= AC_HALF; this.high -= AC_HALF; }
      else if (this.low >= AC_QTR && this.high < AC_HALF + AC_QTR) { this.follow++; this.low -= AC_QTR; this.high -= AC_QTR; }
      else break;
      this.low = (this.low * 2) >>> 0;
      this.high = ((this.high * 2) + 1) >>> 0;
    }
  };
  AcEnc.prototype.finish = function () {
    this.follow++;
    this.outBit(this.low < AC_QTR ? 0 : 1);
    return this.bits.end();
  };

  function AcDec(bytes) {
    this.low = 0; this.high = AC_MAX; this.bits = new BitReader(bytes); this.code = 0;
    var i;
    for (i = 0; i < 32; i++) this.code = (this.code * 2 + this.bits.read()) >>> 0;
  }
  AcDec.prototype.peek = function (total) {
    var range = this.high - this.low + 1;
    return Math.floor(((this.code - this.low + 1) * total - 1) / range);
  };
  AcDec.prototype.confirm = function (cumLow, cumHigh, total) {
    var range = this.high - this.low + 1;
    this.high = this.low + Math.floor(range * cumHigh / total) - 1;
    this.low = this.low + Math.floor(range * cumLow / total);
    for (;;) {
      if (this.high < AC_HALF) { /* 0 */ }
      else if (this.low >= AC_HALF) { this.low -= AC_HALF; this.high -= AC_HALF; this.code -= AC_HALF; }
      else if (this.low >= AC_QTR && this.high < AC_HALF + AC_QTR) { this.low -= AC_QTR; this.high -= AC_QTR; this.code -= AC_QTR; }
      else break;
      this.low = (this.low * 2) >>> 0;
      this.high = ((this.high * 2) + 1) >>> 0;
      this.code = ((this.code * 2) + this.bits.read()) >>> 0;
    }
  };

  function encBit(e, bit, p0) { if (bit) e.encode(p0, TOT, TOT); else e.encode(0, p0, TOT); }
  function decBit(d, p0) {
    var c = d.peek(TOT), bit = c >= p0 ? 1 : 0;
    if (bit) d.confirm(p0, TOT, TOT); else d.confirm(0, p0, TOT);
    return bit;
  }
  function encSym(e, sym, freq) {
    var total = 0, cum = 0, i;
    for (i = 0; i < freq.length; i++) total += freq[i];
    for (i = 0; i < sym; i++) cum += freq[i];
    e.encode(cum, cum + freq[sym], total);
  }
  function decSym(d, freq) {
    var total = 0, cum = 0, i, c;
    for (i = 0; i < freq.length; i++) total += freq[i];
    c = d.peek(total);
    for (i = 0; i < freq.length; i++) {
      if (c < cum + freq[i]) { d.confirm(cum, cum + freq[i], total); return i; }
      cum += freq[i];
    }
    return -1;
  }
  function encRawBits(e, val, n) {
    var i;
    for (i = n - 1; i >= 0; i--) encBit(e, (val >> i) & 1, TOT >> 1);
  }
  function decRawBits(d, n) {
    var v = 0, i;
    for (i = 0; i < n; i++) v = (v << 1) | decBit(d, TOT >> 1);
    return v;
  }

  /* ---------- 離散 Laplace／Rice 整數（軸向；二維徑向由兩軸＋適應尺度構成） ---------- */
  function riceK(s) {
    var k = 0, t = 1, v = s < 1 ? 1 : s | 0;
    while (t <= (v >> 1) && k < 14) { t <<= 1; k++; }
    return k;
  }
  /* P(X=0) ≈ 1/(2s+1)，只用整數運算，避免不同裝置浮點誤差造成無法還原 */
  function pZero(s) {
    var f = Math.floor(TOT / (2 * Math.max(s, 1) + 1));
    if (f < 1) f = 1;
    if (f > TOT - 1) f = TOT - 1;
    return f;
  }
  /* P(unary continue) ≈ (s/(s+1))^(2^k)，Q24 固定小數、整數幂 */
  function pCont(s, k) {
    var mu = s < 1 ? 1 : s | 0, M = 1 << k, Q = 1 << 24;
    var b = Math.floor(Q * mu / (mu + 1)), r = Q, m = M;
    while (m > 0) {
      if (m & 1) r = Math.floor((r * b) / Q);
      m >>= 1;
      if (m) b = Math.floor((b * b) / Q);
    }
    var f = Math.floor(TOT * r / Q);
    if (f < 1) f = 1;
    if (f > TOT - 1) f = TOT - 1;
    return f;
  }
  function encInt(e, value, scale) {
    value = value | 0;
    var u = value < 0 ? ((-value) * 2 - 1) : (value * 2);
    var pz = pZero(scale);
    if (u === 0) { encBit(e, 0, pz); return; }
    encBit(e, 1, pz);
    encBit(e, value < 0 ? 1 : 0, TOT >> 1);
    var mag = u; /* zigzag：|v| 的 2x 或 2x-1，改對 |value|-1 編碼更緊 */
    mag = (value < 0 ? -value : value) - 1;
    var k = riceK(scale), pc = pCont(scale, k), q = mag >> k, r = mag & ((1 << k) - 1), i;
    if (q > 64) { /* 極端離群：先寫 64 個 continue 當逃逸，再寫 16 位長度 */
      for (i = 0; i < 65; i++) encBit(e, 0, pc);
      encRawBits(e, mag, 24);
      return;
    }
    for (i = 0; i < q; i++) encBit(e, 0, pc);
    encBit(e, 1, pc);
    encRawBits(e, r, k);
  }
  function decInt(d, scale) {
    var pz = pZero(scale);
    if (decBit(d, pz) === 0) return 0;
    var neg = decBit(d, TOT >> 1);
    var k = riceK(scale), pc = pCont(scale, k), q = 0, mag, r, i;
    while (q < 65 && decBit(d, pc) === 0) q++;
    if (q === 65) mag = decRawBits(d, 24);
    else { r = decRawBits(d, k); mag = (q << k) + r; }
    mag = mag + 1;
    return neg ? -mag : mag;
  }

  function clampScale(model, s) {
    if (s < model.scaleMin) return model.scaleMin;
    if (s > model.scaleMax) return model.scaleMax;
    return s;
  }
  function pickBucket(model, rms) {
    var b = model.scaleBuckets, best = 0, bd = 1e9, i, d, x = Math.max(rms, 1);
    for (i = 0; i < b.length; i++) {
      d = x > b[i] ? x / b[i] : b[i] / x;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function newAdapt(model, s0) {
    return { model: model, n0: model.adaptN0, s0: s0, n: 0, sumSq: 0 };
  }
  function adaptScale(st) {
    var v = (st.n0 * st.s0 * st.s0 + st.sumSq / 2) / (st.n0 + st.n);
    return clampScale(st.model, Math.round(Math.sqrt(Math.max(v, 1))));
  }
  function adaptAdd(st, dx, dy) {
    st.sumSq += dx * dx + dy * dy;
    st.n++;
  }

  /* ---------- 紀錄 ↔ 整數座標 ---------- */
  function qmm(v) { return Math.round(Number(v) * 100); }
  function umm(i) { return i / 100; }
  function minuteOf(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) t = 0;
    return Math.floor(t / 60000);
  }
  function isoOfMinute(m) { return new Date(m * 60000).toISOString(); }

  function utf8Bytes(str) {
    if (!str) return [];
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    var s = unescape(encodeURIComponent(str)), o = [], i;
    for (i = 0; i < s.length; i++) o.push(s.charCodeAt(i));
    return o;
  }
  function utf8String(bytes) {
    if (!bytes || !bytes.length) return '';
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch (e) { return null; }
    }
    try {
      var s = '', i;
      for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return decodeURIComponent(escape(s));
    } catch (e) { return null; }
  }

  function collectShots(rec) {
    var sheets = [], i, sh, shots, j, x, y, sx, sy, n, mx, my;
    var list = rec && rec.sheets ? rec.sheets : [];
    for (i = 0; i < list.length; i++) {
      sh = list[i];
      shots = [];
      sx = 0; sy = 0; n = 0;
      for (j = 0; j < (sh.shots || []).length; j++) {
        x = qmm(sh.shots[j].x); y = qmm(sh.shots[j].y);
        shots.push([x, y]);
        sx += x; sy += y; n++;
      }
      mx = n ? Math.round(sx / n) : 0;
      my = n ? Math.round(sy / n) : 0;
      sheets.push({ shots: shots, mx: mx, my: my });
    }
    return sheets;
  }

  function contentKey(rec) {
    var parts = [String(rec.targetId || ''), String(minuteOf(rec.created)), String(rec.name || '')], i, j, sh, q;
    var list = rec.sheets || [];
    for (i = 0; i < list.length; i++) {
      parts.push('|');
      sh = list[i].shots || [];
      for (j = 0; j < sh.length; j++) {
        q = sh[j];
        parts.push(qmm(q.x) + ',' + qmm(q.y));
      }
    }
    return parts.join(';');
  }
  function contentHash(rec) { return fnv1a(isForecast(rec) ? contentKeyFc(rec) : contentKey(rec)); }

  function packRecord(rec) {
    var model = modelOf(MODEL_VER);
    var tid = rec.targetId || 'ap10';
    var ti = TARGET_IDS.indexOf(tid); if (ti < 0) ti = 0;
    var sheets = collectShots(rec);
    var name = rec.name ? String(rec.name).slice(0, 60) : '';
    var nb = utf8Bytes(name); if (nb.length > 240) nb = nb.slice(0, 240);
    var i, j, sh, nAll = 0, sumSq = 0, dx, dy;
    for (i = 0; i < sheets.length; i++) {
      sh = sheets[i];
      for (j = 0; j < sh.shots.length; j++) {
        dx = sh.shots[j][0] - sh.mx; dy = sh.shots[j][1] - sh.my;
        sumSq += dx * dx + dy * dy; nAll++;
      }
    }
    var rms = nAll ? Math.sqrt(sumSq / (2 * nAll)) : lookup(model.shotScale, tid);
    var bkt = pickBucket(model, rms);
    var s0 = model.scaleBuckets[bkt];
    var e = new AcEnc();
    encRawBits(e, MODEL_VER, 4);
    encRawBits(e, ti, 4);
    encRawBits(e, minuteOf(rec.created) >>> 0, 32);
    encBit(e, nb.length ? 1 : 0, TOT >> 1);
    if (nb.length) {
      encRawBits(e, nb.length, 8);
      for (i = 0; i < nb.length; i++) encRawBits(e, nb[i], 8);
    }
    encRawBits(e, sheets.length, 8);
    for (i = 0; i < sheets.length; i++) encRawBits(e, sheets[i].shots.length, 12);
    encSym(e, bkt, lookup(model.scalePrior, tid));

    var mpiS = lookup(model.mpiScale, tid);
    var prevMx = 0, prevMy = 0, st = newAdapt(model, s0), s, sc;
    for (i = 0; i < sheets.length; i++) {
      sh = sheets[i];
      if (i === 0) { encInt(e, sh.mx, mpiS); encInt(e, sh.my, mpiS); }
      else { encInt(e, sh.mx - prevMx, model.sheetMpiScale); encInt(e, sh.my - prevMy, model.sheetMpiScale); }
      prevMx = sh.mx; prevMy = sh.my;
      for (j = 0; j < sh.shots.length; j++) {
        s = adaptScale(st);
        dx = sh.shots[j][0] - sh.mx; dy = sh.shots[j][1] - sh.my;
        encInt(e, dx, s); encInt(e, dy, s);
        adaptAdd(st, dx, dy);
      }
    }
    return e.finish();
  }

  function unpackRecord(bytes) {
    if (!bytes || !bytes.length) return null;
    var d = new AcDec(bytes);
    var mv = decRawBits(d, 4);
    if (mv === FC_VER) return unpackForecast(d);
    var model = modelOf(mv);
    if (!model) return null;
    var ti = decRawBits(d, 4);
    if (ti < 0 || ti >= TARGET_IDS.length) return null;
    var tid = TARGET_IDS[ti];
    var mins = decRawBits(d, 32);
    var name = '';
    if (decBit(d, TOT >> 1)) {
      var nl = decRawBits(d, 8), nb = [], i;
      for (i = 0; i < nl; i++) nb.push(decRawBits(d, 8));
      name = utf8String(nb);
      if (name == null) return null;
    }
    var nSheets = decRawBits(d, 8), counts = [], i, j;
    if (nSheets > 200) return null;
    for (i = 0; i < nSheets; i++) {
      counts[i] = decRawBits(d, 12);
      if (counts[i] > 2000) return null;
    }
    var bkt = decSym(d, lookup(model.scalePrior, tid));
    if (bkt < 0 || bkt >= model.scaleBuckets.length) return null;
    var s0 = model.scaleBuckets[bkt];
    var mpiS = lookup(model.mpiScale, tid);
    var prevMx = 0, prevMy = 0, st = newAdapt(model, s0), sheets = [], mx, my, dx, dy, s, shots, created;
    created = isoOfMinute(mins);
    for (i = 0; i < nSheets; i++) {
      if (i === 0) { mx = decInt(d, mpiS); my = decInt(d, mpiS); }
      else { mx = prevMx + decInt(d, model.sheetMpiScale); my = prevMy + decInt(d, model.sheetMpiScale); }
      prevMx = mx; prevMy = my;
      shots = [];
      for (j = 0; j < counts[i]; j++) {
        s = adaptScale(st);
        dx = decInt(d, s); dy = decInt(d, s);
        adaptAdd(st, dx, dy);
        shots.push({ x: umm(mx + dx), y: umm(my + dy), src: 'code' });
      }
      sheets.push({ id: 'c' + i, created: created, shots: shots, calib: null, photo: null });
    }
    return { v: 2, kind: 'analysis', targetId: tid, created: created, tz: 'Asia/Taipei', name: name, note: '', sheets: sheets };
  }

  /* ---------- 預報紀錄（v1.8.0） ---------- */
  function roundOf(p) { return p && p.r > 0 ? Math.min(255, p.r | 0) : 0; }
  function byRound(list) { // 依輪次排好（同一輪內保持原本順序）
    return (list || []).map(function (p, i) { return { p: p, i: i, r: roundOf(p) }; }).sort(function (a, b) { return a.r - b.r || a.i - b.i; });
  }
  function encGroup(e, model, tid, pts) { // 一組點：尺度桶＋群中心＋相對座標
    var n = pts.length, i, sx = 0, sy = 0, mx, my, sumSq = 0, dx, dy;
    if (!n) return;
    for (i = 0; i < n; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    mx = Math.round(sx / n); my = Math.round(sy / n);
    for (i = 0; i < n; i++) { dx = pts[i][0] - mx; dy = pts[i][1] - my; sumSq += dx * dx + dy * dy; }
    var bkt = pickBucket(model, Math.sqrt(sumSq / (2 * n)));
    encSym(e, bkt, lookup(model.scalePrior, tid));
    var mpiS = lookup(model.mpiScale, tid);
    encInt(e, mx, mpiS); encInt(e, my, mpiS);
    var st = newAdapt(model, model.scaleBuckets[bkt]), s;
    for (i = 0; i < n; i++) { s = adaptScale(st); dx = pts[i][0] - mx; dy = pts[i][1] - my; encInt(e, dx, s); encInt(e, dy, s); adaptAdd(st, dx, dy); }
  }
  function decGroup(d, model, tid, n) {
    var out = [], i;
    if (!n) return out;
    var bkt = decSym(d, lookup(model.scalePrior, tid));
    if (bkt < 0 || bkt >= model.scaleBuckets.length) return null;
    var mpiS = lookup(model.mpiScale, tid), mx = decInt(d, mpiS), my = decInt(d, mpiS);
    var st = newAdapt(model, model.scaleBuckets[bkt]), s, dx, dy;
    for (i = 0; i < n; i++) { s = adaptScale(st); dx = decInt(d, s); dy = decInt(d, s); adaptAdd(st, dx, dy); out.push([mx + dx, my + dy]); }
    return out;
  }
  var PAIR = ['', 'optimal', 'order'];
  function packForecast(rec) {
    var model = modelOf(MODEL_VER), tid = rec.targetId || 'ap10';
    var ti = TARGET_IDS.indexOf(tid); if (ti < 0) ti = 0;
    var name = rec.name ? String(rec.name).slice(0, 60) : '';
    var nb = utf8Bytes(name); if (nb.length > 240) nb = nb.slice(0, 240);
    var P = byRound(rec.preds), A = byRound(rec.actuals), nR = 1, i, k;
    P.concat(A).forEach(function (o) { if (o.r + 1 > nR) nR = o.r + 1; });
    var e = new AcEnc();
    encRawBits(e, FC_VER, 4);
    encRawBits(e, ti, 4);
    encRawBits(e, minuteOf(rec.created) >>> 0, 32);
    encBit(e, nb.length ? 1 : 0, TOT >> 1);
    if (nb.length) { encRawBits(e, nb.length, 8); for (i = 0; i < nb.length; i++) encRawBits(e, nb[i], 8); }
    encRawBits(e, 0, 2); // 模式：v1.8.0–v2.9.6 的 1＝鬼影；v3.0 beta 起一律 0（鬼影拿掉，解碼仍相容）
    encRawBits(e, Math.max(0, PAIR.indexOf(rec.pairMode || '')), 2);
    encRawBits(e, rec.round > 0 ? Math.min(255, rec.round | 0) : 0, 8);
    encRawBits(e, nR, 8);
    for (k = 0; k < nR; k++) {
      encRawBits(e, P.filter(function (o) { return o.r === k; }).length, 12);
      encRawBits(e, A.filter(function (o) { return o.r === k; }).length, 12);
    }
    encGroup(e, model, tid, P.map(function (o) { return [qmm(o.p.x), qmm(o.p.y)]; }));
    encGroup(e, model, tid, A.map(function (o) { return [qmm(o.p.x), qmm(o.p.y)]; }));
    return e.finish();
  }
  function unpackForecast(d) {
    var model = modelOf(MODEL_VER), i, k;
    var ti = decRawBits(d, 4);
    if (ti < 0 || ti >= TARGET_IDS.length) return null;
    var tid = TARGET_IDS[ti], created = isoOfMinute(decRawBits(d, 32)), name = '';
    if (decBit(d, TOT >> 1)) {
      var nl = decRawBits(d, 8), nb = [];
      for (i = 0; i < nl; i++) nb.push(decRawBits(d, 8));
      name = utf8String(nb); if (name == null) return null;
    }
    var mode = decRawBits(d, 2), pm = PAIR[decRawBits(d, 2)], round = decRawBits(d, 8), gsrc = 0, gdone = 0;
    if (mode > 1 || pm == null) return null;
    if (mode === 1) { gsrc = decRawBits(d, 1); gdone = decRawBits(d, 1); }
    var nR = decRawBits(d, 8), pr = [], ar = [], nP = 0, nA = 0;
    if (nR < 1) return null;
    for (k = 0; k < nR; k++) { pr[k] = decRawBits(d, 12); ar[k] = decRawBits(d, 12); nP += pr[k]; nA += ar[k]; }
    if (nP > 4000 || nA > 4000) return null;
    var P = decGroup(d, model, tid, nP), A = decGroup(d, model, tid, nA);
    if (!P || !A) return null;
    function pts(list, cnt, isPred) {
      var out = [], j = 0;
      for (k = 0; k < nR; k++) for (i = 0; i < cnt[k]; i++, j++) {
        var q = { x: umm(list[j][0]), y: umm(list[j][1]) };
        if (!isPred) q.src = 'code';
        if (k > 0) q.r = k;
        out.push(q);
      }
      return out;
    }
    var rec = { v: 2, kind: 'forecast', created: created, name: name, note: '', targetId: tid, preds: pts(P, pr, true), actuals: pts(A, ar, false), calib: null };
    if (pm) rec.pairMode = pm;
    if (round) rec.round = round;
    if (mode === 1 && round) rec.round = round; // v3.0 beta：舊的鬼影紀錄碼照樣能還原，解成一般預報紀錄（多輪照留；鬼影設定 gsrc／gdone 讀過就丟）
    return rec;
  }
  function isForecast(rec) { return !!rec && rec.kind !== 'analysis'; }
  function contentKeyFc(rec) {
    var parts = ['F', String(rec.targetId || ''), String(minuteOf(rec.created)), String(rec.name || '')];
    function add(list) { byRound(list).forEach(function (o) { parts.push(o.r + ':' + qmm(o.p.x) + ',' + qmm(o.p.y)); }); }
    add(rec.preds); parts.push('|'); add(rec.actuals);
    return parts.join(';');
  }

  function newId(rec) {
    var p = rec && rec.kind !== 'analysis' ? 's' : 'a';
    return p + Date.now() + Math.floor(Math.random() * 1000);
  }

  function encode(rec) {
    if (!rec) return null;
    var plain, n = 0, i;
    if (isForecast(rec)) {
      n = (rec.preds || []).length + (rec.actuals || []).length;
      if (!n) return null;
      plain = packForecast(rec);
    } else {
      var sheets = rec.sheets || [];
      for (i = 0; i < sheets.length; i++) n += (sheets[i].shots || []).length;
      if (!n) return null;
      plain = packRecord(rec);
    }
    var crc = crc16(plain);
    var body = bytesToAlpha(scramble(plain, crc));
    return MARK + toDigits(body.length, 3) + toDigits(crc, 3) + body;
  }

  function encodeMany(recs) {
    var s = '', i, c;
    for (i = 0; i < (recs || []).length; i++) { c = encode(recs[i]); if (c) s += c; }
    return s;
  }

  function strip(text) {
    return String(text || '').replace(/[\s\u00a0\u3000\u200b\u200c\u200d\ufeff]+/g, '');
  }

  function decodeOneBytes(body, crc) {
    var bytes = alphaToBytes(body);
    if (!bytes) return null;
    var plain = scramble(bytes, crc);
    if (crc16(plain) !== crc) return null;
    try { return unpackRecord(plain); } catch (e) { return null; }
  }

  /* 剖析可串接的字串：壞掉的段略過，不阻擋後面的段 */
  function decode(text) {
    var s = strip(text), records = [], invalid = 0, i = 0, p, len, crc, body, rec, resync = false;
    while (i < s.length) {
      p = s.indexOf(MARK, i);
      if (p < 0) { if (!resync && i < s.length) invalid++; break; }
      if (p > i && !resync) invalid++;
      if (s.length < p + 9) { invalid++; break; }
      len = fromDigits(s.slice(p + 3, p + 6));
      crc = fromDigits(s.slice(p + 6, p + 9));
      if (len == null || crc == null || len < 0) { invalid++; resync = true; i = p + 1; continue; }
      body = s.slice(p + 9, p + 9 + len);
      if (body.length < len) { invalid++; break; }
      rec = decodeOneBytes(body, crc);
      if (!rec) { if (!resync) invalid++; resync = true; i = p + 1; continue; }
      rec.id = newId(rec);
      rec.hash = contentHash(rec);
      for (var si = 0; si < (rec.sheets || []).length; si++) rec.sheets[si].id = rec.id + 's' + si;
      records.push(rec);
      i = p + 9 + len;
      resync = false;
    }
    return { records: records, invalid: invalid };
  }

  /* 把解碼結果併入現有分析紀錄：回傳 added / skipped（內容雜湊相同）／ invalid */
  function merge(existing, text) {
    var got = decode(text);
    var have = {};
    var i, h, add = [];
    for (i = 0; i < (existing || []).length; i++) {
      if (existing[i]) have[contentHash(existing[i])] = true;
    }
    for (i = 0; i < got.records.length; i++) {
      h = got.records[i].hash;
      if (have[h]) continue;
      have[h] = true;
      add.push(got.records[i]);
    }
    return { added: add, skipped: got.records.length - add.length, invalid: got.invalid, records: got.records };
  }

  /* ---------- 舊案（變長／bit-pack）對照，只給測試量測用，App 不使用 ---------- */
  function zigzag(v) { return v < 0 ? ((-v) << 1) - 1 : (v << 1); }
  function bitWidthNeed(v) {
    var u = v < 0 ? -v : v, w = 1;
    while (u > ((1 << (w - 1)) - 1) && w < 16) w++;
    return w;
  }
  function encodeVarintBaseline(rec) {
    var sheets = collectShots(rec), i, j, sh, dx, dy, maxa = 1, bits = [], w;
    function pushBits(val, n) {
      var k;
      for (k = n - 1; k >= 0; k--) bits.push((val >> k) & 1);
    }
    for (i = 0; i < sheets.length; i++) {
      sh = sheets[i];
      for (j = 0; j < sh.shots.length; j++) {
        dx = sh.shots[j][0] - sh.mx; dy = sh.shots[j][1] - sh.my;
        if (Math.abs(dx) > maxa) maxa = Math.abs(dx);
        if (Math.abs(dy) > maxa) maxa = Math.abs(dy);
      }
    }
    w = bitWidthNeed(maxa);
    pushBits(MODEL_VER, 4); pushBits(Math.max(0, TARGET_IDS.indexOf(rec.targetId)), 4);
    pushBits(minuteOf(rec.created) >>> 0, 32);
    var nb = utf8Bytes(rec.name || ''); pushBits(nb.length ? 1 : 0, 1);
    if (nb.length) { pushBits(nb.length, 8); for (i = 0; i < nb.length; i++) pushBits(nb[i], 8); }
    pushBits(sheets.length, 8);
    for (i = 0; i < sheets.length; i++) pushBits(sheets[i].shots.length, 12);
    /* MPI 16 位有號 + 共用位寬 + 每發 zigzag 固定位寬（舊案） */
    for (i = 0; i < sheets.length; i++) {
      sh = sheets[i];
      pushBits(sh.mx & 0xFFFF, 16); pushBits(sh.my & 0xFFFF, 16);
      if (i === 0) pushBits(w, 4);
      for (j = 0; j < sh.shots.length; j++) {
        dx = sh.shots[j][0] - sh.mx; dy = sh.shots[j][1] - sh.my;
        pushBits(zigzag(dx), w + 1); pushBits(zigzag(dy), w + 1);
      }
    }
    var bytes = [], acc = 0, n = 0;
    for (i = 0; i < bits.length; i++) {
      acc = (acc << 1) | bits[i]; n++;
      if (n === 8) { bytes.push(acc); acc = 0; n = 0; }
    }
    if (n) bytes.push(acc << (8 - n));
    var crc = crc16(bytes);
    var body = bytesToAlpha(scramble(bytes, crc));
    return MARK + toDigits(body.length, 3) + toDigits(crc, 3) + body;
  }

  /* ---------- v2.9.4 好友分享用的「檢視碼」（PROGRESS §7 第 14 項，White 2026-11-23 指定：分享文件不能讓收件人讀到完整紀錄碼） ----------
   * 分享文件（Firestore shares/{sid}）改存 view＝'*S1'＋紀錄碼本體依分享 id 逐字位移（同一個 86 字元字母表）。
   * 不是紀錄碼：沒有 '*A1' 標記（字母表裡沒有 *），貼到「貼上紀錄碼還原」會被當成無效、不會變成自己可編輯的紀錄；
   * App 只用它畫唯讀檢視。這是混淆不是加密（免費方案沒有伺服器，收件人的 App 一定要能解開才看得到靶面），擋的是「複製貼上」這條路。 */
  var SMARK = '*S1';
  function shareKey(sid) { var h = 0x811C9DC5, s = String(sid || ''), i; for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h ^ 0x5EED5A1E) >>> 0; }
  function shift(body, sid, dir) { var rng = mulberry32(shareKey(sid)), o = '', i, d; for (i = 0; i < body.length; i++) { d = AIDX[body[i]]; if (d == null) return null; o += ALPH[(d + dir * (rng() % BASE) + BASE * 2) % BASE]; } return o; }
  function encodeShare(rec, sid) { var c = encode(rec); if (!c) return null; var b = shift(c.slice(MARK.length), sid, 1); return b ? SMARK + b : null; }
  /* 檢視碼 → 一筆紀錄（解不開＝null）。舊的分享文件（v2.9.3 以前）存的是 code（紀錄碼），也接受 */
  function decodeShare(view, sid) {
    var s = strip(view), r;
    if (s.indexOf(SMARK) === 0) { var b = shift(s.slice(SMARK.length), sid, -1); if (!b) return null; r = decode(MARK + b); }
    else if (s.indexOf(MARK) === 0) r = decode(s);
    else return null;
    return r.records.length === 1 && !r.invalid ? r.records[0] : null;
  }

  var api = {
    SMARK: SMARK, encodeShare: encodeShare, decodeShare: decodeShare,
    FORMAT: FORMAT, MODEL_VER: MODEL_VER, MARK: MARK, ALPH: ALPH, MODELS: MODELS,
    FC_VER: FC_VER,
    encode: encode, encodeMany: encodeMany, decode: decode, merge: merge,
    contentHash: contentHash, encodeVarintBaseline: encodeVarintBaseline,
    /* 測試用 */
    _scramble: scramble, _crc16: crc16, _bytesToAlpha: bytesToAlpha, _alphaToBytes: alphaToBytes,
    _encInt: encInt, _decInt: decInt, _AcEnc: AcEnc, _AcDec: AcDec, _encBit: encBit, _decBit: decBit,
    _qmm: qmm
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BMCode = api;
})(typeof window !== 'undefined' ? window : this);
