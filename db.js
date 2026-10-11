/* 圈问 · 本机数据库（IndexedDB）
   items 表里放五种记录：log（提问记录）、word（生词）、wrong（错题）、question（问题集）、digest（每日总结） */
(function () {
  'use strict';

  var DB = {};
  var NAME = 'quanwen', STORE = 'items';
  var opened = null;

  function open() {
    if (opened) return opened;
    opened = new Promise(function (res, rej) {
      var r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = function () {
        var s = r.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('type', 'type');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return opened;
  }
  function run(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), s = t.objectStore(STORE), req;
        try { req = fn(s); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('数据库操作被中断')); };
      });
    });
  }

  DB.uid = function () {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  };
  DB.put = function (item) { return run('readwrite', function (s) { return s.put(item); }); };
  DB.get = function (id) { return run('readonly', function (s) { return s.get(id); }); };
  DB.del = function (id) { return run('readwrite', function (s) { return s.delete(id); }); };
  DB.all = function (type) { return run('readonly', function (s) { return s.index('type').getAll(type); }); };
  DB.everything = function () { return run('readonly', function (s) { return s.getAll(); }); };
  DB.clear = function () { return run('readwrite', function (s) { return s.clear(); }); };

  DB.dayKey = function (ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  };

  /* ---------- 备份：Blob 转成文本再存 ---------- */
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(b);
    });
  }
  async function dataUrlToBlob(u) { var r = await fetch(u); return r.blob(); }

  /* 递归处理：笔记页里的背景图、插入的图片也是 Blob */
  async function encodeBlobs(v) {
    if (v instanceof Blob) return { __blob: await blobToDataUrl(v) };
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(await encodeBlobs(v[i])); return a; }
    if (v && typeof v === 'object') { var o = {}; for (var k in v) o[k] = await encodeBlobs(v[k]); return o; }
    return v;
  }
  async function decodeBlobs(v) {
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(await decodeBlobs(v[i])); return a; }
    if (v && typeof v === 'object') {
      if (typeof v.__blob === 'string') return dataUrlToBlob(v.__blob);
      var o = {}; for (var k in v) o[k] = await decodeBlobs(v[k]); return o;
    }
    return v;
  }

  DB.exportAll = async function () {
    var items = await DB.everything();
    var out = [];
    for (var i = 0; i < items.length; i++) out.push(await encodeBlobs(items[i]));
    return JSON.stringify({ app: 'quanwen', version: 2, exportedAt: Date.now(), items: out });
  };
  DB.importAll = async function (text) {
    var j = JSON.parse(text);
    if (!j || j.app !== 'quanwen' || !Array.isArray(j.items)) throw new Error('这不是圈问的备份文件');
    var n = 0;
    for (var i = 0; i < j.items.length; i++) {
      await DB.put(await decodeBlobs(j.items[i])); n++;
    }
    return n;
  };

  window.DB = DB;
})();
