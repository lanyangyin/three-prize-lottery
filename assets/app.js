/* 三人抽奖器 · 页面交互
 *
 * 第一步：把数字编号铺在板上，三个选框随机弹射、互相碰撞，
 *         停下后每个框选覆盖面积最大的编号（保证三人不同）。
 * 第二步：把三个平级但不同的奖品随机分配给这三位中奖者。
 */
(function () {
  'use strict';

  var Core = window.LotteryCore;
  var Board = window.LotteryBoard && window.LotteryBoard.Board;
  if (!Core || !Board) {
    console.error('LotteryCore / LotteryBoard 未加载');
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
    '20260000001', '20260000002', '20260000003', '20260000004',
    '20260000005', '20260000006', '20260000007', '20260000008',
    '20260000009', '20260000010', '20260000011', '20260000012'
  ];
  var REDUCED = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  var state = {
    round: null,
    busy: false,
    assigning: false,
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
    boardCanvas: $('board'),
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

  var board = new Board(el.boardCanvas);

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

  function syncBoardIdle() {
    if (state.round) return;
    board.setIds(parsedInput().ids);
    board.setSelected([]);
    board.setPrizeLabels(['', '', '']);
  }

  function shuffleIds(ids) {
    var list = ids.slice();
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Core.randomIndex(i + 1);
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function sameIdSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    var left = a.slice().sort();
    var right = b.slice().sort();
    for (var i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
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
    var frames = null;
    var tileOrder = null;
    if (round && round.winners.length) {
      frames = board.getFrames().map(function (frame) {
        return {
          x: Math.round(frame.x * 10) / 10,
          y: Math.round(frame.y * 10) / 10
        };
      });
      tileOrder = board.ids.slice();
    }
    var data = {
      v: 6,
      idsText: round ? round.ids.join('\n') : el.names.value,
      prizes: round ? round.prizes.slice() : readPrizeInputs(),
      round: round && round.winners.length ? round.snapshot() : null,
      board: frames ? { frames: frames, tileOrder: tileOrder } : null,
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
      el.next.textContent = '第一步 · 弹射选框选人';
      el.remain.textContent = '待抽奖 ' + parsedInput().ids.length + ' 个编号';
      return;
    }
    if (!round.allDrawn) {
      if (round.winners.length) {
        el.next.textContent = '第一步 · 已选出 ' + round.winners.length + '/3';
        el.remain.textContent = '可以重新弹射';
      } else {
        el.next.textContent = '第一步 · 选框弹射中';
        el.remain.textContent = '等待三个框停下';
      }
      return;
    }
    if (!round.assigned || state.assigning) {
      el.next.textContent = '第二步 · 随机分配奖品';
      el.remain.textContent = '3 位中奖者已选出';
      return;
    }
    el.next.textContent = '分配完成';
    el.remain.textContent = '3 位中奖者 · 3 个奖品';
  }

  function updateSteps() {
    var round = state.round;
    var allDrawn = Boolean(round && round.allDrawn);
    var assigned = Boolean(round && round.assigned && !state.assigning);

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
    var busy = state.busy;
    var allDrawn = Boolean(round && round.allDrawn);
    var assigned = Boolean(round && round.assigned);
    var label;
    var disabled;

    if (busy) {
      label = state.assigning ? '分配中…' : '弹射中…';
      disabled = true;
    } else if (!allDrawn) {
      label = '开始弹射';
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

    el.redraw.disabled = busy || !round || !allDrawn || assigned;
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
      winners.textContent = rec.winners.length + ' 位中奖者';

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
    state.busy = false;
    state.assigning = false;
    setInputLocked(true);
    updateIdError();
    updatePrizeError();

    board.setIds(state.round.ids);
    board.setSelected([]);
    board.setPrizeLabels(['', '', '']);
    updateAll();
    persist();
    setStatus('编号已锁定 · 三个框准备弹射');
    return true;
  }

  function launchFrames() {
    if (state.busy || !state.round || state.round.assigned) return;
    state.busy = true;
    state.assigning = false;
    updateButtons();
    board.setSelected([]);
    board.setPrizeLabels(['', '', '']);
    setStatus('三个框正在弹射，等待它们停下……');

    // 弹射前重新随机排列编号位置，保证每个编号机会相同
    board.launch(shuffleIds(state.round.ids)).then(function (result) {
      if (!result) {
        state.busy = false;
        updateAll();
        return;
      }
      var picks;
      try {
        picks = Core.selectWinners(result.frames, result.tiles);
        state.round.setWinners(picks.map(function (pick) { return pick.id; }));
      } catch (err) {
        state.busy = false;
        updateAll();
        showToast('选框结果无效：' + err.message, 'error');
        return;
      }

      board.setSelected(state.round.winners);
      board.setPrizeLabels(['', '', '']);
      state.busy = false;
      updateAll();
      setStatus('三位中奖者已选出 · 下一步随机分配奖品');
      el.live.textContent = state.round.winners.map(function (id, index) {
        return '第 ' + (index + 1) + ' 位：' + id;
      }).join('；');
      fireConfetti();
      persist();
    }).catch(function (err) {
      state.busy = false;
      state.assigning = false;
      updateAll();
      showToast('弹射出错：' + err.message, 'error');
    });
  }

  function assignPrizesFlow() {
    var round = state.round;
    if (!round || state.busy || !round.allDrawn || round.assigned) return;

    var assignments;
    try {
      assignments = round.assignPrizes();
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    state.busy = true;
    state.assigning = true;
    persist();
    updateAll();
    setStatus('正在把三个奖品随机分配给三位中奖者……');
    board.setPrizeLabels(['', '', '']);

    var prizes = round.prizes;
    var flicker = window.setInterval(function () {
      board.setPrizeLabels([
        prizes[Math.floor(Math.random() * prizes.length)],
        prizes[Math.floor(Math.random() * prizes.length)],
        prizes[Math.floor(Math.random() * prizes.length)]
      ]);
    }, 110);

    window.setTimeout(function () {
      window.clearInterval(flicker);
      state.busy = false;
      state.assigning = false;
      board.setPrizeLabels(['', '', '']);
      updateAll();
      setStatus('奖品分配完成');
      el.live.textContent = assignments.map(function (item) {
        return item.prize + '：' + item.id;
      }).join('；');
      fireConfetti();
      saveRecord();
      showToast('奖品分配完成，记录已保存到「历史记录」', 'success');
      persist();
    }, 1300);
  }

  function startPrimary() {
    if (state.busy) return;
    if (!state.round) {
      if (!createRound()) return;
    }
    if (!state.round.allDrawn) {
      launchFrames();
      return;
    }
    if (!state.round.assigned) {
      assignPrizesFlow();
      return;
    }
    showToast('本轮奖品已经分配完成，点「重置」开始新一轮');
  }

  function relaunch() {
    if (state.busy || !state.round || !state.round.allDrawn || state.round.assigned) return;
    confirmDialog(
      '重新弹射',
      '重新弹射会清空本次选出的 3 位中奖者，三个框会重新随机弹射。确定吗？',
      '重新弹射'
    ).then(function (ok) {
      if (!ok) return;
      state.round = new Round(state.round.ids, state.round.prizes);
      state.recordId = null;
      state.assigning = false;
      board.setSelected([]);
      board.setPrizeLabels(['', '', '']);
      updateAll();
      persist();
      launchFrames();
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
    if (state.busy) return;
    var hadWinner = Boolean(state.round && state.round.winners.length);
    var run = function () {
      stopConfetti();
      board.stop();
      state.round = null;
      state.busy = false;
      state.assigning = false;
      state.startedAt = null;
      state.recordId = null;
      el.live.textContent = '';
      setInputLocked(false);
      syncBoardIdle();
      updateAll();
      persist();
      setStatus('已重置 · 改好编号和奖品后点「开始弹射」');
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
    window.requestAnimationFrame(function () {
      board.resize();
      fitConfetti();
    });
  });

  /* ---------------- 事件 ---------------- */

  el.draw.addEventListener('click', startPrimary);
  el.redraw.addEventListener('click', relaunch);
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
    syncBoardIdle();
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
    syncBoardIdle();
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
        syncBoardIdle();
        updateAll();
        persist();
        el.names.focus();
        setStatus('编号已清空');
      });
      return;
    }
    el.names.value = '';
    syncBoardIdle();
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
      syncBoardIdle();
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
  function resizeAll() {
    board.resize();
    fitConfetti();
  }

  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeAll, 150);
  });

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () {
      board.resize();
      fitConfetti();
    });
    observer.observe(el.stage);
  }

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

    board.setIds(parsedInput().ids);

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
        var tileOrder = round.ids;
        if (saved.board && Array.isArray(saved.board.tileOrder) &&
            sameIdSet(saved.board.tileOrder, round.ids)) {
          tileOrder = saved.board.tileOrder;
        }
        board.setIds(tileOrder);
        if (saved.board && Array.isArray(saved.board.frames) && saved.board.frames.length === 3) {
          board.setFrames(saved.board.frames);
        }
        board.setSelected(round.winners);
        board.setPrizeLabels(['', '', '']);
        restored = true;
      } catch (err) {
        state.round = null;
        state.startedAt = null;
        state.recordId = null;
      }
    }

    if (!restored) {
      board.setIds(parsedInput().ids);
      board.setSelected([]);
      board.setPrizeLabels(['', '', '']);
    }

    updateAll();
    if (restored) {
      if (state.round.assigned) {
        setStatus('已恢复：奖品分配结果');
      } else if (state.round.allDrawn) {
        setStatus('已恢复：三位中奖者已选出 · 下一步分配奖品');
      } else {
        setStatus('已恢复上次进度 · 可以重新弹射');
      }
    } else {
      setStatus('就绪 · 点「开始弹射」或按空格');
    }

    renderHistory();
    if (restored && state.round.assigned) {
      saveRecord();
    }
    window.requestAnimationFrame(function () {
      board.resize();
      fitConfetti();
    });
  }

  init();
})();
