/* WordLens 学习中心模块：从零学英语（课程 / 每日任务 / 错题本）
   依赖 app.html 内联脚本的全局：$, $$, esc, api, toast, go, TITLES, S */
(function () {
  'use strict';

  var IC = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
    fix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };
  var TASK_IC = { book: IC.book, sound: IC.sound, fix: IC.fix, zap: IC.zap };
  var TYPE_ZH = { phonetic: '音标', vocab: '词汇', grammar: '语法', dialog: '对话', reading: '阅读', writing: '写作', review: '综合' };
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  var LP = { curriculum: null, overview: null, lessons: {}, sess: null, keyHandler: null };

  function audioUrl(w, type) { return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(w) + '&type=' + (type || 2); }
  function playAudio(w, type) { try { new Audio(audioUrl(w, type)).play().catch(function () { toast('发音需要联网'); }); } catch (_) {} }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickDistractors(pool, val, n) {
    var out = [], cand = shuffle(pool.filter(function (x) { return x !== val; }));
    for (var i = 0; i < cand.length && out.length < n; i++) out.push(cand[i]);
    return out;
  }
  // 打乱选项后回填正确答案下标
  function mkOptions(correctText, wrongTexts) {
    var opts = shuffle([{ text: correctText, ok: true }].concat(wrongTexts.map(function (x) { return { text: x, ok: false }; })));
    var a = 0;
    for (var i = 0; i < opts.length; i++) if (opts[i].ok) { a = i; break; }
    return { options: opts, a: a };
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ''); }
  function dateTitle(dstr) {
    var d = new Date(dstr + 'T00:00:00');
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + WEEK[d.getDay()];
  }

  /* ===================== 播放器骨架 ===================== */
  function ensurePlayerDom() {
    if (document.getElementById('learnPlayer')) return;
    var div = document.createElement('div');
    div.id = 'learnPlayer';
    div.innerHTML =
      '<div class="lp-top">' +
      '<button class="x" id="lpClose">' + IC.close + '</button>' +
      '<div class="t" id="lpTitle"></div>' +
      '<div class="acc" id="lpAcc"></div>' +
      '<div class="counter" id="lpCounter"></div></div>' +
      '<div class="lp-bar"><i id="lpBar"></i></div>' +
      '<div class="lp-body"><div class="lp-stage" id="lpStage"></div></div>';
    document.body.appendChild(div);
  }
  function closePlayer() {
    var p = document.getElementById('learnPlayer');
    if (p) p.classList.remove('open');
    if (LP.keyHandler) { document.removeEventListener('keydown', LP.keyHandler); LP.keyHandler = null; }
    LP.sess = null;
    refreshOverviewAndBadges();
  }
  function openPlayer(sess) {
    ensurePlayerDom();
    LP.sess = sess; sess.i = 0; sess.correct = 0; sess.answered = 0; sess.finished = false;
    document.getElementById('learnPlayer').classList.add('open');
    document.getElementById('lpTitle').textContent = sess.title;
    document.getElementById('lpClose').onclick = function () {
      if (LP.sess && LP.sess.answered > 0 && !LP.sess.finished) { if (!confirm('学习进行中，确定退出？已完成的题目已记录。')) return; }
      closePlayer();
    };
    if (LP.keyHandler) document.removeEventListener('keydown', LP.keyHandler);
    LP.keyHandler = function (e) {
      if (!LP.sess || LP.sess.finished) return;
      var ae = document.activeElement, tag = (ae && ae.tagName) || '';
      var inInput = /^(INPUT|TEXTAREA)$/.test(tag);
      if (e.key === ' ' && !inInput && tag !== 'BUTTON') { e.preventDefault(); var aw = document.getElementById('lpAudioWord'); if (aw) playAudio(aw.value); return; }
      if (e.key === 'Enter' && !inInput && tag !== 'BUTTON') { e.preventDefault(); var nb = document.getElementById('lpNext'); if (nb && !nb.disabled) nb.click(); return; }
      if (/^[1-9]$/.test(e.key) && !inInput) { var ob = document.querySelectorAll('#lpStage .opt:not(:disabled)')[Number(e.key) - 1]; if (ob) ob.click(); return; }
    };
    document.addEventListener('keydown', LP.keyHandler);
    renderStep();
  }
  function renderStep() {
    var sess = LP.sess; if (!sess) return;
    var st = sess.steps[sess.i];
    document.getElementById('lpCounter').textContent = (sess.i + 1) + ' / ' + sess.steps.length;
    renderAcc();
    document.getElementById('lpBar').style.width = (sess.i / sess.steps.length * 100).toFixed(1) + '%';
    var stage = document.getElementById('lpStage');
    stage.innerHTML = '';
    if (st.t === 'study') renderStudy(st, stage);
    else if (st.t === 'gram') renderGram(st, stage);
    else if (st.t === 'dialog') renderDialog(st, stage);
    else if (st.t === 'reading') renderReading(st, stage);
    else if (st.t === 'writing') renderWriting(st, stage);
    else if (st.t === 'mistake') renderMistake(st, stage);
    else if (st.t === 'done') renderDone(st, stage);
    else renderQ(st, stage);
  }
  function nextStep() {
    var sess = LP.sess; if (!sess) return;
    sess.i++;
    if (sess.i >= sess.steps.length) { sess.i = sess.steps.length - 1; finishSession(); return; }
    renderStep();
  }

  /* ===================== 学习卡片 ===================== */
  function bindAudio(root) {
    root.querySelectorAll('[data-play]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); playAudio(b.dataset.play); };
    });
  }
  function setAudioWord(stage, w) {
    var card = stage.querySelector('.study-card, .q-card'); if (!card) return;
    var h = document.createElement('input'); h.type = 'hidden'; h.id = 'lpAudioWord'; h.value = w;
    card.appendChild(h);
  }
  function renderStudy(st, stage) {
    if (st.phon) {
      var ph = st.phon;
      stage.innerHTML = '<div class="card study-card">' +
        '<div class="kind">音标 · ' + esc(ph.zh) + '</div>' +
        '<div class="phone-big">/' + esc(ph.ipa) + '/</div>' +
        '<div class="tip"><b>发音技巧：</b>' + esc(ph.tip) + '</div>' +
        '<div style="margin-top:14px">' + ph.words.map(function (w) {
          return '<div class="ex" style="border:0;padding:6px 0"><span class="en" style="font-weight:600;cursor:pointer" data-word="' + esc(w.w) + '">' + esc(w.w) + '</span> <span class="enz">' + esc(w.zh) + ' <button class="audio-btn" data-play="' + esc(w.w) + '">' + IC.sound + '</button></span></div>';
        }).join('') + '</div>' +
        '<div class="lp-acts"><button class="btn" id="lpNext">下一步 ↵</button></div></div>';
      setAudioWord(stage, ph.words[0] && ph.words[0].w);
      setTimeout(function () { playAudio(ph.words[0] && ph.words[0].w); }, 250);
      stage.querySelectorAll('[data-word]').forEach(function (el) { el.onclick = function () { playAudio(el.dataset.word); }; });
    } else {
      var v = st.vocab;
      stage.innerHTML = '<div class="card study-card">' +
        '<div class="kind">新词</div>' +
        '<div class="big">' + esc(v.w) + '</div>' +
        '<div class="ipa">/' + esc(v.phone || '') + '/</div>' +
        '<div class="zh">' + esc(v.zh) + '</div>' +
        '<div class="ex"><div class="en">' + esc(v.ex || '') + ' <button class="audio-btn" data-play="' + esc(v.ex || v.w) + '">' + IC.sound + '</button></div><div class="enz">' + esc(v.exZh || '') + '</div></div>' +
        '<div><button class="mini-audio" data-play="' + esc(v.w) + '" title="播放发音">' + IC.sound + '</button>' +
        '<button class="speak-btn" id="btnSpeak" data-word="' + esc(v.w) + '" title="跟读评分">' + IC.mic + '</button></div>' +
        '<div class="muted" id="speakRes" style="margin-top:12px;font-size:13px;min-height:18px"></div>' +
        '<div class="lp-acts"><button class="btn" id="lpNext">记住了，继续 ↵</button></div></div>';
      setAudioWord(stage, v.w);
      setTimeout(function () { playAudio(v.w); }, 250);
      var sb = stage.querySelector('#btnSpeak');
      if (sb) sb.onclick = function () { speakCheck(sb.dataset.word, stage.querySelector('#speakRes')); };
    }
    bindAudio(stage);
    var nx = stage.querySelector('#lpNext'); if (nx) nx.onclick = nextStep;
  }
  function renderGram(st, stage) {
    var c = st.card;
    stage.innerHTML = '<div class="card study-card gram-card"><div class="point">' + esc(c.point) + '</div>' +
      '<div class="explain">' + esc(c.explain) + '</div>' +
      '<div class="gex">' + (c.examples || []).map(function (x) {
        return '<div><span class="en">' + esc(x.en) + '</span> <button class="audio-btn" data-play="' + esc(x.en) + '">' + IC.sound + '</button><br><span class="zh">' + esc(x.zh) + '</span></div>';
      }).join('<div style="height:12px"></div>') + '</div>' +
      '<div class="lp-acts"><button class="btn" id="lpNext">继续 ↵</button></div></div>';
    bindAudio(stage);
    stage.querySelector('#lpNext').onclick = nextStep;
  }

  /* ===================== 题目 ===================== */
  function qKindName(kind) {
    return ({ en2zh: '英译中', zh2en: '中译英', spell: '听写拼写', ipa: '听音辨音标', grammar: '语法填空', choice: '选择题', reading: '阅读理解' })[kind] || '练习';
  }
  function renderQ(st, stage) {
    var head = '<div class="q-kind">' + qKindName(st.kind) + '</div>';
    var prompt = '<div class="q-text">' + esc(st.prompt) + '</div>';
    var audioPart = st.audio ? '<div class="q-audio"><button class="mini-audio" data-play="' + esc(st.audio) + '" title="重听（空格）">' + IC.sound + '</button></div>' : '';
    var body;
    if (st.options) {
      var keys = '1234';
      body = '<div class="opts">' + st.options.map(function (o, i) {
        return '<button class="opt" data-i="' + i + '"><span class="k">' + keys[i] + '</span><span>' + esc(o.text) + '</span></button>';
      }).join('') + '</div>' +
        '<div class="q-why" id="qWhy"></div>' +
        '<div class="lp-acts" id="qActs" style="display:none"><button class="btn" id="lpNext">继续 ↵</button></div>';
    } else {
      body = '<input class="spell-input" id="spellInput" placeholder="输入英文拼写…" autocomplete="off" spellcheck="false" autocapitalize="off">' +
        '<div class="q-why" id="qWhy"></div>' +
        '<div class="lp-acts"><button class="btn" id="spellGo">提交 ↵</button></div>' +
        '<div class="lp-acts" id="qActs" style="display:none"><button class="btn" id="lpNext">继续 ↵</button></div>';
    }
    stage.innerHTML = '<div class="card q-card">' + head + prompt + (st.hint ? '<div class="q-hint">提示：' + esc(st.hint) + '</div>' : '') + audioPart + body + '</div>';
    if (st.audio) setAudioWord(stage, st.audio);
    bindAudio(stage);
    var opts = stage.querySelectorAll('.opt');
    if (opts.length) {
      opts.forEach(function (b) { b.onclick = function () { gradeChoice(st, b); }; });
    } else {
      var inp = stage.querySelector('#spellInput');
      var go = stage.querySelector('#spellGo');
      var submit = function () {
        var val = inp.value.trim();
        if (!val) { inp.focus(); return; }
        gradeSpell(st, val);
      };
      go.onclick = submit;
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
      if (st.audio) setTimeout(function () { playAudio(st.audio); }, 300);
      setTimeout(function () { inp.focus(); }, 100);
    }
  }
  function afterGrade(st, correct, given) {
    var sess = LP.sess;
    sess.answered++;
    if (correct) sess.correct++;
    var why = document.getElementById('qWhy');
    if (why) {
      why.className = 'q-why show ' + (correct ? 'good' : 'bad');
      var ans = st.answerText != null ? st.answerText : st.answer;
      why.innerHTML = correct
        ? (st.why ? '<b>回答正确！</b>' + esc(st.why) : '<b>回答正确！</b>')
        : '<b>正确答案：' + esc(ans) + '</b>' + (st.why ? '<br>' + esc(st.why) : '');
    }
    if (!correct) recordMistake(st, given);
    if (st.taskId) {
      api('/api/learn/daily/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: st.taskId, inc: 1 }) }).then(function (r) {
        if (r && r.grantedXp) toast('任务完成！+' + r.grantedXp + ' XP');
      }).catch(function () {});
    }
    var acts = document.getElementById('qActs');
    if (acts) { acts.style.display = 'flex'; var nx = document.getElementById('lpNext'); if (nx) nx.onclick = nextStep; }
    renderAcc();
  }
  function gradeChoice(st, btn) {
    var opts = document.querySelectorAll('#lpStage .opt');
    opts.forEach(function (b) {
      b.disabled = true;
      if (Number(b.dataset.i) === Number(st.a)) b.classList.add('correct');
    });
    var givenIdx = Number(btn.dataset.i);
    if (givenIdx !== Number(st.a)) { btn.classList.add('wrong'); btn.classList.remove('correct'); }
    afterGrade(st, givenIdx === Number(st.a), st.options[givenIdx].text);
  }
  function gradeSpell(st, val) {
    var inp = document.getElementById('spellInput');
    var ok = norm(val) === norm(st.answer);
    if (inp) {
      inp.disabled = true; inp.value = val;
      inp.classList.add(ok ? 'ok' : 'no');
    }
    var sg = document.getElementById('spellGo'); if (sg) sg.style.display = 'none';
    afterGrade(st, ok, val);
  }
  function renderAcc() {
    var sess = LP.sess; if (!sess) return;
    document.getElementById('lpAcc').textContent = sess.answered ? '正确率 ' + Math.round(sess.correct / sess.answered * 100) + '%' : '';
  }
  function recordMistake(st, given) {
    var sess = LP.sess;
    api('/api/learn/mistake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: st.kind, prompt: String(st.prompt || ''), answer: String(st.answerText != null ? st.answerText : st.answer), given: String(given), source: sess.source || ''
    }) }).catch(function () {});
  }

  /* ===================== 对话 / 阅读 / 写作 ===================== */
  function renderDialog(st, stage) {
    var u = st.unit;
    stage.innerHTML = '<div class="card study-card gram-card"><div class="point" style="text-align:center">' + esc(u.title) + ' · 情景对话</div>' +
      '<div class="dlg-list" style="margin-top:22px">' + u.lines.map(function (l, i) {
        return '<div class="dlg-line' + (i % 2 ? ' b' : '') + '"><div class="sp">' + esc((l.sp || '?').slice(0, 2)) + '</div>' +
          '<div class="bub"><div class="en">' + esc(l.en) + ' <button class="audio-btn play" data-play="' + esc(l.en) + '">' + IC.sound + '</button></div><div class="zh">' + esc(l.zh) + '</div></div></div>';
      }).join('') + '</div>' +
      '<div class="muted" style="text-align:center;margin-top:16px;font-size:12px">点喇叭逐句听 → 跟读 → 再看中文确认理解</div>' +
      '<div class="lp-acts"><button class="btn" id="lpNext">开始本课测验 ↵</button></div></div>';
    bindAudio(stage);
    stage.querySelector('#lpNext').onclick = nextStep;
  }
  function renderReading(st, stage) {
    var u = st.unit;
    var words = u.text.split(/(\s+)/).map(function (tok) {
      if (/^\s+$/.test(tok)) return esc(tok);
      var clean = tok.replace(/[^A-Za-z'’-]/g, '');
      if (!clean) return esc(tok);
      return '<span class="wd" data-w="' + esc(clean) + '">' + esc(tok) + '</span>';
    }).join('');
    stage.innerHTML = '<div class="card study-card gram-card"><div class="point" style="text-align:center">' + esc(u.title) + '</div>' +
      '<div class="muted" style="text-align:center;margin:10px 0 22px;font-size:12px">点击任何单词即可查看释义</div>' +
      '<div class="rd-text">' + words + '</div>' +
      '<div id="rdTrans" style="margin-top:14px;display:none" class="card pad"></div>' +
      '<div class="lp-acts"><button class="btn ghost" id="rdZh">显示全文翻译</button><button class="btn" id="lpNext">开始理解测验 ↵</button></div>' +
      '<div class="rd-zh" id="rdZhBox" style="display:none">' + esc(u.zh) + '</div></div>';
    bindAudio(stage);
    stage.querySelector('#rdZh').onclick = function () {
      var b = document.getElementById('rdZhBox'); b.style.display = b.style.display === 'none' ? 'block' : 'none';
    };
    stage.querySelectorAll('.wd').forEach(function (el) {
      el.onclick = function () {
        var w = el.dataset.w;
        var box = document.getElementById('rdTrans');
        box.style.display = 'block';
        box.innerHTML = '<span class="spinner"></span> 查询 ' + esc(w) + ' …';
        api('/api/translate?text=' + encodeURIComponent(w)).then(function (d) {
          var zh = d.error ? '（联网查询失败）' : (d.type === 'word' ? (((d.senses && d.senses[0] && d.senses[0].defs) || []).join('；')) : d.translation);
          box.innerHTML = '<b style="color:var(--brand)">' + esc(w) + '</b> — ' + esc(zh || '暂无释义') + ' <button class="audio-btn" data-play="' + esc(w) + '">' + IC.sound + '</button>';
          bindAudio(box);
        }).catch(function () { box.innerHTML = esc(w) + ' — 查询失败'; });
      };
    });
    stage.querySelector('#lpNext').onclick = nextStep;
  }
  function renderWriting(st, stage) {
    var u = st.unit;
    stage.innerHTML = '<div class="card study-card gram-card"><div class="point" style="text-align:center">' + esc(u.title) + ' · 写作</div>' +
      '<div class="tip"><b>写作技巧：</b>' + esc(u.tip || '') + '</div>' +
      '<div class="section-title">可套用句型</div>' +
      (u.patterns || []).map(function (p) { return '<div class="wr-pattern"><b>' + esc(p.en) + '</b><br><span class="muted">' + esc(p.zh) + '</span></div>'; }).join('') +
      '<textarea class="wr-textarea" id="wrText" placeholder="按句型写下你自己的版本…"></textarea>' +
      '<div class="lp-acts"><button class="btn ghost" id="wrShow">对照示例</button><button class="btn" id="wrDone">我写好了，掌握！</button></div>' +
      '<div class="wr-example" id="wrEx"><div class="en">' + esc((u.example && u.example.en) || '') + '</div><div class="zh">' + esc((u.example && u.example.zh) || '') + '</div></div></div>';
    stage.querySelector('#wrShow').onclick = function () {
      var ex = document.getElementById('wrEx'); ex.classList.toggle('show');
      if (ex.classList.contains('show')) { var t = document.getElementById('wrText'); if (t && !t.value.trim()) toast('先自己写一写，再对照效果最好'); }
    };
    stage.querySelector('#wrDone').onclick = function () {
      var t = document.getElementById('wrText');
      if (!t.value.trim()) { toast('先写下你的版本吧'); return; }
      LP.sess.finished = true;
      api('/api/learn/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId: u.id, score: 100, stars: 3 }) })
        .then(function (r) { finishSummary(100, 3, r.xp || 15); }).catch(function () { finishSummary(100, 3, 15); });
    };
  }

  /* ===================== 错题订正步骤 ===================== */
  function renderMistake(st, stage) {
    var m = st.m;
    stage.innerHTML = '<div class="card q-card"><div class="q-kind">错题订正 · ' + esc(qKindName(m.kind)) + (m.source ? ' · ' + esc(m.source) : '') + '</div>' +
      '<div class="q-text">' + esc(m.prompt) + '</div>' +
      '<div class="q-hint">输入正确答案（答对 2 次自动销题）· 已连对 ' + (m.streak || 0) + ' 次</div>' +
      '<input class="spell-input" id="spellInput" placeholder="输入正确答案…" autocomplete="off" spellcheck="false">' +
      '<div class="q-why" id="qWhy"></div>' +
      '<div class="lp-acts"><button class="btn" id="spellGo">提交 ↵</button></div>' +
      '<div class="lp-acts" id="qActs" style="display:none"><button class="btn" id="lpNext">继续 ↵</button></div></div>';
    var inp = stage.querySelector('#spellInput');
    var go = stage.querySelector('#spellGo');
    var submit = function () {
      var val = inp.value.trim();
      if (!val) { inp.focus(); return; }
      var ok = norm(val) === norm(m.answer);
      inp.disabled = true; go.style.display = 'none';
      inp.classList.add(ok ? 'ok' : 'no');
      var why = stage.querySelector('#qWhy');
      why.className = 'q-why show ' + (ok ? 'good' : 'bad');
      why.innerHTML = (ok ? '<b>答对了！</b>' : '<b>正确答案：' + esc(m.answer) + '</b>');
      api('/api/learn/mistake/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, correct: ok }) }).then(function (r) {
        if (r && r.mastered) why.innerHTML += '<br>连续答对 2 次，此题已销题 ✅';
        else if (ok && r) why.innerHTML += '<br>再答对 1 次即销题';
        else if (!ok) why.innerHTML += '<br>连对次数已重置，加油';
        if (ok && r && r.grantedXp) toast('+' + r.grantedXp + ' XP');
      }).catch(function () {});
      stage.querySelector('#qActs').style.display = 'flex';
      stage.querySelector('#lpNext').onclick = nextStep;
      if (st.taskId) {
        api('/api/learn/daily/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: st.taskId, inc: 1 }) }).then(function (r) {
          if (r && r.grantedXp) toast('错题任务完成！+' + r.grantedXp + ' XP');
        }).catch(function () {});
      }
    };
    go.onclick = submit;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    setTimeout(function () { inp.focus(); }, 100);
  }

  /* ===================== 结果页 ===================== */
  function finishSession() {
    var sess = LP.sess; if (!sess || sess.finished) return;
    sess.finished = true;
    var score = sess.answered ? Math.round(sess.correct / sess.answered * 100) : 100;
    var stars = score >= 90 ? 3 : score >= 70 ? 2 : 1;
    var words = sess.wordsForBook || [];
    if (sess.unitId) {
      api('/api/learn/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId: sess.unitId, score: score, stars: stars, words: words }) })
        .then(function (r) { finishSummary(score, stars, r.xp || 15); }).catch(function () { finishSummary(score, stars, 15); });
    } else if (words.length) {
      api('/api/learn/words', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: words }) })
        .then(function (r) { finishSummary(score, stars, r.xp || 0); }).catch(function () { finishSummary(score, stars, 0); });
    } else {
      finishSummary(score, stars, 0);
    }
  }
  function finishSummary(score, stars, xp) {
    var sess = LP.sess;
    document.getElementById('lpCounter').textContent = '完成';
    document.getElementById('lpBar').style.width = '100%';
    document.getElementById('lpAcc').textContent = '';
    var stage = document.getElementById('lpStage');
    var starHtml = [1, 2, 3].map(function (i) { return i <= stars ? IC.star : IC.starO; }).join('');
    stage.innerHTML = '<div class="card done-card"><div class="kind" style="font-size:12px;color:var(--brand);font-weight:700;letter-spacing:1px">' + esc(sess.title) + '</div>' +
      '<div class="stars">' + starHtml + '</div>' +
      '<div class="score">' + score + '<span style="font-size:18px;color:var(--muted)">分</span></div>' +
      '<div class="subscore">答对 ' + sess.correct + ' / ' + Math.max(sess.answered, 1) + ' 题' + (sess.answered - sess.correct > 0 ? '，错题已收入错题本，记得去订正' : '，全对，漂亮！') + '</div>' +
      (xp ? '<div class="xp-earn">+' + xp + ' XP</div>' : '') +
      '<div class="lp-acts" style="margin-top:26px"><button class="btn ghost" id="doneAgain">再来一次</button><button class="btn" id="doneBack">返回</button></div></div>';
    document.getElementById('doneAgain').onclick = function () {
      if (sess.rebuild) { var clone = sess.rebuild(); openPlayer(clone); } else closePlayer();
    };
    document.getElementById('doneBack').onclick = closePlayer;
  }

  /* ===================== 会话构建器 ===================== */
  function sessVocab(items, meta) {
    var steps = items.map(function (it) { return { t: 'study', vocab: it }; });
    var zs = items.map(function (x) { return x.zh; });
    var quiz = [];
    items.forEach(function (it) {
      var o1 = mkOptions(it.zh, pickDistractors(zs, it.zh, 3));
      quiz.push({ t: 'q', kind: 'en2zh', taskId: meta.taskId, prompt: it.w, audio: it.w, options: o1.options, a: o1.a, answer: o1.a, answerText: it.zh,
        why: it.w + '（/' + (it.phone || '') + '/）意为「' + it.zh + '」' });
      quiz.push({ t: 'q', kind: 'spell', taskId: meta.taskId, prompt: '听发音，拼写单词', audio: it.w, hint: '中文释义：' + it.zh, answer: it.w, answerText: it.w, why: it.w + ' — ' + it.zh });
    });
    var s = { title: meta.title, source: meta.source, unitId: meta.unitId || null, wordsForBook: meta.wordsForBook || null, steps: steps.concat(shuffle(quiz)) };
    s.rebuild = function () { return sessVocab(items, meta); };
    return s;
  }
  function sessPhonetic(unit) {
    var steps = unit.items.map(function (ph) { return { t: 'study', phon: ph }; });
    var ipas = unit.items.map(function (x) { return x.ipa; });
    var quiz = unit.items.map(function (ph) {
      var w = ph.words[0].w;
      var o = mkOptions('/' + ph.ipa + '/', pickDistractors(ipas, ph.ipa, 3).map(function (x) { return '/' + x + '/'; }));
      return { t: 'q', kind: 'ipa', prompt: '听发音：' + w + ' 中的核心音标是？', audio: w, options: o.options, a: o.a, answer: o.a, answerText: '/' + ph.ipa + '/',
        why: w + ' /' + ph.ipa + '/ — ' + ph.zh };
    });
    var s = { title: unit.title, source: unit.title, unitId: unit.id, steps: steps.concat(shuffle(quiz)) };
    s.rebuild = function () { return sessPhonetic(unit); };
    return s;
  }
  function quizSteps(unit, kind) {
    var qs = unit.quiz || unit.questions || [];
    return qs.map(function (q) {
      var o = mkOptions(q.options[q.a], q.options.filter(function (_, i) { return i !== q.a; }));
      return { t: 'q', kind: kind, prompt: q.q, options: o.options, a: o.a, answer: o.a, answerText: q.options[q.a], why: q.why || '' };
    });
  }
  function sessGrammar(unit) {
    var steps = (unit.cards || []).map(function (c) { return { t: 'gram', card: c }; });
    var s = { title: unit.title, source: unit.title, unitId: unit.id, steps: steps.concat(shuffle(quizSteps(unit, 'grammar'))) };
    s.rebuild = function () { return sessGrammar(unit); };
    return s;
  }
  function sessDialog(unit) {
    var s = { title: unit.title, source: unit.title, unitId: unit.id, steps: [{ t: 'dialog', unit: unit }].concat(shuffle(quizSteps(unit, 'choice'))) };
    s.rebuild = function () { return sessDialog(unit); };
    return s;
  }
  function sessReading(unit) {
    var s = { title: unit.title, source: unit.title, unitId: unit.id, steps: [{ t: 'reading', unit: unit }].concat(shuffle(quizSteps(unit, 'reading'))) };
    s.rebuild = function () { return sessReading(unit); };
    return s;
  }
  function sessWriting(unit) {
    var s = { title: unit.title, source: unit.title, unitId: unit.id, steps: [{ t: 'writing', unit: unit }] };
    s.rebuild = function () { return sessWriting(unit); };
    return s;
  }
  function sessReview(pool, meta) {
    var zs = pool.map(function (x) { return x.zh; });
    var ws = pool.map(function (x) { return x.word; });
    var kinds = ['en2zh', 'zh2en', 'spell'];
    var quiz = pool.map(function (x, i) {
      var k = kinds[i % 3];
      if (k === 'en2zh') { var o = mkOptions(x.zh, pickDistractors(zs, x.zh, 3)); return { t: 'q', kind: 'en2zh', taskId: meta.taskId, prompt: x.word, audio: x.word, options: o.options, a: o.a, answer: o.a, answerText: x.zh, why: x.word + ' — ' + x.zh }; }
      if (k === 'zh2en') { var o2 = mkOptions(x.word, pickDistractors(ws, x.word, 3)); return { t: 'q', kind: 'zh2en', taskId: meta.taskId, prompt: x.zh, options: o2.options, a: o2.a, answer: o2.a, answerText: x.word, why: x.word + ' — ' + x.zh }; }
      return { t: 'q', kind: 'spell', taskId: meta.taskId, prompt: '听发音，拼写单词', audio: x.word, hint: '中文释义：' + (x.zh || ''), answer: x.word, answerText: x.word, why: x.word + ' — ' + (x.zh || '') };
    });
    var s = { title: meta.title, source: meta.source, unitId: meta.unitId || null, steps: shuffle(quiz) };
    s.rebuild = function () { return sessReview(pool, meta); };
    return s;
  }
  function sessDictation(words, taskId) {
    var steps = words.map(function (x) {
      return { t: 'q', kind: 'spell', taskId: taskId, prompt: '听发音，拼写单词', audio: x.word, hint: '中文释义：' + (x.zh || '（生词本词条）'), answer: x.word, answerText: x.word, why: x.word + ' ' + (x.zh || '') };
    });
    var s = { title: '听写训练', source: '每日听写', taskId: taskId, steps: shuffle(steps) };
    s.rebuild = function () { return sessDictation(words, taskId); };
    return s;
  }
  function sessMistakes(mistakes, taskId) {
    var steps = mistakes.map(function (m) { return { t: 'mistake', m: m, taskId: taskId }; });
    var s = { title: '错题订正', source: '错题本', taskId: taskId, steps: steps };
    s.rebuild = null;
    return s;
  }

  /* ===================== 跟读评分 ===================== */
  function speakCheck(word, resEl) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('当前浏览器不支持跟读评分（推荐 Chrome / Edge）'); return; }
    var rec;
    try { rec = new SR(); } catch (_) { toast('语音识别启动失败'); return; }
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    resEl.textContent = '正在聆听，请朗读：' + word + ' …';
    resEl.style.color = 'var(--sub)';
    rec.onresult = function (e) {
      var said = e.results[0][0].transcript.trim();
      var a = norm(word), b = norm(said);
      var score = a === b ? 100 : (a.indexOf(b) >= 0 || b.indexOf(a) >= 0 ? 80 : Math.round(similarText(a, b) * 100));
      resEl.textContent = '你说的是「' + said + '」· 相似度 ' + score + (score >= 90 ? '%，非常标准 🎉' : score >= 70 ? '%，不错，再清晰一点' : '%，多听两遍再试试');
      resEl.style.color = score >= 70 ? 'var(--ok)' : 'var(--warn)';
      if (score >= 90) playAudio(word, 1);
    };
    rec.onerror = function (e) { resEl.textContent = '识别失败：' + (e.error === 'not-allowed' ? '请允许使用麦克风' : e.error); resEl.style.color = 'var(--danger)'; };
    rec.onend = function () { if (resEl.textContent.indexOf('聆听') >= 0) { resEl.textContent = '没有听清，再试一次'; resEl.style.color = 'var(--muted)'; } };
    try { rec.start(); } catch (_) { toast('麦克风启动失败'); }
  }
  function similarText(a, b) {
    if (!a.length || !b.length) return 0;
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[m][n] / Math.max(m, n);
  }

  /* ===================== 视图：每日任务 ===================== */
  async function renderDaily() {
    var box = document.getElementById('v-daily');
    var daily;
    try { daily = await api('/api/learn/daily'); } catch (e) { box.innerHTML = '<div class="card empty">加载失败，请确认本地服务已启动</div>'; return; }
    var allDone = daily.tasks.every(function (t) { return t.completed || t.target === 0; });
    var html = '<div class="daily-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>' + dateTitle(daily.date) +
      ' · 今日已得 <b style="color:var(--warn)">' + daily.earnedXp + ' XP</b>' + (allDone ? '<span class="tag" style="margin-left:8px;background:rgba(22,163,74,.12);color:var(--ok)">全部完成 🎉</span>' : '') + '</div>';
    html += '<div class="task-grid">' + daily.tasks.map(function (t) {
      var pct = t.target ? Math.round(t.progress / t.target * 100) : 0;
      var icon = TASK_IC[t.icon] || IC.book;
      var btn = t.completed
        ? '<div class="tk-done-badge">' + IC.check + '已完成</div>'
        : (t.target === 0 ? '' : '<button class="btn tk-go" data-task="' + t.id + '">' + (t.progress > 0 ? '继续' : '开始') + '</button>');
      return '<div class="card task-card' + (t.completed ? ' done' : '') + '">' +
        '<div class="tk-head"><div class="tk-ic">' + icon + '</div><div><div class="tk-title">' + esc(t.title) + '</div></div><div class="tk-xp">+' + t.xp + ' XP</div></div>' +
        '<div class="tk-desc">' + esc(t.desc) + '</div>' +
        '<div class="tk-foot"><div class="tk-bar bar"><i style="width:' + pct + '%"></i></div><span class="tk-count">' + (t.target ? t.progress + '/' + t.target : '—') + '</span></div>' +
        btn + '</div>';
    }).join('') + '</div>';
    html += '<div class="card pad" style="margin-top:16px"><div class="muted" style="font-size:12.5px;line-height:1.9">💡 <b>学习技巧</b>：新词走「看卡 → 测验 → 听写」三步；错题答对 2 次自动销题；学过的词按 1/2/4/7/15/30 天间隔进入「闪卡复习」—— 正是艾宾浩斯遗忘曲线的科学用法。全程键盘可操作：<b>1-4</b> 选答案，<b>Enter</b> 继续，<b>空格</b> 重听发音。</div></div>';
    box.innerHTML = html;
    box.querySelectorAll('[data-task]').forEach(function (b) {
      b.onclick = function () { startTask(b.dataset.task, daily); };
    });
  }
  async function startTask(id, daily) {
    var t = daily.tasks.find(function (x) { return x.id === id; });
    if (!t || t.target === 0) return;
    if (id === 'new') {
      if (!t.words.length) { toast('课程词库已全部学完'); return; }
      openPlayer(sessVocab(t.words, { title: '每日新词', source: '每日任务 · 学新词', taskId: 'new', wordsForBook: t.words }));
    } else if (id === 'dict') {
      if (!t.words.length) { toast('暂无可听写的词，先学几个新词'); return; }
      openPlayer(sessDictation(t.words, 'dict'));
    } else if (id === 'mistake') {
      var r = await api('/api/learn/mistakes');
      var list = r.items || [];
      if (!list.length) { toast('没有待订正的错题'); return; }
      openPlayer(sessMistakes(list, 'mistake'));
    } else if (id === 'quiz') {
      var pool = (t.words || []).slice(0, 10);
      if (!pool.length) { toast('先学几个新词，才有题可测'); return; }
      openPlayer(sessReview(pool, { title: '每日综合小测', source: '每日任务 · 综合小测', taskId: 'quiz' }));
    }
  }

  /* ===================== 视图：学习中心（课程地图） ===================== */
  async function renderCourse() {
    var box = document.getElementById('v-course');
    var ov, cur, lessons;
    try {
      ov = await api('/api/learn/overview');
      cur = LP.curriculum = LP.curriculum || await api('/api/curriculum');
      lessons = await api('/api/learn/lessons');
    } catch (e) { box.innerHTML = '<div class="card empty">加载失败，请确认本地服务已启动</div>'; return; }
    LP.overview = ov; LP.lessons = lessons.items || {};
    var pctNext = Math.min(100, Math.round(ov.xp / ov.nextLevelXp * 100));
    var html = '<div class="card profile">' +
      '<div class="avatar">' + Math.min(ov.level, 99) + '</div>' +
      '<div class="who"><b>' + esc(ov.levelTitle) + ' · Lv.' + ov.level + '</b><div class="rank">课程进度 ' + ov.lessonsDone + '/' + ov.lessonsTotal + ' 课 · 已学 ' + ov.wordsLearned + ' 词</div></div>' +
      '<div class="nums"><div><b class="streak-flame">' + ov.streak + '</b><span>连续天数 🔥</span></div><div><b>' + ov.mistakesActive + '</b><span>待订正</span></div><div><b>' + ov.mistakesMastered + '</b><span>已销题</span></div></div>' +
      '<div class="xp-ring"><div class="ring" style="--pct:' + pctNext + '"><i>' + ov.xp + '</i></div><div class="lbl">XP · 距 Lv.' + (ov.level + 1) + ' 还差 ' + Math.max(0, ov.nextLevelXp - ov.xp) + '</div></div></div>';
    cur.levels.forEach(function (lv) {
      var lvDone = 0;
      lv.units.forEach(function (u) { if (LP.lessons[u.id]) lvDone++; });
      html += '<div class="level-block"><div class="level-head">' +
        '<div class="level-badge" style="background:linear-gradient(135deg,' + lv.color + ',' + shade(lv.color) + ')">' + lv.id.replace('L', '') + '</div>' +
        '<div class="lt"><b>' + esc(lv.name) + '</b><span>' + esc(lv.desc) + '</span></div>' +
        '<div class="lp">' + lvDone + ' / ' + lv.units.length + ' 课完成</div></div>' +
        '<div class="unit-grid">' + lv.units.map(function (u, ui) {
          var done = !!LP.lessons[u.id];
          var locked = !done && ui > 0 && !LP.lessons[lv.units[ui - 1].id];
          var count = unitCount(u);
          var foot = locked ? '<span class="u-count">先完成上一课解锁</span><span class="u-stars" style="color:var(--muted)">' + IC.lock + '</span>'
            : '<span class="u-count">' + (done ? '✅ 已完成 · 点击重学' : (count ? count + ' 项' : '开始挑战')) + '</span><span class="u-stars">' + (done ? IC.star : '') + '</span>';
          return '<div class="card unit-card' + (locked ? ' locked' : '') + '" data-unit="' + u.id + '">' +
            '<span class="u-type">' + (TYPE_ZH[u.type] || u.type) + '</span>' +
            '<div class="u-title">' + esc(u.title) + '</div>' +
            '<div class="u-desc">' + esc(u.desc || (count ? count + ' 项内容' : '')) + '</div>' +
            '<div class="u-foot">' + foot + '</div></div>';
        }).join('') + '</div></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.unit-card').forEach(function (c) {
      c.onclick = function () {
        if (c.classList.contains('locked')) { toast('按顺序学习效果更好：先完成上一课'); return; }
        startUnit(c.dataset.unit);
      };
    });
  }
  function shade(hex) {
    try {
      var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgb(' + Math.round(r * .6) + ',' + Math.round(g * .6) + ',' + Math.round(b * .7) + ')';
    } catch (_) { return hex; }
  }
  function unitCount(u) {
    if (u.type === 'vocab' || u.type === 'phonetic') return (u.items || []).length;
    if (u.type === 'grammar') return (u.cards || []).length + (u.quiz || []).length;
    if (u.type === 'dialog') return (u.lines || []).length;
    if (u.type === 'reading') return (u.questions || []).length;
    if (u.type === 'writing') return (u.patterns || []).length;
    return 0;
  }
  function startUnit(id) {
    var cur = LP.curriculum;
    var unit = null;
    if (cur) (cur.levels || []).forEach(function (l) { (l.units || []).forEach(function (u) { if (u.id === id) unit = u; }); });
    if (!unit) { api('/api/curriculum').then(function (c) { LP.curriculum = c; startUnit(id); }); return; }
    if (unit.type === 'phonetic') openPlayer(sessPhonetic(unit));
    else if (unit.type === 'vocab') openPlayer(sessVocab(unit.items, { title: unit.title, source: unit.title, unitId: unit.id, wordsForBook: unit.items.map(function (x) { return { word: x.w, zh: x.zh, phone: x.phone }; }) }));
    else if (unit.type === 'grammar') openPlayer(sessGrammar(unit));
    else if (unit.type === 'dialog') openPlayer(sessDialog(unit));
    else if (unit.type === 'reading') openPlayer(sessReading(unit));
    else if (unit.type === 'writing') openPlayer(sessWriting(unit));
    else if (unit.type === 'review') startReviewUnit(unit);
  }
  async function startReviewUnit(unit) {
    var r = await api('/api/wordbook');
    var pool = (r.items || []).filter(function (b) { return /^[A-Za-z' -]+$/.test(b.word || ''); }).map(function (b) { return { word: b.word, zh: b.def || '' }; });
    if (pool.length < 4) {
      var cur = LP.curriculum = LP.curriculum || await api('/api/curriculum');
      (cur.levels || []).forEach(function (l) { (l.units || []).forEach(function (u) { if (u.type === 'vocab') (u.items || []).forEach(function (it) { if (pool.length < 12 && !pool.some(function (p) { return p.word === it.w; })) pool.push({ word: it.w, zh: it.zh }); }); }); });
    }
    if (!pool.length) { toast('先去学几课，再来挑战'); return; }
    openPlayer(sessReview(shuffle(pool).slice(0, 10), { title: unit.title, source: unit.title, unitId: unit.id }));
  }

  /* ===================== 视图：错题本 ===================== */
  async function renderMistakesView() {
    var box = document.getElementById('v-mistakes');
    var r;
    try { r = await api('/api/learn/mistakes'); } catch (e) { box.innerHTML = '<div class="card empty">加载失败，请确认本地服务已启动</div>'; return; }
    var items = r.items || [];
    var html = '<div class="mk-count-row">' +
      '<div class="card"><b style="color:var(--warn)">' + items.length + '</b><span>待订正</span></div>' +
      '<div class="card"><b style="color:var(--ok)">' + (r.masteredCount || 0) + '</b><span>已销题</span></div>' +
      '<div class="card"><b>' + (LP.overview ? LP.overview.xp : '—') + '</b><span>累计 XP</span></div></div>' +
      '<div class="mk-toolbar"><div class="muted" style="font-size:13px">答对 2 次自动销题；错题来自课程测验、听写与每日小测</div><div class="spacer"></div>' +
      (items.length ? '<button class="btn" id="mkGo">开始订正</button><button class="btn ghost sm" id="mkClear">清空</button>' : '') + '</div>';
    if (!items.length) {
      html += '<div class="card empty">' + IC.check + '<div>没有待订正的错题</div><div style="font-size:12px;margin-top:8px">做错课程测验题时会自动收进这里</div></div>';
    } else {
      html += '<div class="book-list">' + items.map(function (m) {
        return '<div class="card mk-item">' +
          '<span class="tag mk-kind">' + esc(qKindName(m.kind)) + '</span>' +
          '<div class="prompt"><b>' + esc(m.prompt) + '</b><div class="ans">正确答案：' + esc(m.answer) + (m.source ? ' · ' + esc(m.source) : '') + '</div></div>' +
          '<div class="mk-st">连对 ' + (m.streak || 0) + '/2</div>' +
          '<button class="row-btn del" data-del="' + esc(m.id) + '">' + IC.trash + '</button></div>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;
    var go = document.getElementById('mkGo');
    if (go) go.onclick = function () { openPlayer(sessMistakes(items, null)); };
    var cl = document.getElementById('mkClear');
    if (cl) cl.onclick = async function () {
      if (!confirm('确定清空全部错题？')) return;
      await api('/api/learn/mistake?all=1', { method: 'DELETE' });
      toast('已清空'); renderMistakesView(); refreshBadgesLearn();
    };
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        await api('/api/learn/mistake?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        renderMistakesView(); refreshBadgesLearn();
      };
    });
  }

  /* ===================== 徽章 & 导航接入 ===================== */
  async function refreshOverviewAndBadges() {
    try {
      var ov = LP.overview = await api('/api/learn/overview');
      refreshBadgesLearn(ov);
      var active = document.querySelector('.view.active');
      if (active && active.id === 'v-daily') renderDaily();
      if (active && active.id === 'v-course') renderCourse();
      if (active && active.id === 'v-mistakes') renderMistakesView();
    } catch (_) {}
  }
  function refreshBadgesLearn(ov) {
    ov = ov || LP.overview;
    if (!ov) return;
    var daily = ov.daily;
    var remain = daily ? daily.tasks.filter(function (t) { return t.target > 0 && !t.completed; }).length : 0;
    var db = document.getElementById('dailyBadge');
    if (db) { db.textContent = remain; db.style.display = remain ? 'flex' : 'none'; }
    var mb = document.getElementById('mistakeBadge');
    if (mb) { mb.textContent = ov.mistakesActive; mb.style.display = ov.mistakesActive ? 'flex' : 'none'; }
  }

  /* 接入 app.html 的导航 */
  TITLES.daily = '每日任务'; TITLES.course = '学习中心'; TITLES.mistakes = '错题本';
  var _go = go;
  window.go = function (view) {
    _go(view);
    if (view === 'daily') renderDaily();
    if (view === 'course') renderCourse();
    if (view === 'mistakes') renderMistakesView();
  };

  /* 启动 */
  ensurePlayerDom();
  refreshOverviewAndBadges();
  // 支持 ?view=daily / course / mistakes（本脚本晚于主脚本执行，这里补一次导航）
  var _params2 = new URLSearchParams(location.search);
  var initV = _params2.get('view');
  if (initV === 'daily' || initV === 'course' || initV === 'mistakes') window.go(initV);
  // 深链：?unit=L1U1 直接打开指定课程；?demo=quiz|choice 直接打开测验界面（便于外部程序唤起）
  var initU = _params2.get('unit');
  if (initU) setTimeout(function () { startUnit(initU); }, 500);
  var demo = _params2.get('demo');
  if (demo === 'quiz' || demo === 'choice') {
    api('/api/curriculum').then(function (c) {
      LP.curriculum = c;
      var items = null;
      (c.levels || []).some(function (l) { return (l.units || []).some(function (u) { if (u.type === 'vocab') { items = u.items; return true; } return false; }); });
      if (!items) return;
      var s = sessVocab(items.slice(0, 4), { title: '课程测验', source: '词汇单元' });
      s.steps = s.steps.filter(function (x) { return x.t === 'q' && (demo === 'quiz' || !!x.options); });
      openPlayer(s);
    }).catch(function () {});
  }

  window.LearnModule = { refresh: refreshOverviewAndBadges, startUnit: startUnit, current: function () { return LP.sess; } };
})();
