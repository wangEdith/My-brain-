/* W · 主程序 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PDF_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  /* ================= 设置 ================= */
  var LS_KEY = 'quanwen.settings.v2';
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var settings = Object.assign({ provider: 'gemini', keys: {}, models: {}, autoWord: true, autoWrong: true, draw: true, mode: 'en', strong: false }, lsGet(LS_KEY, {}));
  if (!settings.keys) settings.keys = {};
  if (!settings.models) settings.models = {};
  if (!AI.PROVIDERS[settings.provider]) settings.provider = 'gemini';
  function saveSettings() { lsSet(LS_KEY, settings); }

  /* ================= 小工具 ================= */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function hashId(s) {
    var h = 5381, g = 52711;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h = ((h << 5) + h + c) | 0;
      g = ((g << 5) ^ (g >>> 3) ^ c) | 0;
    }
    return (h >>> 0).toString(36) + (g >>> 0).toString(36);
  }
  function fmtTime(ts) { var d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtDay(ts) { return new Date(ts).toLocaleDateString('zh-CN'); }
  function errMsg(e) { return (e && (e.userMessage || e.message)) || '出了点问题，再试一次。'; }

  /* 点两次才执行的按钮（页面里没有确认弹窗） */
  function confirmButton(label, confirmLabel, cls, onConfirm) {
    var b = el('button', 'btn small ' + (cls || ''), label); b.type = 'button';
    var timer = null, armed = false;
    b.addEventListener('click', function () {
      if (armed) { clearTimeout(timer); armed = false; onConfirm(); return; }
      armed = true; b.textContent = confirmLabel; b.classList.add('confirm');
      timer = setTimeout(function () { armed = false; b.textContent = label; b.classList.remove('confirm'); }, 3000);
    });
    return b;
  }

  async function saveFile(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    try {
      var file = new File([blob], name, { type: type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('已复制。'); }
    catch (e) { toast('这个环境不让复制，换个方式吧。'); }
  }
  function copyImage(blob) {
    try {
      var png = createImageBitmap(blob).then(function (bmp) {
        var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        return new Promise(function (res) { c.toBlob(res, 'image/png'); });
      });
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
        function () { toast('图片已复制，去 ChatGPT / Gemini 里粘贴。'); },
        function () { toast('复制图片失败。可以长按页面里的图片再拷贝。'); });
    } catch (e) { toast('这个环境不能复制图片。'); }
  }

  /* ================= 视图切换 ================= */
  var currentView = 'notes';
  function showView(name) {
    if (currentView === 'notes' && name !== 'notes' && window.QWNotes) window.QWNotes.leave();
    currentView = name;
    ['read', 'notes', 'today', 'book', 'settings'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('#tabbar button').forEach(function (b) {
      if (b.getAttribute('data-view') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'read') renderPage();
    else if (name === 'notes') { if (window.QWNotes) window.QWNotes.enter(); }
    else if (name === 'today') renderToday();
    else if (name === 'book') renderBook();
    else syncSettingsUi();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('#tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });

  function updateBanner() {
    var b = $('banner');
    var has = AI.hasKey(settings);
    $('whoBadge').textContent = has ? AI.PROVIDERS[settings.provider].label.replace(/（.*）/, '') : '未填密钥';
    if (has) { b.hidden = true; return; }
    b.hidden = false; b.textContent = '还没有填 AI 密钥，填好才能提问。';
    var go = el('button', 'btn small', '去设置'); go.type = 'button';
    go.addEventListener('click', function () { showView('settings'); });
    b.appendChild(go);
  }

  /* ================= 示例页 ================= */
  function wrapText(g, text, x, y, maxW, lh) {
    var words = text.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = words[i]; y += lh; } else line = test;
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }
  function makeSample() {
    var W = 1100, H = 1500, c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#1b1b1b';
    g.font = '600 44px Georgia, "Times New Roman", serif';
    g.fillText('Chapter 4   Inflation and Monetary Policy', 80, 140);
    g.fillStyle = '#c8c8c8'; g.fillRect(80, 168, W - 160, 2); g.fillStyle = '#1b1b1b';
    g.font = '29px Georgia, "Times New Roman", serif';
    var y = 250, lh = 46, mw = W - 160;
    y = wrapText(g, 'When the general price level rises over a sustained period, each unit of currency buys fewer goods and services. Economists call this erosion of purchasing power inflation. A modest rate is usually regarded as benign, but persistent inflation can distort the signals that prices send to firms and households.', 80, y, mw, lh) + 26;
    y = wrapText(g, 'Central banks respond primarily by adjusting the policy interest rate. Raising it is known as monetary tightening: borrowing becomes costlier, the opportunity cost of spending rises, and aggregate demand cools. The effect, however, is rarely immediate, because many prices are sticky and wages adjust only with a lag.', 80, y, mw, lh) + 26;
    g.font = 'italic 31px Georgia, "Times New Roman", serif';
    g.fillText('real interest rate ≈ nominal interest rate − expected inflation', 130, y + 8);
    y += 80; g.font = '29px Georgia, "Times New Roman", serif';
    wrapText(g, 'A central bank that is perceived as credible can anchor inflation expectations, which reduces the output sacrifice of disinflation. Conversely, if households expect prices to keep rising, they demand higher wages and a wage-price spiral may follow.', 80, y, mw, lh);
    g.fillStyle = '#8a8a8a';
    g.font = '24px "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
    g.fillText('示例页：用来试框选。点“打开 PDF / 图片”换成你自己的资料。', 80, H - 90);
    return c;
  }

  /* ================= 页面渲染 ================= */
  var src = { kind: 'sample', pdf: null, bitmap: null, page: 1, pages: 1, name: '示例页' };
  var zoom = 1, ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3], renderToken = 0;
  var cv = $('cv'), stage = $('stage'), selBox = $('selBox');
  var sel = null, drag = null;

  var pdfReady = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (pdfReady) return pdfReady;
    pdfReady = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = PDF_BASE + 'pdf.min.js';
      s.onload = async function () {
        try {
          var r = await fetch(PDF_BASE + 'pdf.worker.min.js');
          var t = await r.text();
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
        } catch (e) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'pdf.worker.min.js'; }
        res();
      };
      s.onerror = function () { pdfReady = null; rej(new Error('PDF 引擎加载失败，检查网络后再试。')); };
      document.head.appendChild(s);
    });
    return pdfReady;
  }

  function updatePager() {
    var label = src.name;
    if (src.kind === 'pdf') label += '  ·  ' + src.page + ' / ' + src.pages;
    $('pageInfo').textContent = label; $('pageInfo').title = label;
    $('prevBtn').disabled = !(src.kind === 'pdf' && src.page > 1);
    $('nextBtn').disabled = !(src.kind === 'pdf' && src.page < src.pages);
    $('zoomVal').textContent = Math.round(zoom * 100) + '%';
    $('zoomOut').disabled = zoom <= ZOOMS[0];
    $('zoomIn').disabled = zoom >= ZOOMS[ZOOMS.length - 1];
  }
  function clearSel() { sel = null; selBox.hidden = true; var sc = $('selC'); if (sc && sc.width) sc.getContext('2d').clearRect(0, 0, sc.width, sc.height); }

  async function renderPage() {
    if (currentView !== 'read') return;
    var tok = ++renderToken;
    var cssW = Math.max(220, Math.floor((stage.clientWidth - 26) * zoom));
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var pxW = Math.min(Math.round(cssW * dpr), 3200);
    try {
      var off = document.createElement('canvas');
      if (src.kind === 'pdf') {
        var page = await src.pdf.getPage(src.page);
        if (tok !== renderToken) return;
        var v1 = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: pxW / v1.width });
        off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
        await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
      } else {
        var b = src.bitmap, bw = b.width || b.naturalWidth, bh = b.height || b.naturalHeight;
        off.width = pxW; off.height = Math.round(pxW * bh / bw);
        var og = off.getContext('2d'); og.imageSmoothingQuality = 'high';
        og.drawImage(b, 0, 0, off.width, off.height);
      }
      if (tok !== renderToken) return;
      cv.width = off.width; cv.height = off.height;
      cv.getContext('2d').drawImage(off, 0, 0);
      cv.style.width = cssW + 'px';
      cv.style.height = (cssW * off.height / off.width) + 'px';
      clearSel();
    } catch (e) {
      if (tok === renderToken) toast('这一页画不出来：' + (e && e.message ? e.message : '未知错误'));
    }
    updatePager();
  }

  async function openFile(file) {
    if (!file) return;
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    try {
      if (isPdf) {
        await loadPdfJs();
        var buf = await file.arrayBuffer();
        var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        src = { kind: 'pdf', pdf: pdf, bitmap: null, page: 1, pages: pdf.numPages, name: file.name };
      } else if (/^image\//.test(file.type)) {
        var url = URL.createObjectURL(file), img = new Image();
        await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = url; });
        src = { kind: 'image', pdf: null, bitmap: img, page: 1, pages: 1, name: file.name };
      } else { toast('只能打开 PDF 或图片文件。'); return; }
    } catch (e) { toast('这个文件打不开：' + (e && e.message ? e.message : '未知错误')); return; }
    zoom = 1; stage.scrollTop = 0; stage.scrollLeft = 0;
    await renderPage();
  }

  /* ---------- 圈选 / 框选 ---------- */
  var selC = $('selC');
  function freeMode() { return settings.shape !== 'box'; }
  function applyDrawMode() {
    cv.style.touchAction = settings.draw ? 'none' : 'pan-x pan-y pinch-zoom';
    $('drawBtn').setAttribute('aria-pressed', settings.draw ? 'true' : 'false');
    $('shapeBtn').textContent = freeMode() ? '圈选' : '框选';
    $('shapeBtn').title = freeMode() ? '现在是自由圈选：画圈、画线都行。点一下换成拖矩形框。' : '现在是矩形框选。点一下换成自由圈选。';
    $('hint').textContent = !settings.draw
      ? '现在可以用手指滚动页面。要选内容就点“选取”打开（Apple Pencil 和鼠标随时能选）。'
      : freeMode()
        ? '用笔、手指或鼠标在要问的字上画个圈（圈不圆也行），松手就提问，圈外的字不会被问到。只想选一个词，就围着它画小圈，或者在它下面划一条线。'
        : '拖出一个矩形框，松手就提问。';
  }
  function localPoint(e) {
    var r = cv.getBoundingClientRect();
    return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
  }
  function paintBox(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    selBox.hidden = false;
    selBox.style.left = x + 'px'; selBox.style.top = y + 'px'; selBox.style.width = w + 'px'; selBox.style.height = h + 'px';
    return { x: x, y: y, w: w, h: h };
  }
  function sizeSelC() {
    var r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (selC.width !== w || selC.height !== h) { selC.width = w; selC.height = h; }
    selC.style.width = r.width + 'px'; selC.style.height = r.height + 'px';
    return d;
  }
  function paintPath(pts, closed) {
    var d = sizeSelC(), c = selC.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, selC.width, selC.height);
    if (!pts || pts.length < 2) return;
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    if (closed) c.closePath();
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (closed) { c.fillStyle = 'rgba(255, 212, 59, 0.22)'; c.fill(); }
    c.lineWidth = 3; c.strokeStyle = '#e0a800'; c.stroke();
  }
  function polyArea(p) {
    var a = 0; for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
    return Math.abs(a) / 2;
  }
  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' && !settings.draw) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    clearSel();
    var p = localPoint(e);
    drag = { id: e.pointerId, a: p, b: p, pts: [p], free: freeMode() };
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    if (drag.free) paintPath(drag.pts, false); else paintBox(p, p);
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.free) {
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!evs.length) evs = [e];
      evs.forEach(function (ev) { var p = localPoint(ev), l = drag.pts[drag.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 1.5) drag.pts.push(p); });
      paintPath(drag.pts, false);
    } else { drag.b = localPoint(e); paintBox(drag.a, drag.b); }
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.free) {
      var r = paintBox(d.a, d.b);
      if (cancelled || r.w < 24 || r.h < 18) { clearSel(); return; }
      sel = r; regionToAsk(); return;
    }
    if (cancelled || d.pts.length < 4) { clearSel(); return; }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    d.pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var bw = x1 - x0, bh = y1 - y0;
    if (bw < 10 && bh < 10) { clearSel(); return; }
    /* 圈得闭合（面积够大）就按圈裁，只留圈里的字；划一条线（下划线、波浪线）就按线所在的那一条带 */
    var closedShape = polyArea(d.pts) > 0.2 * bw * bh && bw > 12 && bh > 12;
    var pad = 8;
    if (!closedShape && bh < 26) { y0 -= 14; y1 += 10; x0 -= 10; x1 += 10; }
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    var rect = cv.getBoundingClientRect();
    x1 = Math.min(rect.width, x1 + pad); y1 = Math.min(rect.height, y1 + pad);
    sel = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, poly: closedShape ? d.pts : null };
    paintPath(d.pts, closedShape);
    regionToAsk();
  }
  cv.addEventListener('pointerup', function (e) { endDrag(e, false); });
  cv.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  $('shapeBtn').addEventListener('click', function () { settings.shape = freeMode() ? 'box' : 'free'; saveSettings(); clearSel(); applyDrawMode(); });

  function cropSelection() {
    var rect = cv.getBoundingClientRect(), k = cv.width / rect.width;
    var x = Math.round(sel.x * k), y = Math.round(sel.y * k);
    var w = Math.max(1, Math.min(cv.width - x, Math.round(sel.w * k)));
    var h = Math.max(1, Math.min(cv.height - y, Math.round(sel.h * k)));
    var t = document.createElement('canvas'); t.width = w; t.height = h;
    var tc = t.getContext('2d');
    if (sel.poly) {
      /* 圈外变成白色；圈的边缘留一点余量，避免切到字 */
      var m = document.createElement('canvas'); m.width = w; m.height = h;
      var mc = m.getContext('2d');
      mc.beginPath();
      sel.poly.forEach(function (p, i) { var px = p.x * k - x, py = p.y * k - y; if (i) mc.lineTo(px, py); else mc.moveTo(px, py); });
      mc.closePath(); mc.fillStyle = '#000'; mc.fill();
      mc.lineWidth = 14 * k; mc.lineJoin = 'round'; mc.strokeStyle = '#000'; mc.stroke();
      tc.drawImage(cv, x, y, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in'; tc.drawImage(m, 0, 0);
      var o = document.createElement('canvas'); o.width = w; o.height = h;
      var oc = o.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0, 0, w, h); oc.drawImage(t, 0, 0);
      t = o;
    } else {
      tc.drawImage(cv, x, y, w, h, 0, 0, w, h);
    }
    return new Promise(function (res) { t.toBlob(res, 'image/png'); });
  }
  async function regionToAsk() {
    if (!sel) return;
    var blob = await cropSelection();
    if (!blob) { toast('没截到图，再框一次。'); return; }
    var note = $('askIn').value.trim(); $('askIn').value = '';
    ask({ blob: blob, note: note });
    if (window.matchMedia('(max-width: 860px)').matches) $('thread').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================= 提问 ================= */
  var SYSTEM = '你是一位耐心、直接的学习教练。学生是在日本留学的中国人，读英语、日语等外语材料，也学经济学、数学等学科。用简体中文回答，不要使用 Markdown 符号（不要 #、*、表格、反引号），公式用文字或普通符号写。不要客套，不要重复题目。';
  var MARK = /={3}\s*(WORDS|DATA)\s*={3}/i; /* WORDS 是旧格式，兼容 */
  var JSON_TAIL = '最后另起一行写 ===MARKER=== ，紧接着给出一个 JSON，不要用代码块，不要在它后面再写别的话。';

  function buildPrompt(hasImage, typed, note) {
    var intro = hasImage
      ? '图片是我在学习资料上圈出的一块。可能是外语文字（英语、日语或别的语言）、题目、公式、图表，也可能带有我的手写（包括数学和经济学符号，字迹可能潦草、可能没写完）。'
      : '下面是我想问的内容：\n' + typed;
    var body = [
      '先判断这一块属于哪一类，再按对应格式回答，只写对应的部分，每个小标题单独成行。',
      '',
      '【A. 外语文字（英语、日语、别的语言，单个单词也算）】',
      '原文：抄写原文，日语保留汉字和假名，最多 300 字。',
      '读音：只有日语等需要时才写，用假名，必要时加罗马音。',
      '翻译：通顺的中文翻译。',
      '生词：列出我可能不会的单词或短语，每个一行，格式“单词 /读音或音标/ 词性 在这里的中文意思”，最多 8 个，太简单的不要列。',
      '句子分析：只有句子较长或有难点时才写，3 句以内讲清结构（日语要点出助词、活用、敬语）。',
      '',
      '【B. 题目，并且带有我手写的解答（含数学、经济学符号）】',
      '题目：转写题目。',
      '我的解答：逐行转写我手写的内容，公式用普通符号，看不清的地方用 [?]。如果我什么都没写，就写“（没有写）”。',
      '诊断：判断我做到了哪一步，从哪一步开始卡住或出错，并说明原因。',
      '接着做：从我卡住或出错的那一步开始往下讲，一步一步，每步说明为什么这样做。我已经做对的部分不要重讲。',
      '要点：这道题用到的 2 到 4 个知识点。',
      '',
      '【C. 学科概念、文献段落、图表（不是单纯的外语查词，也没有我的解答）】',
      '原文：抄写图中的关键内容，最多 300 字。',
      '通俗讲解：用白话讲明白它在说什么，先结论后原因，6 句以内。',
      '举个例子：一个贴近生活的具体例子。',
      '相关概念：2 到 4 个需要先懂的概念，每个一行，一句话。',
      '',
      '如果同一块里既有外语又有学科内容，就把 A 的“原文、翻译、生词”和 C 的“通俗讲解”合在一起写。图里看不清就直接说看不清，不要猜。',
      JSON_TAIL.replace('MARKER', 'DATA') + '格式：{"kind":"lang 或 solve 或 concept","lang":"外语的中文名，如 英语、日语、韩语、法语；不是外语则为空","words":[{"term":"单词、短语或概念","reading":"读音或音标，没有则为空","pos":"词性","meaning":"在这里的中文意思","example":"原文里含有它的短句"}],"solve":{"problem":"题目转写","my_work":"我的解答转写","status":"correct 或 incomplete 或 wrong","stuck_at":"卡住或出错的那一步，没有则为空","points":["知识点"]}}。words 只在 lang 或 concept 时填，solve 只在 solve 时填，没有的部分写空数组或 null。'
    ].join('\n');
    var extra = note ? '\n\n我的补充问题：' + note + '\n请在上面的结构里回应这个问题。' : '';
    return intro + '\n' + body + extra;
  }

  function visibleOnly(full) {
    var m = full.match(MARK);
    var t = m ? full.slice(0, m.index) : full;
    if (!m) {
      var i = t.lastIndexOf('\n=');
      if (i >= 0 && /^\n=+[\sA-Za-z]*=*\s*$/.test(t.slice(i))) t = t.slice(0, i);
    }
    return t.trim();
  }
  function splitOut(full) {
    var m = full.match(MARK);
    if (!m) return { visible: visibleOnly(full), kind: null, json: null };
    return { visible: visibleOnly(full), kind: m[1].toUpperCase(), json: AI.parseJSON(full.slice(m.index + m[0].length)) };
  }

  var LABELS = /^(原文|读音|翻译|生词|句子分析|通俗讲解|举个例子|相关概念|题目|我的解答|诊断|接着做|要点)\s*[：:]\s*(.*)$/;
  function renderAnswer(node, text) {
    node.textContent = '';
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var p = document.createElement('p'), m = line.match(LABELS);
      if (m) { p.className = 'sec'; p.appendChild(el('span', 'lab', m[1])); p.appendChild(document.createTextNode(m[2])); }
      else p.textContent = line;
      node.appendChild(p);
    });
  }

  /* ---------- 对话区 ---------- */
  var ctl = null, busy = false, topic = null, thumbUrl = null;

  function emptyThread() {
    var t = $('thread'); t.textContent = '';
    var box = el('div', 'empty');
    box.appendChild(el('strong', null, '还没有提问。'));
    var ul = el('ul');
    ['圈住外语（英语、日语等），松手就查词、翻译，生词自动进生词本。',
     '圈住学科内容，白话讲解；圈住题目和你写了一半的解答，从卡住的那一步接着讲，没做对的进错题本。',
     '不用选模式，我自己判断。也可以在下面直接打字问。'].forEach(function (x) { ul.appendChild(el('li', null, x)); });
    box.appendChild(ul); t.appendChild(box);
  }
  function userCard(blob, text, caption) {
    var m = el('div', 'msg u');
    if (blob) {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = URL.createObjectURL(blob);
      var img = el('img'); img.src = thumbUrl; img.alt = '你框选的区域'; m.appendChild(img);
      if (caption) m.appendChild(el('div', 'cap', caption));
    } else m.textContent = text;
    return m;
  }
  function setBusy(b) {
    busy = b; $('stopBtn').hidden = !b; $('sendBtn').disabled = b; $('newBtn').disabled = b;
  }
  function updateAskUi() {
    var has = !!(topic && topic.done);
    $('sendBtn').textContent = has ? '追问' : '问';
    $('newBtn').hidden = !has;
    $('askIn').placeholder = has ? '继续追问，或输入新的词' : '输入单词或问题';
  }
  function syncModeUi() { $('strong').checked = !!settings.strong; }

  async function run(messages, tier, body) {
    ctl = new AbortController(); setBusy(true);
    body.className = 'body thinking'; body.textContent = '思考中…';
    try {
      var full = await AI.chat({
        settings: settings, tier: tier, system: SYSTEM, messages: messages, signal: ctl.signal,
        onText: function (t) { body.className = 'body'; renderAnswer(body, visibleOnly(t)); }
      });
      body.className = 'body';
      return full;
    } catch (e) {
      body.className = 'body';
      if (e && e.name === 'AbortError') { body.appendChild(el('p', 'err', '已停止。')); }
      else { body.textContent = ''; body.appendChild(el('p', 'err', errMsg(e))); }
      return null;
    } finally { setBusy(false); ctl = null; }
  }

  async function ask(o) {
    if (!AI.hasKey(settings)) { toast('先到“设置”里填 AI 密钥。'); showView('settings'); return; }
    if (busy && ctl) ctl.abort();
    var typed = (o.text || '').trim();
    var img = null;
    if (o.blob) {
      try { img = await AI.prepareImage(o.blob, o.strong ? 2000 : 1600); }
      catch (e) { toast('这张图读不了：' + errMsg(e)); return; }
    }
    /* 带手写的内容用强模型读，更准 */
    var tier = (o.strong || settings.strong) ? 'strong' : 'fast';
    var prompt = buildPrompt(!!img, typed, o.note || '');
    topic = { tier: tier, prompt: prompt, img: img && img.blob, done: false, anchor: o.anchor || null,
      messages: [{ role: 'user', text: prompt, images: img ? [{ mime: img.mime, b64: img.b64 }] : [] }] };
    updateAskUi();

    var t = $('thread');
    if (t.querySelector('.empty')) t.textContent = '';
    else if (t.children.length) t.appendChild(el('hr', 'thsep'));
    var uc = userCard(img ? img.blob : null, typed, o.note ? '补充：' + o.note : '');
    t.appendChild(uc);
    var card = el('div', 'msg a'), body = el('div', 'body');
    card.appendChild(body); t.appendChild(card);
    uc.scrollIntoView({ block: 'start', behavior: 'smooth' });

    var full = await run(topic.messages, tier, body);
    if (full == null) return;
    var out = splitOut(full);
    topic.messages.push({ role: 'assistant', text: out.visible });
    topic.done = true; updateAskUi();

    var data = (out.json && !Array.isArray(out.json) && typeof out.json === 'object') ? out.json : null;
    var words = Array.isArray(out.json) ? out.json : (data && Array.isArray(data.words) ? data.words : []);
    var kind = data && /^(lang|solve|concept)$/.test(data.kind) ? data.kind : (words.length ? 'lang' : null);
    var lang = data && typeof data.lang === 'string' ? data.lang.trim().slice(0, 12) : '';
    var logMode = kind === 'solve' ? 'solve' : kind === 'concept' ? 'sub' : 'en';

    var ctxLine = '';
    var mm = out.visible.match(/(?:^|\n)(?:原文|题目)\s*[：:]\s*(.+)/);
    if (mm) ctxLine = mm[1].trim();
    var title = ctxLine || typed || '图片提问';

    var logId = DB.uid();
    var thumb = null;
    if (img) { try { thumb = (await AI.prepareImage(img.blob, 420)).blob; } catch (e) {} }
    DB.put({ id: logId, type: 'log', ts: Date.now(), day: DB.dayKey(), nb: (window.QWNotes && window.QWNotes.currentId()) || '', mode: logMode, title: title.slice(0, 120), text: out.visible, img: thumb }).catch(function () {});

    addTools(card);
    if (kind === 'solve') await afterSolve(card, data && data.solve && typeof data.solve === 'object' ? data.solve : null, out.visible, img);
    else if (words.length) await afterWords(card, words, ctxLine, kind === 'concept' ? 'sub' : 'en', lang);
  }

  /* 这本笔记以前问过的内容：点一条，把当时的问答调回来 */
  async function showHistory() {
    var nbid = (window.QWNotes && window.QWNotes.currentId()) || '';
    var logs = (await DB.all('log')).filter(function (x) { return !nbid || x.nb === nbid; }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 40);
    var t = $('thread');
    var old = t.querySelector('.histlist'); if (old) { old.remove(); return; }
    var box = el('div', 'histlist');
    box.appendChild(el('strong', null, logs.length ? '这本笔记的提问记录（点一条查看）' : '这本笔记还没有提问记录。'));
    logs.forEach(function (x) {
      var b = el('button', 'hist-item', new Date(x.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '  ' + (x.title || '提问'));
      b.type = 'button';
      b.addEventListener('click', function () {
        if (t.querySelector('.empty')) t.textContent = '';
        var u = el('div', 'msg u'); u.textContent = x.title || '提问';
        if (x.img) { u.textContent = ''; var im = el('img'); im.alt = ''; im.src = URL.createObjectURL(x.img); u.appendChild(im); }
        var c = el('div', 'msg a'), body = el('div', 'body'); renderAnswer(body, x.text || ''); c.appendChild(body);
        t.appendChild(el('hr', 'thsep')); t.appendChild(u); t.appendChild(c);
        box.remove(); u.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      box.appendChild(b);
    });
    t.insertBefore(box, t.firstChild);
  }
  var hb = document.getElementById('drawerHist'); if (hb) hb.addEventListener('click', showHistory);

  async function askFollow(q) {
    if (!topic || !topic.done) return;
    var t = $('thread');
    t.appendChild(userCard(null, q));
    var card = el('div', 'msg a'), body = el('div', 'body');
    card.appendChild(body); t.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    var msgs = topic.messages.concat([{ role: 'user', text: q + '\n\n（简洁回答，不要用 Markdown 符号，不要输出 ===DATA=== 或 JSON。）' }]);
    var full = await run(msgs, topic.tier, body);
    if (full == null) return;
    topic.messages.push({ role: 'user', text: q });
    topic.messages.push({ role: 'assistant', text: visibleOnly(full) });
    if (topic.messages.length > 14) topic.messages = [topic.messages[0], topic.messages[1]].concat(topic.messages.slice(-8));
  }

  function addTools(card) {
    var row = el('div', 'rowtools');
    var b1 = el('button', 'btn small', '复制提示词'); b1.type = 'button';
    b1.addEventListener('click', function () { copyText(topic.prompt.replace(/最后另起一行写[\s\S]*$/, '').trim()); });
    row.appendChild(b1);
    if (topic.img) {
      var img = topic.img;
      var b2 = el('button', 'btn small', '复制图片'); b2.type = 'button';
      b2.addEventListener('click', function () { copyImage(img); });
      row.appendChild(b2);
    }
    if (window.QWNotes && window.QWNotes.canInsert()) {
      var b3 = el('button', 'btn small', '贴到笔记页'); b3.type = 'button';
      var anchor = topic.anchor, ans = topic.messages.length > 1 ? topic.messages[topic.messages.length - 1].text : '';
      b3.addEventListener('click', function () {
        var lines = String(ans).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        var txt = lines.join('\n'); if (txt.length > 330) txt = txt.slice(0, 330).replace(/\s+\S*$/, '') + '…';
        if (window.QWNotes.addSticky(txt, anchor)) { b3.textContent = '已贴上 ✓'; b3.disabled = true; }
      });
      row.appendChild(b3);
    }
    row.appendChild(el('span', null, '拿去问 ChatGPT / Gemini 聊天版'));
    card.appendChild(row);
  }

  async function saveWords(words, context, kind, lang) {
    var added = 0, dup = 0, failed = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || typeof w.term !== 'string' || !w.term.trim()) continue;
      var term = w.term.trim().slice(0, 80);
      var id = 'word-' + hashId(kind + '|' + term.toLowerCase());
      try {
        var old = await DB.get(id);
        if (old) { dup++; continue; }
        await DB.put({ id: id, type: 'word', ts: Date.now(), day: DB.dayKey(), kind: kind, term: term,
          reading: String(w.reading || '').slice(0, 60), lang: lang || '', pos: String(w.pos || '').slice(0, 20), meaning: String(w.meaning || '').slice(0, 300), example: String(w.example || '').slice(0, 300),
          context: (context || '').slice(0, 160) });
        added++;
      } catch (e) { failed++; }
    }
    return { added: added, dup: dup, failed: failed };
  }
  async function afterWords(card, words, ctxLine, kind, lang) {
    words = words.filter(function (w) { return w && typeof w.term === 'string' && w.term.trim(); }).slice(0, 12);
    if (!words.length) return;
    var row = el('div', 'rowtools');
    row.appendChild(el('span', null, '词条 ' + words.length + ' 个：'));
    words.forEach(function (w) { row.appendChild(el('span', 'chip', String(w.term).slice(0, 40))); });
    card.appendChild(row);
    if (settings.autoWord) {
      var r = await saveWords(words, ctxLine, kind, lang);
      var msg = '已记入生词本 ' + r.added + ' 个' + (r.dup ? '，' + r.dup + ' 个本来就有' : '') + (r.failed ? '，' + r.failed + ' 个没存上' : '');
      row.appendChild(el('span', r.failed ? 'err' : 'ok', msg));
    } else {
      var b = el('button', 'btn small', '记入生词本'); b.type = 'button';
      b.addEventListener('click', async function () {
        b.disabled = true;
        var r2 = await saveWords(words, ctxLine, kind, lang);
        b.replaceWith(el('span', 'ok', '已记入 ' + r2.added + ' 个'));
      });
      row.appendChild(b);
    }
  }
  async function afterSolve(card, data, visible, img) {
    var row = el('div', 'rowtools');
    var status = (data && /^(correct|incomplete|wrong)$/.test(data.status)) ? data.status : 'incomplete';
    var label = { correct: '做对了', incomplete: '没做完', wrong: '做错了' }[status];
    row.appendChild(el('span', 'statuspill ' + status, label));
    if (data && data.stuck_at) row.appendChild(el('span', null, '卡在：' + String(data.stuck_at).slice(0, 80)));
    card.appendChild(row);
    if (status === 'correct' || !settings.autoWrong) {
      if (status !== 'correct') {
        var b = el('button', 'btn small', '记入错题本'); b.type = 'button';
        b.addEventListener('click', async function () { b.disabled = true; await saveWrong(data, visible, img); b.replaceWith(el('span', 'ok', '已记入错题本')); });
        row.appendChild(b);
      }
      return;
    }
    var ok = await saveWrong(data, visible, img);
    row.appendChild(el('span', ok ? 'ok' : 'err', ok ? '已记入错题本' : '没存上'));
  }
  async function saveWrong(data, visible, img) {
    try {
      var shot = null;
      if (img) { try { shot = (await AI.prepareImage(img.blob, 1000)).blob; } catch (e) { shot = img.blob; } }
      var status = (data && /^(incomplete|wrong)$/.test(data.status)) ? data.status : 'incomplete';
      await DB.put({ id: 'wrong-' + DB.uid(), type: 'wrong', ts: Date.now(), day: DB.dayKey(), status: status,
        problem: String((data && data.problem) || '').slice(0, 1500), mywork: String((data && data.my_work) || '').slice(0, 2000),
        stuck: String((data && data.stuck_at) || '').slice(0, 300),
        points: Array.isArray(data && data.points) ? data.points.slice(0, 6).map(function (x) { return String(x).slice(0, 60); }) : [],
        explain: visible, img: shot, mastered: false });
      return true;
    } catch (e) { return false; }
  }

  /* ================= 今日总结 ================= */
  async function renderToday() {
    var day = $('dayIn').value || DB.dayKey();
    $('dayIn').value = day;
    var res = await Promise.all([DB.all('log'), DB.all('word'), DB.all('wrong'), DB.all('question'), DB.get('digest-' + day)]);
    var logs = res[0].filter(function (x) { return x.day === day; }).sort(function (a, b) { return b.ts - a.ts; });
    var words = res[1].filter(function (x) { return x.day === day; });
    var wrongs = res[2].filter(function (x) { return x.day === day; });
    var qs = res[3].filter(function (x) { return x.day === day; });

    var stats = $('stats'); stats.textContent = '';
    [['提问', logs.length], ['生词', words.length], ['错题', wrongs.length], ['题目', qs.length]].forEach(function (p) {
      var s = el('div', 'stat'); s.appendChild(el('b', null, String(p[1]))); s.appendChild(el('span', null, p[0])); stats.appendChild(s);
    });

    var list = $('dayLogs'); list.textContent = '';
    if (!logs.length) list.appendChild(el('div', 'empty', '这一天还没有提问记录。'));
    logs.forEach(function (x) {
      var r = el('div', 'logrow');
      if (x.img) { var im = el('img'); im.alt = ''; im.src = URL.createObjectURL(x.img); im.onload = function () { URL.revokeObjectURL(im.src); }; r.appendChild(im); }
      var t = el('div', 'txt');
      t.appendChild(el('div', 'meta', fmtTime(x.ts) + ' · ' + ({ en: '外语查词', sub: '学科讲解', solve: '解题接力' }[x.mode] || '提问')));
      t.appendChild(el('div', null, x.title));
      r.appendChild(t); list.appendChild(r);
    });
    renderDigest(res[4], qs);
    $('digestNote').textContent = (logs.length + words.length + wrongs.length) ? '' : '这一天没有可总结的内容。';
  }

  function renderDigest(d, qs) {
    var out = $('digestOut'); out.textContent = '';
    if (!d) return;
    var wrap = el('div', 'digest');
    var c1 = el('div', 'card'); c1.appendChild(el('h3', null, '回顾')); c1.appendChild(el('div', null, d.summary || '')); wrap.appendChild(c1);
    [['薄弱点', d.weak], ['明天怎么学', d.suggest]].forEach(function (p) {
      if (!Array.isArray(p[1]) || !p[1].length) return;
      var c = el('div', 'card'); c.appendChild(el('h3', null, p[0]));
      var ul = el('ul'); p[1].forEach(function (x) { ul.appendChild(el('li', null, String(x))); });
      c.appendChild(ul); wrap.appendChild(c);
    });
    var dq = qs.filter(function (q) { return q.source === 'digest'; });
    if (dq.length) {
      var c3 = el('div', 'card'); c3.appendChild(el('h3', null, '今天的题目 ' + dq.length + ' 道'));
      var b = el('button', 'btn primary', '开始练习'); b.type = 'button';
      b.addEventListener('click', function () { startPractice(dq); });
      var act = el('div', 'actions'); act.appendChild(b); c3.appendChild(act); wrap.appendChild(c3);
    }
    out.appendChild(wrap);
  }

  var digestCtl = null;
  async function generateDigest() {
    if (!AI.hasKey(settings)) { toast('先到“设置”里填 AI 密钥。'); showView('settings'); return; }
    var day = $('dayIn').value || DB.dayKey();
    var res = await Promise.all([DB.all('log'), DB.all('word'), DB.all('wrong')]);
    var logs = res[0].filter(function (x) { return x.day === day; }).sort(function (a, b) { return a.ts - b.ts; });
    var words = res[1].filter(function (x) { return x.day === day; });
    var wrongs = res[2].filter(function (x) { return x.day === day; });
    if (!logs.length && !words.length && !wrongs.length) { toast('这一天没有可总结的内容。'); return; }

    var lines = [];
    if (words.length) lines.push('【查过的词和概念】\n' + words.slice(0, 40).map(function (w) { return '- ' + w.term + (w.pos ? ' (' + w.pos + ')' : '') + '：' + w.meaning; }).join('\n'));
    if (wrongs.length) lines.push('【没做对的题】\n' + wrongs.slice(0, 15).map(function (w) { return '- 题目：' + (w.problem || '（图片）').slice(0, 300) + '；卡在：' + (w.stuck || '未标明') + '；知识点：' + (w.points || []).join('、'); }).join('\n'));
    var qa = logs.filter(function (l) { return l.mode === 'sub' || l.mode === 'en'; }).slice(0, 20);
    if (qa.length) lines.push('【问过的内容】\n' + qa.map(function (l) { return '- ' + l.title.slice(0, 100); }).join('\n'));
    var prompt = '下面是我（学生）' + day + ' 这一天的学习记录。\n\n' + lines.join('\n\n') +
      '\n\n请据此生成一份学习总结，只输出一个 JSON，不要代码块，格式：\n' +
      '{"summary":"3 到 5 句，回顾今天学了什么、哪里掌握得好","weak_points":["最需要补的 2 到 4 个薄弱点，各一句话"],"suggestions":["明天具体怎么学，2 到 4 条"],' +
      '"questions":[{"q":"题目","a":"标准答案和简要解析","topic":"所属知识点"}]}\n' +
      'questions 出 8 道：词汇题（用某个词造句或翻译句子）、概念理解题、至少 2 道应用题，优先覆盖没做对的题涉及的知识点。用简体中文，题目要能不看资料独立作答。';

    var btn = $('digestBtn'); btn.disabled = true; btn.textContent = '正在生成…'; $('digestStop').hidden = false;
    digestCtl = new AbortController();
    try {
      var text = await AI.chat({ settings: settings, tier: 'strong', system: SYSTEM, json: true, signal: digestCtl.signal,
        messages: [{ role: 'user', text: prompt }] });
      var j = AI.parseJSON(text);
      if (!j || typeof j !== 'object') throw new Error('AI 返回的格式读不出来，再点一次生成。');
      var old = (await DB.all('question')).filter(function (q) { return q.day === day && q.source === 'digest' && !q.result; });
      for (var i = 0; i < old.length; i++) await DB.del(old[i].id);
      await DB.put({ id: 'digest-' + day, type: 'digest', ts: Date.now(), day: day, summary: String(j.summary || ''),
        weak: Array.isArray(j.weak_points) ? j.weak_points : [], suggest: Array.isArray(j.suggestions) ? j.suggestions : [] });
      var qs = Array.isArray(j.questions) ? j.questions : [];
      for (var k = 0; k < qs.length; k++) {
        if (!qs[k] || !qs[k].q) continue;
        await DB.put({ id: 'q-' + DB.uid(), type: 'question', ts: Date.now() + k, day: day, source: 'digest',
          q: String(qs[k].q).slice(0, 1200), a: String(qs[k].a || '').slice(0, 1500), topic: String(qs[k].topic || '').slice(0, 60), result: null });
      }
      toast('总结和题目已生成。');
    } catch (e) {
      if (!(e && e.name === 'AbortError')) toast(errMsg(e));
    } finally {
      btn.disabled = false; btn.textContent = '生成这一天的总结和题目'; $('digestStop').hidden = true; digestCtl = null;
      renderToday();
    }
  }

  /* ================= 本子 ================= */
  var bookTab = 'word', bookQuery = '';
  var cache = { word: [], wrong: [], question: [] };

  async function loadBook() {
    var res = await Promise.all([DB.all('word'), DB.all('wrong'), DB.all('question')]);
    cache.word = res[0].sort(function (a, b) { return b.ts - a.ts; });
    cache.wrong = res[1].sort(function (a, b) { return b.ts - a.ts; });
    cache.question = res[2].sort(function (a, b) { return b.ts - a.ts; });
    $('cWord').textContent = cache.word.length; $('cWrong').textContent = cache.wrong.length; $('cQuestion').textContent = cache.question.length;
  }
  function match(x, fields) {
    var q = bookQuery.trim().toLowerCase();
    if (!q) return true;
    return fields.map(function (f) { return Array.isArray(x[f]) ? x[f].join(' ') : (x[f] || ''); }).join(' ').toLowerCase().indexOf(q) >= 0;
  }

  async function renderBook() {
    await loadBook();
    document.querySelectorAll('#bookSeg button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-book') === bookTab ? 'true' : 'false'); });
    renderBookTools();
    renderBookList();
  }
  function renderBookTools() {
    var t = $('bookTools'); t.textContent = '';
    var s = document.createElement('input'); s.type = 'search'; s.placeholder = '搜索'; s.value = bookQuery; s.setAttribute('aria-label', '搜索');
    s.addEventListener('input', function () { bookQuery = s.value; renderBookList(); });
    t.appendChild(s);
    if (bookTab === 'word') {
      var b1 = el('button', 'btn', '导出表格'); b1.type = 'button'; b1.addEventListener('click', function () { exportWords('csv'); });
      var b2 = el('button', 'btn', '导出 Anki'); b2.type = 'button'; b2.addEventListener('click', function () { exportWords('anki'); });
      t.appendChild(b1); t.appendChild(b2);
    } else if (bookTab === 'question') {
      var b3 = el('button', 'btn primary', '练习没答对的'); b3.type = 'button';
      b3.addEventListener('click', function () {
        var todo = cache.question.filter(function (q) { return q.result !== 'right'; }).reverse();
        if (!todo.length) { toast('没有需要练习的题。'); return; }
        startPractice(todo);
      });
      t.appendChild(b3);
    }
  }
  function emptyBox(text) { var b = el('div', 'empty book-empty', text); return b; }

  function renderBookList() {
    var list = $('bookList'); list.textContent = '';
    if (bookTab === 'word') renderWords(list);
    else if (bookTab === 'wrong') renderWrongs(list);
    else renderQuestions(list);
  }

  function renderWords(list) {
    var rows = cache.word.filter(function (x) { return match(x, ['term', 'meaning', 'example', 'context']); });
    if (!rows.length) { list.appendChild(emptyBox(cache.word.length ? '没有符合的词条。' : '生词本还是空的。在文档里圈一个词问 AI，它会自动出现在这里。')); return; }
    rows.forEach(function (x) {
      var card = el('article', 'entry'), head = el('div');
      head.appendChild(el('span', 'kind', x.kind === 'sub' ? '概念' : (x.lang || '英语')));
      head.appendChild(el('span', 'term', x.term));
      if (x.reading) head.appendChild(el('span', 'pos', x.reading));
      if (x.pos) head.appendChild(el('span', 'pos', x.pos));
      card.appendChild(head);
      if (x.meaning) card.appendChild(el('div', null, x.meaning));
      if (x.example) card.appendChild(el('div', 'ex', x.example));
      var foot = el('div', 'foot'); foot.appendChild(el('span', null, fmtDay(x.ts))); foot.appendChild(el('span', 'sp'));
      foot.appendChild(confirmButton('删除', '确认删除', '', async function () { await DB.del(x.id); renderBook(); }));
      card.appendChild(foot); list.appendChild(card);
    });
  }

  function renderWrongs(list) {
    var rows = cache.wrong.filter(function (x) { return match(x, ['problem', 'stuck', 'points', 'mywork']); });
    if (!rows.length) { list.appendChild(emptyBox(cache.wrong.length ? '没有符合的错题。' : '错题本还是空的。圈住一道题和你手写的解答问 AI，没做对的会自动进来。')); return; }
    rows.forEach(function (x) {
      var card = el('article', 'entry' + (x.mastered ? ' mastered' : ''));
      var head = el('div', 'foot');
      head.appendChild(el('span', 'statuspill ' + (x.status === 'wrong' ? 'wrong' : 'incomplete'), x.status === 'wrong' ? '做错了' : '没做完'));
      head.appendChild(el('span', null, fmtDay(x.ts)));
      if (x.mastered) head.appendChild(el('span', 'ok', '已掌握'));
      card.appendChild(head);
      if (x.img) { var im = el('img', 'shot'); im.alt = '题目截图'; im.src = URL.createObjectURL(x.img); im.onload = function () { URL.revokeObjectURL(im.src); }; card.appendChild(im); }
      if (x.problem) card.appendChild(el('div', 'qtext', x.problem));
      if (x.stuck) card.appendChild(el('div', 'ex', '卡在：' + x.stuck));
      if (x.points && x.points.length) { var pr = el('div', 'foot'); x.points.forEach(function (p) { pr.appendChild(el('span', 'chip', p)); }); card.appendChild(pr); }
      var rev = el('div', 'reveal'); rev.hidden = true; renderAnswer(rev, x.explain || ''); card.appendChild(rev);
      var foot = el('div', 'foot');
      var b1 = el('button', 'btn small', '看讲解'); b1.type = 'button';
      b1.addEventListener('click', function () { rev.hidden = !rev.hidden; b1.textContent = rev.hidden ? '看讲解' : '收起'; });
      var b2 = el('button', 'btn small', '出变式题'); b2.type = 'button';
      b2.addEventListener('click', function () { makeVariants(x, b2); });
      var b3 = el('button', 'btn small', x.mastered ? '取消已掌握' : '已掌握'); b3.type = 'button';
      b3.addEventListener('click', async function () { x.mastered = !x.mastered; await DB.put(x); renderBook(); });
      foot.appendChild(b1); foot.appendChild(b2); foot.appendChild(b3); foot.appendChild(el('span', 'sp'));
      foot.appendChild(confirmButton('删除', '确认删除', '', async function () { await DB.del(x.id); renderBook(); }));
      card.appendChild(foot); list.appendChild(card);
    });
  }

  async function makeVariants(item, btn) {
    if (!AI.hasKey(settings)) { toast('先到“设置”里填 AI 密钥。'); return; }
    btn.disabled = true; btn.textContent = '生成中…';
    var prompt = '学生做错了下面这道题。\n题目：' + (item.problem || '（见图片）') + '\n卡在：' + (item.stuck || '未标明') + '\n知识点：' + (item.points || []).join('、') +
      '\n\n请出 4 道考查同一知识点的变式题，难度由易到难，换数字或换情境。只输出一个 JSON 数组，不要代码块：[{"q":"题目","a":"标准答案和关键步骤","topic":"知识点"}]。用简体中文。';
    var msgs = [{ role: 'user', text: prompt }];
    if (!item.problem && item.img) {
      try { var im = await AI.prepareImage(item.img, 1600); msgs[0].images = [{ mime: im.mime, b64: im.b64 }]; } catch (e) {}
    }
    try {
      var text = await AI.chat({ settings: settings, tier: 'strong', system: SYSTEM, json: true, messages: msgs });
      var arr = AI.parseJSON(text);
      if (!Array.isArray(arr)) throw new Error('AI 返回的格式读不出来，再试一次。');
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        if (!arr[i] || !arr[i].q) continue;
        await DB.put({ id: 'q-' + DB.uid(), type: 'question', ts: Date.now() + i, day: DB.dayKey(), source: 'variant', from: item.id,
          q: String(arr[i].q).slice(0, 1200), a: String(arr[i].a || '').slice(0, 1500), topic: String(arr[i].topic || (item.points || [])[0] || '').slice(0, 60), result: null });
        n++;
      }
      toast('已生成 ' + n + ' 道变式题，在“问题集”里。');
      bookTab = 'question'; renderBook();
    } catch (e) { toast(errMsg(e)); btn.disabled = false; btn.textContent = '出变式题'; }
  }

  function renderQuestions(list) {
    var rows = cache.question.filter(function (x) { return match(x, ['q', 'a', 'topic']); });
    if (!rows.length) { list.appendChild(emptyBox(cache.question.length ? '没有符合的题目。' : '问题集还是空的。到“总结”里生成每日题目，或在错题本里出变式题。')); return; }
    rows.forEach(function (x) {
      var card = el('article', 'entry');
      var head = el('div', 'foot');
      if (x.topic) head.appendChild(el('span', 'chip', x.topic));
      head.appendChild(el('span', null, fmtDay(x.ts) + (x.source === 'variant' ? ' · 变式题' : '')));
      if (x.result) head.appendChild(el('span', x.result === 'right' ? 'ok' : 'err', x.result === 'right' ? '答对' : '答错'));
      card.appendChild(head);
      card.appendChild(el('div', 'qtext', x.q));
      var rev = el('div', 'reveal'); rev.hidden = true; renderAnswer(rev, x.a || ''); card.appendChild(rev);
      var foot = el('div', 'foot');
      var b1 = el('button', 'btn small', '看答案'); b1.type = 'button';
      b1.addEventListener('click', function () { rev.hidden = !rev.hidden; b1.textContent = rev.hidden ? '看答案' : '收起'; });
      foot.appendChild(b1); foot.appendChild(el('span', 'sp'));
      foot.appendChild(confirmButton('删除', '确认删除', '', async function () { await DB.del(x.id); renderBook(); }));
      card.appendChild(foot); list.appendChild(card);
    });
  }

  /* ---------- 导出 ---------- */
  function csvCell(s) { s = String(s == null ? '' : s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportWords(fmt) {
    var rows = cache.word.filter(function (x) { return match(x, ['term', 'meaning', 'example', 'context']); });
    if (!rows.length) { toast('没有可以导出的词条。'); return; }
    if (fmt === 'csv') {
      var lines = [['词条', '读音', '词性', '释义', '例句', '出处', '类别', '日期'].map(csvCell).join(',')];
      rows.forEach(function (x) { lines.push([x.term, x.reading || '', x.pos, x.meaning, x.example, x.context, x.kind === 'sub' ? '概念' : (x.lang || '英语'), fmtDay(x.ts)].map(csvCell).join(',')); });
      saveFile('W-生词本.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    } else {
      var clean = function (s) { return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' '); };
      var out = ['#separator:tab', '#html:true'];
      rows.forEach(function (x) {
        out.push(clean(x.term) + (x.reading ? ' ' + clean(x.reading) : '') + (x.pos ? ' (' + clean(x.pos) + ')' : '') + '\t' + clean(x.meaning) + (x.example ? '<br><i>' + clean(x.example) + '</i>' : ''));
      });
      saveFile('W-Anki.txt', out.join('\n'), 'text/plain');
    }
  }

  /* ================= 练习 ================= */
  var prac = null;
  function startPractice(list) {
    if (!list.length) { toast('没有题目可练。'); return; }
    prac = { list: list.slice(), i: 0, right: 0, wrong: 0 };
    $('practice').hidden = false; showPracQ();
  }
  function showPracQ() {
    var body = $('pracBody'); body.textContent = '';
    if (prac.i >= prac.list.length) {
      $('pracCount').textContent = '完成';
      body.appendChild(el('div', 'prac-q', '答对 ' + prac.right + ' 道，答错 ' + prac.wrong + ' 道。'));
      if (prac.wrong) body.appendChild(el('p', 'muted', '答错的题已经记进错题本，可以在那里出变式题再练。'));
      var done = el('button', 'btn primary', '完成'); done.type = 'button';
      done.addEventListener('click', closePractice); var act = el('div', 'actions'); act.appendChild(done); body.appendChild(act);
      return;
    }
    var q = prac.list[prac.i];
    $('pracCount').textContent = (prac.i + 1) + ' / ' + prac.list.length + (q.topic ? ' · ' + q.topic : '');
    body.appendChild(el('div', 'prac-q', q.q));
    var ta = document.createElement('textarea'); ta.placeholder = '先自己写出答案（可以不写）'; ta.setAttribute('aria-label', '你的答案'); body.appendChild(ta);
    var act2 = el('div', 'actions'); body.appendChild(act2);
    var show = el('button', 'btn primary', '显示答案'); show.type = 'button'; act2.appendChild(show);
    show.addEventListener('click', function () {
      show.remove();
      var a = el('div', 'prac-a'); renderAnswer(a, q.a || '（没有标准答案）'); body.insertBefore(a, act2);
      var r = el('button', 'btn', '答对了'); r.type = 'button';
      var w = el('button', 'btn danger', '答错了'); w.type = 'button';
      r.addEventListener('click', function () { markPrac(q, 'right'); });
      w.addEventListener('click', function () { markPrac(q, 'wrong'); });
      act2.appendChild(r); act2.appendChild(w);
    });
  }
  async function markPrac(q, result) {
    q.result = result;
    try {
      await DB.put(q);
      if (result === 'wrong') {
        var wid = 'wrong-q-' + q.id;
        if (!(await DB.get(wid))) await DB.put({ id: wid, type: 'wrong', ts: Date.now(), day: DB.dayKey(), status: 'wrong', problem: q.q, mywork: '', stuck: '', points: q.topic ? [q.topic] : [], explain: q.a, img: null, mastered: false });
      }
    } catch (e) { toast('没存上这次结果。'); }
    if (result === 'right') prac.right++; else prac.wrong++;
    prac.i++; showPracQ();
  }
  function closePractice() { $('practice').hidden = true; prac = null; if (currentView === 'book') renderBook(); if (currentView === 'today') renderToday(); }
  $('pracClose').addEventListener('click', closePractice);

  /* ================= 设置页 ================= */
  function syncSettingsUi() {
    var p = settings.provider, P = AI.PROVIDERS[p];
    document.querySelectorAll('#provSeg button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-prov') === p ? 'true' : 'false'); });
    $('keyIn').value = settings.keys[p] || '';
    var m = settings.models[p] || {};
    $('modelFast').value = m.fast || ''; $('modelFast').placeholder = P.fast || '填 OpenAI 官网现有的模型名';
    $('modelStrong').value = m.strong || ''; $('modelStrong').placeholder = P.strong || '填 OpenAI 官网现有的模型名';
    var help = $('keyHelp'); help.textContent = '';
    help.appendChild(document.createTextNode('在这里申请密钥：'));
    var a = el('a', null, P.keyUrl.replace('https://', '')); a.href = P.keyUrl; a.target = '_blank'; a.rel = 'noopener';
    help.appendChild(a);
    if (p === 'gemini') help.appendChild(document.createTextNode('。用个人 Google 账号登录，Flash-Lite 系列有免费额度。'));
    if (p === 'openai') help.appendChild(document.createTextNode('。ChatGPT 会员不含 API，API 要单独充值。'));
    $('autoWord').checked = !!settings.autoWord; $('autoWrong').checked = !!settings.autoWrong;
    $('testOut').textContent = '';
    updateBanner();
  }
  document.querySelectorAll('#provSeg button').forEach(function (b) {
    b.addEventListener('click', function () { settings.provider = b.getAttribute('data-prov'); saveSettings(); syncSettingsUi(); });
  });
  $('keyIn').addEventListener('change', function () { settings.keys[settings.provider] = $('keyIn').value.trim(); saveSettings(); updateBanner(); });
  function saveModels() {
    var p = settings.provider;
    settings.models[p] = { fast: $('modelFast').value.trim(), strong: $('modelStrong').value.trim() };
    saveSettings();
  }
  $('modelFast').addEventListener('change', saveModels);
  $('modelStrong').addEventListener('change', saveModels);
  $('autoWord').addEventListener('change', function () { settings.autoWord = $('autoWord').checked; saveSettings(); });
  $('autoWrong').addEventListener('change', function () { settings.autoWrong = $('autoWrong').checked; saveSettings(); });
  $('testBtn').addEventListener('click', async function () {
    settings.keys[settings.provider] = $('keyIn').value.trim(); saveModels(); updateBanner();
    var out = $('testOut'); out.textContent = '测试中…'; $('testBtn').disabled = true;
    var msgs = [];
    try {
      await AI.test(settings, 'fast'); msgs.push('日常模型 ✓');
      try { await AI.test(settings, 'strong'); msgs.push('强模型 ✓'); } catch (e) { msgs.push('强模型 ✗ ' + errMsg(e)); }
    } catch (e) { msgs.push('日常模型 ✗ ' + errMsg(e)); }
    out.textContent = msgs.join('　'); $('testBtn').disabled = false;
  });
  $('expBackup').addEventListener('click', async function () {
    try { var t = await DB.exportAll(); await saveFile('W-备份-' + DB.dayKey() + '.json', t, 'application/json'); }
    catch (e) { toast('导出失败：' + errMsg(e)); }
  });
  $('impBackup').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { var n = await DB.importAll(await f.text()); toast('已导入 ' + n + ' 条记录。'); }
    catch (err) { toast('导入失败：' + errMsg(err)); }
  });
  (function () {
    var wrap = $('wipeBtn').parentNode, old = $('wipeBtn');
    var b = confirmButton('清空所有记录', '再点一次，真的清空', 'danger', async function () { await DB.clear(); toast('已清空。'); });
    wrap.replaceChild(b, old);
  })();

  /* ================= 接线 ================= */
  $('strong').addEventListener('change', function () { settings.strong = $('strong').checked; saveSettings(); });
  $('drawBtn').addEventListener('click', function () { settings.draw = !settings.draw; saveSettings(); applyDrawMode(); });
  $('fileIn').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; openFile(f); });
  $('prevBtn').addEventListener('click', function () { if (src.kind === 'pdf' && src.page > 1) { src.page--; stage.scrollTop = 0; renderPage(); } });
  $('nextBtn').addEventListener('click', function () { if (src.kind === 'pdf' && src.page < src.pages) { src.page++; stage.scrollTop = 0; renderPage(); } });
  function stepZoom(d) {
    var i = ZOOMS.indexOf(zoom); if (i < 0) i = 1;
    var n = Math.min(Math.max(i + d, 0), ZOOMS.length - 1);
    if (n !== i) { zoom = ZOOMS[n]; renderPage(); }
  }
  $('zoomIn').addEventListener('click', function () { stepZoom(1); });
  $('zoomOut').addEventListener('click', function () { stepZoom(-1); });
  stage.addEventListener('dragover', function (e) { e.preventDefault(); });
  stage.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openFile(f); });

  $('askForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('askIn').value.trim();
    if (!q || busy) return;
    $('askIn').value = '';
    if (topic && topic.done) askFollow(q); else ask({ text: q });
  });
  $('newBtn').addEventListener('click', function () {
    var q = $('askIn').value.trim();
    if (!q || busy) { toast('先输入要问的词或问题。'); return; }
    $('askIn').value = ''; ask({ text: q });
  });
  $('stopBtn').addEventListener('click', function () { if (ctl) ctl.abort(); });
  $('imgBtn').addEventListener('click', function () { $('imgIn').click(); });
  $('imgIn').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (f) { var note = $('askIn').value.trim(); $('askIn').value = ''; ask({ blob: f, note: note }); }
  });
  document.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) {
          if (currentView === 'notes' && window.QWNotes && window.QWNotes.canInsert()) return; /* 文档里的粘贴由 notes.js 处理 */
          e.preventDefault();
          if (currentView !== 'notes') showView('notes');
          if (window.QWNotes && window.QWNotes.openAI) window.QWNotes.openAI();
          var note = $('askIn').value.trim(); $('askIn').value = '';
          ask({ blob: f, note: note });
          return;
        }
      }
    }
  });

  $('dayIn').addEventListener('change', renderToday);
  $('digestBtn').addEventListener('click', generateDigest);
  $('digestStop').addEventListener('click', function () { if (digestCtl) digestCtl.abort(); });
  document.querySelectorAll('#bookSeg button').forEach(function (b) {
    b.addEventListener('click', function () { bookTab = b.getAttribute('data-book'); bookQuery = ''; renderBook(); });
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (currentView === 'read') renderPage(); }, 220);
  });

  /* ================= 启动 ================= */
  window.QW = { ask: ask, toast: toast, saveFile: saveFile, loadPdfJs: loadPdfJs, confirmButton: confirmButton, el: el, showView: showView, errMsg: errMsg };
  src.bitmap = makeSample();
  $('dayIn').value = DB.dayKey();
  syncModeUi(); applyDrawMode(); emptyThread(); updateAskUi(); updateBanner();
  showView('notes');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
