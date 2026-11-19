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
const DATA_DIR = path.join(__dirname, '.data');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- 本地数据层（生词本 / 历史 / 统计 / 学习） ---------- */
const WORDBOOK_FILE = path.join(DATA_DIR, 'wordbook.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const LEARN_FILE = path.join(DATA_DIR, 'learn.json');
const HOTKEY_FILE = path.join(__dirname, 'hotkey_config.json');
const CURRICULUM_FILE = path.join(PUBLIC_DIR, 'curriculum.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shortDef(d) {
  if (!d) return '';
  if (d.type === 'sentence') return d.translation || '';
  const s = d.senses && d.senses[0];
  return s ? (s.pos ? s.pos + ' ' : '') + (s.defs || []).join('；') : '';
}

// 每次查询后记录历史与统计（5 分钟内同一内容只记一次）
function recordQuery(text, type, ok) {
  if (!ok || !text) return;
  const now = Date.now();
  const hist = readJson(HISTORY_FILE, []);
  const last = hist[0];
  if (!last || last.text !== text || now - last.ts > 300000) {
    hist.unshift({ id: 'h' + now, text, type, ts: now });
    writeJson(HISTORY_FILE, hist.slice(0, 300));
  }
  const st = readJson(STATS_FILE, { total: 0, words: 0, sentences: 0, byDay: {} });
  st.total = (st.total || 0) + 1;
  if (type === 'word') st.words = (st.words || 0) + 1; else st.sentences = (st.sentences || 0) + 1;
  const day = todayStr();
  st.byDay[day] = (st.byDay[day] || 0) + 1;
  writeJson(STATS_FILE, st);
}

function getStats() {
  const st = readJson(STATS_FILE, { total: 0, words: 0, sentences: 0, byDay: {} });
  const book = readJson(WORDBOOK_FILE, []);
  const hist = readJson(HISTORY_FILE, []);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = todayStr(d);
    days.push({ date: key, label: (d.getMonth() + 1) + '/' + d.getDate(), count: st.byDay[key] || 0 });
  }
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((st.byDay[todayStr(d)] || 0) > 0) streak++; else break;
  }
  let due = 0;
  const now = Date.now();
  for (const it of book) if (!it.nextReview || it.nextReview <= now) due++;
  return { total: st.total || 0, words: st.words || 0, sentences: st.sentences || 0,
    favorites: book.length, due, streak, historyCount: hist.length, days, cacheCount: fs.readdirSync(CACHE_DIR).length };
}

// 复习间隔（天）：按熟练度 level 0..5
const REVIEW_DAYS = [1, 2, 4, 7, 15, 30];

/* ---------- 学习引擎（从零学英语：每日任务 / 错题本 / XP） ---------- */
const LEARN_LEVEL_TITLES = ['新芽', '起步', '入门', '成长', '进阶', '熟练', '精通', '大师'];

