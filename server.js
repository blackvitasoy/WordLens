/**
 * WordLens - 本地词典服务
 * 输入英文单词/短语，返回剑桥风格的结构化词条（音标、词性、释义、例句、词族、搭配）
 * 数据源：有道词典 jsonapi（含柯林斯/牛津双语例句）
 * 用法：node server.js  然后浏览器打开 http://localhost:7788
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 7788;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ---------- 离线兜底词库（网络失败或查无结果时用，保证工具永不空白） ---------- */
const OFFLINE = {
  artificial: {
    word: 'artificial', ukphone: 'ˌɑːtɪˈfɪʃ(ə)l', usphone: 'ˌɑːrtɪˈfɪʃ(ə)l',
    senses: [
      { pos: 'adj.', defs: ['人造的，人工的；人为的', '不真挚的，矫揉造作的', '假的，仿造的'] }
    ],
    examples: [
      { en: 'The juice contains no artificial preservatives.', zh: '这种果汁不含人工防腐剂。' },
      { en: 'The city is dotted with small lakes, natural and artificial.', zh: '这座城市点缀着天然和人造的小湖泊。' },
      { en: 'Her manner was somewhat artificial.', zh: '她的举止有些做作。' }
    ],
    phrases: [
      { en: 'artificial intelligence', zh: '人工智能' },
      { en: 'artificial leather', zh: '人造革' },
      { en: 'artificial insemination', zh: '人工受精' },
      { en: 'artificial respiration', zh: '人工呼吸' }
    ],
    wordforms: [{ name: '比较级', value: 'more artificial' }, { name: '最高级', value: 'most artificial' }],
    derivatives: [{ w: 'artificially', pos: 'adv.', zh: '人工地；虚假地' }, { w: 'artificiality', pos: 'n.', zh: '人造；虚伪' }],
    synonyms: [{ w: 'synthetic', zh: '人造的' }, { w: 'false', zh: '假的' }, { w: 'simulated', zh: '模拟的' }, { w: 'fake', zh: '伪造的' }],
    _offline: true
  }
};

/* ---------- HTTP GET，自动解压 gzip / br ---------- */
function fetchUrl(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json,text/html,*/*', 'Accept-Encoding': 'gzip, deflate' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let stream = res;
      const enc = res.headers['content-encoding'] || '';
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* ---------- 归一化工具 ---------- */
// 有道字段里 l.i 有时是字符串，有时是数组，有时是对象，统一取成字符串
function flattenI(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x.trim();
  if (Array.isArray(x)) return x.map(flattenI).filter(Boolean).join('；');
  if (typeof x === 'object') {
    if ('i' in x) return flattenI(x.i);
    return Object.values(x).map(flattenI).filter(Boolean).join('');
  }
  return String(x);
}
function cleanHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/* ---------- 抓取并有道数据 -> 统一结构 ---------- */
async function lookup(rawWord) {
  const word = rawWord.trim();
  if (!word) throw new Error('empty word');
  const cacheKey = path.join(CACHE_DIR, encodeURIComponent(word.toLowerCase()) + '.json');

  // 缓存：1 天内有效
  if (fs.existsSync(cacheKey)) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheKey, 'utf8'));
      if (Date.now() - c._ts < 86400000) return c.data;
    } catch (_) {}
  }

  try {
    const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word);
    const raw = await fetchUrl(url);
    const d = JSON.parse(raw);
    const result = normalizeYoudao(d, word);
    if (!result.word || (!result.senses.length && !result.examples.length)) throw new Error('查无结果');
    fs.writeFileSync(cacheKey, JSON.stringify({ _ts: Date.now(), data: result }), 'utf8');
    return result;
  } catch (e) {
    // 兜底：离线词库
    const key = word.toLowerCase();
    if (OFFLINE[key]) return OFFLINE[key];
    const r = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'empty.json'), 'utf8'));
    r.word = word;
    r.error = '网络不可用或查无此词';
    return r;
  }
}

