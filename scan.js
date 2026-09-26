// scan.js - read owned plans + levels from a Training Plan screenshot.
// Port of the bot's reader (kingwar_automation.py): the image is scaled to the
// game's 940-px-wide layout, tile rows are found by their orange/blue stat
// diamonds, each tile's icon is matched against the client's own sprites, and
// the level comes from the tile's STR/TECH (unique per card and level).  Dimmed
// (equipped) tiles fall back to the star digit, learned from tiles of known
// level in the same screenshots.
var SCAN = (function () {
  var W = 940, COLS_LIST = [115, 290, 465, 640, 815], COLS_BAR = [120, 301, 482, 663, 844];
  var SCALES = [1.25, 1.32, 1.4], ICON_MIN = 0.6;
  var ICONS = null, DIGITS = null, STATS = null;

  function b64(s) {
    if (typeof atob === 'function') { var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function resize(src, sw, sh, dw, dh) {             // bilinear, Float32
    var out = new Float32Array(dw * dh);
    for (var y = 0; y < dh; y++) {
      var fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
      for (var x = 0; x < dw; x++) {
        var fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
        out[y * dw + x] = (src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx) * (1 - wy) +
                          (src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx) * wy;
      }
    }
    return out;
  }
  function init(scan, cards) {
    ICONS = scan.icons.map(function (ic) {
      var lum = b64(ic.lum), per = {};
      SCALES.forEach(function (s) {
        var w = Math.round(ic.w * s), h = Math.round(ic.h * s), t = resize(lum, ic.w, ic.h, w, h), m = 0, i;
        for (i = 0; i < t.length; i++) m += t[i]; m /= t.length;
        for (i = 0; i < t.length; i++) t[i] -= m;
        per[s] = { w: w, h: h, t: t };
      });
      return { g: ic.g, per: per };
    });
    DIGITS = {};
    Object.keys(scan.digits).forEach(function (d) {
      DIGITS[d] = scan.digits[d].map(function (bits) { return bits.split('').map(Number); });
    });
    STATS = {};                                       // group -> "s,t" -> level
    cards.forEach(function (c) { STATS[c.g] = {}; c.lv.forEach(function (r, i) { STATS[c.g][r[0] + ',' + r[1]] = i + 1; }); });
  }

  // img: {w, h, px: Uint8ClampedArray RGBA}, already scaled to width 940
  function prepare(img) {
    var n = img.w * img.h, L = new Float32Array(n), tick = new Uint8Array(n), p = img.px;
    for (var i = 0; i < n; i++) {
      var r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
      L[i] = (r + g + b) / 3;
      tick[i] = (g > r + 30 && g > b + 15 && g > 100) ? 1 : 0;
    }
    return { w: img.w, h: img.h, px: p, L: L, tick: tick };
  }

  function rows(im) {
    var h = im.h, w = im.w, p = im.px, prof = new Float32Array(h), y, x, k, c;
    for (y = 0; y < h; y++) {
      for (k = 0; k < 5; k++) {
        c = COLS_LIST[k]; var o = 0, bl = 0;
        for (x = c - 62; x < c - 14; x++) { var i = (y * w + x) * 4, r = p[i], g = p[i + 1], b = p[i + 2]; if (r > g + 18 && g >= b + 4 && r > 55) o++; }
        for (x = c + 26; x < c + 74 && x < w; x++) { var j = (y * w + x) * 4, r2 = p[j], g2 = p[j + 1], b2 = p[j + 2]; if (b2 > r2 + 18 && b2 > 45) bl++; }
        prof[y] += Math.min(o, bl);
      }
    }
    var sm = new Float32Array(h), acc = 0;
    for (y = 0; y < h; y++) { acc += prof[y] - (y >= 40 ? prof[y - 40] : 0); sm[y - 20 >= 0 ? y - 20 : 0] = acc; }
    var idx = Array.from(sm.keys()).sort(function (a, b) { return sm[b] - sm[a]; }), mx = sm[idx[0]], out = [];
    for (var q = 0; q < idx.length; q++) {
      y = idx[q]; if (sm[y] < mx * 0.12 || sm[y] < 150) break;
      if (out.every(function (r) { return Math.abs(y - r) > 120; })) out.push(y);
    }
    return out.map(function (r) { return r + 55; }).filter(function (r) { return r + 110 < h; }).sort(function (a, b) { return a - b; });
  }

  function corr(im, T, x0, y0) {
    var w = im.w, sa = 0, n = 0, i, j, v;
    if (x0 < 0 || y0 < 0 || x0 + T.w > im.w || y0 + T.h > im.h) return -1;
    for (j = 0; j < T.h; j++) for (i = 0; i < T.w; i++) { var q = (y0 + j) * w + x0 + i; if (!im.tick[q]) { sa += im.L[q]; n++; } }
    if (n < T.t.length * 0.5) return -1;
    var ma = sa / n, ab = 0, aa = 0, bb = 0;
    for (j = 0; j < T.h; j++) for (i = 0; i < T.w; i++) {
      var q2 = (y0 + j) * w + x0 + i; if (im.tick[q2]) continue;
      var a = im.L[q2] - ma, b = T.t[j * T.w + i]; ab += a * b; aa += a * a; bb += b * b;
    }
    return ab / (Math.sqrt(aa * bb) + 1e-9);
  }
  function identify(im, cx, cy) {
    var best = { s: -1, g: 0 };
    ICONS.forEach(function (ic) {
      SCALES.forEach(function (s) {
        var T = ic.per[s];
        for (var dx = -6; dx <= 6; dx += 3) for (var dy = -6; dy <= 6; dy += 3) {
          var v = corr(im, T, cx + dx - (T.w >> 1), cy + dy - (T.h >> 1));
          if (v > best.s) best = { s: v, g: ic.g };
        }
      });
    });
    return best;
  }

  // ---- digits (port of kingwar_automation._glyphs / read_number) ----------
  function glyphs(im, x0, y0, x1, y1) {
    var w = im.w, p = im.px, bw = x1 - x0, bh = y1 - y0, m = new Uint8Array(bw * bh), x, y;
    for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
      var i = ((y0 + y) * w + x0 + x) * 4, r = p[i], g = p[i + 1], b = p[i + 2];
      var mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      m[y * bw + x] = mn > 195 && mx - mn < 40 ? 1 : 0;
    }
    var cols = [];
    for (x = 0; x < bw; x++) { var s = 0; for (y = 0; y < bh; y++) s += m[y * bw + x]; if (s > 1) cols.push(x); }
    var segs = [], st = null, pv = null;
    cols.forEach(function (c) { if (st === null) st = c; else if (c - pv > 1) { segs.push([st, pv]); st = c; } pv = c; });
    if (st !== null) segs.push([st, pv]);
    var out = [];
    segs.forEach(function (sg) {
      if (sg[1] - sg[0] < 2) return;
      var rr = []; for (y = 0; y < bh; y++) { for (x = sg[0]; x <= sg[1]; x++) if (m[y * bw + x]) { rr.push(y); break; } }
      if (rr.length < 12) return;
      var ya = rr[0], yb = rr[rr.length - 1], gw = sg[1] - sg[0] + 1, gh = yb - ya + 1, src = new Float32Array(gw * gh);
      for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) src[y * gw + x] = m[(ya + y) * bw + sg[0] + x] * 255;
      var r10 = resize(src, gw, gh, 10, 16), bits = [];
      for (var k = 0; k < 160; k++) bits.push(r10[k] > 127 ? 1 : 0);
      out.push(bits);
    });
    return out;
  }
  function readNumber(im, box) {
    var gs = glyphs(im, box[0], box[1], box[2], box[3]); if (!gs.length) return null;
    var s = '';
    for (var i = 0; i < gs.length; i++) {
      var best = null, sc = 0;
      Object.keys(DIGITS).forEach(function (d) {
        DIGITS[d].forEach(function (t) { var e = 0; for (var k = 0; k < 160; k++) if (t[k] === gs[i][k]) e++; if (e / 160 > sc) { sc = e / 160; best = d; } });
      });
      if (sc < 0.85) return null;
      s += best;
    }
    return +s;
  }
  function digitScore(g, d) {
    var best = 0;
    (DIGITS[d] || []).forEach(function (t) { var e = 0; for (var k = 0; k < 160; k++) if (t[k] === g[k]) e++; if (e > best) best = e; });
    return best / 160;
  }
  function numberScore(gs, n) {            // how well glyphs gs spell the number n
    var s = String(n); if (gs.length !== s.length) return 0;
    var t = 0; for (var i = 0; i < s.length; i++) t += digitScore(gs[i], s[i]);
    return t / s.length;
  }
  // The card is known, so only its 6 (STR, TECH) pairs are possible: pick the
  // level whose digits fit the tile best (tolerates other screen scales).
  function levelFromTile(im, g, x, y) {
    var tab = STATS[g]; if (!tab) return null;
    var a = statBox(x, y, 0), b = statBox(x, y, 1);
    var gs = glyphs(im, a[0], a[1], a[2], a[3]), gt = glyphs(im, b[0], b[1], b[2], b[3]);
    if (!gs.length || !gt.length) return null;
    var sc = Object.keys(tab).map(function (k) {
      var st = k.split(','); return [(numberScore(gs, +st[0]) + numberScore(gt, +st[1])) / 2, tab[k]];
    }).sort(function (p, q) { return q[0] - p[0]; });
    if (sc[0][0] < 0.75 || (sc[1] && sc[0][0] - sc[1][0] < 0.02)) return null;
    return sc[0][1];
  }
  function statBox(x, y, which) { var cx = which === 0 ? x - 38 : x + 50; return [cx - 24, y - 75, cx + 24, y - 35]; }

  function starDesc(im, x, y) {
    var p = im.px, w = im.w, v = [], vals = [], bw = 32, bh = 34, xx, yy;
    for (yy = 0; yy < bh; yy++) for (xx = 0; xx < bw; xx++) {
      var i = ((y + 64 + yy) * w + x - 36 + xx) * 4; vals.push(p[i] * 0.5 + p[i + 1] * 0.5 - p[i + 2] * 0.5);
    }
    var sorted = vals.slice().sort(function (a, b) { return a - b; }), thr = sorted[Math.floor(sorted.length * 0.78)];
    var m = new Float32Array(bw * bh); for (var k = 0; k < vals.length; k++) m[k] = vals[k] > thr ? 1 : 0;
    var r = resize(m, bw, bh, 16, 16), mean = 0, q; for (q = 0; q < 256; q++) mean += r[q]; mean /= 256;
    var n = 0; for (q = 0; q < 256; q++) { r[q] -= mean; n += r[q] * r[q]; } n = Math.sqrt(n) + 1e-9;
    for (q = 0; q < 256; q++) r[q] /= n;
    return r;
  }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // images: array of {w,h,px} at width 940.  Returns {found: {g: level|null}, tiles: n}
  function read(images) {
    var tiles = [];
    images.forEach(function (img, ii) {
      var im = prepare(img);
      rows(im).forEach(function (y) {
        [COLS_LIST, COLS_BAR].forEach(function (cols, ci) {
          cols.forEach(function (x) {
            if (x + 80 > im.w || y + 100 > im.h) return;
            var id = identify(im, x + 4, y + 10);
            if (id.s < ICON_MIN) return;
            var lv = levelFromTile(im, id.g, x, y);
            tiles.push({ img: ii, g: id.g, s: id.s, x: x, y: y, lv: lv, star: starDesc(im, x, y), bar: ci === 1 });
          });
        });
      });
    });
    // the bar and list columns overlap: keep the better icon match per spot
    tiles.sort(function (a, b) { return b.s - a.s; });
    var kept = [];
    tiles.forEach(function (t) { if (!kept.some(function (k) { return k.img === t.img && k.y === t.y && Math.abs(k.x - t.x) < 60; })) kept.push(t); });
    // learn star glyphs from tiles of known level, then read the rest
    var ref = {};
    kept.forEach(function (t) { if (t.lv) (ref[t.lv] = ref[t.lv] || []).push(t.star); });
    kept.forEach(function (t) {
      if (t.lv || !STATS[t.g]) return;
      var sc = Object.keys(ref).map(function (l) { return [Math.max.apply(null, ref[l].map(function (r) { return dot(t.star, r); })), +l]; })
        .sort(function (a, b) { return b[0] - a[0]; });
      if (sc.length && sc[0][0] >= 0.8 && (sc.length < 2 || sc[0][0] - sc[1][0] >= 0.1)) t.lv = sc[0][1];
    });
    var found = {};
    kept.forEach(function (t) {
      if (!STATS[t.g]) return;                        // green / other plans: not in the 24
      if (!(t.g in found) || (t.lv && !found[t.g])) found[t.g] = t.lv;
    });
    return { found: found, tiles: kept.length };
  }
  return { init: init, read: read, W: W, _identify: identify, _prepare: prepare, _rows: rows,
           _readNumber: readNumber, _levelFromTile: levelFromTile, _statBox: statBox, _glyphs: glyphs };
})();
if (typeof module !== 'undefined') module.exports = SCAN;