function readLearn() {
  return readJson(LEARN_FILE, { xp: 0, learnedWords: [], lessonDone: {}, byDay: {}, mistakes: [] });
}
function learnLevel(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1; }
function learnLevelTitle(lv) { return LEARN_LEVEL_TITLES[Math.min(lv - 1, LEARN_LEVEL_TITLES.length - 1)]; }
function learnStreak(byDay) {
  let s = 0;
  for (let i = 0; ; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const day = byDay[todayStr(d)];
    if (day && (day.xp || 0) > 0) s++; else break;
  }
  return s;
}
function curric() { return readJson(CURRICULUM_FILE, { levels: [] }); }
// 按课程顺序拍平全部词汇
function allCourseWords() {
  const out = [];
  for (const lv of curric().levels || [])
    for (const u of lv.units || [])
      if (u.type === 'vocab')
        for (const it of u.items || [])
          out.push({ word: it.w, zh: it.zh, phone: it.phone || '', unitId: u.id, unitTitle: u.title });
  return out;
}
// 生成/读取某天的每日任务（按日期确定性生成，避免重复随机）
function buildDaily(st, date) {
  if (!st.byDay[date]) st.byDay[date] = { xp: 0, progress: {}, done: {} };
  const day = st.byDay[date];
  day.progress = day.progress || {}; day.done = day.done || {};
  const learned = new Set(st.learnedWords || []);
  const fresh = allCourseWords().filter(p => !learned.has(p.word)).slice(0, 5);
  // 听写词源：优先生词本单词（到期优先），不足补已学词，再不足补新词
  const book = readJson(WORDBOOK_FILE, [])
    .filter(b => /^[A-Za-z' -]+$/.test(b.word || ''))
    .sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
  let dictPool = book.map(b => ({ word: b.word, zh: b.def || '', phone: '' }));
  if (dictPool.length < 8) {
    const learnedList = (st.learnedWords || []).map(w => {
      const hit = allCourseWords().find(c => c.word === w);
      return hit ? { word: hit.word, zh: hit.zh, phone: hit.phone } : null;
    }).filter(Boolean);
    for (const x of learnedList) if (dictPool.length < 8 && !dictPool.some(d => d.word === x.word)) dictPool.push(x);
    for (const x of fresh) if (dictPool.length < 8 && !dictPool.some(d => d.word === x.word)) dictPool.push({ word: x.word, zh: x.zh, phone: x.phone });
  }
  const dictWords = dictPool.slice(0, 8);
  // 用日期做种子的稳定抽取（错峰复习不同词）
  const seed = parseInt(date.replace(/-/g, ''), 10);
  const rnd = i => { const x = Math.sin(seed * 9301 + i * 49297) * 233280; return Math.abs(x - Math.floor(x)); };
  const quizPool = [];
  const learnedArr = (st.learnedWords || []).slice();
  for (let i = 0; i < 10 && learnedArr.length; i++) {
    const idx = Math.floor(rnd(i) * learnedArr.length);
    const hit = allCourseWords().find(c => c.word === learnedArr[idx]);
    if (hit) quizPool.push({ word: hit.word, zh: hit.zh, phone: hit.phone });
  }
  const activeMistakes = (st.mistakes || []).filter(m => !m.mastered);
  const tasks = [
    { id: 'new', icon: 'book', title: '学新词', desc: fresh.length ? '今天学 ' + fresh.length + ' 个新单词，先看卡再闯关' : '课程词库已全部学完', target: fresh.length, words: fresh, xp: 40 },
    { id: 'dict', icon: 'sound', title: '听写训练', desc: '听发音写单词，练耳朵和拼写', target: dictWords.length, words: dictWords, xp: 30 },
    { id: 'mistake', icon: 'fix', title: '错题订正', desc: activeMistakes.length ? '攻克 ' + activeMistakes.length + ' 道错题（答对 2 次即销题）' : '没有待订正的错题，保持下去', target: activeMistakes.length, xp: 30 },
    { id: 'quiz', icon: 'zap', title: '综合小测', desc: quizPool.length ? '已学词随机 10 题，检验记忆' : '先去学几个新词，才有题目可测', target: quizPool.length ? 10 : 0, words: quizPool, xp: 40 }
  ];
  for (const t of tasks) {
    t.progress = Math.min(day.progress[t.id] || 0, t.target);
    t.completed = t.target > 0 && t.progress >= t.target;
  }
  return { date, tasks, earnedXp: day.xp || 0 };
}
function grantXp(st, date, amount) {
  st.xp = (st.xp || 0) + amount;
  const day = st.byDay[date] = st.byDay[date] || { xp: 0, progress: {}, done: {} };
  day.xp = (day.xp || 0) + amount;
}
// 新词入册：记入已学列表 + 自动进生词本（进入间隔复习体系）
function addLearnedWords(st, words) {
  let added = 0;
  const book = readJson(WORDBOOK_FILE, []);
  for (const w of (words || [])) {
    const word = String((w && w.word) || '').trim();
    if (!word) continue;
    if (!(st.learnedWords || []).includes(word)) { (st.learnedWords = st.learnedWords || []).push(word); added++; }
    if (!book.some(b => b.word === word)) {
      book.unshift({ id: 'w' + Date.now() + '_' + added + '_' + Math.floor(Math.random() * 9999), word, type: 'word',
        def: String((w && w.zh) || ''), addedAt: Date.now(), level: 0, reviewCount: 0, lastReview: 0, nextReview: Date.now() + 86400000 });
    }
  }
  writeJson(WORDBOOK_FILE, book.slice(0, 1000));
  return added;
}
function learnOverview() {
  const st = readLearn();
  const today = todayStr();
  const daily = buildDaily(st, today);
  writeJson(LEARN_FILE, st);
  const cur = curric();
  let total = 0, done = 0;
  for (const lv of cur.levels || []) for (const u of lv.units || []) { total++; if (st.lessonDone && st.lessonDone[u.id]) done++; }
  const lv = learnLevel(st.xp || 0);
  return {
    xp: st.xp || 0, level: lv, levelTitle: learnLevelTitle(lv), nextLevelXp: Math.round(Math.pow(lv, 2) * 60),
    streak: learnStreak(st.byDay || {}), wordsLearned: (st.learnedWords || []).length,
    lessonsDone: done, lessonsTotal: total,
    mistakesActive: (st.mistakes || []).filter(m => !m.mastered).length,
    mistakesMastered: (st.mistakes || []).filter(m => m.mastered).length,
    daily
  };
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1048576) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (_) { resolve({}); } });
  });
}
function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

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
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
  const P = u.pathname, M = req.method;

  /* ---------- 服务状态 ---------- */
  if (P === '/api/ping') return json(res, { ok: true, name: 'WordLens', port: PORT, time: Date.now() });

  /* ---------- 生词本 ---------- */
  if (P === '/api/wordbook' && M === 'GET') {
    const items = readJson(WORDBOOK_FILE, []);
    return json(res, { items });
  }
  if (P === '/api/wordbook' && M === 'POST') {
    const b = await readBody(req);
    const word = String(b.word || b.text || '').trim();
    if (!word) return json(res, { error: 'empty word' }, 400);
    const items = readJson(WORDBOOK_FILE, []);
    if (items.some(x => x.word === word)) return json(res, { ok: true, duplicate: true, items });
    items.unshift({ id: 'w' + Date.now(), word, type: b.type || 'word', def: String(b.def || ''),
      addedAt: Date.now(), level: 0, reviewCount: 0, lastReview: 0, nextReview: 0 });
    writeJson(WORDBOOK_FILE, items.slice(0, 1000));
    return json(res, { ok: true, items: items.slice(0, 1000) });
  }
  if (P === '/api/wordbook' && M === 'DELETE') {
    const id = u.searchParams.get('id');
    let items = readJson(WORDBOOK_FILE, []);
    if (u.searchParams.get('all') === '1') items = [];
    else items = items.filter(x => x.id !== id);
    writeJson(WORDBOOK_FILE, items);
    return json(res, { ok: true, items });
  }
  // 复习打分：known=true 熟练度+1，false 归零
  if (P === '/api/wordbook/review' && M === 'POST') {
    const b = await readBody(req);
    const items = readJson(WORDBOOK_FILE, []);
    const it = items.find(x => x.id === b.id);
    if (!it) return json(res, { error: 'not found' }, 404);
    it.level = b.known ? Math.min((it.level || 0) + 1, 5) : 0;
    it.reviewCount = (it.reviewCount || 0) + 1;
    it.lastReview = Date.now();
    it.nextReview = Date.now() + REVIEW_DAYS[it.level] * 86400000;
    writeJson(WORDBOOK_FILE, items);
    return json(res, { ok: true, item: it });
  }

  /* ---------- 历史 ---------- */
  if (P === '/api/history' && M === 'GET') {
    return json(res, { items: readJson(HISTORY_FILE, []) });
  }
  if (P === '/api/history' && M === 'DELETE') {
    let items = readJson(HISTORY_FILE, []);
    if (u.searchParams.get('all') === '1') items = [];
    else items = items.filter(x => x.id !== u.searchParams.get('id'));
    writeJson(HISTORY_FILE, items);
    return json(res, { ok: true, items });
  }

  /* ---------- 统计 ---------- */
  if (P === '/api/stats' && M === 'GET') return json(res, getStats());

  /* ---------- 热键配置（与托盘共用 hotkey_config.json） ---------- */
  if (P === '/api/hotkey' && M === 'GET') {
    const c = readJson(HOTKEY_FILE, null);
    return json(res, { config: c || { name: '默认 Ctrl+Shift+W', mod: 6, vk: 87 }, configured: !!c });
  }
  if (P === '/api/hotkey' && M === 'POST') {
    const b = await readBody(req);
    const mod = Number(b.mod), vk = Number(b.vk);
    if (!Number.isInteger(mod) || !Number.isInteger(vk) || mod < 1 || mod > 15 || vk < 8 || vk > 255)
      return json(res, { error: 'invalid hotkey' }, 400);
    const cfg = { mod, vk, name: String(b.name || (mod + '+' + vk)) };
    writeJson(HOTKEY_FILE, cfg);
    return json(res, { ok: true, config: cfg, needRestart: true });
  }

  /* ---------- 缓存管理 ---------- */
  if (P === '/api/cache' && M === 'DELETE') {
    const files = fs.readdirSync(CACHE_DIR);
    for (const f of files) { try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (_) {} }
    return json(res, { ok: true, cleared: files.length });
  }

  /* ---------- 学习引擎：课程 / 每日任务 / 错题本 ---------- */
  if (P === '/api/curriculum' && M === 'GET') return json(res, curric());

  if (P === '/api/learn/lessons' && M === 'GET') {
    const st = readLearn();
    return json(res, { items: st.lessonDone || {} });
  }


  if (P === '/api/learn/overview' && M === 'GET') return json(res, learnOverview());

  if (P === '/api/learn/daily' && M === 'GET') {
    const st = readLearn();
    const daily = buildDaily(st, todayStr());
    writeJson(LEARN_FILE, st);
    return json(res, daily);
  }
  if (P === '/api/learn/daily/progress' && M === 'POST') {
    const b = await readBody(req);
    const taskId = String(b.taskId || '');
    const inc = Math.max(0, Math.min(Number(b.inc) || 0, 50));
    const st = readLearn();
    const today = todayStr();
    const daily = buildDaily(st, today);
    const t = daily.tasks.find(x => x.id === taskId);
    if (!t || t.target <= 0) return json(res, { error: 'task not found or empty' }, 404);
    t.progress = Math.min(t.progress + inc, t.target);
    st.byDay[today].progress[taskId] = t.progress;
    let granted = 0;
    if (t.progress >= t.target && !st.byDay[today].done[taskId]) {
      st.byDay[today].done[taskId] = true;
      grantXp(st, today, t.xp);
      granted = t.xp;
      t.completed = true;
    }
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true, task: { id: t.id, progress: t.progress, target: t.target, completed: t.completed }, grantedXp: granted });
  }

  // 新词入册（学习卡片完成后调用）
  if (P === '/api/learn/words' && M === 'POST') {
    const b = await readBody(req);
    const st = readLearn();
    const added = addLearnedWords(st, b.words);
    const xp = added * 4;
    if (xp > 0) grantXp(st, todayStr(), xp);
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true, added, xp });
  }

  // 课程单元完成
  if (P === '/api/learn/lesson' && M === 'POST') {
    const b = await readBody(req);
    const unitId = String(b.unitId || '');
    if (!unitId) return json(res, { error: 'unitId required' }, 400);
    const st = readLearn();
    const prev = (st.lessonDone || {})[unitId] || {};
    const score = Math.max(0, Math.min(Number(b.score) || 0, 100));
    st.lessonDone = st.lessonDone || {};
    st.lessonDone[unitId] = { doneAt: Date.now(), score: Math.max(score, prev.score || 0), stars: Math.max(Number(b.stars) || 0, prev.stars || 0), times: (prev.times || 0) + 1 };
    let xp = 15 + Math.round(score / 10);
    if ((prev.times || 0) === 0 && b.words && b.words.length) xp += addLearnedWords(st, b.words) * 4;
    grantXp(st, todayStr(), xp);
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true, xp, lesson: st.lessonDone[unitId] });
  }

  // 错题本
  if (P === '/api/learn/mistakes' && M === 'GET') {
    const st = readLearn();
    const items = (st.mistakes || []);
    return json(res, { items: items.filter(m => !m.mastered), masteredCount: items.filter(m => m.mastered).length });
  }
  if (P === '/api/learn/mistake' && M === 'POST') {
    const b = await readBody(req);
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return json(res, { error: 'prompt required' }, 400);
    const st = readLearn();
    st.mistakes = st.mistakes || [];
    if (st.mistakes.some(m => !m.mastered && m.kind === b.kind && m.prompt === prompt)) return json(res, { ok: true, duplicate: true });
    st.mistakes.push({ id: 'm' + Date.now(), kind: String(b.kind || 'choice'), prompt, answer: String(b.answer || ''),
      given: String(b.given || ''), source: String(b.source || ''), streak: 0, mastered: false, addedAt: Date.now() });
    if (st.mistakes.length > 500) st.mistakes = st.mistakes.slice(-500);
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true });
  }
  if (P === '/api/learn/mistake/answer' && M === 'POST') {
    const b = await readBody(req);
    const st = readLearn();
    const m = (st.mistakes || []).find(x => x.id === b.id);
    if (!m) return json(res, { error: 'not found' }, 404);
    if (b.correct) {
      m.streak = (m.streak || 0) + 1;
      grantXp(st, todayStr(), 5);
      if (m.streak >= 2) m.mastered = true;
    } else {
      m.streak = 0;
    }
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true, streak: m.streak, mastered: m.mastered, grantedXp: b.correct ? 5 : 0 });
  }
  if (P === '/api/learn/mistake' && M === 'DELETE') {
    const st = readLearn();
    if (u.searchParams.get('all') === '1') st.mistakes = [];
    else st.mistakes = (st.mistakes || []).filter(x => x.id !== u.searchParams.get('id'));
    writeJson(LEARN_FILE, st);
    return json(res, { ok: true });
  }

  // 学习统计（近 14 天 XP 曲线）
  if (P === '/api/learn/stats' && M === 'GET') {
    const st = readLearn();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = todayStr(d);
      const day = (st.byDay || {})[key];
      days.push({ date: key, label: (d.getMonth() + 1) + '/' + d.getDate(), xp: (day && day.xp) || 0 });
    }
    return json(res, { xp: st.xp || 0, level: learnLevel(st.xp || 0), levelTitle: learnLevelTitle(learnLevel(st.xp || 0)),
      streak: learnStreak(st.byDay || {}), days,
      lessonsDone: Object.keys(st.lessonDone || {}).length, wordsLearned: (st.learnedWords || []).length,
      mistakesMastered: (st.mistakes || []).filter(m => m.mastered).length });
  }

  if (u.pathname === '/api/lookup') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const word = u.searchParams.get('word') || '';
    try {
      const data = await lookup(word);
      recordQuery(word, 'word', !data.error);
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
      recordQuery(text, data.type === 'word' ? 'word' : 'sentence', !data.error);
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