function normalizeYoudao(d, word) {
  const out = {
    word: word, ukphone: '', usphone: '', ukSpeech: '', usSpeech: '',
    senses: [], examples: [], phrases: [], wordforms: [], derivatives: [], synonyms: [],
    source: '有道词典（柯林斯 / 牛津双语例句）', _offline: false
  };

  // 音标 + 发音地址（ec.word 与 simple.word 都是数组，取首项）
  const ecWord = d.ec && d.ec.word ? (Array.isArray(d.ec.word) ? d.ec.word[0] : d.ec.word) : null;
  const simpleWord = (d.simple && d.simple.word && d.simple.word[0]) || ecWord;
  if (simpleWord) {
    out.ukphone = simpleWord.ukphone || '';
    out.usphone = simpleWord.usphone || '';
    out.ukSpeech = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=1';
    out.usSpeech = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=2';
  }

  // 词性 + 释义：ec.word[0].trs（简明英汉），按词性聚合
  const trs = ecWord && ecWord.trs;
  if (Array.isArray(trs)) {
    const group = new Map();
    for (const t of trs) {
      const arr = Array.isArray(t.tr) ? t.tr : [t.tr];
      for (const item of arr) {
        const s = flattenI(item && item.l && item.l.i);
        if (!s) continue;
        const m = s.match(/^([a-z]+\.)\s*(.*)$/i);
        const pos = m ? m[1] : '其他';
        const def = m ? m[2] : s;
        if (!group.has(pos)) group.set(pos, []);
        def.split(/[；;]/).map(x => x.trim()).filter(Boolean).forEach(x => {
          if (!group.get(pos).includes(x)) group.get(pos).push(x);
        });
      }
    }
    for (const [pos, defs] of group) out.senses.push({ pos, defs });
  }

  // 双语例句：blng_sents_part.sentence-pair
  const pairs = d.blng_sents_part && d.blng_sents_part['sentence-pair'];
  if (Array.isArray(pairs)) {
    for (const p of pairs) {
      const en = cleanHtml(p.sentence || p['sentence-eng']);
      const zh = cleanHtml(p['sentence-translation']);
      if (en) out.examples.push({ en, zh, source: p.source || '' });
    }
  }

  // 短语搭配：phrs.phrs
  const phrs = d.phrs && d.phrs.phrs;
  if (Array.isArray(phrs)) {
    for (const it of phrs) {
      const p = it.phr || {};
      const en = flattenI(p.headword && p.headword.l && p.headword.l.i);
      const trArr = Array.isArray(p.trs) ? p.trs : [];
      const zh = trArr.map(t => flattenI(t.tr && t.tr.l && t.tr.l.i)).filter(Boolean).join('；');
      if (en) out.phrases.push({ en, zh });
    }
  }

  // 词形变化：ec.word[0].wfs
  const wfs = ecWord && ecWord.wfs;
  if (Array.isArray(wfs)) {
    for (const it of wfs) {
      const wf = it.wf || {};
      if (wf.value) out.wordforms.push({ name: wf.name || '', value: wf.value });
    }
  }

  // 派生词：individual.derivative = [{pos, trans:[{word, tran}]}]
  const der = d.individual && d.individual.derivative;
  if (Array.isArray(der)) {
    for (const it of der) {
      const pos = flattenI(it.pos) || '';
      const trans = Array.isArray(it.trans) ? it.trans : [];
      for (const t of trans) {
        const w = flattenI(t.word);
        const zh = flattenI(t.tran);
        if (w && !out.derivatives.some(x => x.w === w)) out.derivatives.push({ w, pos, zh });
      }
    }
  }
  // 兜底：rel_word.rels
  if (!out.derivatives.length && d.rel_word && Array.isArray(d.rel_word.rels)) {
    for (const r of d.rel_word.rels) {
      const rel = r.rel || {}; const pos = flattenI(rel.pos) || '';
      const words = Array.isArray(rel.words) ? rel.words : [];
      for (const t of words) {
        const w = flattenI(t.word); if (w) out.derivatives.push({ w, pos, zh: flattenI(t.tran) });
      }
    }
  }

  // 同义词：syno.synos（word + tran 中文），再补 individual.synonym
  const synos = d.syno && d.syno.synos;
  if (Array.isArray(synos)) {
    for (const s of synos) {
      const so = s.syno || {};
      const ws = Array.isArray(so.ws) ? so.ws : [];
      const tran = flattenI(so.tran);
      for (const it of ws) {
        const w = flattenI(it.w);
        if (w && !out.synonyms.some(x => x.w === w)) out.synonyms.push({ w, zh: tran });
      }
    }
  }
  const indSyn = d.individual && d.individual.synonym;
  if (Array.isArray(indSyn)) {
    for (const s of indSyn) {
      const trans = Array.isArray(s.trans) ? s.trans : [];
      for (const t of trans) {
        const w = flattenI(t.word); if (!w) continue;
        if (!out.synonyms.some(x => x.w === w)) out.synonyms.push({ w, zh: flattenI(t.tran) });
      }
    }
  }

  // 例句数量做上限，避免卡片过长
  out.examples = out.examples.slice(0, 8);
  out.phrases = out.phrases.slice(0, 12);
  out.synonyms = out.synonyms.slice(0, 12);
  out.derivatives = out.derivatives.slice(0, 12);
  return out;
}

