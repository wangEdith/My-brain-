/* 圈问 · AI 接入层
   Gemini / ChatGPT(OpenAI) / Claude 三家共用一套调用。密钥只存在这台设备的浏览器里。 */
(function () {
  'use strict';

  var AI = {};

  AI.PROVIDERS = {
    gemini: { label: 'Gemini', fast: 'gemini-3.1-flash-lite', strong: 'gemini-3-flash-preview', keyUrl: 'https://aistudio.google.com/apikey' },
    openai: { label: 'ChatGPT（OpenAI API）', fast: '', strong: '', keyUrl: 'https://platform.openai.com/api-keys' },
    claude: { label: 'Claude', fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' }
  };

  /* ---------- images ---------- */
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('读取图片失败')); };
      r.readAsDataURL(blob);
    });
  }
  function loadImage(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('图片无法解码')); };
      img.src = url;
    });
  }
  /* 缩到最长边 maxSide 再压成 JPEG，省流量也省钱 */
  AI.prepareImage = async function (blob, maxSide) {
    maxSide = maxSide || 1800;
    var img = await loadImage(blob);
    var w = img.naturalWidth, h = img.naturalHeight;
    var k = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    var out = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.9); });
    var url = await blobToDataUrl(out);
    return { mime: 'image/jpeg', b64: url.split(',')[1], blob: out };
  };

  /* ---------- errors ---------- */
  function friendly(status, raw) {
    var m = (raw || '').toString();
    if (status === 0) return '连不上服务器。检查网络，或者这家服务在你的网络下不可用。';
    if (status === 400 && /api key|API_KEY|invalid.*key/i.test(m)) return '密钥不对，去“设置”里重新粘贴。';
    if (status === 400) return '请求被拒绝：' + m.slice(0, 160);
    if (status === 401 || status === 403) return '密钥无效，或者这个密钥没有权限用这个模型。';
    if (status === 404) return '找不到这个模型名，去“设置”里检查模型名。';
    if (status === 429) return '额度用完了，或者请求太快。等一会儿再试，或换一家 AI。';
    if (status >= 500) return '这家 AI 服务暂时出问题了，稍后再试。';
    return '出错了（' + status + '）：' + m.slice(0, 160);
  }
  function makeError(status, raw, body) {
    var msg = raw;
    try {
      var j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error.status)) || raw;
    } catch (e) {}
    var err = new Error(friendly(status, msg));
    err.status = status; err.userMessage = err.message;
    return err;
  }

  /* ---------- SSE ---------- */
  async function readSSE(res, onData) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.indexOf('data:') === 0) { var d = line.slice(5).trim(); if (d) onData(d); }
      }
    }
    var rest = buf.trim();
    if (rest.indexOf('data:') === 0) onData(rest.slice(5).trim());
  }

  async function post(url, headers, body, signal) {
    var res;
    try {
      res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      var err = new Error(friendly(0)); err.status = 0; err.userMessage = err.message; throw err;
    }
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) {}
      throw makeError(res.status, res.statusText, t);
    }
    return res;
  }

  /* ---------- providers ---------- */
  async function callGemini(o) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(o.model) + ':streamGenerateContent?alt=sse';
    var body = {
      contents: o.messages.map(function (m) {
        var parts = (m.images || []).map(function (im) { return { inline_data: { mime_type: im.mime, data: im.b64 } }; });
        parts.push({ text: m.text });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts };
      }),
      generationConfig: {}
    };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    if (o.json) body.generationConfig.responseMimeType = 'application/json';
    var res = await post(url, { 'content-type': 'application/json', 'x-goog-api-key': o.key }, body, o.signal);
    var full = '', blocked = '';
    await readSSE(res, function (d) {
      var j; try { j = JSON.parse(d); } catch (e) { return; }
      if (j.promptFeedback && j.promptFeedback.blockReason) blocked = j.promptFeedback.blockReason;
      var c = j.candidates && j.candidates[0];
      if (!c) return;
      if (c.content && c.content.parts) {
        var add = c.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('');
        if (add) { full += add; if (o.onText) o.onText(full); }
      }
      if (c.finishReason === 'SAFETY' && !full) blocked = 'SAFETY';
    });
    if (!full && blocked) { var e = new Error('这段内容被 Gemini 的安全过滤拦下了，换个范围再试。'); e.userMessage = e.message; throw e; }
    return full;
  }

  async function callOpenAI(o) {
    var msgs = [];
    if (o.system) msgs.push({ role: 'system', content: o.system });
    o.messages.forEach(function (m) {
      if (m.images && m.images.length) {
        var parts = [{ type: 'text', text: m.text }];
        m.images.forEach(function (im) { parts.push({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.b64 } }); });
        msgs.push({ role: m.role, content: parts });
      } else msgs.push({ role: m.role, content: m.text });
    });
    var body = { model: o.model, messages: msgs, stream: true };
    if (o.json) body.response_format = { type: 'json_object' };
    var res = await post('https://api.openai.com/v1/chat/completions',
      { 'content-type': 'application/json', 'authorization': 'Bearer ' + o.key }, body, o.signal);
    var full = '';
    await readSSE(res, function (d) {
      if (d === '[DONE]') return;
      var j; try { j = JSON.parse(d); } catch (e) { return; }
      var delta = j.choices && j.choices[0] && j.choices[0].delta;
      if (delta && delta.content) { full += delta.content; if (o.onText) o.onText(full); }
    });
    return full;
  }

  async function callClaude(o) {
    var body = {
      model: o.model, max_tokens: 4096, stream: true,
      messages: o.messages.map(function (m) {
        var parts = (m.images || []).map(function (im) { return { type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }; });
        parts.push({ type: 'text', text: m.text });
        return { role: m.role, content: parts };
      })
    };
    if (o.system) body.system = o.system;
    var res = await post('https://api.anthropic.com/v1/messages', {
      'content-type': 'application/json', 'x-api-key': o.key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
    }, body, o.signal);
    var full = '';
    await readSSE(res, function (d) {
      var j; try { j = JSON.parse(d); } catch (e) { return; }
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') { full += j.delta.text; if (o.onText) o.onText(full); }
      if (j.type === 'error') { var e = new Error((j.error && j.error.message) || 'Claude 返回了错误'); e.userMessage = e.message; throw e; }
    });
    return full;
  }

  /* ---------- public ---------- */
  AI.modelFor = function (settings, tier) {
    var p = settings.provider;
    var m = (settings.models && settings.models[p]) || {};
    return (tier === 'strong' ? m.strong : m.fast) || AI.PROVIDERS[p][tier === 'strong' ? 'strong' : 'fast'];
  };
  AI.hasKey = function (settings) { return !!(settings.keys && settings.keys[settings.provider]); };

  /* opts: {settings, tier:'fast'|'strong', system, messages:[{role,text,images}], json, onText(fullText), signal} */
  AI.chat = async function (opts) {
    var s = opts.settings, p = s.provider;
    var key = s.keys && s.keys[p];
    if (!key) { var e0 = new Error('还没有填 ' + AI.PROVIDERS[p].label + ' 的密钥，去“设置”里填。'); e0.userMessage = e0.message; throw e0; }
    var model = AI.modelFor(s, opts.tier || 'fast');
    if (!model) { var e1 = new Error('还没有填模型名，去“设置”里填。'); e1.userMessage = e1.message; throw e1; }
    var o = { key: key, model: model, system: opts.system, messages: opts.messages, json: !!opts.json, onText: opts.onText, signal: opts.signal };
    var text;
    if (p === 'gemini') text = await callGemini(o);
    else if (p === 'openai') text = await callOpenAI(o);
    else text = await callClaude(o);
    if (!text || !text.trim()) { var e2 = new Error('没有得到回答，缩小范围或换个说法再试。'); e2.userMessage = e2.message; throw e2; }
    return text;
  };

  AI.parseJSON = function (text) {
    var s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.search(/[\[{]/);
    if (a < 0) return null;
    var closeObj = s.lastIndexOf('}'), closeArr = s.lastIndexOf(']');
    var b = Math.max(closeObj, closeArr);
    if (b < a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  };

  AI.test = async function (settings, tier) {
    return AI.chat({ settings: settings, tier: tier, messages: [{ role: 'user', text: '只回复两个字：成功' }] });
  };

  window.AI = AI;
})();
