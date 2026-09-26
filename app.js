// app.js - War for the Crown deck finder, mixed card levels.
// Every deck is scored live by the game's own Training Plan logic (tp_engine.js,
// shipped inside data.js as WOTC.engine) in Web Workers, for the exact levels picked.
(function () {
  var D = window.WOTC;
  var elRes = document.getElementById('results');
  if (!D || !D.engine) { elRes.innerHTML = '<li class="empty">data.js failed to load — run <code>python3 build_web_data.py</code>.</li>'; return; }

  var CARDS = D.cards, N = CARDS.length, TIERS = ['Gold', 'Purple', 'Blue'];
  var nf = new Intl.NumberFormat('en-US');
  var levels = new Array(N).fill(0);   // 0 = not owned, 1..6
  var topN = 10, rankBy = 'avg';

  /* ---------- worker pool ---------- */
  var cfg = { g: {} };
  CARDS.forEach(function (c) { cfg.g[c.g] = { t: c.tm, pos: c.pos, lv: c.lv }; });
  var workerSrc = D.engine + '\nTP.init(' + JSON.stringify(cfg) + ');\n' +
    'onmessage=function(e){var m=e.data,r;' +
    'if(m.t==="calc"){var d=m.d,n=d.length/10,o=new Float64Array(n*3);' +
    'for(var i=0;i<n;i++){var dk=[];for(var j=0;j<5;j++)dk.push({g:d[i*10+j*2],lv:d[i*10+j*2+1]});' +
    'var x=TP.calc(dk);o[i*3]=x[0];o[i*3+1]=x[1];o[i*3+2]=x[2];}postMessage({id:m.id,r:o},[o.buffer]);}' +
    'else{var dk2=[];for(var k=0;k<5;k++)dk2.push({g:m.d[k*2],lv:m.d[k*2+1]});r=TP.exact(dk2);postMessage({id:m.id,r:r});}};';
  var url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
  var NW = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4)));
  var pool = [], queue = [], pending = {}, seq = 0;
  for (var w = 0; w < NW; w++) {
    var wk = new Worker(url); wk.busy = false;
    wk.onmessage = (function (wk) { return function (e) { var p = pending[e.data.id]; delete pending[e.data.id]; wk.busy = false; pump(); p(e.data.r); }; })(wk);
    pool.push(wk);
  }
  function pump() {
    for (var i = 0; i < pool.length && queue.length; i++) if (!pool[i].busy) {
      var job = queue.shift(); pool[i].busy = true; pending[job.msg.id] = job.res;
      pool[i].postMessage(job.msg, job.tr || []);
    }
  }
  function run(msg, tr) { return new Promise(function (res) { msg.id = ++seq; queue.push({ msg: msg, res: res, tr: tr }); pump(); }); }

  /* ---------- per-set pruning bounds ---------- */
  // D.bounds.setAvg/setMax: for every Destiny/Airdrop card set (in combinations order
  // over the sorted group ids), the max over all 7,776 level combos of
  // exact / one-pass value, x1e4 rounded up. Falls back to the global ratio.
  var RATIO = {};
  (function () {
    var b = D.bounds; if (!b.setAvg) return;
    var gs = CARDS.map(function (c) { return c.g; }).sort(function (a, b) { return a - b; }), k = 0;
    for (var a = 0; a < 24; a++) for (var c = a + 1; c < 24; c++) for (var d = c + 1; d < 24; d++)
      for (var e = d + 1; e < 24; e++) for (var f = e + 1; f < 24; f++) {
        var s = [gs[a], gs[c], gs[d], gs[e], gs[f]];
        if (s.indexOf(207) < 0 && s.indexOf(405) < 0) continue;
        RATIO[s.join(',')] = { avg: b.setAvg[k] / 1e4, max: b.setMax[k] / 1e4 }; k++;
      }
  })();
  function ratio(s, key) {
    var r = RATIO[s.map(function (x) { return CARDS[x].g; }).join(',')];
    return r ? r[key] : D.bounds[key];
  }

  /* ---------- search ---------- */
  // Owned cards in canonical input order (group id ascending). Decks without Destiny/
  // Airdrop get the game's exact number from one pass; with them, the ranked figures
  // are over all 120 slot orders, and the one-pass value times D.bounds (max ratio
  // over every deck x level combo, from the exhaustive sweep) bounds them from above.
  function search(lv, must, want, key, gen) {
    var own = [];
    for (var i = 0; i < N; i++) if (lv[i] > 0) own.push(i);
    own.sort(function (a, b) { return CARDS[a].g - CARDS[b].g; });
    var sets = [];
    var m = own.length;
    for (var a = 0; a < m; a++) for (var b = a + 1; b < m; b++) for (var c = b + 1; c < m; c++)
      for (var d = c + 1; d < m; d++) for (var e = d + 1; e < m; e++) {
        var s = [own[a], own[b], own[c], own[d], own[e]];
        if (must < 0 || s.indexOf(must) >= 0) sets.push(s);
      }
    if (!sets.length) return Promise.resolve([]);
    var flat = function (s) { var o = []; s.forEach(function (k) { o.push(CARDS[k].g, lv[k]); }); return o; };
    var chunk = Math.ceil(sets.length / (NW * 3)), jobs = [];
    for (var st = 0; st < sets.length; st += chunk) {
      var arr = new Int16Array(Math.min(chunk, sets.length - st) * 10), q = 0;
      for (var t = st; t < st + chunk && t < sets.length; t++) flat(sets[t]).forEach(function (x) { arr[q++] = x; });
      jobs.push(run({ t: 'calc', d: arr }, [arr.buffer]));
    }
    return Promise.all(jobs).then(function (parts) {
      if (gen !== GEN) return null;
      var rows = [], idx = 0;
      parts.forEach(function (r) {
        for (var k = 0; k < r.length; k += 3) {
          var s = sets[idx++], sp = s.some(function (x) { return CARDS[x].g === 207 || CARDS[x].g === 405; });
          var val = key === 'avg' ? r[k + 2] : r[k + 1];
          rows.push({ s: s, sp: sp, up: sp ? val * ratio(s, key) : val,
                      ex: sp ? null : { avg: r[k + 2], lo: r[k], hi: r[k + 1] } });
        }
      });
      rows.sort(function (x, y) { return y.up - x.up; });
      var top = [], pos = 0;
      var thr = function () { return top.length >= want ? top[want - 1].v : -Infinity; };
      var ins = function (row) { row.v = key === 'avg' ? row.ex.avg : row.ex.hi; top.push(row);
        top.sort(function (x, y) { return y.v - x.v; }); if (top.length > want) top.length = want; };
      function step() {
        if (gen !== GEN) return null;
        var batch = [];
        while (pos < rows.length && rows[pos].up >= thr() && batch.length < NW) {
          var r = rows[pos++];
          if (r.ex) ins(r); else batch.push(r);
        }
        if (!batch.length) return top;
        return Promise.all(batch.map(function (r) {
          return run({ t: 'exact', d: flat(r.s) }).then(function (x) { r.ex = x; });
        })).then(function () { batch.forEach(ins); return step(); });
      }
      var res = step();
      res = res && res.then ? res : Promise.resolve(res);
      return res.then(function (t2) { if (t2) t2.total = sets.length; return t2; });
    });
  }

  /* ---------- state ---------- */
  function readInitial() {
    var h = location.hash.replace(/^#/, '');
    if (/^[0-6]{24}$/.test(h)) return h.split('').map(Number);
    if (/^[0-9a-z]+$/.test(h)) {                      // old links: owned bitmask -> Lv 6
      var v = parseInt(h, 36);
      if (!isNaN(v) && v >= 0 && v < (1 << N)) return levels.map(function (_, i) { return v & (1 << i) ? 6 : 0; });
    }
    try { var s = localStorage.getItem('wotc.levels'); if (s && /^[0-6]{24}$/.test(s)) return s.split('').map(Number); } catch (e) {}
    return levels.slice();
  }
  function persist() {
    var s = levels.join('');
    try { localStorage.setItem('wotc.levels', s); } catch (e) {}
    history.replaceState(null, '', /[1-6]/.test(s) ? '#' + s : location.pathname);
  }

  /* ---------- picker ---------- */
  var picker = document.getElementById('picker'), cardEls = [];
  TIERS.forEach(function (tier) {
    var idxs = []; for (var i = 0; i < N; i++) if (CARDS[i].r === tier) idxs.push(i);
    var sec = document.createElement('div'); sec.className = 'tier';
    var head = document.createElement('div'); head.className = 'tier-head';
    head.innerHTML = '<span class="tier-name ' + tier + '">' + tier + '</span>';
    var all = document.createElement('button'); all.className = 'mini'; all.textContent = 'All ' + tier.toLowerCase() + ' Lv 6';
    all.onclick = function () {
      var full = idxs.every(function (i) { return levels[i] === 6; });
      idxs.forEach(function (i) { levels[i] = full ? 0 : 6; }); render();
    };
    head.appendChild(all); sec.appendChild(head);
    var grid = document.createElement('div'); grid.className = 'grid';
    idxs.forEach(function (i) {
      var c = CARDS[i], el = document.createElement('div');
      el.className = 'card ' + tier; el.title = c.e;
      el.innerHTML = (c.img ? '<img alt="" src="' + c.img + '">' : '') +
        '<span class="txt"><span class="nm"></span><span class="st"></span><span class="lvbar"></span></span>';
      el.querySelector('.nm').textContent = c.n;
      var bar = el.querySelector('.lvbar');
      for (var l = 0; l <= 6; l++) {
        var b = document.createElement('button'); b.type = 'button';
        b.innerHTML = '<span>' + (l ? l : '–') + '</span>';
        b.title = l ? 'Level ' + l : 'Not owned';
        b.onclick = (function (l) { return function () { levels[i] = l; render(); }; })(l);
        bar.appendChild(b);
      }
      grid.appendChild(el); cardEls[i] = el;
    });
    sec.appendChild(grid); picker.appendChild(sec);
  });

  function seg(id, cb) {
    var el = document.getElementById(id);
    el.addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; cb(b.dataset.v); render(); });
    return function (cur) { [].forEach.call(el.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === String(cur))); }); };
  }
  var paintTopN = seg('topN', function (v) { topN = +v; });
  var paintRank = seg('rankBy', function (v) { rankBy = v; });
  document.getElementById('selAll').onclick = function () { levels = levels.map(function () { return 6; }); render(); };
  document.getElementById('selNone').onclick = function () { levels = levels.map(function () { return 0; }); render(); };
  document.getElementById('copyLink').onclick = function () {
    var btn = this, done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy shareable link'; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, done); else done();
  };

  /* ---------- import from screenshots ---------- */
  // Everything runs in this page: the images never leave the device.
  if (window.SCAN && D.scan) {
    SCAN.init(D.scan, CARDS);
    var fileIn = document.getElementById('shotFile'), note = document.getElementById('importNote');
    document.getElementById('importShot').onclick = function () { fileIn.click(); };
    fileIn.onchange = function () {
      var files = [].slice.call(fileIn.files); fileIn.value = '';
      if (!files.length) return;
      note.hidden = false; note.textContent = 'Reading ' + files.length + ' screenshot' + (files.length > 1 ? 's' : '') + '…';
      Promise.all(files.map(function (f) {
        return new Promise(function (res, rej) {
          var img = new Image(); img.onload = function () { res(img); }; img.onerror = rej;
          img.src = URL.createObjectURL(f);
        });
      })).then(function (imgs) {
        setTimeout(function () {                     // let the note paint first
          var data = imgs.map(function (img) {
            var h = Math.round(img.naturalHeight * SCAN.W / img.naturalWidth);
            var c = document.createElement('canvas'); c.width = SCAN.W; c.height = h;
            var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, SCAN.W, h);
            URL.revokeObjectURL(img.src);
            return { w: SCAN.W, h: h, px: ctx.getImageData(0, 0, SCAN.W, h).data };
          });
          var r = SCAN.read(data), byG = {}, got = [], unsure = [];
          CARDS.forEach(function (c, i) { byG[c.g] = i; });
          if (document.getElementById('shotAll').checked && Object.keys(r.found).length)
            levels = levels.map(function () { return 0; });
          Object.keys(r.found).forEach(function (g) {
            var i = byG[g], lv = r.found[g];
            if (i === undefined) return;
            if (lv) { levels[i] = lv; got.push(CARDS[i].n + ' Lv' + lv); }
            else { levels[i] = levels[i] || 1; unsure.push(CARDS[i].n); }
          });
          note.textContent = got.length || unsure.length
            ? 'Read ' + (got.length + unsure.length) + ' plan' + (got.length + unsure.length === 1 ? '' : 's') + ': ' + got.join(', ') +
              (unsure.length ? '. Level not readable — please set: ' + unsure.join(', ') : '') + '. Check the levels below.'
            : 'No plans recognised. Use screenshots of the Training Plan screen (All Plans list), full width, portrait.';
          render();
        }, 30);
      }).catch(function () { note.textContent = 'Could not open that image.'; });
    };
  } else document.querySelector('.import').hidden = true;

  /* ---------- render ---------- */
  function deckRow(r, place) {
    var li = document.createElement('li');
    var rank = document.createElement('div'); rank.className = 'rank'; rank.textContent = '#' + place;
    var body = document.createElement('div'); body.className = 'deck-body';
    var chips = document.createElement('div'); chips.className = 'icons';
    r.s.slice().sort(function (a, b) { return a - b; }).forEach(function (k) {
      var c = CARDS[k], s = document.createElement('span');
      s.className = 'ico ' + c.r; s.title = c.n + ' Lv' + levels[k] + ' — ' + c.e;
      s.innerHTML = (c.img ? '<img alt="">' : '') + '<b></b><em></em>';
      if (c.img) s.querySelector('img').src = c.img;
      s.querySelector('b').textContent = 'Lv' + levels[k];
      s.querySelector('em').textContent = c.n;
      chips.appendChild(s);
    });
    body.appendChild(chips);
    var meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = (rankBy === 'avg' ? 'range ' : 'avg ' + nf.format(Math.round(r.ex.avg)) + ' &middot; range ') +
      nf.format(r.ex.lo) + '&ndash;' + nf.format(r.ex.hi) + (r.sp ? ' &middot; over all 120 slot orders' : '');
    body.appendChild(meta);
    var score = document.createElement('div'); score.className = 'score';
    score.innerHTML = '<b>' + nf.format(Math.round(r.v)) + '</b><span>' + (rankBy === 'avg' ? 'avg power' : 'top power') + '</span>';
    li.appendChild(rank); li.appendChild(body); li.appendChild(score);
    return li;
  }

  var GEN = 0;
  function render() {
    persist(); paintTopN(topN); paintRank(rankBy);
    var have = 0;
    for (var i = 0; i < N; i++) {
      var c = CARDS[i], el = cardEls[i], l = levels[i];
      if (l) have++;
      el.classList.toggle('on', !!l);
      el.style.opacity = l ? '' : '.62';
      var row = c.lv[(l || 6) - 1];
      el.querySelector('.st').textContent = row[0] + ' STR / ' + row[1] + ' TECH' + (l ? '' : ' (Lv 6)');
      [].forEach.call(el.querySelector('.lvbar').children, function (b, k) { b.setAttribute('aria-pressed', String(k === l)); });
    }
    document.getElementById('ownedLine').textContent = have === 0 ?
      'Nothing selected yet — set the level of each card you own.' : have + ' of ' + N + ' cards owned.';
    var gen = ++GEN, count = document.getElementById('count');
    elRes.innerHTML = ''; document.getElementById('upgradePanel').hidden = true;
    if (have < 5) { count.textContent = ''; elRes.innerHTML = '<li class="empty">Own at least 5 cards to see deck suggestions.</li>'; return; }
    count.textContent = 'Computing…';
    var t0 = performance.now(), lv = levels.slice(), key = rankBy, want = topN;
    search(lv, -1, want, key, gen).then(function (top) {
      if (!top || gen !== GEN) return;
      count.innerHTML = '<b>' + nf.format(top.total) + '</b> buildable deck' + (top.total === 1 ? '' : 's') +
        ' &middot; scored in ' + Math.round(performance.now() - t0) + ' ms.';
      elRes.innerHTML = '';
      top.forEach(function (r, k) { elRes.appendChild(deckRow(r, k + 1)); });
      upgrades(lv, key, top[0].v, gen);
    });
  }

  // Levelling one card only changes decks that contain it, and a level-up never makes
  // a deck worse, so the new best is max(current best, best deck containing that card).
  function upgrades(lv, key, base, gen) {
    var cand = [];
    for (var i = 0; i < N; i++) if (lv[i] < 6) cand.push(i);
    var rows = [];
    (function next() {
      if (gen !== GEN) return;
      if (!cand.length) return show();
      var i = cand.shift(), nl = lv.slice(); nl[i]++;
      search(nl, i, 1, key, gen).then(function (t) {
        if (t && t.length && t[0].v > base) rows.push({ i: i, to: t[0].v, gain: t[0].v - base, lv: nl[i] });
        next();
      });
    })();
    function show() {
      if (!rows.length) return;
      rows.sort(function (a, b) { return b.gain - a.gain; });
      var box = document.getElementById('upgrades'); box.innerHTML = '';
      rows.slice(0, 5).forEach(function (r) {
        var d = document.createElement('div'); d.className = 'upg'; var c = CARDS[r.i];
        d.innerHTML = '<span class="chip ' + c.r + '"></span><span style="color:var(--ink-faint)">best deck &rarr; ' +
          nf.format(Math.round(r.to)) + '</span><span class="delta">+' + nf.format(Math.round(r.gain)) + '</span>';
        d.querySelector('.chip').textContent = c.n + (r.lv === 1 ? ' (unlock Lv1)' : ' → Lv' + r.lv);
        box.appendChild(d);
      });
      document.getElementById('upgradePanel').hidden = false;
    }
  }

  var a = D.accuracy;
  document.getElementById('footer').innerHTML =
    'Power = total Strength &times; total Technique after every plan effect resolves. Every deck is scored live, ' +
    'at the exact levels you set, by the game&rsquo;s own Training Plan logic extracted from the client ' +
    '(ported to JavaScript and checked against the original on thousands of mixed-level decks' +
    (a ? '; on all ' + a.n + ' decks measured in-game it reproduces the displayed min, max and average exactly' : '') + '). ' +
    '<b>Average</b> is the same average the game shows on its training screen; <b>top power</b> is the best roll the game can display. ' +
    'For decks with Airdrop or Destiny the exact figure shifts a little with how you order the five slots; the figures shown are over all 120 orderings.';

  levels = readInitial();
  render();
})();
