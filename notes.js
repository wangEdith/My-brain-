/* W · 笔记
   笔记本、多页、手写笔/荧光笔/橡皮/套索、图片/文字/便利贴、PDF 批注、导出，以及套索圈选直接问 AI */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var Q = window.QW;
  var el = Q.el;

  var PW = 1000, A4 = 1414;
  var FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
  var COLORS = ['#1b1b1b', '#1d4ed8', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#7a4a21', '#6b7280'];
  var HL_COLORS = ['#ffd43b', '#8ce99a', '#ffa8d4', '#74c0fc', '#ffc078'];
  var STICKY = ['#fff3a3', '#ffd1e3', '#c9f2cf', '#cfe6ff', '#ffe0b8'];
  var PEN_SIZES = [2, 3.6, 6, 10], HL_SIZES = [16, 26, 38], ER_SIZES = [10, 22, 40], TEXT_SIZES = [22, 30, 42];
  var TPLS = [['blank', '空白'], ['lined', '横线'], ['grid', '方格'], ['dots', '点阵']];
  var SPINES = ['#2346c8', '#c2410c', '#15803d', '#7c3aed', '#be123c', '#0e7490'];
  var TOOLS = ['read', 'pen', 'hl', 'eraser', 'lasso', 'text', 'sticky'];

  var S = {
    nb: null, pages: [], idx: 0, page: null,
    tool: 'pen',
    cfg: { pen: { color: COLORS[0], size: 1 }, hl: { color: HL_COLORS[0], size: 1 }, eraser: { size: 1 }, text: { color: COLORS[0], size: 1 }, sticky: { color: STICKY[0] } },
    zoom: 1, s: 1, dpr: 1, bgTok: 0,
    fingerAlways: false, penSeen: false, penT: 0, vIdx: 0, lv: 0,
    history: [], future: [], dirty: false, saveT: 0, thumbT: 0, thumbPending: false,
    sel: null, selObj: null, clip: null
  };
  try { var ip = JSON.parse(localStorage.getItem('quanwen.input') || '{}'); S.penSeen = !!ip.penSeen; S.fingerAlways = !!ip.fingerAlways; } catch (e) {}
  function saveInput() { try { localStorage.setItem('quanwen.input', JSON.stringify({ penSeen: S.penSeen, fingerAlways: S.fingerAlways })); } catch (e) {} }
  var cur = null, rafT = 0;
  var live = $('liveC'), stage = $('nStage'), wrap = $('pageWrap'), objsLayer = $('objs');

  /* ================= 小工具 ================= */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function toBlob(c, type, q) { return new Promise(function (res) { c.toBlob(res, type, q); }); }
  var bmCache = new WeakMap();
  function bitmapOf(blob) {
    if (!bmCache.has(blob)) bmCache.set(blob, createImageBitmap(blob));
    return bmCache.get(blob);
  }
  var urlCache = new WeakMap(), urlList = [];
  function urlOf(b) {
    var u = urlCache.get(b);
    if (!u) { u = URL.createObjectURL(b); urlCache.set(b, u); urlList.push(u); }
    return u;
  }
  function releaseUrls() { urlList.forEach(function (u) { URL.revokeObjectURL(u); }); urlList = []; urlCache = new WeakMap(); }
  function fmtDay(ts) { return new Date(ts).toLocaleDateString('zh-CN'); }

  /* ---------- 对话框 ---------- */
  function dialog(build) {
    var box = $('nDialogBox'); box.textContent = ''; box.className = 'sheetbox dlg';
    build(box); $('nDialog').hidden = false;
  }
  function closeDialog() { $('nDialog').hidden = true; $('nDialogBox').textContent = ''; }
  $('nDialog').addEventListener('click', function (e) { if (e.target === $('nDialog')) closeDialog(); });

  /* ================= 页面模板与绘制 ================= */
  function paintTemplate(ctx, tpl, w, h) {
    var x, y;
    if (tpl === 'lined') {
      ctx.strokeStyle = '#c9d6e8'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (y = 110; y < h - 30; y += 44) { ctx.moveTo(60, y); ctx.lineTo(w - 60, y); }
      ctx.stroke();
      ctx.strokeStyle = '#f0b3b3'; ctx.beginPath(); ctx.moveTo(112, 60); ctx.lineTo(112, h - 60); ctx.stroke();
    } else if (tpl === 'grid') {
      ctx.strokeStyle = '#d5deeb'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (x = 40; x < w; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (y = 40; y < h; y += 40) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else if (tpl === 'dots') {
      ctx.fillStyle = '#9fadc2';
      for (x = 40; x < w; x += 40) for (y = 40; y < h; y += 40) ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
  }

  function strokePath(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length < 3) { for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); return; }
    for (var j = 1; j < pts.length - 1; j++) {
      var mx = (pts[j][0] + pts[j + 1][0]) / 2, my = (pts[j][1] + pts[j + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[j][0], pts[j][1], mx, my);
    }
    var l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
  }
  function drawStroke(ctx, st) {
    var pts = st.pts; if (!pts.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
    if (st.t === 'h') {
      ctx.globalAlpha = 0.38; ctx.lineWidth = st.w;
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], st.w / 2, 0, 6.2832); ctx.fill(); }
      else { strokePath(ctx, pts); ctx.stroke(); }
      ctx.globalAlpha = 1; return;
    }
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], Math.max(0.7, st.w * (0.5 + pts[0][2]) / 2), 0, 6.2832); ctx.fill(); return; }
    var prev = pts[0], pm = { x: pts[0][0], y: pts[0][1] };
    for (var i = 1; i < pts.length; i++) {
      var c = pts[i], m = { x: (prev[0] + c[0]) / 2, y: (prev[1] + c[1]) / 2 };
      ctx.lineWidth = st.w * (0.5 + (prev[2] + c[2]) / 2);
      ctx.beginPath(); ctx.moveTo(pm.x, pm.y); ctx.quadraticCurveTo(prev[0], prev[1], m.x, m.y); ctx.stroke();
      pm = m; prev = c;
    }
    ctx.lineWidth = st.w * (0.5 + prev[2]);
    ctx.beginPath(); ctx.moveTo(pm.x, pm.y); ctx.lineTo(prev[0], prev[1]); ctx.stroke();
  }
  /* 荧光笔先画，笔迹压在上面 */
  function paintStrokes(ctx, list, moving) {
    ['h', 'p'].forEach(function (pass) {
      for (var i = 0; i < list.length; i++) {
        var st = list[i];
        if (st.t !== pass) continue;
        if (moving && moving.ids.has(st.id)) { ctx.save(); ctx.translate(moving.dx, moving.dy); drawStroke(ctx, st); ctx.restore(); }
        else drawStroke(ctx, st);
      }
    });
  }

  /* ---------- 文字排版（画布导出用，和页面里的文字框尽量一致） ---------- */
  function wrapLines(ctx, text, w) {
    var lines = [];
    String(text || '').split('\n').forEach(function (par) {
      var toks = par.match(/[A-Za-z0-9'’\-.,;:!?()\/"%$&+=<>]+\s*|\s+|[^\x00-\x7f]/g) || [''];
      var line = '';
      toks.forEach(function (t) {
        var test = line + t;
        if (ctx.measureText(test.replace(/\s+$/, '')).width > w && line) { lines.push(line); line = t.replace(/^\s+/, ''); }
        else line = test;
      });
      lines.push(line);
    });
    return lines;
  }
  function drawTextBlock(ctx, text, x, y, w, size, color) {
    ctx.font = size + 'px ' + FONT; ctx.fillStyle = color; ctx.textBaseline = 'top';
    var lines = wrapLines(ctx, text, w);
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * size * 1.4); });
    return lines.length * size * 1.4;
  }
  async function paintObjects(ctx, objs) {
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.type === 'image') {
        try { ctx.drawImage(await bitmapOf(o.blob), o.x, o.y, o.w, o.h); } catch (e) {}
      } else if (o.type === 'sticky') {
        ctx.font = o.size + 'px ' + FONT;
        var n = wrapLines(ctx, o.text, o.w - 24).length;
        var h = Math.max(o.h, n * o.size * 1.4 + 20);
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        ctx.fillStyle = o.color; ctx.fillRect(o.x, o.y, o.w, h); ctx.restore();
        drawTextBlock(ctx, o.text, o.x + 12, o.y + 10, o.w - 24, o.size, inkOn(o.color));
      } else if (o.type === 'tape') {
        ctx.save(); ctx.globalAlpha = 0.65; ctx.fillStyle = o.color; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.restore();
      } else if (o.type === 'emoji') {
        ctx.save(); ctx.font = (o.h * 0.8) + 'px ' + FONT + ',"Apple Color Emoji","Noto Color Emoji"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000'; ctx.fillText(o.text, o.x + o.w / 2, o.y + o.h / 2 + o.h * 0.04); ctx.restore();
      } else if (o.type === 'text') {
        drawTextBlock(ctx, o.text, o.x + 4, o.y + 2, o.w - 8, o.size, o.color);
      }
    }
  }
  /* 把页面（或其中一块）画成图片，用于缩略图、导出、问 AI */
  async function renderCanvas(page, reg, k) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(reg.w * k)); c.height = Math.max(1, Math.round(reg.h * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(k, 0, 0, k, -reg.x * k, -reg.y * k);
    if (page.bg) { try { ctx.drawImage(await bitmapOf(page.bg), 0, 0, PW, page.h); } catch (e) {} }
    else paintTemplate(ctx, page.tpl, PW, page.h);
    await paintObjects(ctx, page.objects);
    paintStrokes(ctx, page.strokes, null);
    return c;
  }

  /* ================= 数据 ================= */
  function newPage(nb, opt) {
    opt = opt || {};
    return { id: 'pg-' + DB.uid(), type: 'page', nb: nb.id, ts: Date.now(), updated: Date.now(), tpl: opt.tpl || nb.tpl || 'blank',
      w: PW, h: opt.h || A4, bg: opt.bg || null, strokes: [], objects: [], thumb: null };
  }
  async function createNotebook(title, tpl) {
    var nb = { id: 'nb-' + DB.uid(), type: 'notebook', title: title, ts: Date.now(), updated: Date.now(), tpl: tpl,
      color: SPINES[Math.floor(Math.random() * SPINES.length)], pageIds: [], lastIdx: 0 };
    var p = newPage(nb); nb.pageIds.push(p.id);
    await DB.put(p); await DB.put(nb);
    return nb;
  }

  var saveIndT = 0;
  function saveInd(msg, bad) {
    var e = $('saveInd'); if (!e) return;
    e.textContent = msg; e.classList.toggle('bad', !!bad);
    clearTimeout(saveIndT);
    if (!bad && msg) saveIndT = setTimeout(function () { e.textContent = ''; }, 2500);
  }
  function markDirty() {
    S.dirty = true; S.thumbPending = true; saveInd('保存中…');
    clearTimeout(S.saveT); S.saveT = setTimeout(saveNow, 450);
    clearTimeout(S.thumbT); S.thumbT = setTimeout(makeThumb, 2500);
  }
  var saving = Promise.resolve();
  function saveNow() {
    clearTimeout(S.saveT);
    if (!S.dirty || !S.page || !S.nb) return saving;
    S.dirty = false;
    var p = S.page, nb = S.nb; p.updated = Date.now(); nb.updated = Date.now();
    saving = saving.then(async function () {
      try { await DB.put(p); await DB.put(nb); saveInd('已保存到本机 ✓'); }
      catch (e) { if (p === S.page) S.dirty = true; saveInd('没存上', true); Q.toast('笔记没存上：' + Q.errMsg(e)); }
    });
    return saving;
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  async function makeThumb() {
    clearTimeout(S.thumbT);
    var p = S.page; if (!p || !S.thumbPending) return;
    S.thumbPending = false;
    try {
      var c = await renderCanvas(p, { x: 0, y: 0, w: PW, h: p.h }, 240 / PW);
      p.thumb = await toBlob(c, 'image/jpeg', 0.7);
      await DB.put(p);
    } catch (e) {}
  }

  /* ================= 撤销 / 重做 ================= */
  function snap() { return { strokes: S.page.strokes, objects: S.page.objects.map(function (o) { return Object.assign({}, o); }) }; }
  function pushHistory() {
    S.history.push(snap()); if (S.history.length > 80) S.history.shift();
    S.future = []; updateUndo();
  }
  function restore(sn) {
    S.page.strokes = sn.strokes;
    S.page.objects = sn.objects.map(function (o) { return Object.assign({}, o); });
    S.sel = null; S.selObj = null; $('selBar').hidden = true;
    redrawInk(); buildObjects(); paintLive(); markDirty(); updateUndo();
  }
  function undo() { if (!S.history.length) return; S.future.push(snap()); restore(S.history.pop()); }
  function redo() { if (!S.future.length) return; S.history.push(snap()); restore(S.future.pop()); }
  function updateUndo() { $('nUndo').disabled = !S.history.length; $('nRedo').disabled = !S.future.length; }

  /* ================= 版面：所有页面竖着连成一长条，直接往下滑 ================= */
  var strip = $('strip'), slots = [], tops = [0], GAP = 14, visSet = new Set(), pvIO = null, actT = 0;
  var hmap = {};
  function cssWOf() { return Math.round(Math.max(240, stage.clientWidth - 24) * S.zoom); }
  function stripTop() { return strip.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop; }
  function clearStrip() {
    if (pvIO) slots.forEach(function (s) { pvIO.unobserve(s.el); });
    visSet.clear(); slots = []; tops = [0]; strip.textContent = '';
  }
  function buildStrip() {
    clearStrip();
    if (!S.page) return;
    S.pages.forEach(function (p, i) {
      var d = el('div', 'slot' + (i === S.idx ? ' act' : '')); d.dataset.i = i;
      strip.appendChild(d); slots.push({ el: d, pv: null, ver: -1, busy: false });
    });
    slots[S.idx].el.appendChild(wrap);
    if (!pvIO && 'IntersectionObserver' in window) {
      pvIO = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          var i = +en.target.dataset.i;
          if (en.isIntersecting) visSet.add(i); else { visSet.delete(i); dropPv(i); }
        });
        renderVisible();
      }, { root: stage, rootMargin: '700px 0px' });
    }
    slots.forEach(function (s, i) { if (pvIO) pvIO.observe(s.el); else visSet.add(i); });
  }
  function dropPv(i) { var s = slots[i]; if (s && s.pv) { s.pv.width = s.pv.height = 1; s.pv.remove(); s.pv = null; } if (s) s.ver = -1; }
  function renderVisible() { visSet.forEach(function (i) { if (i !== S.idx) paintPv(i); }); }
  async function paintPv(i) {
    var s = slots[i], p = S.pages[i];
    if (!s || !p || s.ver === S.lv || s.busy || i === S.idx) return;
    var ver = S.lv; s.busy = true;
    try {
      var cssW = Math.round(PW * S.s), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var cssH = Math.round(p.h * S.s);
      if (cssW * cssH * dpr * dpr > 6e6) dpr = Math.sqrt(6e6 / (cssW * cssH));
      var c = await renderCanvas(p, { x: 0, y: 0, w: PW, h: p.h }, cssW * dpr / PW);
      if (slots[i] === s && ver === S.lv && i !== S.idx) {
        if (s.pv) { s.pv.width = s.pv.height = 1; s.pv.remove(); }
        c.className = 'pv'; s.el.appendChild(c); s.pv = c; s.ver = ver;
      }
    } catch (e) {}
    s.busy = false;
    if (slots[i] === s && s.ver !== S.lv && visSet.has(i) && i !== S.idx) paintPv(i);
  }
  function layoutStrip() {
    var cssW = cssWOf(); if (cssW < 100) return false;
    if (slots.length !== S.pages.length) buildStrip();
    var s = cssW / PW; S.s = s; S.lv++;
    var gap = Math.max(6, Math.round(GAP * S.zoom)), y = 0;
    strip.style.width = cssW + 'px';
    tops = [];
    S.pages.forEach(function (p, i) {
      var h = Math.round(p.h * s), sl = slots[i];
      sl.el.style.width = cssW + 'px'; sl.el.style.height = h + 'px';
      sl.el.style.marginBottom = (i === S.pages.length - 1 ? 0 : gap) + 'px';
      tops.push(y); y += h + gap;
    });
    tops.push(y);
    renderVisible();
    return true;
  }
  function layoutActive() {
    var p = S.page; if (!p) return;
    var cssW = Math.round(PW * S.s), cssH = Math.round(p.h * S.s);
    wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cssW * cssH * dpr * dpr > 9e6) dpr = Math.sqrt(9e6 / (cssW * cssH));
    ['bgC', 'inkC', 'liveC'].forEach(function (id) {
      var c = $(id); c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    });
    S.dpr = $('bgC').width / cssW;
    drawBg(); redrawInk(); buildObjects(); paintLive(); updateSelBar();
  }
  function layout() {
    if (!S.page || $('nEditor').hidden) return;
    if (!layoutStrip()) return;
    layoutActive();
  }
  async function drawBg() {
    var tok = ++S.bgTok, p = S.page, c = $('bgC'), ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    var k = S.s * S.dpr; ctx.setTransform(k, 0, 0, k, 0, 0);
    if (p.bg) { try { var bm = await bitmapOf(p.bg); if (tok !== S.bgTok) return; ctx.drawImage(bm, 0, 0, PW, p.h); } catch (e) {} }
    else paintTemplate(ctx, p.tpl, PW, p.h);
  }
  function redrawInk(moving) {
    var c = $('inkC'), ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    var k = S.s * S.dpr; ctx.setTransform(k, 0, 0, k, 0, 0);
    paintStrokes(ctx, S.page.strokes, moving || null);
  }
  function inkAdd(st) {
    var c = $('inkC'), ctx = c.getContext('2d'), k = S.s * S.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0); drawStroke(ctx, st);
  }

  /* 切换“正在书写的那一页”：只有这一页有画布，其余页是现成的图片 */
  function activate(i) {
    i = clamp(i, 0, S.pages.length - 1);
    if (!S.page || i === S.idx || !S.pages[i] || !slots[i]) return;
    saveNow(); if (S.thumbPending) makeThumb();
    var old = slots[S.idx];
    if (old) {
      try {
        var bc = $('bgC'), ic = $('inkC'), sn = document.createElement('canvas');
        sn.width = bc.width; sn.height = bc.height;
        var sx = sn.getContext('2d'); sx.drawImage(bc, 0, 0); sx.drawImage(ic, 0, 0);
        if (old.pv) old.pv.remove();
        sn.className = 'pv'; old.el.appendChild(sn); old.pv = sn; old.ver = -1;
      } catch (e) {}
      old.el.classList.remove('act');
    }
    hmap[S.page.id] = { h: S.history, f: S.future };
    S.idx = i; S.page = S.pages[i]; S.nb.lastIdx = i;
    var hh = hmap[S.page.id] || { h: [], f: [] }; S.history = hh.h; S.future = hh.f;
    S.sel = null; S.selObj = null; cur = null; $('selBar').hidden = true;
    var nw = slots[i]; dropPv(i); nw.el.classList.add('act'); nw.el.appendChild(wrap);
    layoutActive();
    S.vIdx = i; updateUndo(); updatePageBtn(); markTocCur();
    renderVisible();
  }
  function viewIdxNow() {
    var y = stage.scrollTop + stage.clientHeight * 0.35 - stripTop(), lo = 0;
    for (var i = 0; i < S.pages.length; i++) { if (tops[i] <= y) lo = i; else break; }
    return lo;
  }
  stage.addEventListener('scroll', function () {
    if (!S.page || $('nEditor').hidden) return;
    var v = viewIdxNow();
    if (v !== S.vIdx) { S.vIdx = v; updatePageBtn(); markTocCur(); }
    clearTimeout(actT); actT = setTimeout(settleActivate, 170);
  }, { passive: true });
  function settleActivate() {
    if (!S.page) return;
    if (cur || tp.size || pinch) { actT = setTimeout(settleActivate, 220); return; }
    var ae = document.activeElement;
    if (ae && ae.isContentEditable && wrap.contains(ae)) return;
    if (S.vIdx !== S.idx) activate(S.vIdx);
  }
  function scrollToPage(i, smooth) {
    var top = Math.max(0, stripTop() + (tops[i] || 0) - 8);
    if (smooth && stage.scrollTo) stage.scrollTo({ top: top, behavior: 'smooth' }); else stage.scrollTop = top;
  }
  /* 笔落在别的页上：先把那一页切成可写，再把这一下交给它 */
  stage.addEventListener('pointerdown', function (e) {
    if (!S.page || $('nEditor').hidden || wrap.contains(e.target)) return;
    var sl = e.target.closest && e.target.closest('.slot'); if (!sl) return;
    if (e.pointerType === 'touch' && !(drawFinger() || /^(text|sticky|lasso)$/.test(S.tool))) return;
    if (e.pointerType === 'touch' && penNear()) return;
    activate(+sl.dataset.i);
    var t2 = document.elementFromPoint(e.clientX, e.clientY);
    if (t2 && t2 !== e.target && wrap.contains(t2)) {
      t2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: e.pointerId, pointerType: e.pointerType,
        clientX: e.clientX, clientY: e.clientY, pressure: e.pressure, button: e.button, buttons: e.buttons, isPrimary: e.isPrimary, width: e.width, height: e.height }));
    }
  }, true);

  /* ---------- 缩放（捏合）与手指滑动：由我自己处理，笔永远不会被当成滑动 ---------- */
  function setZoom(z, focal) {
    var sr = strip.getBoundingClientRect(), st = stage.getBoundingClientRect();
    var fx = focal ? focal.x : st.left + st.width / 2, fy = focal ? focal.y : st.top + st.height / 2;
    var px = (fx - sr.left) / S.s, py = (fy - sr.top) / S.s;
    S.zoom = clamp(z, 0.5, 3); layout(); showHud(S.zoom);
    var sr2 = strip.getBoundingClientRect();
    stage.scrollLeft += (sr2.left + px * S.s) - fx; stage.scrollTop += (sr2.top + py * S.s) - fy;
  }
  var hud = document.createElement('div'); hud.className = 'zoomhud'; hud.hidden = true; document.body.appendChild(hud);
  var hudT = 0;
  function showHud(z) { hud.textContent = Math.round(z * 100) + '%'; hud.hidden = false; clearTimeout(hudT); hudT = setTimeout(function () { hud.hidden = true; }, 900); }
  stage.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  var tp = new Map(), pan = null, pinch = null, inertia = 0, lastTap = null;
  function penNear() { return S.penSeen && Date.now() - S.penT < 450; }
  function drawFinger() { return fingerOK() && /^(pen|hl|eraser|lasso)$/.test(S.tool); }
  function cancelInertia() { if (inertia) { cancelAnimationFrame(inertia); inertia = 0; } }
  function startInertia(vx, vy) {
    cancelInertia(); vx = clamp(vx, -3, 3); vy = clamp(vy, -3, 3); if (Math.hypot(vx, vy) < 0.15) return;
    var last = performance.now();
    function step(now) {
      var dt = Math.min(40, now - last); last = now;
      stage.scrollLeft += vx * dt; stage.scrollTop += vy * dt;
      var f = Math.pow(0.94, dt / 16); vx *= f; vy *= f;
      if (Math.hypot(vx, vy) < 0.03) { inertia = 0; return; }
      inertia = requestAnimationFrame(step);
    }
    inertia = requestAnimationFrame(step);
  }
  function two() { var a = []; tp.forEach(function (v) { if (a.length < 2) a.push(v); }); return a; }
  function startPinch() {
    if (cur && cur.touch) { cur = null; redrawInk(); paintLive(); }
    pan = null; cancelInertia();
    var a = two(), sr = strip.getBoundingClientRect();
    var cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
    pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, z: S.zoom, cx: cx, cy: cy, lx: cx, ly: cy, r: 1 };
    strip.style.transformOrigin = (cx - sr.left) + 'px ' + (cy - sr.top) + 'px';
  }
  function updatePinch() {
    var a = two(); if (a.length < 2 || !pinch) return;
    pinch.r = clamp(Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / pinch.d, 0.4, 4);
    pinch.lx = (a[0].x + a[1].x) / 2; pinch.ly = (a[0].y + a[1].y) / 2;
    strip.style.transform = 'translate(' + (pinch.lx - pinch.cx) + 'px,' + (pinch.ly - pinch.cy) + 'px) scale(' + pinch.r + ')';
    showHud(clamp(pinch.z * pinch.r, 0.5, 3));
  }
  function endPinch(apply) {
    var p = pinch; pinch = null; strip.style.transform = ''; strip.style.transformOrigin = '0 0';
    if (!p || !apply) return;
    if (Math.abs(p.r - 1) > 0.02) setZoom(p.z * p.r, { x: p.cx, y: p.cy });
    stage.scrollLeft -= (p.lx - p.cx); stage.scrollTop -= (p.ly - p.cy);
  }
  /* 笔一出现：手指的滑动和缩放全部作废（手掌不会再把页面拖走） */
  function cancelFingers() {
    tp.clear(); pan = null; cancelInertia();
    if (pinch) endPinch(false);
    if (cur && cur.touch) { cur = null; redrawInk(); paintLive(); }
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' || !S.page || $('nEditor').hidden) return;
    if (penNear()) return;
    var now = Date.now();
    tp.forEach(function (v, k) { if (now - v.seen > 1500) tp.delete(k); });
    cancelInertia();
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var onObj = !!(t && t.closest && t.closest('.obj, .selbar, button, input, textarea, [contenteditable="true"]'));
    tp.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now, seen: now, moved: false, onObj: onObj });
    if (tp.size === 2) { startPinch(); return; }
    if (tp.size > 2 || pinch) return;
    if (onObj || drawFinger()) return;
    pan = { id: e.pointerId, vx: 0, vy: 0, lt: e.timeStamp };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  }, true);
  stage.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'pen') { S.penT = Date.now(); return; }
    var r = tp.get(e.pointerId); if (!r) return;
    var dx = e.clientX - r.x, dy = e.clientY - r.y; r.x = e.clientX; r.y = e.clientY; r.seen = Date.now();
    if (Math.hypot(e.clientX - r.x0, e.clientY - r.y0) > 8) r.moved = true;
    if (pinch) { updatePinch(); return; }
    if (pan && pan.id === e.pointerId) {
      stage.scrollLeft -= dx; stage.scrollTop -= dy;
      var dt = Math.max(1, e.timeStamp - pan.lt); pan.lt = e.timeStamp;
      pan.vx = 0.7 * pan.vx + 0.3 * (-dx / dt); pan.vy = 0.7 * pan.vy + 0.3 * (-dy / dt);
    }
  });
  function touchEnd(e) {
    if (e.pointerType === 'pen') { S.penT = Date.now(); return; }
    var r = tp.get(e.pointerId); if (!r) return;
    tp.delete(e.pointerId);
    if (pinch) { if (tp.size < 2) endPinch(e.type === 'pointerup'); return; }
    if (pan && pan.id === e.pointerId) {
      var fresh = e.timeStamp - pan.lt < 80;
      startInertia(fresh ? pan.vx : 0, fresh ? pan.vy : 0); pan = null;
    }
    var now = Date.now();
    var canToggle = !r.onObj && !r.moved && now - r.t0 < 300 && e.type === 'pointerup' && !tp.size && !drawFinger();
    if (!canToggle) return;
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null; setZoom(S.zoom > 1.05 ? 1 : 2, { x: e.clientX, y: e.clientY });
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  stage.addEventListener('pointerup', touchEnd);
  stage.addEventListener('pointercancel', touchEnd);

  /* ================= 工具与选项 ================= */
  /* 防误触（和 GoodNotes 一样自动）：只要这台设备用过 Apple Pencil，手指就只负责滑动和缩放，笔负责书写；没有笔时手指可以写 */
  function fingerOK() { return S.fingerAlways || !S.penSeen; }
  function applyPenSeen() {
    var rb = document.querySelector('#nTools [data-tool="read"]');
    var hide = S.penSeen && !S.fingerAlways;
    if (rb) rb.style.display = hide ? 'none' : '';
    if (hide && S.tool === 'read') setTool('pen');
  }
  function notePen() {
    S.penT = Date.now();
    if (!S.penSeen) {
      S.penSeen = true; saveInput(); applyPenSeen();
      Q.toast('检测到 Apple Pencil：现在手指只负责滑动和缩放，用笔写字。');
    }
  }
  document.addEventListener('pointerdown', function (e) { if (e.pointerType === 'pen') { notePen(); cancelFingers(); } }, true);
  document.addEventListener('pointermove', function (e) { if (e.pointerType === 'pen') notePen(); }, true);
  function setTool(t) {
    S.tool = t; if (S.nb) S.nb.tool = t;
    document.querySelectorAll('#nTools [data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tool') === t ? 'true' : 'false'); });
    TOOLS.forEach(function (x) { wrap.classList.toggle('tool-' + x, x === t); });
    if (t !== 'lasso') { S.sel = null; $('selBar').hidden = true; S.selObj = null; }
    cur = null; renderOpts(); buildObjects(); paintLive();
  }
  document.querySelectorAll('#nTools [data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.getAttribute('data-tool')); });
  });
  $('nUndo').addEventListener('click', undo);
  $('nRedo').addEventListener('click', redo);

  function swatches(list, get, set) {
    var g = el('span', 'grp');
    list.forEach(function (c) {
      var b = el('button', 'sw'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', '颜色 ' + c);
      b.setAttribute('aria-pressed', get() === c ? 'true' : 'false');
      b.addEventListener('click', function () { set(c); renderOpts(); });
      g.appendChild(b);
    });
    return g;
  }
  var RECENT = [];
  try { RECENT = JSON.parse(localStorage.getItem('quanwen.recentColors') || '[]').filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 6); } catch (e) {}
  function rememberColor(c) {
    if (COLORS.indexOf(c) >= 0 || HL_COLORS.indexOf(c) >= 0 || STICKY.indexOf(c) >= 0) return;
    RECENT = [c].concat(RECENT.filter(function (x) { return x !== c; })).slice(0, 6);
    try { localStorage.setItem('quanwen.recentColors', JSON.stringify(RECENT)); } catch (e) {}
  }
  function customColor(get, set, title) {
    var g = el('span', 'grp');
    RECENT.forEach(function (c) {
      var b = el('button', 'sw'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', '最近用过的颜色 ' + c);
      b.setAttribute('aria-pressed', get() === c ? 'true' : 'false');
      b.addEventListener('click', function () { set(c); renderOpts(); });
      g.appendChild(b);
    });
    var b = el('button', 'sw-custom', '色板'); b.type = 'button'; b.setAttribute('aria-label', '打开色板和调色盘');
    b.addEventListener('click', function () { colorDialog(title || '颜色', get, set); });
    g.appendChild(b);
    return g;
  }

  /* ---------- 色板：基本色 / 官方色板 / 我的颜色（可调、可存） ---------- */
  var BASIC = ['#111111', '#6b7280', '#dc2626', '#ea580c', '#eab308', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#7a4a21', '#ffffff'];
  var PALETTES = [
    ['经典', ['#1b1b1b', '#1d4ed8', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#7a4a21', '#6b7280']],
    ['马卡龙', ['#ffb3c1', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff']],
    ['莫兰迪', ['#a8998a', '#b5838d', '#e5989b', '#6d6875', '#7d8f8a', '#9db4a0', '#8e9aaf', '#cbc0d3']],
    ['复古', ['#8c2f39', '#b23a48', '#d98e04', '#6b705c', '#3a5a40', '#355070', '#6d597a', '#3d2c2e']],
    ['荧光', ['#ff3b6b', '#ff9f1c', '#ffe600', '#39ff14', '#00e5ff', '#2979ff', '#d500f9', '#ff6ec7']],
    ['深邃', ['#0b132b', '#1c2541', '#3a506b', '#264653', '#2a9d8f', '#e76f51', '#6a040f', '#5bc0be']],
    ['大地', ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#b6ad90', '#c2c5aa', '#656d4a', '#414833']]
  ];
  var MY = [];
  try { MY = JSON.parse(localStorage.getItem('quanwen.myColors') || '[]').filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 48); } catch (e) {}
  function saveMy() { try { localStorage.setItem('quanwen.myColors', JSON.stringify(MY)); } catch (e) {} }
  function hexToHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, sat = 0, d = mx - mn;
    if (d) {
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [Math.round(h), Math.round(sat * 100), Math.round(l * 100)];
  }
  function hslToHex(h, sat, l) {
    sat /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; }, a = sat * Math.min(l, 1 - l);
    var f = function (n) { var v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return ('0' + Math.round(v * 255).toString(16)).slice(-2); };
    return '#' + f(0) + f(8) + f(4);
  }
  function inkOn(bg) {
    if (!/^#[0-9a-f]{6}$/i.test(bg)) return '#222222';
    var r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 120 ? '#ffffff' : '#222222';
  }
  function colorDialog(title, get, set, palIdx, manage) {
    palIdx = palIdx || 0;
    var hex0 = /^#[0-9a-f]{6}$/i.test(get()) ? get().toLowerCase() : '#1b1b1b';
    dialog(function (box) {
      box.classList.add('colordlg');
      var head = el('div', 'cd-head');
      var prev = el('span', 'cd-prev'); prev.style.background = hex0;
      head.appendChild(prev); head.appendChild(el('b', null, title));
      var hexIn = document.createElement('input'); hexIn.type = 'text'; hexIn.className = 'cd-hex'; hexIn.value = hex0; hexIn.maxLength = 7;
      hexIn.setAttribute('aria-label', '颜色代码'); hexIn.autocapitalize = 'off'; hexIn.spellcheck = false;
      head.appendChild(hexIn);
      box.appendChild(head);
      function apply(c, rerender) {
        c = c.toLowerCase(); set(c); rememberColor(c); prev.style.background = c; hexIn.value = c;
        if (rerender) colorDialog(title, function () { return c; }, set, palIdx, manage); 
      }
      function sw(c, parent, del) {
        var b = el('button', 'sw'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', (del ? '删除颜色 ' : '颜色 ') + c);
        b.setAttribute('aria-pressed', !del && hex0 === c.toLowerCase() ? 'true' : 'false');
        if (del) { b.classList.add('del'); b.textContent = '×'; b.style.color = inkOn(c); }
        b.addEventListener('click', function () {
          if (del) { MY = MY.filter(function (x) { return x !== c; }); saveMy(); colorDialog(title, function () { return hex0; }, set, palIdx, true); }
          else apply(c, true);
        });
        parent.appendChild(b);
      }
      function section(name) { box.appendChild(el('div', 'lbl cd-lbl', name)); var g = el('div', 'cd-grid'); box.appendChild(g); return g; }

      var g1 = section('基本色'); BASIC.forEach(function (c) { sw(c, g1); });

      var lab = el('div', 'lbl cd-lbl', '官方色板'); box.appendChild(lab);
      var tabs = el('div', 'cd-tabs');
      PALETTES.forEach(function (p, i) {
        var t = el('button', null, p[0]); t.type = 'button'; t.setAttribute('aria-pressed', i === palIdx ? 'true' : 'false');
        t.addEventListener('click', function () { colorDialog(title, function () { return hex0; }, set, i, manage); });
        tabs.appendChild(t);
      });
      box.appendChild(tabs);
      var g2 = el('div', 'cd-grid'); box.appendChild(g2); PALETTES[palIdx][1].forEach(function (c) { sw(c, g2); });

      var myHead = el('div', 'cd-myhead'); myHead.appendChild(el('span', 'lbl cd-lbl', '我的颜色（' + MY.length + '）'));
      if (MY.length) {
        var mg = el('button', 'btn small', manage ? '完成整理' : '整理'); mg.type = 'button';
        mg.addEventListener('click', function () { colorDialog(title, function () { return hex0; }, set, palIdx, !manage); });
        myHead.appendChild(mg);
      }
      box.appendChild(myHead);
      var g3 = el('div', 'cd-grid');
      box.appendChild(g3);
      if (!MY.length) g3.appendChild(el('span', 'muted', '还没有。下面调一个颜色，点“存到我的颜色”。'));
      MY.forEach(function (c) { sw(c, g3, manage); });

      /* 调色：色相 / 饱和度 / 亮度 */
      box.appendChild(el('div', 'lbl cd-lbl', '自己调'));
      var hsl = hexToHsl(hex0);
      var sliders = el('div', 'cd-sliders');
      var defs = [['色相', 0, 360], ['饱和', 0, 100], ['亮度', 0, 100]], ins = [];
      defs.forEach(function (d, i) {
        var row = el('label', 'cd-row'); row.appendChild(el('span', null, d[0]));
        var r = document.createElement('input'); r.type = 'range'; r.min = d[1]; r.max = d[2]; r.value = hsl[i]; r.setAttribute('aria-label', d[0]);
        r.addEventListener('input', function () {
          hsl[i] = +r.value; var c = hslToHex(hsl[0], hsl[1], hsl[2]); set(c); prev.style.background = c; hexIn.value = c; paintTracks();
        });
        r.addEventListener('change', function () { rememberColor(hslToHex(hsl[0], hsl[1], hsl[2])); renderOpts(); });
        ins.push(r); row.appendChild(r); sliders.appendChild(row);
      });
      function paintTracks() {
        ins[0].style.background = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
        ins[1].style.background = 'linear-gradient(90deg,' + hslToHex(hsl[0], 0, hsl[2]) + ',' + hslToHex(hsl[0], 100, hsl[2]) + ')';
        ins[2].style.background = 'linear-gradient(90deg,#000,' + hslToHex(hsl[0], hsl[1], 50) + ',#fff)';
      }
      paintTracks();
      box.appendChild(sliders);
      hexIn.addEventListener('change', function () {
        var v = hexIn.value.trim(); if (v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
        if (!/^#[0-9a-f]{6}$/i.test(v)) { hexIn.value = hex0; return; }
        apply(v, true);
      });

      var row = el('div', 'row'); row.style.marginTop = '12px';
      var save = el('button', 'btn', '存到我的颜色'); save.type = 'button';
      save.addEventListener('click', function () {
        var c = hexIn.value.toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(c)) c = hex0;
        if (MY.indexOf(c) < 0) { MY.unshift(c); MY = MY.slice(0, 48); saveMy(); }
        set(c); rememberColor(c); colorDialog(title, function () { return c; }, set, palIdx, manage);
      });
      var nat = el('label', 'btn'); nat.textContent = '系统取色器';
      var ni = document.createElement('input'); ni.type = 'color'; ni.value = hex0; ni.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;pointer-events:none';
      ni.addEventListener('change', function () { apply(ni.value, true); });
      nat.appendChild(ni);
      var done = el('button', 'btn primary', '完成'); done.type = 'button';
      done.addEventListener('click', function () { closeDialog(); renderOpts(); });
      row.appendChild(save); row.appendChild(nat); row.appendChild(done); box.appendChild(row);
    });
  }
  function sizeButtons(list, get, set, dia) {
    var g = el('span', 'grp');
    list.forEach(function (v, idx) {
      var b = el('button', 'szb'); b.type = 'button'; b.setAttribute('aria-label', '粗细 ' + (idx + 1));
      var i = el('i'); var d = dia(v); i.style.width = d + 'px'; i.style.height = d + 'px'; b.appendChild(i);
      b.setAttribute('aria-pressed', get() === idx ? 'true' : 'false');
      b.addEventListener('click', function () { set(idx); renderOpts(); });
      g.appendChild(b);
    });
    return g;
  }
  function renderOpts() {
    var o = $('nOpts'); o.textContent = '';
    var t = S.tool, c = S.cfg;
    if (t === 'pen') {
      o.appendChild(swatches(COLORS, function () { return c.pen.color; }, function (v) { c.pen.color = v; }));
      o.appendChild(customColor(function () { return c.pen.color; }, function (v) { c.pen.color = v; }, '笔的颜色'));
      o.appendChild(sizeButtons(PEN_SIZES, function () { return c.pen.size; }, function (v) { c.pen.size = v; }, function (v) { return Math.round(v * 1.5 + 3); }));
    } else if (t === 'hl') {
      o.appendChild(swatches(HL_COLORS, function () { return c.hl.color; }, function (v) { c.hl.color = v; }));
      o.appendChild(customColor(function () { return c.hl.color; }, function (v) { c.hl.color = v; }, '荧光笔的颜色'));
      o.appendChild(sizeButtons(HL_SIZES, function () { return c.hl.size; }, function (v) { c.hl.size = v; }, function (v) { return Math.round(v / 2.4 + 4); }));
    } else if (t === 'eraser') {
      o.appendChild(sizeButtons(ER_SIZES, function () { return c.eraser.size; }, function (v) { c.eraser.size = v; }, function (v) { return Math.round(v / 2 + 6); }));
      o.appendChild(el('span', 'tip', '在笔迹上划过就擦掉整条笔画'));
    } else if (t === 'lasso') {
      o.appendChild(el('span', 'tip', '用笔画圈选中内容，松手点“问 AI”，圈外的字不会发出去。点一下图片、贴纸、便利贴可以直接拖动，右下角圆点缩放，双击文字可以编辑。'));
    } else if (t === 'text') {
      o.appendChild(swatches(COLORS, function () { return c.text.color; }, function (v) { c.text.color = v; }));
      o.appendChild(customColor(function () { return c.text.color; }, function (v) { c.text.color = v; }, '文字的颜色'));
      var g = el('span', 'grp');
      ['小', '中', '大'].forEach(function (n, i) {
        var b = el('button', 'szb', n); b.type = 'button'; b.setAttribute('aria-pressed', c.text.size === i ? 'true' : 'false');
        b.addEventListener('click', function () { c.text.size = i; renderOpts(); }); g.appendChild(b);
      });
      o.appendChild(g);
      o.appendChild(el('span', 'tip', '点页面空白处添加文字'));
    } else if (t === 'sticky') {
      o.appendChild(swatches(STICKY, function () { return c.sticky.color; }, function (v) { c.sticky.color = v; }));
      o.appendChild(customColor(function () { return c.sticky.color; }, function (v) { c.sticky.color = v; }, '便利贴的颜色'));
      o.appendChild(el('span', 'tip', '点页面空白处添加便利贴'));
    } else if (t === 'read') {
      o.appendChild(el('span', 'tip', '浏览：只滚动和双指缩放，不会画上任何东西，适合读。要圈起来问 AI，换到“选中”。双击可以放大或还原。'));
    }
  }

  /* ================= 书写 / 擦除 / 套索 ================= */
  function ptOf(e) {
    var r = live.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.s, y: (e.clientY - r.top) / S.s, p: (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5 };
  }
  var bbCache = new WeakMap();
  function bboxOf(st) {
    var b = bbCache.get(st);
    if (b) return b;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    st.pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var pad = st.w * (st.t === 'h' ? 0.5 : 0.8);
    b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    bbCache.set(st, b); return b;
  }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function hitStroke(st, x, y, r) {
    var b = bboxOf(st);
    if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
    var rr = r + (st.t === 'h' ? st.w / 2 : st.w * 0.7), pts = st.pts;
    if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= rr;
    for (var i = 1; i < pts.length; i++) if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rr) return true;
    return false;
  }
  function pointInPoly(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function simplify(pts) {
    var out = [], last = null;
    pts.forEach(function (p, i) {
      var q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100];
      if (!last || i === pts.length - 1 || Math.hypot(q[0] - last[0], q[1] - last[1]) >= 0.9) { out.push(q); last = q; }
    });
    return out;
  }
  function inBBox(pt, b) { return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; }

  function liveDown(e) {
    if (e.pointerType === 'pen') { notePen(); if (cur && cur.touch) { cur = null; redrawInk(); paintLive(); } }
    /* 手指：用过 Apple Pencil 之后不写字；手掌紧跟着笔落下的触碰也一律忽略 */
    if (e.pointerType === 'touch' && (!fingerOK() || penNear())) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (cur || !S.page) return;
    var pt = ptOf(e), t = S.tool, touch = e.pointerType === 'touch';
    if (t === 'pen' || t === 'hl') {
      var cfg = S.cfg[t];
      cur = { kind: 'draw', id: e.pointerId, touch: touch, t: t === 'hl' ? 'h' : 'p', c: cfg.color,
        w: (t === 'hl' ? HL_SIZES : PEN_SIZES)[cfg.size], pts: [[pt.x, pt.y, pt.p]] };
    } else if (t === 'eraser') {
      cur = { kind: 'erase', id: e.pointerId, touch: touch, changed: false, last: pt };
      eraseAt(pt);
    } else if (t === 'lasso') {
      if (S.selObj) selectObj(null);
      if (S.sel && !S.sel.region && inBBox(pt, S.sel.bbox)) { cur = { kind: 'move', id: e.pointerId, touch: touch, sx: pt.x, sy: pt.y, dx: 0, dy: 0 }; $('selBar').hidden = true; }
      else { clearSel(); cur = { kind: 'lasso', id: e.pointerId, touch: touch, pts: [[pt.x, pt.y]] }; }
    } else return;
    try { live.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault(); schedLive();
  }
  live.addEventListener('pointerdown', liveDown);
  live.addEventListener('pointermove', function (e) {
    if (!cur || e.pointerId !== cur.id) return;
    var evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    if (!evs.length) evs = [e];
    var minD = cur.kind === 'lasso' ? 1.6 / S.s : 0.5;
    for (var i = 0; i < evs.length; i++) {
      var pt = ptOf(evs[i]);
      if (cur.kind === 'draw') {
        var l = cur.pts[cur.pts.length - 1];
        if (Math.hypot(pt.x - l[0], pt.y - l[1]) >= 0.5) cur.pts.push([pt.x, pt.y, pt.p]);
      } else if (cur.kind === 'erase') { cur.last = pt; eraseAt(pt); }
      else if (cur.kind === 'lasso') {
        var q = cur.pts[cur.pts.length - 1];
        if (Math.hypot(pt.x - q[0], pt.y - q[1]) >= minD) cur.pts.push([pt.x, pt.y]);
      }
      else if (cur.kind === 'move') { cur.dx = pt.x - cur.sx; cur.dy = pt.y - cur.sy; }
    }
    schedLive();
  });
  function finish(e, cancelled) {
    if (!cur || e.pointerId !== cur.id) return;
    var c = cur; cur = null;
    try { live.releasePointerCapture(e.pointerId); } catch (err) {}
    if (cancelled) { redrawInk(); paintLive(); updateSelBar(); return; }
    if (c.kind === 'draw') {
      var st = { id: DB.uid(), t: c.t, c: c.c, w: c.w, pts: simplify(c.pts) };
      pushHistory(); S.page.strokes = S.page.strokes.concat([st]);
      if (st.t === 'h') redrawInk(); else inkAdd(st);
      markDirty();
    } else if (c.kind === 'erase') { if (c.changed) markDirty(); }
    else if (c.kind === 'lasso') makeSelection(c.pts);
    else if (c.kind === 'move') commitMove(c);
    paintLive(); updateSelBar();
  }
  live.addEventListener('pointerup', function (e) { finish(e, false); });
  live.addEventListener('pointercancel', function (e) { finish(e, true); });

  /* 平滑曲线：经过各点中点的二次曲线 */
  function tracePath(ctx, pts, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    var n = pts.length; if (!n) return;
    ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    if (n < 3) { for (var k = 1; k < n; k++) ctx.lineTo(pts[k][0] + dx, pts[k][1] + dy); return; }
    for (var i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, (pts[i][0] + pts[i + 1][0]) / 2 + dx, (pts[i][1] + pts[i + 1][1]) / 2 + dy);
    }
    ctx.lineTo(pts[n - 1][0] + dx, pts[n - 1][1] + dy);
  }
  function tracePoly(ctx, poly, dx, dy) {
    ctx.moveTo(poly[0][0] + (dx || 0), poly[0][1] + (dy || 0));
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0] + (dx || 0), poly[i][1] + (dy || 0));
    ctx.closePath();
  }
  /* 把手画的圈整理成光滑的闭合曲线（Chaikin 切角） */
  function smoothClosed(pts) {
    var p = [pts[0]];
    for (var i = 1; i < pts.length; i++) { var l = p[p.length - 1]; if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= 5) p.push(pts[i]); }
    if (p.length < 4) return p;
    for (var it = 0; it < 2; it++) {
      var out = [];
      for (var j = 0; j < p.length; j++) {
        var a = p[j], b = p[(j + 1) % p.length];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = out;
    }
    return p;
  }

  function schedLive() { if (rafT) return; rafT = requestAnimationFrame(function () { rafT = 0; paintLive(); }); }
  function paintLive() {
    var c = live, ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    if (!S.page) return;
    var k = S.s * S.dpr, px = 1 / S.s;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    var mv = cur && cur.kind === 'move' ? cur : null;
    if (mv) redrawInk({ ids: S.sel.sids, dx: mv.dx, dy: mv.dy });
    if (S.sel) {
      var b = S.sel.bbox, dx = mv ? mv.dx : 0, dy = mv ? mv.dy : 0;
      ctx.save(); ctx.setLineDash([7 * px, 5 * px]); ctx.lineWidth = 1.6 * px; ctx.strokeStyle = '#2346c8'; ctx.fillStyle = 'rgba(35,70,200,0.07)';
      if (S.sel.region && S.sel.poly) { ctx.beginPath(); tracePoly(ctx, S.sel.poly, dx, dy); ctx.fill(); ctx.stroke(); }
      else {
        ctx.fillRect(b.x + dx - 6, b.y + dy - 6, b.w + 12, b.h + 12); ctx.strokeRect(b.x + dx - 6, b.y + dy - 6, b.w + 12, b.h + 12);
        if (S.sel.poly) { ctx.globalAlpha = 0.45; ctx.beginPath(); tracePoly(ctx, S.sel.poly, dx, dy); ctx.stroke(); }
      }
      ctx.restore();
      if (mv) S.sel.oids.forEach(function (id) {
        var o = objById(id), d = objEl(id);
        if (o && d) { d.style.left = (o.x + mv.dx) * S.s + 'px'; d.style.top = (o.y + mv.dy) * S.s + 'px'; }
      });
    }
    if (cur) {
      if (cur.kind === 'draw') drawStroke(ctx, { t: cur.t, c: cur.c, w: cur.w, pts: cur.pts });
      else if (cur.kind === 'lasso' && cur.pts.length > 1) {
        var lp = cur.pts;
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.fillStyle = 'rgba(255,212,59,0.16)'; ctx.beginPath(); tracePath(ctx, lp); ctx.closePath(); ctx.fill();
        ctx.setLineDash([4 * px, 5 * px]); ctx.lineWidth = 1.3 * px; ctx.strokeStyle = 'rgba(35,70,200,0.55)';
        ctx.beginPath(); ctx.moveTo(lp[lp.length - 1][0], lp[lp.length - 1][1]); ctx.lineTo(lp[0][0], lp[0][1]); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 2.6 * px; ctx.strokeStyle = '#2346c8';
        ctx.beginPath(); tracePath(ctx, lp); ctx.stroke(); ctx.restore();
      } else if (cur.kind === 'erase') {
        ctx.save(); ctx.lineWidth = 1.4 * px; ctx.strokeStyle = 'rgba(80,90,110,0.9)'; ctx.fillStyle = 'rgba(160,170,190,0.18)';
        ctx.beginPath(); ctx.arc(cur.last.x, cur.last.y, ER_SIZES[S.cfg.eraser.size], 0, 6.2832); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
  }

  function eraseAt(pt) {
    var r = ER_SIZES[S.cfg.eraser.size];
    var keep = S.page.strokes.filter(function (st) { return !hitStroke(st, pt.x, pt.y, r); });
    if (keep.length !== S.page.strokes.length) {
      if (!cur.changed) { pushHistory(); cur.changed = true; }
      S.page.strokes = keep; redrawInk();
    }
  }

  /* ---------- 套索选择 ---------- */
  function isBox(o) { return o.type === 'image' || o.type === 'emoji' || o.type === 'tape'; }
  function objH(o) { var d = objEl(o.id); return isBox(o) ? o.h : (d ? d.offsetHeight / S.s : (o.h || 60)); }
  function strokeInFrac(st, poly) {
    var pts = st.pts, tot = 0, inn = 0;
    if (pts.length === 1) return pointInPoly(pts[0][0], pts[0][1], poly) ? 1 : 0;
    for (var i = 1; i < pts.length; i++) {
      var L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) || 0.01;
      tot += L; if (pointInPoly((pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2, poly)) inn += L;
    }
    return tot ? inn / tot : 0;
  }
  function boxInFrac(x, y, w, h, poly) {
    var n = 0, tot = 0;
    for (var i = 0; i < 6; i++) for (var j = 0; j < 6; j++) { tot++; if (pointInPoly(x + (i + 0.5) / 6 * w, y + (j + 0.5) / 6 * h, poly)) n++; }
    return n / tot;
  }
  function makeSelection(raw) {
    if (raw.length < 4) { clearSel(); return; }
    var poly = smoothClosed(raw);
    if (poly.length < 3) { clearSel(); return; }
    var sids = new Set(), oids = new Set(), bb = null;
    function add(x0, y0, x1, y1) { bb = bb ? { x0: Math.min(bb.x0, x0), y0: Math.min(bb.y0, y0), x1: Math.max(bb.x1, x1), y1: Math.max(bb.y1, y1) } : { x0: x0, y0: y0, x1: x1, y1: y1 }; }
    var px0 = 1e9, py0 = 1e9, px1 = -1e9, py1 = -1e9;
    poly.forEach(function (q) { px0 = Math.min(px0, q[0]); py0 = Math.min(py0, q[1]); px1 = Math.max(px1, q[0]); py1 = Math.max(py1, q[1]); });
    if (px1 - px0 < 12 && py1 - py0 < 12) { clearSel(); return; }
    S.page.strokes.forEach(function (st) {
      var b = bboxOf(st);
      if (b.x1 < px0 || b.x0 > px1 || b.y1 < py0 || b.y0 > py1) return;
      if (strokeInFrac(st, poly) >= 0.5) { sids.add(st.id); add(b.x0, b.y0, b.x1, b.y1); }
    });
    S.page.objects.forEach(function (o) {
      var h = objH(o);
      if (boxInFrac(o.x, o.y, o.w, h, poly) >= 0.4) { oids.add(o.id); add(o.x, o.y, o.x + o.w, o.y + h); }
    });
    var pb = { x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
    if (!sids.size && !oids.size) {
      /* 圈住的地方没有笔迹和对象：圈出的范围就是一块区域，用来问 PDF/页面上印着的内容 */
      if (pb.w < 12 || pb.h < 12) { clearSel(); return; }
      S.sel = { sids: sids, oids: oids, bbox: pb, region: true, poly: poly };
      return;
    }
    S.sel = { sids: sids, oids: oids, bbox: { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 }, region: false, poly: poly };
  }
  function clearSel() { S.sel = null; $('selBar').hidden = true; paintLive(); }

  function commitMove(c) {
    if (Math.abs(c.dx) + Math.abs(c.dy) < 0.5) { redrawInk(); buildObjects(); return; }
    pushHistory();
    var dx = c.dx, dy = c.dy, sel = S.sel;
    S.page.strokes = S.page.strokes.map(function (st) {
      return sel.sids.has(st.id) ? Object.assign({}, st, { pts: st.pts.map(function (p) { return [p[0] + dx, p[1] + dy, p[2]]; }) }) : st;
    });
    S.page.objects.forEach(function (o) { if (sel.oids.has(o.id)) { o.x += dx; o.y += dy; } });
    sel.bbox.x += dx; sel.bbox.y += dy;
    redrawInk(); buildObjects(); markDirty();
  }

  function copySelection() {
    var sel = S.sel; if (!sel || sel.region) return;
    S.clip = { strokes: S.page.strokes.filter(function (st) { return sel.sids.has(st.id); }),
      objects: S.page.objects.filter(function (o) { return sel.oids.has(o.id); }).map(function (o) { return Object.assign({}, o); }), n: 0 };
    $('nPaste').hidden = false;
    Q.toast('已复制。点工具栏的“粘贴”，可以贴在这一页或别的页。');
  }
  function pasteClip() {
    if (!S.clip || !S.page) return;
    S.clip.n++; var off = 30 * S.clip.n;
    pushHistory();
    var sids = new Set(), oids = new Set(), bb = null;
    function add(x0, y0, x1, y1) { bb = bb ? { x0: Math.min(bb.x0, x0), y0: Math.min(bb.y0, y0), x1: Math.max(bb.x1, x1), y1: Math.max(bb.y1, y1) } : { x0: x0, y0: y0, x1: x1, y1: y1 }; }
    var ns = S.clip.strokes.map(function (st) {
      var n = Object.assign({}, st, { id: DB.uid(), pts: st.pts.map(function (p) { return [p[0] + off, p[1] + off, p[2]]; }) });
      sids.add(n.id); var b = bboxOf(n); add(b.x0, b.y0, b.x1, b.y1); return n;
    });
    var no = S.clip.objects.map(function (o) {
      var n = Object.assign({}, o, { id: DB.uid(), x: o.x + off, y: o.y + off });
      oids.add(n.id); add(n.x, n.y, n.x + n.w, n.y + (n.h || 60)); return n;
    });
    S.page.strokes = S.page.strokes.concat(ns); S.page.objects = S.page.objects.concat(no);
    setTool('lasso');
    S.sel = { sids: sids, oids: oids, bbox: { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 }, region: false };
    redrawInk(); buildObjects(); paintLive(); updateSelBar(); markDirty();
  }
  $('nPaste').addEventListener('click', pasteClip);

  function deleteSelection() {
    var sel = S.sel; if (!sel || sel.region) return;
    pushHistory();
    S.page.strokes = S.page.strokes.filter(function (st) { return !sel.sids.has(st.id); });
    S.page.objects = S.page.objects.filter(function (o) { return !sel.oids.has(o.id); });
    S.sel = null; $('selBar').hidden = true;
    redrawInk(); buildObjects(); paintLive(); markDirty();
  }
  function recolorSelection() {
    var sel = S.sel; if (!sel || sel.region) return;
    pushHistory();
    S.page.strokes = S.page.strokes.map(function (st) {
      return sel.sids.has(st.id) ? Object.assign({}, st, { c: st.t === 'h' ? S.cfg.hl.color : S.cfg.pen.color }) : st;
    });
    redrawInk(); markDirty();
  }

  /* 选区上方的小工具条 */
  function barBtn(label, cls, fn) { var b = el('button', cls || '', label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function placeBar(bar, x, y, w, h) {
    var wrapW = wrap.clientWidth, s = S.s;
    bar.hidden = false;
    var bw = bar.offsetWidth, bh = bar.offsetHeight;
    var left = clamp(x * s + (w * s - bw) / 2, 4, Math.max(4, wrapW - bw - 4));
    var top = y * s - bh - 12;
    if (top < 4) top = (y + h) * s + 12;
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }
  function updateSelBar() {
    var bar = $('selBar');
    if (!S.sel || (cur && cur.kind === 'move')) { bar.hidden = true; return; }
    bar.textContent = '';
    bar.appendChild(barBtn('问 AI', 'hot', function () { askSel(); }));
    if (!S.sel.region) {
      bar.appendChild(barBtn('复制', '', copySelection));
      bar.appendChild(barBtn('变色', '', recolorSelection));
      bar.appendChild(barBtn('删除', 'dng', deleteSelection));
    }
    bar.appendChild(barBtn('取消', '', clearSel));
    var b = S.sel.bbox; placeBar(bar, b.x, b.y, b.w, b.h);
  }
  /* 只把圈里的东西交给 AI：圈外的字抹成白色，被选中的笔迹和对象整块保留 */
  async function askSel() {
    var sel = S.sel, page = S.page; if (!sel) return;
    var pad = 16, x0 = sel.bbox.x, y0 = sel.bbox.y, x1 = sel.bbox.x + sel.bbox.w, y1 = sel.bbox.y + sel.bbox.h;
    if (sel.poly) sel.poly.forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    var x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad);
    var w = Math.min(PW - x, x1 - x0 + 2 * pad), h = Math.min(page.h - y, y1 - y0 + 2 * pad);
    var k = clamp(1600 / Math.max(w, h), 0.8, 3);
    var anchor = { pageId: page.id, bbox: { x: sel.bbox.x, y: sel.bbox.y, w: sel.bbox.w, h: sel.bbox.h } };
    try {
      var cv = await renderCanvas(page, { x: x, y: y, w: w, h: h }, k);
      var mk = document.createElement('canvas'); mk.width = cv.width; mk.height = cv.height;
      var m = mk.getContext('2d'); m.setTransform(k, 0, 0, k, -x * k, -y * k);
      m.fillStyle = '#000'; m.strokeStyle = '#000'; m.lineJoin = 'round';
      if (sel.poly) { m.beginPath(); tracePoly(m, sel.poly); m.fill(); m.lineWidth = 12; m.stroke(); }
      page.strokes.forEach(function (st) { if (sel.sids.has(st.id)) { var b = bboxOf(st); m.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); } });
      page.objects.forEach(function (o) { if (sel.oids.has(o.id)) m.fillRect(o.x - 4, o.y - 4, o.w + 8, objH(o) + 8); });
      var oc = document.createElement('canvas'); oc.width = cv.width; oc.height = cv.height;
      var o2 = oc.getContext('2d'); o2.drawImage(cv, 0, 0);
      o2.globalCompositeOperation = 'destination-in'; o2.drawImage(mk, 0, 0);
      var fin = document.createElement('canvas'); fin.width = cv.width; fin.height = cv.height;
      var f = fin.getContext('2d'); f.fillStyle = '#fff'; f.fillRect(0, 0, fin.width, fin.height); f.drawImage(oc, 0, 0);
      var blob = await toBlob(fin, 'image/png');
      var strong = !!(sel.sids && sel.sids.size);
      var note = ($('askIn').value || '').trim(); $('askIn').value = '';
      openDrawer();
      Q.ask({ blob: blob, strong: strong, note: note, anchor: anchor });
    } catch (e) { Q.toast('这一块截不下来：' + Q.errMsg(e)); }
  }

  /* ================= 文字框 / 便利贴 / 图片 ================= */
  function objById(id) { for (var i = 0; i < S.page.objects.length; i++) if (S.page.objects[i].id === id) return S.page.objects[i]; return null; }
  function objEl(id) { return objsLayer.querySelector('[data-id="' + id + '"]'); }

  function posObj(d, o) {
    var s = S.s;
    d.style.left = o.x * s + 'px'; d.style.top = o.y * s + 'px'; d.style.width = o.w * s + 'px';
    if (o.type === 'emoji') { d.style.fontSize = o.h * s * 0.8 + 'px'; d.style.lineHeight = o.h * s + 'px'; }
    if (isBox(o)) d.style.height = o.h * s + 'px';
    else d.style.minHeight = (o.type === 'sticky' ? o.h * s : 0) + 'px';
  }
  function styleTextObj(d, o) {
    var s = S.s;
    d.style.fontSize = o.size * s + 'px';
    if (o.type === 'sticky') { d.style.background = o.color; d.style.color = inkOn(o.color); d.style.padding = (10 * s) + 'px ' + (12 * s) + 'px'; }
    else { d.style.color = o.color; d.style.padding = (2 * s) + 'px ' + (4 * s) + 'px'; }
  }
  function editable() { return S.tool === 'text' || S.tool === 'sticky'; }
  function buildObj(o) {
    var d = document.createElement('div');
    d.className = 'obj ' + o.type; d.dataset.id = o.id; posObj(d, o);
    if (o.type === 'image') {
      var im = new Image(); im.alt = ''; im.draggable = false; im.src = urlOf(o.blob); d.appendChild(im);
    } else if (o.type === 'emoji') {
      d.textContent = o.text;
    } else if (o.type === 'tape') {
      d.style.background = o.color;
    } else {
      styleTextObj(d, o); d.textContent = o.text || '';
      d.contentEditable = editable() ? 'true' : 'false'; d.spellcheck = false;
      var before = '';
      d.addEventListener('focus', function () { pushHistory(); before = o.text || ''; S.selObj = o.id; });
      d.addEventListener('input', function () { o.text = d.innerText.replace(/ /g, ' ').replace(/\n$/, ''); markDirty(); });
      d.addEventListener('blur', function () {
        if ((o.text || '') === before) { S.history.pop(); updateUndo(); }
        if (o.type === 'sticky') o.h = Math.max(o.h, Math.round(d.offsetHeight / S.s));
        if (S.tool === 'lasso') d.contentEditable = 'false';
      });
      d.addEventListener('paste', function (e) {
        var cd = e.clipboardData; if (!cd) return;
        for (var i = 0; i < cd.items.length; i++) if (cd.items[i].kind === 'file') return;
        e.preventDefault(); document.execCommand('insertText', false, cd.getData('text/plain'));
      });
    }
    return d;
  }
  function buildObjects() {
    objsLayer.textContent = '';
    if (!S.page) return;
    S.page.objects.forEach(function (o) { objsLayer.appendChild(buildObj(o)); });
    updateObjSel();
  }
  function selectObj(id) { S.selObj = id; updateObjSel(); }
  function updateObjSel() {
    var bar = $('objBar');
    objsLayer.querySelectorAll('.obj').forEach(function (d) {
      var on = S.tool === 'lasso' && d.dataset.id === S.selObj;
      d.classList.toggle('sel', on);
      var h = d.querySelector('.rh');
      if (on && !h) { h = el('span', 'rh'); d.appendChild(h); }
      if (!on && h) h.remove();
    });
    if (S.tool !== 'lasso' || !S.selObj || !objById(S.selObj)) { bar.hidden = true; return; }
    var o = objById(S.selObj); bar.textContent = '';
    if (o.type === 'text' || o.type === 'sticky') {
      bar.appendChild(barBtn('编辑', '', function () { var d = objEl(o.id); d.contentEditable = 'true'; d.focus(); }));
      bar.appendChild(barBtn('A−', '', function () { changeObjSize(o, -1); }));
      bar.appendChild(barBtn('A＋', '', function () { changeObjSize(o, 1); }));
    }
    if (o.type === 'text' || o.type === 'sticky' || o.type === 'tape') bar.appendChild(barBtn('换色', '', function () { recolorObj(o); }));
    bar.appendChild(barBtn('复制', '', function () { dupObj(o); }));
    bar.appendChild(barBtn('删除', 'dng', function () { delObj(o.id); }));
    positionObjBar();
  }
  function positionObjBar() {
    var o = S.selObj && objById(S.selObj), d = o && objEl(o.id), bar = $('objBar');
    if (!d) { bar.hidden = true; return; }
    bar.hidden = false;
    var bw = bar.offsetWidth, bh = bar.offsetHeight, wrapW = wrap.clientWidth;
    var left = clamp(d.offsetLeft + (d.offsetWidth - bw) / 2, 4, Math.max(4, wrapW - bw - 4));
    var top = d.offsetTop - bh - 12; if (top < 4) top = d.offsetTop + d.offsetHeight + 16;
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }
  function changeObjSize(o, dir) {
    pushHistory(); o.size = clamp(Math.round(o.size * (dir > 0 ? 1.15 : 0.87)), 12, 90);
    var d = objEl(o.id); styleTextObj(d, o); markDirty(); positionObjBar();
  }
  function recolorObj(o) {
    var first = true;
    colorDialog(o.type === 'sticky' ? '便利贴颜色' : o.type === 'tape' ? '胶带颜色' : '文字颜色', function () { return o.color; }, function (c) {
      if (first) { pushHistory(); first = false; }
      o.color = c; var d = objEl(o.id);
      if (d) { if (o.type === 'tape') d.style.background = c; else styleTextObj(d, o); }
      markDirty();
    });
  }
  function dupObj(o) {
    pushHistory();
    var n = Object.assign({}, o, { id: DB.uid(), x: Math.min(PW - 60, o.x + 30), y: o.y + 30 });
    S.page.objects.push(n); buildObjects(); selectObj(n.id); markDirty();
  }
  function delObj(id) {
    pushHistory(); S.page.objects = S.page.objects.filter(function (o) { return o.id !== id; });
    S.selObj = null; buildObjects(); markDirty();
  }

  /* 移动和缩放（选择工具） */
  objsLayer.addEventListener('pointerdown', function (e) {
    if (S.tool !== 'lasso') return;
    if (e.pointerType === 'touch' && penNear()) return;
    var d = e.target.closest ? e.target.closest('.obj') : null;
    if (e.target.classList && e.target.classList.contains('rh')) { startResize(e, d); return; }
    if (!d) { selectObj(null); return; }
    if (d.isContentEditable) return;
    if (S.sel) clearSel();
    selectObj(d.dataset.id); startDrag(e, d);
  });
  var lastObjTap = { id: '', t: 0 };
  function startDrag(e, d) {
    var o = objById(d.dataset.id); if (!o) return;
    var st = { x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, moved: false };
    try { d.setPointerCapture(e.pointerId); } catch (err) {}
    function mv(ev) {
      var dx = (ev.clientX - st.x) / S.s, dy = (ev.clientY - st.y) / S.s;
      if (!st.moved) { if (Math.hypot(dx, dy) * S.s < 4) return; st.moved = true; pushHistory(); }
      o.x = st.ox + dx; o.y = st.oy + dy; posObj(d, o); positionObjBar();
    }
    function up() {
      d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up);
      if (st.moved) markDirty();
      else if (o.type === 'text' || o.type === 'sticky') {
        var now = Date.now();
        if (lastObjTap.id === o.id && now - lastObjTap.t < 450) { lastObjTap = { id: '', t: 0 }; d.contentEditable = 'true'; d.focus(); }
        else lastObjTap = { id: o.id, t: now };
      }
    }
    d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  }
  function startResize(e, d) {
    e.stopPropagation(); e.preventDefault();
    var o = objById(d.dataset.id), h = e.target; if (!o) return;
    var st = { x: e.clientX, w: o.w, ratio: (o.h || 1) / o.w, started: false };
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
    function mv(ev) {
      if (!st.started) { st.started = true; pushHistory(); }
      o.w = clamp(st.w + (ev.clientX - st.x) / S.s, 60, PW);
      if (o.type === 'image' || o.type === 'emoji') o.h = o.w * st.ratio;
      posObj(d, o); positionObjBar();
    }
    function up() { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); if (st.started) markDirty(); }
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }

  /* 点空白处新建文字 / 便利贴 */
  objsLayer.addEventListener('click', function (e) {
    if (e.target !== objsLayer || !S.page) return;
    if (S.tool !== 'text' && S.tool !== 'sticky') return;
    var r = objsLayer.getBoundingClientRect();
    var x = clamp((e.clientX - r.left) / S.s, 10, PW - 80), y = clamp((e.clientY - r.top) / S.s, 10, S.page.h - 60);
    var o;
    if (S.tool === 'text') {
      o = { id: DB.uid(), type: 'text', x: x, y: y, w: Math.min(440, PW - x - 10), h: 0, text: '', size: TEXT_SIZES[S.cfg.text.size], color: S.cfg.text.color };
    } else {
      o = { id: DB.uid(), type: 'sticky', x: Math.min(x, PW - 320), y: y, w: 300, h: 200, text: '', size: 26, color: S.cfg.sticky.color };
    }
    pushHistory(); S.page.objects.push(o); buildObjects(); markDirty();
    var d = objEl(o.id); if (d) d.focus();
  });

  async function insertImage(blob) {
    if (!S.page) { Q.toast('先打开一本笔记。'); return; }
    activate(S.vIdx);
    var im;
    try { im = await AI.prepareImage(blob, 1800); } catch (e) { Q.toast('这张图读不了。'); return; }
    var bm = await createImageBitmap(im.blob);
    var w = Math.min(520, PW * 0.6), h = w * bm.height / bm.width;
    if (h > S.page.h * 0.8) { h = S.page.h * 0.8; w = h * bm.width / bm.height; }
    var sr = stage.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    var cx = ((sr.left + sr.width / 2) - wr.left) / S.s, cy = ((sr.top + sr.height / 2) - wr.top) / S.s;
    var o = { id: DB.uid(), type: 'image', x: clamp(cx - w / 2, 0, PW - w), y: clamp(cy - h / 2, 0, S.page.h - h), w: w, h: h, blob: im.blob };
    pushHistory(); S.page.objects.push(o); setTool('lasso'); selectObj(o.id); markDirty();
  }
  function addSticky(text, anchor) {
    if (!S.page) return false;
    var pi = -1;
    if (anchor && anchor.pageId) pi = S.pages.findIndex(function (p) { return p.id === anchor.pageId; });
    if (pi < 0) { activate(S.vIdx); pi = S.idx; }
    var page = S.pages[pi];
    var t = String(text || '').trim().slice(0, 420);
    var w = 440, lines = Math.max(3, Math.ceil(t.length / 17) + (t.split('\n').length - 1));
    var h = clamp(Math.round(lines * 22 * 1.4 + 26), 110, 720);
    var x = 60, y;
    if (anchor && anchor.bbox) {
      var b = anchor.bbox;
      x = b.x + b.w + 22; y = b.y;
      if (x + w > PW - 10) { x = clamp(b.x, 10, PW - w - 10); y = b.y + b.h + 22; }
    } else {
      var sr = stage.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      y = ((sr.top + sr.height / 2) - wr.top) / S.s - h / 2;
    }
    y = clamp(y, 10, Math.max(10, page.h - h - 10));
    var o = { id: DB.uid(), type: 'sticky', x: x, y: y, w: w, h: h, text: t, size: 22, color: STICKY[0] };
    if (page === S.page) { pushHistory(); S.page.objects.push(o); buildObjects(); markDirty(); }
    else { page.objects.push(o); page.updated = Date.now(); DB.put(page); if (slots[pi]) slots[pi].ver = -1; renderVisible(); }
    Q.toast('已贴到第 ' + (pi + 1) + ' 页' + (anchor ? '，圈选处旁边' : '') + '。');
    return true;
  }
  function viewCenter() {
    var sr = stage.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    return { x: ((sr.left + sr.width / 2) - wr.left) / S.s, y: ((sr.top + sr.height / 2) - wr.top) / S.s };
  }
  var STICKERS = [
    ['标记', ['✅', '❌', '⭕', '❓', '❗', '‼️', '⭐', '🌟', '💡', '📌', '📍', '🔖', '⚠️', '🚩', '✔️', '➡️', '⬅️', '⬆️', '⬇️', '↩️', '🔥', '💯', '🎯', '🔍', '🔔', '🚫']],
    ['学习', ['📚', '📖', '✏️', '📝', '🧮', '📊', '📈', '📉', '💰', '💵', '🏦', '🌍', '🔬', '🧪', '⏰', '📅', '🎓', '💻', '📐', '📎', '🗂️', '🧠', '🔑', '⚖️', '🏷️', '🧾']],
    ['心情', ['😀', '😅', '🤔', '😭', '😎', '🥳', '😴', '🤯', '😤', '🥹', '👍', '👎', '👏', '💪', '🙏', '❤️', '💔', '🫡']],
    ['装饰', ['🌸', '🌈', '☀️', '🌙', '✨', '🍀', '🎀', '🎈', '🎉', '🐱', '🐶', '🐻', '🐰', '☕', '🍰', '🍎', '🌻', '🦋']]
  ];
  var LABELS = [['重点', '#ffc9c9'], ['易错', '#ffd8a8'], ['待查', '#a5d8ff'], ['背诵', '#b2f2bb'], ['公式', '#d0bfff'], ['例题', '#fff3a3'], ['疑问', '#fcc2d7'], ['总结', '#99e9f2']];
  var TAPES = ['#ffd43b', '#ff8787', '#69db7c', '#74c0fc', '#da77f2', '#ffa94d', '#f783ac', '#adb5bd'];
  function addObj(o) { activate(S.vIdx); pushHistory(); S.page.objects.push(o); setTool('lasso'); selectObj(o.id); markDirty(); }
  function stickerDialog(tab) {
    if (!S.page) { Q.toast('先打开一本笔记。'); return; }
    activate(S.vIdx);
    tab = tab || 0;
    var names = ['标签', '胶带'].concat(STICKERS.map(function (x) { return x[0]; }));
    dialog(function (box) {
      box.appendChild(el('h3', null, '贴纸'));
      var tabs = el('div', 'cd-tabs');
      names.forEach(function (n, i) {
        var t = el('button', null, n); t.type = 'button'; t.setAttribute('aria-pressed', i === tab ? 'true' : 'false');
        t.addEventListener('click', function () { stickerDialog(i); }); tabs.appendChild(t);
      });
      box.appendChild(tabs);
      var g = el('div', 'st-grid'); box.appendChild(g);
      var c = viewCenter();
      if (tab === 0) {
        LABELS.forEach(function (l) {
          var b = el('button', 'st-label', l[0]); b.type = 'button'; b.style.background = l[1];
          b.addEventListener('click', function () {
            closeDialog();
            addObj({ id: DB.uid(), type: 'sticky', x: clamp(c.x - 90, 10, PW - 190), y: clamp(c.y - 30, 10, S.page.h - 90), w: 180, h: 64, text: l[0], size: 30, color: l[1] });
          });
          g.appendChild(b);
        });
        box.appendChild(el('p', 'muted', '点一个，贴到当前画面中间。可以双击改字、拖动、缩放。'));
      } else if (tab === 1) {
        TAPES.forEach(function (col) {
          var b = el('button', 'st-tape'); b.type = 'button'; b.style.background = col; b.setAttribute('aria-label', '胶带 ' + col);
          b.addEventListener('click', function () {
            closeDialog();
            addObj({ id: DB.uid(), type: 'tape', x: clamp(c.x - 140, 0, PW - 280), y: clamp(c.y - 22, 0, S.page.h - 44), w: 280, h: 44, color: col });
          });
          g.appendChild(b);
        });
        box.appendChild(el('p', 'muted', '半透明胶带，可以盖在笔迹或图片上。拖右下角圆点改长度，“换色”可以自己调颜色。'));
      } else {
        STICKERS[tab - 2][1].forEach(function (em) {
          var b = el('button', 'st-emoji', em); b.type = 'button'; b.setAttribute('aria-label', '贴纸 ' + em);
          b.addEventListener('click', function () {
            closeDialog();
            addObj({ id: DB.uid(), type: 'emoji', x: clamp(c.x - 45, 0, PW - 90), y: clamp(c.y - 45, 0, S.page.h - 90), w: 90, h: 90, text: em });
          });
          g.appendChild(b);
        });
      }
      var row = el('div', 'row'); row.style.marginTop = '12px';
      var cl = el('button', 'btn', '关闭'); cl.type = 'button'; cl.addEventListener('click', closeDialog); row.appendChild(cl); box.appendChild(row);
    });
  }
  $('nStickerBtn').addEventListener('click', function () { stickerDialog(0); });
  $('nImgBtn').addEventListener('click', function () { $('nImgIn').click(); });
  $('nImgIn').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (f) insertImage(f);
  });
  document.addEventListener('paste', function (e) {
    if ($('view-notes').hidden || $('nEditor').hidden) return;
    var items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) { e.preventDefault(); insertImage(f); return; }
      }
    }
  });
  stage.addEventListener('dragover', function (e) { e.preventDefault(); });
  stage.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/^image\//.test(f.type)) insertImage(f);
    else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) closeEditor().then(function () { importMany([f]); });
  });

  document.addEventListener('keydown', function (e) {
    if ($('view-notes').hidden || $('nEditor').hidden) return;
    var a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    var mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (S.sel && !S.sel.region) { e.preventDefault(); deleteSelection(); }
      else if (S.selObj) { e.preventDefault(); delObj(S.selObj); }
    }
  });

  /* ================= 笔记本列表 ================= */
  async function renderList() {
    var grid = $('nbGrid'); grid.textContent = '';
    var nbs = (await DB.all('notebook')).sort(function (a, b) { return b.updated - a.updated; });
    if (!nbs.length) {
      grid.appendChild(el('div', 'empty book-empty', '还没有文档。点“导入 PDF / 图片”，把资料放进来，直接读、写、圈着问 AI；也可以新建空白笔记本。'));
      return;
    }
    nbs.forEach(function (nb) {
      var card = el('article', 'nb-card');
      var cover = el('button', 'nb-cover'); cover.type = 'button'; cover.setAttribute('aria-label', '打开 ' + nb.title);
      var sp = el('span', 'spine'); sp.style.background = nb.color || SPINES[0]; cover.appendChild(sp);
      if (nb.pageIds[0]) DB.get(nb.pageIds[0]).then(function (p) {
        if (p && p.thumb) { var im = el('img'); im.alt = ''; var u = URL.createObjectURL(p.thumb); im.src = u; im.onload = function () { URL.revokeObjectURL(u); }; cover.insertBefore(im, sp); }
      });
      cover.addEventListener('click', function () { openNotebook(nb.id); });
      card.appendChild(cover);
      var meta = el('div', 'nb-meta');
      meta.appendChild(el('b', null, nb.title));
      meta.appendChild(el('span', null, nb.pageIds.length + ' 页 · ' + fmtDay(nb.updated)));
      card.appendChild(meta);
      var acts = el('div', 'nb-acts');
      acts.appendChild(barBtnSmall('重命名', function () { renameDialog(nb); }));
      acts.appendChild(barBtnSmall('导出 PDF', function () { exportPdfOf(nb); }));
      acts.appendChild(Q.confirmButton('删除', '确认删除', '', async function () {
        for (var i = 0; i < nb.pageIds.length; i++) await DB.del(nb.pageIds[i]);
        await DB.del(nb.id); renderList();
      }));
      card.appendChild(acts); grid.appendChild(card);
    });
  }
  function barBtnSmall(label, fn) { var b = el('button', 'btn small', label); b.type = 'button'; b.addEventListener('click', fn); return b; }

  function tplPicker(initial, onPick) {
    var row = el('div', 'tpl'), cur = initial;
    TPLS.forEach(function (t) {
      var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', t[0] === cur ? 'true' : 'false');
      var cv = document.createElement('canvas'); cv.width = 120; cv.height = 132;
      var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 120, 132);
      ctx.scale(120 / PW, 120 / PW); paintTemplate(ctx, t[0], PW, 1100);
      b.appendChild(cv); b.appendChild(el('span', null, t[1]));
      b.addEventListener('click', function () {
        cur = t[0]; row.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); onPick(cur);
      });
      row.appendChild(b);
    });
    return row;
  }
  function newNotebookDialog() {
    dialog(function (box) {
      box.appendChild(el('h3', null, '新建笔记本'));
      var f = el('label', 'fld', '名称'); f.setAttribute('for', 'nbTitle');
      var inp = document.createElement('input'); inp.type = 'text'; inp.id = 'nbTitle'; inp.value = '笔记本 ' + new Date().toLocaleDateString('zh-CN'); f.appendChild(inp); box.appendChild(f);
      var tpl = 'lined';
      box.appendChild(el('div', 'lbl muted', '纸张'));
      box.appendChild(tplPicker(tpl, function (v) { tpl = v; }));
      var row = el('div', 'row');
      var ok = el('button', 'btn primary', '创建'); ok.type = 'button';
      ok.addEventListener('click', async function () {
        ok.disabled = true;
        var nb = await createNotebook(inp.value.trim() || '无标题', tpl); closeDialog(); openNotebook(nb.id);
      });
      var no = el('button', 'btn', '取消'); no.type = 'button'; no.addEventListener('click', closeDialog);
      row.appendChild(ok); row.appendChild(no); box.appendChild(row);
      setTimeout(function () { inp.select(); }, 0);
    });
  }
  function renameDialog(nb) {
    dialog(function (box) {
      box.appendChild(el('h3', null, '重命名'));
      var inp = document.createElement('input'); inp.type = 'text'; inp.value = nb.title; inp.setAttribute('aria-label', '名称'); inp.style.width = '100%'; inp.style.marginBottom = '12px';
      box.appendChild(inp);
      var row = el('div', 'row');
      var ok = el('button', 'btn primary', '保存'); ok.type = 'button';
      ok.addEventListener('click', async function () {
        nb.title = inp.value.trim() || '无标题'; nb.updated = Date.now(); await DB.put(nb);
        if (S.nb && S.nb.id === nb.id) $('edTitle').textContent = nb.title;
        closeDialog(); if (!$('nList').hidden) renderList();
      });
      var no = el('button', 'btn', '取消'); no.type = 'button'; no.addEventListener('click', closeDialog);
      row.appendChild(ok); row.appendChild(no); box.appendChild(row);
      setTimeout(function () { inp.select(); }, 0);
    });
  }
  $('nbNew').addEventListener('click', newNotebookDialog);
  $('edTitle').addEventListener('click', function () { if (S.nb) renameDialog(S.nb); });

  /* ---------- 导入 PDF / 图片 ---------- */
  /* 读取 PDF 自带的目录（书签），转成页码；没有目录就是空 */
  async function readOutline(pdf) {
    var out = [];
    var ol = await pdf.getOutline();
    if (!ol) return out;
    async function walk(items, depth) {
      for (var i = 0; i < items.length && out.length < 400; i++) {
        var it = items[i], pi = -1;
        try {
          var dest = it.dest;
          if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest) && dest[0] != null) pi = (typeof dest[0] === 'object') ? await pdf.getPageIndex(dest[0]) : dest[0];
        } catch (e) {}
        if (pi >= 0 && it.title) out.push({ t: String(it.title).slice(0, 80), p: pi, d: depth });
        if (it.items && it.items.length && depth < 2) await walk(it.items, depth + 1);
      }
    }
    await walk(ol, 0);
    return out;
  }
  async function importFile(file, noOpen) {
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    var title = file.name.replace(/\.[^.]+$/, '') || '导入的笔记';
    var nb = { id: 'nb-' + DB.uid(), type: 'notebook', title: title, ts: Date.now(), updated: Date.now(), tpl: 'blank',
      color: SPINES[Math.floor(Math.random() * SPINES.length)], pageIds: [], lastIdx: 0, imported: true };
    try {
      if (isPdf) {
        await Q.loadPdfJs();
        var pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        if (pdf.numPages > 120) { Q.toast('这个 PDF 有 ' + pdf.numPages + ' 页，比较大，导入会花一些时间。'); }
        for (var i = 1; i <= pdf.numPages; i++) {
          Q.toast('正在导入 ' + i + ' / ' + pdf.numPages + ' 页…');
          var pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: 1400 / v1.width });
          var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: cx, viewport: vp }).promise;
          var blob = await toBlob(c, 'image/jpeg', 0.82);
          var p = newPage(nb, { bg: blob, h: Math.round(PW * c.height / c.width) });
          await DB.put(p); nb.pageIds.push(p.id);
          c.width = c.height = 1;
        }
        try { nb.outline = await readOutline(pdf); } catch (e) { nb.outline = []; }
      } else if (/^image\//.test(file.type)) {
        var im = await AI.prepareImage(file, 1600), bm = await createImageBitmap(im.blob);
        var p1 = newPage(nb, { bg: im.blob, h: Math.round(PW * bm.height / bm.width) });
        await DB.put(p1); nb.pageIds.push(p1.id);
      } else { Q.toast('只能导入 PDF 或图片。'); return; }
      await DB.put(nb); Q.toast('导入完成。');
      if (!noOpen) openNotebook(nb.id); else renderList();
    } catch (e) { Q.toast('导入失败：' + Q.errMsg(e)); }
  }
  async function importMany(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || /^image\//.test(f.type); });
    if (!files.length) { Q.toast('只能导入 PDF 或图片。'); return; }
    for (var i = 0; i < files.length; i++) await importFile(files[i], files.length > 1 && i < files.length - 1);
  }
  $('nbImport').addEventListener('change', function (e) { var fs = e.target.files; var arr = fs ? Array.prototype.slice.call(fs) : []; e.target.value = ''; if (arr.length) importMany(arr); });
  /* 把文件拖进来（iPad 分屏时从“文件”App 拖进 W）直接导入 */
  var listView = $('nList');
  listView.addEventListener('dragover', function (e) { e.preventDefault(); });
  listView.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) importMany(e.dataTransfer.files); });

  /* ================= 打开 / 关闭笔记本 ================= */
  async function openNotebook(id) {
    var nb = await DB.get(id); if (!nb) { Q.toast('找不到这本笔记。'); return; }
    var pages = [];
    for (var i = 0; i < nb.pageIds.length; i++) { var p = await DB.get(nb.pageIds[i]); if (p) pages.push(p); }
    if (!pages.length) { var np = newPage(nb); await DB.put(np); pages.push(np); nb.pageIds = [np.id]; await DB.put(nb); }
    S.nb = nb; S.pages = pages; S.idx = clamp(nb.lastIdx || 0, 0, pages.length - 1); S.page = pages[S.idx];
    S.history = []; S.future = []; S.sel = null; S.selObj = null; S.zoom = 1; S.vIdx = S.idx; hmap = {};
    $('nList').hidden = true; $('nEditor').hidden = false;
    $('edTitle').textContent = nb.title;
    updateUndo(); updatePageBtn(); applyPenSeen();
    buildStrip();
    var t0 = nb.tool && TOOLS.indexOf(nb.tool) >= 0 ? nb.tool : (nb.imported && !S.penSeen ? 'read' : 'pen');
    if (t0 === 'read' && S.penSeen && !S.fingerAlways) t0 = 'pen';
    setTool(t0);
    requestAnimationFrame(function () { layout(); scrollToPage(S.idx, false); });
  }
  async function closeEditor() {
    await saveNow(); if (S.thumbPending) await makeThumb();
    closeDrawer(); closeToc(); document.body.classList.remove('focus'); $('edFocus').setAttribute('aria-pressed', 'false');
    S.nb = null; S.page = null; S.pages = []; clearStrip(); releaseUrls();
    $('nEditor').hidden = true; $('nList').hidden = false; renderList();
  }
  $('edBack').addEventListener('click', closeEditor);

  function gotoPage(i, smooth) {
    if (!S.page) return;
    i = clamp(i, 0, S.pages.length - 1);
    if (slots.length !== S.pages.length) { buildStrip(); layout(); }
    activate(i);
    S.vIdx = i; updatePageBtn(); markTocCur();
    scrollToPage(i, !!smooth);
  }
  function updatePageBtn() {
    $('edPages').textContent = '目录 ' + (S.vIdx + 1) + ' / ' + S.pages.length;
    $('edPrev').disabled = S.vIdx <= 0; $('edNext').disabled = S.vIdx >= S.pages.length - 1;
  }
  (function () {
    var head = $('edPages').parentNode;
    var prev = el('button', 'btn small', '‹'); prev.type = 'button'; prev.id = 'edPrev'; prev.setAttribute('aria-label', '上一页');
    var next = el('button', 'btn small', '›'); next.type = 'button'; next.id = 'edNext'; next.setAttribute('aria-label', '下一页');
    head.insertBefore(prev, $('edPages')); head.insertBefore(next, $('edPages').nextSibling);
    prev.addEventListener('click', function () { gotoPage(S.vIdx - 1, true); });
    next.addEventListener('click', function () { gotoPage(S.vIdx + 1, true); });
  })();

  /* ---------- 页面总览 ---------- */
  async function addPageAfter(i) {
    var p = newPage(S.nb, { tpl: S.nb.tpl });
    await DB.put(p);
    S.pages.splice(i + 1, 0, p); S.nb.pageIds = S.pages.map(function (x) { return x.id; });
    S.nb.updated = Date.now(); await DB.put(S.nb);
    S.idx = S.pages.indexOf(S.page); buildStrip(); layout(); updatePageBtn();
  }
  function pagesDialog() {
    if (!S.page) return;
    dialog(function (box) {
      box.appendChild(el('h3', null, '页面（共 ' + S.pages.length + ' 页）'));
      if (!S.page.bg) {
        box.appendChild(el('div', 'lbl muted', '本页纸张'));
        box.appendChild(tplPicker(S.page.tpl, function (v) { S.page.tpl = v; drawBg(); markDirty(); }));
      }
      var grid = el('div', 'pg-grid');
      S.pages.forEach(function (p, i) {
        var card = el('div', 'pg-card' + (i === S.idx ? ' cur' : ''));
        var th = el('button', 'th'); th.type = 'button'; th.setAttribute('aria-label', '去第 ' + (i + 1) + ' 页');
        var im = el('img'); im.alt = '';
        if (p === S.page) { renderCanvas(p, { x: 0, y: 0, w: PW, h: p.h }, 200 / PW).then(function (c) { im.src = c.toDataURL('image/jpeg', 0.7); }); }
        else if (p.thumb) { var u = URL.createObjectURL(p.thumb); im.src = u; im.onload = function () { URL.revokeObjectURL(u); }; }
        else renderCanvas(p, { x: 0, y: 0, w: PW, h: p.h }, 200 / PW).then(function (c) { im.src = c.toDataURL('image/jpeg', 0.7); });
        th.appendChild(im);
        th.addEventListener('click', function () { closeDialog(); gotoPage(i); });
        card.appendChild(th); card.appendChild(el('div', 'num', String(i + 1)));
        var acts = el('div', 'acts');
        var up = el('button', null, '↑'); up.type = 'button'; up.disabled = i === 0; up.setAttribute('aria-label', '上移');
        var dn = el('button', null, '↓'); dn.type = 'button'; dn.disabled = i === S.pages.length - 1; dn.setAttribute('aria-label', '下移');
        var dp = el('button', null, '复制'); dp.type = 'button';
        up.addEventListener('click', function () { movePage(i, -1); });
        dn.addEventListener('click', function () { movePage(i, 1); });
        dp.addEventListener('click', function () { dupPage(i); });
        acts.appendChild(up); acts.appendChild(dn); acts.appendChild(dp);
        acts.appendChild(Q.confirmButton('删', '确认', '', function () { delPage(i); }));
        card.appendChild(acts); grid.appendChild(card);
      });
      box.appendChild(grid);
      var row = el('div', 'row'); row.style.marginTop = '14px';
      var add = el('button', 'btn primary', '在本页后添加一页'); add.type = 'button';
      add.addEventListener('click', async function () { var at = S.vIdx; await addPageAfter(at); closeDialog(); gotoPage(at + 1); });
      var cl = el('button', 'btn', '关闭'); cl.type = 'button'; cl.addEventListener('click', closeDialog);
      row.appendChild(add); row.appendChild(cl); box.appendChild(row);
    });
  }
  async function movePage(i, d) {
    var j = i + d; if (j < 0 || j >= S.pages.length) return;
    var cp = S.page; var t = S.pages[i]; S.pages[i] = S.pages[j]; S.pages[j] = t;
    S.nb.pageIds = S.pages.map(function (x) { return x.id; }); S.idx = S.pages.indexOf(cp); S.nb.lastIdx = S.idx; S.vIdx = S.idx;
    await DB.put(S.nb); buildStrip(); layout(); updatePageBtn(); pagesDialog();
  }
  async function dupPage(i) {
    await saveNow();
    var src = S.pages[i];
    var p = Object.assign({}, src, { id: 'pg-' + DB.uid(), ts: Date.now(), updated: Date.now(),
      objects: src.objects.map(function (o) { return Object.assign({}, o, { id: DB.uid() }); }) });
    await DB.put(p); S.pages.splice(i + 1, 0, p);
    S.nb.pageIds = S.pages.map(function (x) { return x.id; }); S.idx = S.pages.indexOf(S.page); await DB.put(S.nb);
    buildStrip(); layout(); updatePageBtn(); pagesDialog();
  }
  async function delPage(i) {
    if (S.pages.length === 1) {
      var p0 = S.pages[0]; p0.strokes = []; p0.objects = []; p0.thumb = null; await DB.put(p0);
      S.history = []; S.future = []; closeDialog(); layout(); updateUndo(); if (slots[0]) slots[0].ver = -1; return;
    }
    var gone = S.pages[i]; S.pages.splice(i, 1); await DB.del(gone.id);
    S.nb.pageIds = S.pages.map(function (x) { return x.id; }); await DB.put(S.nb);
    closeDialog();
    if (gone === S.page) { S.idx = Math.min(i, S.pages.length - 1); S.page = S.pages[S.idx]; S.nb.lastIdx = S.idx; S.history = []; S.future = []; S.sel = null; S.selObj = null; }
    else { S.idx = S.pages.indexOf(S.page); }
    S.vIdx = clamp(S.vIdx, 0, S.pages.length - 1); buildStrip(); layout(); updateUndo(); updatePageBtn();
  }

  /* ================= 导出 ================= */
  function buildPdf(pages) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    function add(d) { var b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; }
    var n = pages.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    add('%PDF-1.4\n');
    offs[1] = len; add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offs[2] = len; add('2 0 obj\n<< /Type /Pages /Kids [ ' + kids.join(' ') + ' ] /Count ' + n + ' >>\nendobj\n');
    pages.forEach(function (p, i) {
      var pid = 3 + i * 3, cid = 4 + i * 3, iid = 5 + i * 3;
      var W = 595.28, H = +(W * p.h / p.w).toFixed(2);
      offs[pid] = len;
      add(pid + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + iid + ' 0 R >> >> /Contents ' + cid + ' 0 R >>\nendobj\n');
      var content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
      offs[cid] = len;
      add(cid + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
      offs[iid] = len;
      add(iid + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>\nstream\n');
      add(p.jpg); add('\nendstream\nendobj\n');
    });
    var total = 3 + n * 3, xref = len, x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var id = 1; id < total; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    add(x); add('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function exportPdfOf(nb) {
    var pages = [];
    if (S.nb && S.nb.id === nb.id) { await saveNow(); pages = S.pages; }
    else for (var i = 0; i < nb.pageIds.length; i++) { var p = await DB.get(nb.pageIds[i]); if (p) pages.push(p); }
    if (!pages.length) return;
    var out = [];
    try {
      for (var j = 0; j < pages.length; j++) {
        Q.toast('正在生成 PDF：' + (j + 1) + ' / ' + pages.length);
        var pg = pages[j], c = await renderCanvas(pg, { x: 0, y: 0, w: PW, h: pg.h }, 1.4);
        var jb = await toBlob(c, 'image/jpeg', 0.86);
        out.push({ jpg: new Uint8Array(await jb.arrayBuffer()), w: c.width, h: c.height });
        c.width = c.height = 1;
      }
    } catch (e) { Q.toast('生成 PDF 失败：' + Q.errMsg(e)); return; }
    var blob = buildPdf(out), name = (nb.title || '笔记') + '.pdf';
    dialog(function (box) {
      box.appendChild(el('h3', null, 'PDF 已生成'));
      box.appendChild(el('p', 'muted', pages.length + ' 页，' + (blob.size / 1048576).toFixed(1) + ' MB。点下面的按钮保存或分享。'));
      var row = el('div', 'row'); row.style.marginTop = '12px';
      var sv = el('button', 'btn primary', '保存 / 分享'); sv.type = 'button';
      sv.addEventListener('click', function () { Q.saveFile(name, blob, 'application/pdf'); });
      var cl = el('button', 'btn', '关闭'); cl.type = 'button'; cl.addEventListener('click', closeDialog);
      row.appendChild(sv); row.appendChild(cl); box.appendChild(row);
    });
  }
  async function exportPng() {
    activate(S.vIdx); var p = S.page;
    try {
      var c = await renderCanvas(p, { x: 0, y: 0, w: PW, h: p.h }, 1.6);
      var blob = await toBlob(c, 'image/png');
      var name = (S.nb.title || '笔记') + '-第' + (S.idx + 1) + '页.png';
      dialog(function (box) {
        box.appendChild(el('h3', null, '图片已生成'));
        var row = el('div', 'row'); row.style.marginTop = '12px';
        var sv = el('button', 'btn primary', '保存 / 分享'); sv.type = 'button';
        sv.addEventListener('click', function () { Q.saveFile(name, blob, 'image/png'); });
        var cl = el('button', 'btn', '关闭'); cl.type = 'button'; cl.addEventListener('click', closeDialog);
        row.appendChild(sv); row.appendChild(cl); box.appendChild(row);
      });
    } catch (e) { Q.toast('导出失败：' + Q.errMsg(e)); }
  }
  $('edExport').addEventListener('click', function () {
    if (!S.page) return;
    dialog(function (box) {
      box.appendChild(el('h3', null, '导出'));
      var row = el('div', 'row');
      var a = el('button', 'btn primary', '整本导出为 PDF'); a.type = 'button';
      a.addEventListener('click', function () { closeDialog(); exportPdfOf(S.nb); });
      var b = el('button', 'btn', '本页导出为图片'); b.type = 'button';
      b.addEventListener('click', function () { closeDialog(); exportPng(); });
      var c = el('button', 'btn', '取消'); c.type = 'button'; c.addEventListener('click', closeDialog);
      row.appendChild(a); row.appendChild(b); row.appendChild(c); box.appendChild(row);
    });
  });

  /* ================= AI 抽屉与专注模式 ================= */
  var drawer = $('nDrawer'), edBody = drawer.parentNode;
  var AIWIN = null;
  try { AIWIN = JSON.parse(localStorage.getItem('quanwen.aiwin') || 'null'); } catch (e) {}
  function aiGeomDefault() {
    var W = edBody.clientWidth, H = edBody.clientHeight;
    if (W < 700) return { x: 8, y: Math.round(H * 0.34), w: W - 16, h: Math.round(H * 0.64) };
    var w = Math.min(420, Math.round(W * 0.4));
    return { x: W - w - 12, y: 12, w: w, h: Math.max(260, H - 24) };
  }
  function applyAiGeom(g) {
    var W = edBody.clientWidth, H = edBody.clientHeight;
    g = g || AIWIN || aiGeomDefault();
    var w = clamp(g.w, 260, Math.max(260, W - 8)), h = clamp(g.h, 200, Math.max(200, H - 8));
    var x = clamp(g.x, 4, Math.max(4, W - w - 4)), y = clamp(g.y, 4, Math.max(4, H - h - 4));
    drawer.style.left = x + 'px'; drawer.style.top = y + 'px'; drawer.style.width = w + 'px'; drawer.style.height = h + 'px';
    return { x: x, y: y, w: w, h: h };
  }
  function saveAiGeom() {
    var g = { x: drawer.offsetLeft, y: drawer.offsetTop, w: drawer.offsetWidth, h: drawer.offsetHeight };
    AIWIN = g; try { localStorage.setItem('quanwen.aiwin', JSON.stringify(g)); } catch (e) {}
  }
  function openDrawer() {
    drawer.hidden = false; applyAiGeom();
    $('edAI').setAttribute('aria-pressed', 'true');
  }
  function closeDrawer() {
    drawer.hidden = true;
    $('edAI').setAttribute('aria-pressed', 'false');
  }
  $('edAI').addEventListener('click', function () { if (drawer.hidden) openDrawer(); else closeDrawer(); });
  $('drawerClose').addEventListener('click', closeDrawer);
  /* 拖标题栏移动；拖左下 / 右下角改大小 */
  (function () {
    function track(startEv, onMove) {
      var id = startEv.pointerId, t = startEv.target;
      try { t.setPointerCapture(id); } catch (e) {}
      function mv(e) { if (e.pointerId === id) onMove(e.clientX - startEv.clientX, e.clientY - startEv.clientY); }
      function up(e) {
        if (e.pointerId !== id) return;
        t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up);
        saveAiGeom();
      }
      t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
    }
    $('drawerHead').addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      var g0 = { x: drawer.offsetLeft, y: drawer.offsetTop, w: drawer.offsetWidth, h: drawer.offsetHeight };
      track(e, function (dx, dy) { applyAiGeom({ x: g0.x + dx, y: g0.y + dy, w: g0.w, h: g0.h }); });
    });
    $('rzR').addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var g0 = { x: drawer.offsetLeft, y: drawer.offsetTop, w: drawer.offsetWidth, h: drawer.offsetHeight };
      track(e, function (dx, dy) { applyAiGeom({ x: g0.x, y: g0.y, w: g0.w + dx, h: g0.h + dy }); });
    });
    $('rzL').addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var g0 = { x: drawer.offsetLeft, y: drawer.offsetTop, w: drawer.offsetWidth, h: drawer.offsetHeight };
      track(e, function (dx, dy) {
        var w = clamp(g0.w - dx, 260, g0.x + g0.w - 4);
        applyAiGeom({ x: g0.x + g0.w - w, y: g0.y, w: w, h: g0.h + dy });
      });
    });
  })();

  /* ---------- 目录：页面缩略图、PDF 目录、跳页 ---------- */
  var toc = $('nToc'), tocIO = null;
  function openToc() { toc.hidden = false; $('edPages').setAttribute('aria-pressed', 'true'); renderToc(); }
  function closeToc() { toc.hidden = true; $('edPages').setAttribute('aria-pressed', 'false'); if (tocIO) { tocIO.disconnect(); tocIO = null; } }
  function tocJump(i) { gotoPage(i); if (edBody.clientWidth < 700) closeToc(); else markTocCur(); }
  function renderToc(keepScroll) {
    var body = $('tocBody'), top = toc.scrollTop;
    body.textContent = '';
    if (tocIO) { tocIO.disconnect(); tocIO = null; }
    var ol = S.nb && S.nb.outline;
    if (ol && ol.length) {
      body.appendChild(el('div', 'lbl toc-lbl', 'PDF 目录'));
      var list = el('div', 'toc-ol');
      ol.forEach(function (o) {
        var b = el('button', 'toc-item', o.t); b.type = 'button'; b.style.paddingLeft = (10 + (o.d || 0) * 14) + 'px';
        b.appendChild(el('span', 'pn', String(o.p + 1)));
        b.addEventListener('click', function () { tocJump(clamp(o.p, 0, S.pages.length - 1)); });
        list.appendChild(b);
      });
      body.appendChild(list);
    }
    body.appendChild(el('div', 'lbl toc-lbl', '页面（' + S.pages.length + '）'));
    var grid = el('div', 'toc-grid');
    tocIO = ('IntersectionObserver' in window) ? new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var im = en.target; tocIO.unobserve(im);
        var p = S.pages[+im.dataset.i], bl = p && (p.thumb || p.bg);
        if (bl) { var u = URL.createObjectURL(bl); im.src = u; im.onload = function () { URL.revokeObjectURL(u); }; }
      });
    }, { root: toc, rootMargin: '200px' }) : null;
    S.pages.forEach(function (p, i) {
      var c = el('button', 'toc-pg' + (i === S.vIdx ? ' cur' : '')); c.type = 'button'; c.setAttribute('aria-label', '第 ' + (i + 1) + ' 页');
      var im = el('img'); im.alt = ''; im.dataset.i = i; im.style.aspectRatio = PW + ' / ' + (p.h || 1414);
      c.appendChild(im); c.appendChild(el('span', 'pn', String(i + 1)));
      c.addEventListener('click', function () { tocJump(i); });
      grid.appendChild(c);
      if (tocIO) tocIO.observe(im);
      else { var bl = p.thumb || p.bg; if (bl) { var u = URL.createObjectURL(bl); im.src = u; } }
    });
    body.appendChild(grid);
    if (keepScroll) toc.scrollTop = top;
    else { var cur0 = grid.children[S.vIdx]; if (cur0) setTimeout(function () { cur0.scrollIntoView({ block: 'center' }); }, 30); }
  }
  function markTocCur() {
    if (toc.hidden) return;
    var gs = toc.querySelectorAll('.toc-pg');
    for (var i = 0; i < gs.length; i++) gs[i].classList.toggle('cur', i === S.vIdx);
  }
  $('edPages').addEventListener('click', function () { if (toc.hidden) openToc(); else closeToc(); });
  $('tocClose').addEventListener('click', closeToc);
  $('tocManage').addEventListener('click', pagesDialog);
  function tocGo() {
    var v = parseInt($('tocGo').value, 10); if (!v) return;
    $('tocGo').value = ''; tocJump(clamp(v - 1, 0, S.pages.length - 1));
  }
  $('tocGoBtn').addEventListener('click', tocGo);
  $('tocGo').addEventListener('keydown', function (e) { if (e.key === 'Enter') tocGo(); });

  $('edFocus').addEventListener('click', function () {
    var on = !document.body.classList.contains('focus');
    document.body.classList.toggle('focus', on);
    $('edFocus').setAttribute('aria-pressed', on ? 'true' : 'false');
    setTimeout(layout, 30);
  });

  var rzT = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzT);
    rzT = setTimeout(function () { if (!$('view-notes').hidden && S.page) layout(); }, 200);
  });
  window.addEventListener('pagehide', function () { if (S.dirty) saveNow(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.dirty) saveNow(); });
  window.addEventListener('blur', function () { if (S.dirty) saveNow(); });

  /* ================= 对外 ================= */
  window.QWNotes = {
    enter: function () { if (!$('nEditor').hidden) { layout(); } else renderList(); },
    openAI: function () { openDrawer(); },
    leave: function () { saveNow(); closeDrawer(); closeToc(); document.body.classList.remove('focus'); $('edFocus').setAttribute('aria-pressed', 'false'); },
    canInsert: function () { return !!S.page && !$('nEditor').hidden && !$('view-notes').hidden; },
    addSticky: addSticky,
    currentId: function () { return S.nb ? S.nb.id : ''; },
    currentTitle: function () { return S.nb ? S.nb.title : ''; },
    insertImage: insertImage,
    _state: S
  };

  (function () {
    var cb = $('fingerAlways'); if (!cb) return;
    cb.checked = S.fingerAlways;
    cb.addEventListener('change', function () { S.fingerAlways = cb.checked; saveInput(); applyPenSeen(); });
    var info = $('storeInfo');
    if (info && navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (ok) { info.textContent = ok ? '存储状态：已申请长期保存。' : '存储状态：普通保存（正常使用不会丢）。'; }).catch(function () {});
    }
  })();
  renderOpts(); updateUndo(); applyPenSeen();
  renderList();
})();
