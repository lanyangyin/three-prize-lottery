/* 三人抽奖器 · 页面交互
 *
 * 三个奖品平级但内容不同；依次抽出 3 位中奖者，
 * 每位中奖者获得对应奖品，中奖者从名单移除，每人最多中一个。
 */
(function () {
  'use strict';

  var Core = window.LotteryCore;
  if (!Core) {
    console.error('LotteryCore 未加载');
    return;
  }

  var DEFAULT_PRIZES = Core.DEFAULT_PRIZES;
  var PRIZE_COUNT = DEFAULT_PRIZES.length;
  var MIN_PLAYERS = Core.MIN_PLAYERS;
  var Round = Core.Round;
  var DrawError = Core.DrawError;
  var parseNames = Core.parseNames;
  var reportText = Core.reportText;
  var formatStamp = Core.formatStamp;
  var formatShortTime = Core.formatShortTime;

  var STORAGE_KEY = 'three-prize-lottery.v1';
  var SAMPLE_NAMES = [
    '张三', '李四', '王五', '赵六', '钱七', '孙八',
    '周九', '吴十', '郑一', '王二', '冯三', '陈五'
  ];
  var REDUCED = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  var state = {
    round: null,
    rolling: false,
    pending: null,
    history: [],
    startedAt: null,
    recordId: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  var el = {
    names: $('names-input'),
    count: $('count-badge'),
    prob: $('prob-text'),
    sample: $('btn-sample'),
    importBtn: $('btn-import'),
    clearBtn: $('btn-clear'),
    file: $('file-input'),
    prizeInputs: Array.prototype.slice.call(document.querySelectorAll('.prize-input')),
    prizeError: $('prize-error'),
    history: $('history-list'),
    clearHistory: $('btn-clear-history'),
    next: $('next-text'),
    remain: $('remain-text'),
    stage: $('stage'),
    stagePrize: $('stage-prize'),
    stageName: $('stage-name'),
    stageHint: $('stage-hint'),
    canvas: $('confetti'),
    draw: $('btn-draw'),
    drawLabel: $('draw-label'),
    drawKbd: $('draw-kbd'),
    redraw: $('btn-redraw'),
    reset: $('btn-reset'),
    exportBtn: $('btn-export'),
    fullscreen: $('btn-fullscreen'),
    drawPanel: $('draw-panel'),
    cards: $('cards'),
    status: $('status-text'),
    excluded: $('excluded-note'),
    live: $('live-status'),
    toast: $('toast-stack'),
    confirmDialog: $('confirm-dialog'),
    confirmTitle: $('dialog-title'),
    confirmMessage: $('dialog-message'),
    confirmOk: $('dialog-ok'),
    exportDialog: $('export-dialog'),
    exportPreview: $('export-preview'),
    download: $('btn-download'),
    copy: $('btn-copy'),
    year: $('footer-year')
  };

  /* ---------------- 工具 ---------------- */

  function prefersReduced() {
    return Boolean(REDUCED && REDUCED.matches);
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  function showToast(message, type) {
    var node = document.createElement('div');
    node.className = 'toast' + (type ? ' ' + type : '');
    node.textContent = message;
    el.toast.appendChild(node);
    while (el.toast.children.length > 3) {
      el.toast.removeChild(el.toast.firstElementChild);
    }
    window.setTimeout(function () {
      node.classList.add('leaving');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 240);
    }, 3200);
  }

  function currentNames() {
    return state.round ? state.round.names : parseNames(el.names.value);
  }

  function hasWinner() {
    return Boolean(state.round && Object.keys(state.round.winners).length);
  }

  function readPrizeInputs() {
    return el.prizeInputs.map(function (input) {
      return input.value.trim();
    });
  }

  function prizeProblem(prizes) {
    var list = prizes || readPrizeInputs();
    if (list.length !== PRIZE_COUNT) return '需要填写 ' + PRIZE_COUNT + ' 个奖品名称';
    for (var i = 0; i < list.length; i += 1) {
      if (!list[i]) return '三个奖品名称都要填写';
    }
    if (new Set(list).size !== list.length) return '三个奖品名称不能重复';
    return '';
  }

  // 页面展示用：空输入时给一个占位名称
  function displayPrizes() {
    if (state.round) return state.round.prizes.slice();
    return readPrizeInputs().map(function (name, index) {
      return name || ('奖品 ' + (index + 1));
    });
  }

  function fillPrizeInputs(prizes) {
    el.prizeInputs.forEach(function (input, index) {
      input.value = prizes[index] || DEFAULT_PRIZES[index] || '';
    });
  }

  function updatePrizeError() {
    if (state.round) {
      el.prizeError.hidden = true;
      el.prizeError.textContent = '';
      el.prizeInputs.forEach(function (input) {
        input.classList.remove('bad');
      });
      return;
    }
    var problem = prizeProblem();
    el.prizeError.hidden = !problem;
    el.prizeError.textContent = problem;
    el.prizeInputs.forEach(function (input) {
      input.classList.toggle('bad', Boolean(problem) && !input.value.trim());
    });
  }

  /* ---------------- 本地存储 ---------------- */

  function loadSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function normalizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (rec) {
      return rec && Array.isArray(rec.winners) && rec.winners.length;
    }).slice(0, 20).map(function (rec) {
      var winners = rec.winners.filter(function (w) {
        return w && w.name;
      }).map(function (w, index) {
        // 兼容旧版记录：旧版按一等奖/二等奖/三等奖或第 1/2/3 位存
        return {
          prize: String(w.prize || ('奖品 ' + (index + 1))),
          name: String(w.name)
        };
      });
      return {
        id: String(rec.id || ''),
        startedAt: rec.startedAt || new Date().toISOString(),
        total: Number(rec.total) || 0,
        winners: winners,
        excluded: Array.isArray(rec.excluded) ? rec.excluded.map(String) : []
      };
    }).filter(function (rec) {
      return rec.winners.length > 0;
    });
  }

  function persist() {
    var round = state.round;
    var data = {
      v: 3,
      names: round ? round.names : parseNames(el.names.value),
      prizes: round ? round.prizes.slice() : readPrizeInputs(),
      round: round && Object.keys(round.winners).length ? round.snapshot() : null,
      startedAt: state.startedAt,
      recordId: state.recordId,
      history: state.history
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      /* 隐私模式或空间不足时忽略 */
    }
  }

  var persistTimer = 0;
  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 250);
  }

  /* ---------------- 界面渲染 ---------------- */

  function updateCount() {
    var n = currentNames().length;
    el.count.textContent = n + ' 人';
    el.count.classList.toggle('bad', n > 0 && n < MIN_PLAYERS);

    if (n === 0) {
      el.prob.textContent = '共 0 人 · 每人中奖概率 —';
      el.prob.classList.remove('bad');
    } else if (n < MIN_PLAYERS) {
      el.prob.textContent = '共 ' + n + ' 人 · 至少需要 ' + MIN_PLAYERS + ' 人';
      el.prob.classList.add('bad');
    } else {
      var rate = (PRIZE_COUNT / n * 100).toFixed(1);
      el.prob.textContent = '共 ' + n + ' 人 · 每人中奖概率 ' + rate + '%';
      el.prob.classList.remove('bad');
    }
  }

  function updateInfo() {
    var round = state.round;
    if (!round) {
      el.next.textContent = '下一个：' + displayPrizes()[0];
      el.remain.textContent = '待抽奖 ' + currentNames().length + ' 人';
      return;
    }
    el.next.textContent = round.nextPrize
      ? '下一个：' + round.nextPrize
      : '三位中奖者已全部抽出';
    el.remain.textContent = '剩余 ' + round.remaining + ' 人 · 已中奖 ' +
      Object.keys(round.winners).length + ' 人';
  }

  function renderCards() {
    var prizes = displayPrizes();
    var winners = state.round ? state.round.winners : null;
    el.cards.textContent = '';

    prizes.forEach(function (prize) {
      var winner = winners ? winners[prize] : '';
      if (state.pending === prize) winner = '';

      var card = document.createElement('article');
      card.className = 'card' + (winner ? ' filled' : '');
      card.setAttribute('data-prize', prize);

      var label = document.createElement('span');
      label.className = 'card-prize';
      label.textContent = prize;

      var name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = winner || '—';

      card.appendChild(label);
      card.appendChild(name);
      el.cards.appendChild(card);
    });
  }

  function updateExcluded() {
    var excluded = state.round ? state.round.excluded : [];
    if (excluded.length) {
      el.excluded.hidden = false;
      el.excluded.textContent = '未到场作废：' + excluded.join('、');
    } else {
      el.excluded.hidden = true;
      el.excluded.textContent = '';
    }
  }

  function updateButtons() {
    var round = state.round;
    var rolling = state.rolling;
    var finished = Boolean(round && round.finished);
    var winners = hasWinner();

    el.draw.disabled = rolling || finished;
    el.drawLabel.textContent = rolling ? '抽取中…' : finished ? '抽奖结束' : '开始抽奖';
    el.drawKbd.hidden = rolling || finished;

    el.redraw.disabled = rolling || !winners || !round || round.remaining === 0;
    el.reset.disabled = rolling;
    el.exportBtn.disabled = rolling || !winners;
  }

  function updateAll() {
    updatePrizeError();
    updateCount();
    updateInfo();
    renderCards();
    updateExcluded();
    updateButtons();
  }

  function setInputLocked(locked) {
    el.names.disabled = locked;
    [el.sample, el.importBtn, el.clearBtn].forEach(function (btn) {
      btn.disabled = locked;
    });
    el.prizeInputs.forEach(function (input) {
      input.disabled = locked;
    });
  }

  function renderIdleStage() {
    el.stageName.classList.remove('is-rolling', 'is-winner');
    el.stageName.classList.add('is-idle');
    el.stagePrize.textContent = '三个平级奖品';
    el.stageName.textContent = '准备好了吗？';
    el.stageHint.textContent = '每人最多中一个 · 按空格开始';
    el.live.textContent = '';
  }

  function renderRestoredStage() {
    var round = state.round;
    var prize = round ? round.lastPrize : null;
    if (!prize) {
      renderIdleStage();
      return;
    }
    el.stageName.classList.remove('is-rolling', 'is-idle');
    el.stageName.classList.add('is-winner');
    el.stagePrize.textContent = '【' + prize + '】';
    el.stageName.textContent = round.winners[prize] || '';
    el.stageHint.textContent = round.finished ? '三位中奖者已全部抽出' : '恭喜中奖！';
  }

  function renderHistory() {
    el.history.textContent = '';
    if (!state.history.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '还没有完成的抽奖';
      el.history.appendChild(empty);
      return;
    }

    state.history.forEach(function (rec) {
      var details = document.createElement('details');
      details.className = 'history-item';

      var summary = document.createElement('summary');
      var date = document.createElement('span');
      date.className = 'h-date';
      date.textContent = formatShortTime(rec.startedAt);

      var total = document.createElement('span');
      total.className = 'h-total';
      total.textContent = (rec.total || rec.winners.length) + ' 人';

      var names = document.createElement('span');
      names.className = 'h-first';
      names.textContent = rec.winners.map(function (w) { return w.name; }).join('、');

      summary.appendChild(date);
      summary.appendChild(total);
      summary.appendChild(names);
      details.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'h-body';
      rec.winners.forEach(function (w) {
        var line = document.createElement('p');
        line.textContent = w.prize + '：' + w.name;
        body.appendChild(line);
      });
      if (rec.excluded.length) {
        var excluded = document.createElement('p');
        excluded.className = 'h-excluded';
        excluded.textContent = '作废：' + rec.excluded.join('、');
        body.appendChild(excluded);
      }
      details.appendChild(body);
      el.history.appendChild(details);
    });
  }

  /* ---------------- 对话框 ---------------- */

  function confirmDialog(title, message, okText) {
    return new Promise(function (resolve) {
      el.confirmTitle.textContent = title;
      el.confirmMessage.textContent = message;
      el.confirmOk.textContent = okText || '确定';
      el.confirmDialog.returnValue = '';
      var settled = false;

      function onClose() {
        if (settled) return;
        settled = true;
        el.confirmDialog.removeEventListener('close', onClose);
        resolve(el.confirmDialog.returnValue === 'ok');
      }

      el.confirmDialog.addEventListener('close', onClose);
      el.confirmDialog.showModal();
    });
  }

  function buildExportText() {
    if (!state.round) return '';
    var when = state.startedAt ? new Date(state.startedAt) : new Date();
    return '三人抽奖 · 中奖记录\n' + '='.repeat(36) + '\n' +
      reportText(state.round, when);
  }

  function openExport() {
    if (!hasWinner()) return;
    el.exportPreview.textContent = buildExportText();
    el.exportDialog.returnValue = '';
    el.exportDialog.showModal();
  }

  function downloadExport() {
    if (!state.round) return;
    var when = state.startedAt ? new Date(state.startedAt) : new Date();
    var text = buildExportText();
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = '中奖记录_' + formatStamp(when) + '_' + state.round.names.length + '人.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    showToast('已下载中奖记录', 'success');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  /* ---------------- 抽奖 ---------------- */

  function rollAnimation(pool) {
    return new Promise(function (resolve) {
      if (prefersReduced()) {
        window.setTimeout(resolve, 220);
        return;
      }
      var duration = 1800;
      var start = performance.now();
      var lastSwap = 0;

      function frame(now) {
        var t = Math.min((now - start) / duration, 1);
        if (t >= 1) {
          resolve();
          return;
        }
        var delay = 45 + 190 * Math.pow(t, 3);
        if (now - lastSwap >= delay) {
          lastSwap = now;
          el.stageName.textContent = pool[Math.floor(Math.random() * pool.length)];
        }
        window.requestAnimationFrame(frame);
      }

      window.requestAnimationFrame(frame);
    });
  }

  function playReveal(result, options) {
    var redraw = Boolean(options && options.redraw);
    state.rolling = true;
    updateButtons();

    el.stageName.classList.remove('is-winner', 'is-idle');
    el.stageName.classList.add('is-rolling');
    el.stagePrize.textContent = '【' + result.prize + '】';
    el.stageHint.textContent = '正在抽取……';
    el.stageName.textContent = state.round.names[
      Math.floor(Math.random() * state.round.names.length)
    ];

    return rollAnimation(state.round.names).then(function () {
      el.stageName.classList.remove('is-rolling');
      el.stageName.textContent = result.name;
      void el.stageName.offsetWidth;
      el.stageName.classList.add('is-winner');
      el.stagePrize.textContent = '【' + result.prize + '】';
      el.stageHint.textContent = '恭喜中奖！';
      el.live.textContent = result.prize + '：' + result.name;

      state.rolling = false;
      state.pending = null;
      updateAll();
      setStatus('【' + result.prize + '】' + result.name);
      fireConfetti();
      persist();

      if (state.round.finished) {
        saveRecord();
        showToast(redraw ? '重抽完成，记录已更新' : '三位中奖者已全部抽出，记录已保存到「历史记录」', 'success');
      }
    });
  }

  function startDraw() {
    if (state.rolling) return;

    if (!state.round) {
      var problem = prizeProblem();
      if (problem) {
        updatePrizeError();
        showToast(problem, 'error');
        el.prizeInputs[0].focus();
        return;
      }
      try {
        state.round = new Round(parseNames(el.names.value), readPrizeInputs());
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      state.startedAt = new Date().toISOString();
      state.recordId = null;
      state.pending = null;
      setInputLocked(true);
      updatePrizeError();
      setStatus('名单已锁定 · 正在抽奖');
      updateAll();
      persist();
    }

    if (state.round.finished) {
      showToast('三个奖品都抽完了，点「重置」开始新一轮');
      return;
    }

    var result;
    try {
      result = state.round.draw();
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    state.pending = result.prize;
    persist();
    updateAll();
    playReveal(result).catch(function (err) {
      state.rolling = false;
      state.pending = null;
      updateAll();
      showToast('抽奖出错：' + err.message, 'error');
    });
  }

  function startRedraw() {
    if (state.rolling || !state.round) return;
    var round = state.round;
    var prize = round.lastPrize;
    if (!prize) return;
    if (round.remaining === 0) {
      showToast('没有可替换的候选人了', 'error');
      return;
    }
    var oldName = round.winners[prize];

    confirmDialog(
      '重新抽取',
      '【' + prize + '】中奖者「' + oldName + '」无法到场？\n作废后将从剩余 ' +
        round.remaining + ' 人中重抽一位，原中奖者不再参与本轮。',
      '作废并重抽'
    ).then(function (ok) {
      if (!ok) return;
      var result;
      try {
        result = round.redraw();
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      state.pending = prize;
      updateAll();
      setStatus('【' + prize + '】「' + oldName + '」已作废，重新抽取……');
      persist();
      playReveal(result, { redraw: true }).catch(function (err) {
        state.rolling = false;
        state.pending = null;
        updateAll();
        showToast('重抽出错：' + err.message, 'error');
      });
    });
  }

  function saveRecord() {
    var round = state.round;
    if (!round || !round.finished) return;
    if (!state.recordId) state.recordId = 'r' + Date.now();

    var record = {
      id: state.recordId,
      startedAt: state.startedAt || new Date().toISOString(),
      total: round.names.length,
      prizes: round.prizes.slice(),
      winners: round.results(),
      excluded: round.excluded.slice()
    };

    var index = -1;
    for (var i = 0; i < state.history.length; i += 1) {
      if (state.history[i].id === state.recordId) {
        index = i;
        break;
      }
    }
    if (index >= 0) state.history[index] = record;
    else state.history.unshift(record);
    state.history = state.history.slice(0, 20);
    renderHistory();
    persist();
  }

  function resetRound() {
    if (state.rolling) return;
    var hadWinner = hasWinner();
    var run = function () {
      stopConfetti();
      state.round = null;
      state.rolling = false;
      state.pending = null;
      state.startedAt = null;
      state.recordId = null;
      el.live.textContent = '';
      setInputLocked(false);
      renderIdleStage();
      updateAll();
      persist();
      setStatus('已重置 · 改好名单和奖品后点「开始抽奖」');
    };

    if (!hadWinner) {
      run();
      return;
    }
    confirmDialog('重新开始', '确定清空本轮中奖结果，重新开始吗？历史记录会保留。', '重新开始')
      .then(function (ok) {
        if (ok) run();
      });
  }

  /* ---------------- 彩带 ---------------- */

  var confettiRaf = 0;
  var confettiParticles = [];

  function fitConfetti() {
    var rect = el.stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    el.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    el.canvas.style.width = rect.width + 'px';
    el.canvas.style.height = rect.height + 'px';
  }

  function stopConfetti() {
    if (confettiRaf) {
      window.cancelAnimationFrame(confettiRaf);
      confettiRaf = 0;
    }
    confettiParticles = [];
    var ctx = el.canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  }

  function fireConfetti() {
    if (prefersReduced()) return;
    stopConfetti();
    fitConfetti();

    var rect = el.stage.getBoundingClientRect();
    var width = rect.width;
    var height = rect.height;
    if (!width || !height) return;

    var ctx = el.canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var colors = ['#ffcc55', '#ffe6a3', '#6ea8fe', '#5ad1a5', '#ff8fa3', '#c792ea'];
    var count = Math.min(150, Math.max(70, Math.round(width / 6)));
    var particles = [];

    for (var i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.4,
        w: 3 + Math.random() * 5,
        h: 6 + Math.random() * 8,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 2.2 + Math.random() * 3.4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.23,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.65 + Math.random() * 0.35
      });
    }

    confettiParticles = particles;
    var start = performance.now();
    var last = start;

    function frame(now) {
      var dt = Math.min((now - last) / 16.667, 3);
      last = now;
      ctx.clearRect(0, 0, width, height);

      for (var j = confettiParticles.length - 1; j >= 0; j -= 1) {
        var p = confettiParticles[j];
        p.vy += 0.09 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > height + 30) {
          confettiParticles.splice(j, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (confettiParticles.length && now - start < 5000) {
        confettiRaf = window.requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, width, height);
        confettiRaf = 0;
      }
    }

    confettiRaf = window.requestAnimationFrame(frame);
  }

  /* ---------------- 全屏 ---------------- */

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    if (el.drawPanel.requestFullscreen) {
      el.drawPanel.requestFullscreen({ navigationUI: 'hide' }).catch(function () {
        showToast('当前浏览器不支持全屏', 'error');
      });
    } else {
      showToast('当前浏览器不支持全屏', 'error');
    }
  }

  document.addEventListener('fullscreenchange', function () {
    var active = document.fullscreenElement === el.drawPanel;
    el.fullscreen.textContent = active ? '⤢' : '⛶';
    el.fullscreen.title = active ? '退出全屏' : '全屏（投屏用）';
    el.fullscreen.setAttribute('aria-label', active ? '退出全屏' : '全屏（投屏用）');
    window.requestAnimationFrame(fitConfetti);
  });

  /* ---------------- 事件 ---------------- */

  el.draw.addEventListener('click', startDraw);
  el.redraw.addEventListener('click', startRedraw);
  el.reset.addEventListener('click', resetRound);
  el.exportBtn.addEventListener('click', openExport);
  el.download.addEventListener('click', downloadExport);
  el.copy.addEventListener('click', function () {
    copyText(el.exportPreview.textContent).then(function (ok) {
      showToast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', ok ? 'success' : 'error');
    });
  });
  el.fullscreen.addEventListener('click', toggleFullscreen);

  el.names.addEventListener('input', function () {
    if (state.round) return;
    updateAll();
    schedulePersist();
  });

  el.prizeInputs.forEach(function (input) {
    input.addEventListener('input', function () {
      if (state.round) return;
      updateAll();
      schedulePersist();
    });
  });

  el.sample.addEventListener('click', function () {
    if (state.round) return;
    el.names.value = SAMPLE_NAMES.join('\n');
    updateAll();
    persist();
    setStatus('已填入示例名单 · 改成你的参与者即可');
  });

  el.clearBtn.addEventListener('click', function () {
    if (state.round) return;
    if (el.names.value.trim()) {
      confirmDialog('清空名单', '确定清空当前名单吗？', '清空').then(function (ok) {
        if (!ok) return;
        el.names.value = '';
        updateAll();
        persist();
        el.names.focus();
        setStatus('名单已清空');
      });
      return;
    }
    el.names.value = '';
    updateAll();
    persist();
    el.names.focus();
  });

  el.importBtn.addEventListener('click', function () {
    if (!state.round) el.file.click();
  });

  el.file.addEventListener('change', function () {
    var file = el.file.files && el.file.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      el.names.value = String(reader.result || '');
      updateAll();
      persist();
      setStatus('已导入 ' + file.name);
      showToast('已导入 ' + file.name, 'success');
    };
    reader.onerror = function () {
      showToast('读取文件失败', 'error');
    };
    reader.readAsText(file, 'utf-8');
    el.file.value = '';
  });

  el.clearHistory.addEventListener('click', function () {
    if (!state.history.length) return;
    confirmDialog('清空历史记录', '确定删除所有历史记录吗？此操作不可恢复。', '清空').then(function (ok) {
      if (!ok) return;
      state.history = [];
      renderHistory();
      persist();
      showToast('历史记录已清空');
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented) return;
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
        tag === 'button' || tag === 'a' || tag === 'summary' ||
        (target && target.isContentEditable)) {
      return;
    }
    if (document.querySelector('dialog[open]')) return;

    if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      startDraw();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (confettiParticles.length) fitConfetti();
    }, 200);
  });

  /* ---------------- 初始化 ---------------- */

  function init() {
    var saved = loadSaved();
    state.history = normalizeHistory(saved.history);
    el.year.textContent = String(new Date().getFullYear());

    var savedPrizes = Array.isArray(saved.prizes) && saved.prizes.length === PRIZE_COUNT
      ? saved.prizes
      : DEFAULT_PRIZES;
    fillPrizeInputs(savedPrizes);

    var savedNames = Array.isArray(saved.names) ? saved.names : [];
    el.names.value = (savedNames.length ? savedNames : SAMPLE_NAMES).join('\n');

    var restored = false;
    if (saved.round && saved.round.winners && Object.keys(saved.round.winners).length) {
      try {
        var round = Round.fromSnapshot(saved.round);
        if (!Object.keys(round.winners).length) throw new Error('旧版抽奖进度无法恢复');
        state.round = round;
        state.startedAt = saved.startedAt || null;
        state.recordId = saved.recordId || null;
        el.names.value = state.round.names.join('\n');
        fillPrizeInputs(state.round.prizes);
        setInputLocked(true);
        restored = true;
      } catch (err) {
        state.round = null;
        state.startedAt = null;
        state.recordId = null;
      }
    }

    updateAll();
    if (restored) {
      renderRestoredStage();
      setStatus('已恢复上次抽奖进度 · 点「重置」可开始新一轮');
    } else {
      renderIdleStage();
      setStatus('就绪 · 按空格或点「开始抽奖」');
    }
    renderHistory();
    if (restored && state.round && state.round.finished) {
      saveRecord();
    }
    window.requestAnimationFrame(fitConfetti);
  }

  init();
})();