/* ---------- 句子翻译（MyMemory，含缓存，支持双向） ---------- */
async function translateSentence(text, dir) {
  // dir: 'en2zh'(英译中) | 'zh2en'(中译英)
  const pair = dir === 'zh2en' ? 'zh-CN%7Cen' : 'en%7Czh-CN';
  const cacheKey = path.join(CACHE_DIR, 'tr_' + dir + '_' + Buffer.from(text).toString('base64url').slice(0, 120) + '.json');
  if (fs.existsSync(cacheKey)) {
    try { const c = JSON.parse(fs.readFileSync(cacheKey, 'utf8')); if (Date.now() - c._ts < 86400000) return c.data; } catch (_) {}
  }
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + pair;
  const raw = await fetchUrl(url, 15000);
  const j = JSON.parse(raw);
  if (j.responseStatus && j.responseStatus !== 200) throw new Error('翻译失败: ' + (j.responseDetails || j.responseStatus));
  const out = j.responseData && j.responseData.translatedText ? j.responseData.translatedText : '';
  if (!out) throw new Error('无翻译结果');
  const data = { type: 'sentence', dir, text, translation: out, quality: j.responseData.match || 0, source: 'MyMemory' };
  fs.writeFileSync(cacheKey, JSON.stringify({ _ts: Date.now(), data }), 'utf8');
  return data;
}

// 判断是单词还是句子：含空格且词数>=2，或长度>24 视为句子
function isSentence(text) {
  const t = text.trim();
  return /\s/.test(t) && (t.split(/\s+/).length >= 2 || t.length > 24);
}
// 含中文字符 → 判定为中文输入（走中译英）
function hasChinese(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

async function translate(text) {
  const w = text.trim();
  if (!w) throw new Error('empty input');
  // 中文输入（单字/词/句）一律走中译英；有道 jsonapi 只做英译中
  if (hasChinese(w)) return await translateSentence(w, 'zh2en');
  if (isSentence(w)) return await translateSentence(w, 'en2zh');
  const d = await lookup(w);
  return { type: 'word', ...d };
}

/* ---------- 静态文件 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ---------- 服务 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  if (u.pathname === '/api/lookup') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const word = u.searchParams.get('word') || '';
    try {
      const data = await lookup(word);
      res.writeHead(200); res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ word, error: String(e.message || e) }));
    }
    return;
  }
  if (u.pathname === '/api/translate') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const text = u.searchParams.get('text') || '';
    try {
      const data = await translate(text);
      res.writeHead(200); res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ text, error: String(e.message || e) }));
    }
    return;
  }
  serveStatic(req, res, u.pathname);
});

server.listen(PORT, () => {
  console.log('WordLens running at http://localhost:' + PORT);
  console.log('按 Ctrl+C 停止');
});
