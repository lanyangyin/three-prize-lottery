/* 三人抽奖器 · 页面交互
 *
 * 两步抽奖：
 *   1. 先抽出 3 位数字编号中奖者（这一步不出现奖品）；
 *   2. 再把 3 个平级但内容不同的奖品随机分配给这 3 位中奖者。
 * 每位中奖者只获得一个奖品。
 */
(function () {
  'use strict';

  var Core = window.LotteryCore;
  if (!Core) {
    console.error('LotteryCore 未加载');
    return;
  }

  var DEFAULT_PRIZES = Core.DEFAULT_PRIZES;
  var WINNER_COUNT = Core.WINNER_COUNT;
  var MIN_PLAYERS = Core.MIN_PLAYERS;
  var Round = Core.Round;
  var parseIds = Core.parseIds;
  var reportText = Core.reportText;
  var formatStamp = Core.formatStamp;
  var formatShortTime = Core.formatShortTime;

  var STORAGE_KEY = 'three-prize-lottery.v1';
  var SAMPLE_IDS = [
    '001', '002', '003', '004', '005', '006',
    '007', '008', '009', '010', '011', '012'
  ];
  var REDUCED = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  var state = {
    round: null,
    rolling: false,
    assigning: false,
    pendingIndex: null,
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
    idError: $('id-error'),
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
    step1: $('step-1'),
    step2: $('step-2'),
    stage: $('stage'),
    stagePrize: $('stage-prize'),
    stageName: $('stage-name'),
    assignList: $('assign-list'),
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

  function parsedInput() {
    return parseIds(el.names.value);
  }

  function readPrizeInputs() {
    return el.prizeInputs.map(function (input) {
      return input.value.trim();
    });
  }

  function prizeProblem(prizes) {
    var list = prizes || readPrizeInputs();
    if (list.length !== WINNER_COUNT) return '需要填写 ' + WINNER_COUNT + ' 个奖品名称';
    for (var i = 0; i < list.length; i += 1) {
      if (!list[i]) return '三个奖品名称都要填写';
    }
    if (new Set(list).size !== list.length) return '三个奖品名称不能重复';
    return '';
  }

  function fillPrizeInputs(prizes) {
    el.prizeInputs.forEach(function (input, index) {
      input.value = prizes[index] || DEFAULT_PRIZES[index] || '';
    });
  }

  function updateIdError() {
    if (state.round) {
      el.idError.hidden = true;
      el.idError.textContent = '';
      el.names.classList.remove('bad');
      return;
    }
    var parsed = parsedInput();
    if (parsed.invalid.length) {
      el.idError.hidden = false;
      el.idError.textContent = '只能填写数字编号，发现：' +
        parsed.invalid.slice(0, 5).join('、') + '（编号之间用换行或逗号分隔）';
      el.names.classList.add('bad');
    } else {
      el.idError.hidden = true;
      el.idError.textContent = '';
      el.names.classList.remove('bad');
    }
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
      return rec && Array.isArray(rec.winners) && rec.winners.length === WINNER_COUNT &&
        Array.isArray(rec.assignments) && rec.assignments.length === WINNER_COUNT;
    }).slice(0, 20).map(function (rec) {
      return {
        id: String(rec.id || ''),
        startedAt: rec.startedAt || new Date().toISOString(),
        total: Number(rec.total) || 0,
        winners: rec.winners.map(String),
        assignments: rec.assignments.map(function (item) {
          return {
            prize: String((item && item.prize) || ''),
            id: String((item && item.id) || '')
          };
        }).filter(function (item) {
          return item.prize && item.id;
        }),
        excluded: Array.isArray(rec.excluded) ? rec.excluded.map(String) : []
      };
    }).filter(function (rec) {
      return rec.assignments.length === WINNER_COUNT;
    });
  }

  function persist() {
    var round = state.round;
    var data = {
      v: 5,
      idsText: round ? round.ids.join('\n') : el.names.value,
      prizes: round ? round.prizes.slice() : readPrizeInputs(),
      round: round && round.winners.length ? round.snapshot() : null,
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
    var parsed = state.round ? { ids: state.round.ids, invalid: [] } : parsedInput();
    var n = parsed.ids.length;
    el.count.textContent = n + ' 个';
    el.count.classList.toggle('bad',
      parsed.invalid.length > 0 || (n > 0 && n < MIN_PLAYERS));

    if (parsed.invalid.length) {
      el.prob.textContent = '编号只能是数字，请修改';
      el.prob.classList.add('bad');
    } else if (n === 0) {
      el.prob.textContent = '共 0 个编号 · 每人中奖概率 —';
      el.prob.classList.remove('bad');
    } else if (n < MIN_PLAYERS) {
      el.prob.textContent = '共 ' + n + ' 个编号 · 至少需要 ' + MIN_PLAYERS + ' 个';
      el.prob.classList.add('bad');
    } else {
      var rate = (WINNER_COUNT / n * 100).toFixed(1);
      el.prob.textContent = '共 ' + n + ' 个编号 · 每人中奖概率 ' + rate + '%';
      el.prob.classList.remove('bad');
    }
  }

  function updateInfo() {
    var round = state.round;
    if (!round) {
      el.next.textContent = '第一步 · 抽 3 位中奖者';
      el.remain.textContent = '待抽奖 ' + parsedInput().ids.length + ' 个编号';
      return;
    }
    if (!round.allDrawn) {
      el.next.textContent = '第一步 · 第 ' + (round.drawnCount + 1) + ' 位 / 共 3 位';
      el.remain.textContent = '已抽 ' + round.drawnCount + '/3 · 剩余 ' +
        round.remaining + ' 个编号';
      return;
    }
    if (!round.assigned) {
      el.next.textContent = '第二步 · 随机分配奖品';
      el.remain.textContent = '3 位中奖者已就位';
      return;
    }
    el.next.textContent = '分配完成';
    el.remain.textContent = '3 位中奖者 · 3 个奖品';
  }

  function updateSteps() {
    var round = state.round;
    var allDrawn = Boolean(round && round.allDrawn);
    var assigned = Boolean(round && round.assigned);

    el.step1.classList.toggle('is-active', !allDrawn);
    el.step1.classList.toggle('is-done', allDrawn);
    el.step2.classList.toggle('is-active', allDrawn && !assigned);
    el.step2.classList.toggle('is-done', assigned);

    el.step1.querySelector('.step-num').textContent = allDrawn ? '✓' : '1';
    el.step2.querySelector('.step-num').textContent = assigned ? '✓' : '2';
  }

  function renderCards() {
    var round = state.round;
    var showPrize = Boolean(round && round.assigned && !state.assigning);
    el.cards.textContent = '';

    for (var i = 0; i < WINNER_COUNT; i += 1) {
      var id = round ? (round.winners[i] || '') : '';
      if (state.pendingIndex === i + 1) id = '';

      var labelText = showPrize ? round.assignments[i].prize : '中奖者 ' + (i + 1);
      var card = document.createElement('article');
      card.className = 'card' + (id ? ' filled' : '');
      card.setAttribute('data-index', String(i + 1));

      var label = document.createElement('span');
      label.className = 'card-prize';
      label.textContent = labelText;

      var name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = id || '—';

      card.appendChild(label);
      card.appendChild(name);
      el.cards.appendChild(card);
    }
  }

  function renderAssignList() {
    var round = state.round;
    if (round && round.assigned && !state.assigning) {
      el.assignList.textContent = '';
      round.assignments.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'assign-row';

        var prize = document.createElement('span');
        prize.className = 'assign-prize';
        prize.textContent = item.prize;

        var arrow = document.createElement('span');
        arrow.className = 'assign-arrow';
        arrow.textContent = '→';

        var id = document.createElement('span');
        id.className = 'assign-id';
        id.textContent = item.id;

        row.appendChild(prize);
        row.appendChild(arrow);
        row.appendChild(id);
        el.assignList.appendChild(row);
      });
      el.assignList.hidden = false;
      el.stageName.hidden = true;
    } else {
      el.assignList.hidden = true;
      el.stageName.hidden = false;
    }
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
    var busy = state.rolling || state.assigning;
    var allDrawn = Boolean(round && round.allDrawn);
    var assigned = Boolean(round && round.assigned);
    var label;
    var disabled;

    if (busy) {
      label = state.assigning ? '分配中…' : '抽取中…';
      disabled = true;
    } else if (!allDrawn) {
      label = '抽取第 ' + ((round ? round.drawnCount : 0) + 1) + ' 位';
      disabled = false;
    } else if (!assigned) {
      label = '随机分配奖品';
      disabled = false;
    } else {
      label = '分配完成';
      disabled = true;
    }

    el.draw.disabled = disabled;
    el.drawLabel.textContent = label;
    el.drawKbd.hidden = disabled;

    el.redraw.disabled = busy || !round || !round.winners.length ||
      assigned || round.remaining === 0;
    el.reset.disabled = busy;
    el.exportBtn.disabled = busy || !assigned;
  }

  function updateAll() {
    updateIdError();
    updatePrizeError();
    updateCount();
    updateInfo();
    updateSteps();
    renderCards();
    renderAssignList();
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
    el.stageName.hidden = false;
    el.assignList.hidden = true;
    el.stageName.className = 'stage-name is-idle';
    el.stageName.textContent = '准备好了吗？';
    el.stagePrize.textContent = '两步抽奖';
    el.stageHint.textContent = '先抽 3 位中奖者 · 按空格开始';
    el.live.textContent = '';
  }

  function renderRestoredStage() {
    var round = state.round;
    if (!round || !round.winners.length) {
      renderIdleStage();
      return;
    }
    if (round.assigned) {
      el.stagePrize.textContent = '奖品分配结果';
      el.stageHint.textContent = '每位中奖者获得一个奖品';
      return;
    }
    el.stageName.hidden = false;
    el.assignList.hidden = true;
    el.stageName.className = 'stage-name is-winner';
    el.stageName.textContent = round.lastWinner;
    el.stagePrize.textContent = '第 ' + round.winners.length + ' 位中奖者';
    el.stageHint.textContent = round.allDrawn
      ? '三位中奖者已就位 · 下一步分配奖品'
      : '恭喜！';
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
      total.textContent = (rec.total || rec.winners.length) + ' 个';

      var winners = document.createElement('span');
      winners.className = 'h-first';
      winners.textContent = rec.winners.join('、');

      summary.appendChild(date);
      summary.appendChild(total);
      summary.appendChild(winners);
      details.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'h-body';

      var winnersLine = document.createElement('p');
      winnersLine.textContent = '中奖编号：' + rec.winners.join('、');
      body.appendChild(winnersLine);

      rec.assignments.forEach(function (item) {
        var line = document.createElement('p');
        line.textContent = item.prize + '：' + item.id;
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
    if (!state.round || !state.round.assigned) return;
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
    link.download = '中奖记录_' + formatStamp(when) + '_' +
      state.round.ids.length + '个编号.txt';
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

  function rollIds(pool) {
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

  function playWinnerReveal(result, options) {
    var redraw = Boolean(options && options.redraw);
    state.rolling = true;
    updateButtons();

    el.assignList.hidden = true;
    el.stageName.hidden = false;
    el.stageName.className = 'stage-name is-rolling';
    el.stagePrize.textContent = '第 ' + result.index + ' 位中奖者';
    el.stageHint.textContent = '正在抽取……';
    el.stageName.textContent = state.round.ids[
      Math.floor(Math.random() * state.round.ids.length)
    ];

    return rollIds(state.round.ids).then(function () {
      state.rolling = false;
      state.pendingIndex = null;
      el.stageName.className = 'stage-name is-winner';
      el.stageName.textContent = result.id;
      el.stagePrize.textContent = '第 ' + result.index + ' 位中奖者';
      el.stageHint.textContent = state.round.allDrawn
        ? '三位中奖者已就位 · 下一步分配奖品'
        : '恭喜！';
      el.live.textContent = '第 ' + result.index + ' 位中奖者：' + result.id;

      updateAll();
      setStatus('第 ' + result.index + ' 位中奖者：' + result.id);
      fireConfetti();
      persist();

      if (redraw && state.round.allDrawn) {
        showToast('已重抽最后一位，可以分配奖品了', 'success');
      }
    });
  }

  function createRound() {
    var problem = prizeProblem();
    if (problem) {
      updatePrizeError();
      showToast(problem, 'error');
      el.prizeInputs[0].focus();
      return false;
    }
    var parsed = parsedInput();
    if (parsed.invalid.length) {
      updateIdError();
      showToast('抽奖人员只能填数字编号', 'error');
      el.names.focus();
      return false;
    }
    try {
      state.round = new Round(parsed.ids, readPrizeInputs());
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    }
    state.startedAt = new Date().toISOString();
    state.recordId = null;
    state.pendingIndex = null;
    state.assigning = false;
    setInputLocked(true);
    updateIdError();
    updatePrizeError();
    updateAll();
    persist();
    setStatus('编号已锁定 · 开始抽人');
    return true;
  }

  function drawWinner() {
    var result;
    try {
      result = state.round.draw();
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
    state.pendingIndex = result.index;
    persist();
    updateAll();
    playWinnerReveal(result).catch(function (err) {
      state.rolling = false;
      state.pendingIndex = null;
      updateAll();
      showToast('抽奖出错：' + err.message, 'error');
    });
  }

  function startPrimary() {
    if (state.rolling || state.assigning) return;

    if (!state.round) {
      if (!createRound()) return;
    }
    if (!state.round.allDrawn) {
      drawWinner();
      return;
    }
    if (!state.round.assigned) {
      assignPrizesFlow();
      return;
    }
    showToast('本轮奖品已经分配完成，点「重置」开始新一轮');
  }

  function assignPrizesFlow() {
    var round = state.round;
    if (!round || state.rolling || state.assigning || !round.allDrawn || round.assigned) return;

    var assignments;
    try {
      assignments = round.assignPrizes();
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    state.assigning = true;
    persist();
    updateAll();

    el.stageName.hidden = false;
    el.assignList.hidden = true;
    el.stageName.className = 'stage-name is-rolling';
    el.stageName.textContent = '随机分配中…';
    el.stagePrize.textContent = '随机分配奖品';
    el.stageHint.textContent = '正在把三个奖品随机分给三位中奖者……';

    var start = performance.now();
    var prizes = round.prizes;

    function frame(now) {
      if (!state.assigning) return;
      var t = Math.min((now - start) / 1300, 1);
      if (t >= 1) {
        finishAssign(assignments);
        return;
      }
      el.stageName.textContent = prizes[Math.floor(Math.random() * prizes.length)];
      window.requestAnimationFrame(frame);
    }

    function finishAssign(list) {
      state.assigning = false;
      el.stageName.classList.remove('is-rolling');
      el.stagePrize.textContent = '奖品分配结果';
      el.stageHint.textContent = '每位中奖者获得一个奖品';
      el.live.textContent = list.map(function (item) {
        return item.prize + '：' + item.id;
      }).join('；');

      updateAll();
      setStatus('奖品分配完成');
      fireConfetti();
      saveRecord();
      showToast('奖品分配完成，记录已保存到「历史记录」', 'success');
      persist();
    }

    window.requestAnimationFrame(frame);
  }

  function startRedraw() {
    if (state.rolling || state.assigning || !state.round) return;
    var round = state.round;
    if (!round.winners.length || round.assigned) return;
    if (round.remaining === 0) {
      showToast('没有可替换的备选编号了', 'error');
      return;
    }
    var oldId = round.lastWinner;

    confirmDialog(
      '重新抽取最后一位',
      '最后一位中奖者「' + oldId + '」无法到场？\n作废后将从剩余 ' +
        round.remaining + ' 个编号中重抽一位，原中奖者不再参与本轮。',
      '作废并重抽'
    ).then(function (ok) {
      if (!ok) return;
      var result;
      try {
        result = round.redrawLast();
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      state.pendingIndex = result.index;
      updateAll();
      setStatus('「' + oldId + '」已作废，重新抽取最后一位……');
      persist();
      playWinnerReveal(result, { redraw: true }).catch(function (err) {
        state.rolling = false;
        state.pendingIndex = null;
        updateAll();
        showToast('重抽出错：' + err.message, 'error');
      });
    });
  }

  function saveRecord() {
    var round = state.round;
    if (!round || !round.assigned) return;
    if (!state.recordId) state.recordId = 'r' + Date.now();

    var record = {
      id: state.recordId,
      startedAt: state.startedAt || new Date().toISOString(),
      total: round.ids.length,
      prizes: round.prizes.slice(),
      winners: round.winners.slice(),
      assignments: round.results(),
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
    if (state.rolling || state.assigning) return;
    var hadWinner = Boolean(state.round && state.round.winners.length);
    var run = function () {
      stopConfetti();
      state.round = null;
      state.rolling = false;
      state.assigning = false;
      state.pendingIndex = null;
      state.startedAt = null;
      state.recordId = null;
      el.live.textContent = '';
      setInputLocked(false);
      renderIdleStage();
      updateAll();
      persist();
      setStatus('已重置 · 改好编号和奖品后点「抽取第 1 位」');
    };

    if (!hadWinner) {
      run();
      return;
    }
    confirmDialog('重新开始', '确定清空本轮抽奖结果，重新开始吗？历史记录会保留。', '重新开始')
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

  el.draw.addEventListener('click', startPrimary);
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
    el.names.value = SAMPLE_IDS.join('\n');
    updateAll();
    persist();
    setStatus('已填入示例编号 · 改成你的参与者编号即可');
  });

  el.clearBtn.addEventListener('click', function () {
    if (state.round) return;
    if (el.names.value.trim()) {
      confirmDialog('清空编号', '确定清空当前参与者编号吗？', '清空').then(function (ok) {
        if (!ok) return;
        el.names.value = '';
        updateAll();
        persist();
        el.names.focus();
        setStatus('编号已清空');
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
      startPrimary();
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

    var savedPrizes = Array.isArray(saved.prizes) && saved.prizes.length === WINNER_COUNT
      ? saved.prizes
      : DEFAULT_PRIZES;
    fillPrizeInputs(savedPrizes);

    var idsText = '';
    if (typeof saved.idsText === 'string' && saved.idsText.trim()) {
      idsText = saved.idsText;
    } else if (Array.isArray(saved.ids) && saved.ids.length) {
      idsText = saved.ids.join('\n');
    }
    el.names.value = idsText || SAMPLE_IDS.join('\n');

    var restored = false;
    if (saved.round && Array.isArray(saved.round.winners) && saved.round.winners.length) {
      try {
        var round = Round.fromSnapshot(saved.round);
        if (!round.winners.length) throw new Error('旧版抽奖进度无法恢复');
        state.round = round;
        state.startedAt = saved.startedAt || null;
        state.recordId = saved.recordId || null;
        el.names.value = round.ids.join('\n');
        fillPrizeInputs(round.prizes);
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
      if (state.round.assigned) {
        setStatus('已恢复：奖品分配结果');
      } else if (state.round.allDrawn) {
        setStatus('已恢复：三位中奖者已就位 · 下一步分配奖品');
      } else {
        setStatus('已恢复上次抽奖进度 · 继续抽第 ' +
          (state.round.drawnCount + 1) + ' 位');
      }
    } else {
      renderIdleStage();
      setStatus('就绪 · 按空格或点「抽取第 1 位」');
    }

    renderHistory();
    if (restored && state.round.assigned) {
      saveRecord();
    }
    window.requestAnimationFrame(fitConfetti);
  }

  init();
})();
