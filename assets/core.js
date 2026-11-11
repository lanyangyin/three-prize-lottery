/* 三人抽奖器 · 静态网页
 *
 * 两步抽奖：
 *   1. 先抽出 3 位中奖者（只能使用数字编号）；
 *   2. 再把 3 个平级但内容不同的奖品随机分配给这 3 位中奖者。
 * 每位中奖者只获得一个奖品，不会重复中奖。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LotteryCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_PRIZES = ['奖品 A', '奖品 B', '奖品 C'];
  var WINNER_COUNT = 3;
  var MIN_PLAYERS = 4; // 3 位中奖者 + 至少 1 个备选编号，便于重抽
  var ID_PATTERN = /^\d+$/;
  var ID_SPLIT = /[\s,，、;；]+/;

  function DrawError(message) {
    var err = Error.call(this, message);
    this.message = message;
    this.name = 'DrawError';
    this.stack = err.stack;
  }
  DrawError.prototype = Object.create(Error.prototype);
  DrawError.prototype.constructor = DrawError;

  // 把输入拆成编号：只接受纯数字，保留前导零，按原样去重
  function parseIds(text) {
    var tokens = String(text == null ? '' : text).split(ID_SPLIT).filter(Boolean);
    var ids = [];
    var invalid = [];
    var seen = Object.create(null);
    tokens.forEach(function (token) {
      if (!ID_PATTERN.test(token)) {
        invalid.push(token);
        return;
      }
      if (!seen[token]) {
        seen[token] = true;
        ids.push(token);
      }
    });
    return { ids: ids, invalid: invalid };
  }

  function cleanIdList(raw) {
    var ids = [];
    var seen = Object.create(null);
    (raw || []).forEach(function (item) {
      var id = String(item == null ? '' : item).trim();
      if (!id || !ID_PATTERN.test(id) || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  }

  function cleanIds(raw) {
    var list = [];
    var invalid = [];
    (raw || []).forEach(function (item) {
      var id = String(item == null ? '' : item).trim();
      if (!id) return;
      if (!ID_PATTERN.test(id)) {
        invalid.push(id);
        return;
      }
      list.push(id);
    });
    if (invalid.length) {
      throw new DrawError('抽奖人员只能填数字编号：' + invalid.slice(0, 5).join('、'));
    }
    var ids = cleanIdList(list);
    if (ids.length < MIN_PLAYERS) {
      throw new DrawError('至少需要 ' + MIN_PLAYERS + ' 个数字编号（当前 ' + ids.length + ' 个）');
    }
    return ids;
  }

  function cleanPrizeNames(raw) {
    var list = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (item) {
        list.push(String(item == null ? '' : item).trim());
      });
    }
    if (list.length !== WINNER_COUNT) {
      throw new DrawError('需要填写 ' + WINNER_COUNT + ' 个奖品名称');
    }
    if (list.indexOf('') !== -1) {
      throw new DrawError('三个奖品名称都要填写');
    }
    if (new Set(list).size !== list.length) {
      throw new DrawError('三个奖品名称不能重复');
    }
    return list;
  }

  function randomIndex(n, cryptoObj) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError('n 必须是正整数');
    }
    var c = cryptoObj || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (c && typeof c.getRandomValues === 'function') {
      var buf = new Uint32Array(1);
      var limit = Math.floor(4294967296 / n) * n;
      var x;
      do {
        c.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % n;
    }
    return Math.floor(Math.random() * n);
  }

  function Round(ids, prizes, randomFn) {
    this.ids = cleanIds(ids);
    this.prizes = cleanPrizeNames(prizes || DEFAULT_PRIZES);
    this._rng = typeof randomFn === 'function' ? randomFn : randomIndex;
    this._pool = this.ids.slice();
    this.winners = [];
    this.assignments = [];
    this.excluded = [];
  }

  Object.defineProperties(Round.prototype, {
    remaining: {
      get: function () { return this._pool.length; }
    },
    drawnCount: {
      get: function () { return this.winners.length; }
    },
    nextIndex: {
      get: function () { return this.winners.length < WINNER_COUNT ? this.winners.length + 1 : null; }
    },
    lastWinner: {
      get: function () { return this.winners.length ? this.winners[this.winners.length - 1] : null; }
    },
    allDrawn: {
      get: function () { return this.winners.length >= WINNER_COUNT; }
    },
    assigned: {
      get: function () { return this.assignments.length >= WINNER_COUNT; }
    }
  });

  Round.prototype.draw = function () {
    if (this.allDrawn) {
      throw new DrawError('三位中奖者都已经抽出来了');
    }
    if (!this._pool.length) {
      throw new DrawError('名单已抽空，没有可抽的编号了');
    }
    var index = this._rng(this._pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= this._pool.length) {
      throw new Error('随机数生成器返回了无效下标');
    }
    var id = this._pool.splice(index, 1)[0];
    this.winners.push(id);
    return { index: this.winners.length, id: id };
  };

  Round.prototype.redrawLast = function () {
    if (this.assigned) {
      throw new DrawError('奖品已经分配，不能再换人');
    }
    if (!this.winners.length) {
      throw new DrawError('还没有抽出任何中奖者');
    }
    if (!this._pool.length) {
      throw new DrawError('没有备选编号了，无法重抽');
    }
    var index = this._rng(this._pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= this._pool.length) {
      throw new Error('随机数生成器返回了无效下标');
    }
    var oldId = this.winners.pop();
    var id = this._pool.splice(index, 1)[0];
    this.excluded.push(oldId);
    this.winners.push(id);
    return { index: this.winners.length, id: id };
  };

  // 第二步：把三个奖品通过 Fisher-Yates 洗牌后随机分配给三位中奖者
  Round.prototype.assignPrizes = function () {
    if (!this.allDrawn) {
      throw new DrawError('先抽满 3 位中奖者，再分配奖品');
    }
    if (this.assigned) {
      throw new DrawError('奖品已经分配过了');
    }
    var prizes = this.prizes.slice();
    for (var i = prizes.length - 1; i > 0; i -= 1) {
      var j = this._rng(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i) {
        throw new Error('随机数生成器返回了无效下标');
      }
      var tmp = prizes[i];
      prizes[i] = prizes[j];
      prizes[j] = tmp;
    }
    this.assignments = this.winners.map(function (id, index) {
      return { prize: prizes[index], id: id };
    });
    return this.assignments.slice();
  };

  Round.prototype.results = function () {
    return this.assignments.map(function (item) {
      return { prize: item.prize, id: item.id };
    });
  };

  Round.prototype.snapshot = function () {
    return {
      ids: this.ids.slice(),
      prizes: this.prizes.slice(),
      winners: this.winners.slice(),
      assignments: this.results(),
      excluded: this.excluded.slice()
    };
  };

  Round.fromSnapshot = function (data) {
    var source = data || {};
    var ids = cleanIds(source.ids || []);
    var prizes = Array.isArray(source.prizes) ? source.prizes : DEFAULT_PRIZES;
    var round = new Round(ids, prizes);
    var excluded = cleanIdList(source.excluded).filter(function (id) {
      return ids.indexOf(id) !== -1;
    });

    var winners = [];
    (Array.isArray(source.winners) ? source.winners : []).forEach(function (item) {
      var id = String(item == null ? '' : item).trim();
      if (winners.length >= WINNER_COUNT) return;
      if (ID_PATTERN.test(id) && ids.indexOf(id) !== -1 &&
          winners.indexOf(id) === -1 && excluded.indexOf(id) === -1) {
        winners.push(id);
      }
    });

    var assignments = [];
    if (winners.length === WINNER_COUNT && Array.isArray(source.assignments) &&
        source.assignments.length === WINNER_COUNT) {
      var usedPrizes = Object.create(null);
      var cleaned = [];
      var ok = true;
      source.assignments.forEach(function (item, index) {
        if (!ok) return;
        if (!item || prizes.indexOf(item.prize) === -1 ||
            usedPrizes[item.prize] || item.id !== winners[index]) {
          ok = false;
          return;
        }
        usedPrizes[item.prize] = true;
        cleaned.push({ prize: item.prize, id: winners[index] });
      });
      if (ok && cleaned.length === WINNER_COUNT) assignments = cleaned;
    }

    var keptExcluded = excluded.filter(function (id) {
      return winners.indexOf(id) === -1;
    });
    var pool = ids.filter(function (id) {
      return winners.indexOf(id) === -1 && keptExcluded.indexOf(id) === -1;
    });

    round.winners = winners;
    round.assignments = assignments;
    round.excluded = keptExcluded;
    round._pool = pool;
    return round;
  };

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDate(value) {
    var date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function formatTime(value) {
    var d = toDate(value);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function formatStamp(value) {
    var d = toDate(value);
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function formatShortTime(value) {
    var d = toDate(value);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function reportText(round, when) {
    var date = toDate(when);
    var total = round.ids.length;
    var rate = (WINNER_COUNT / total * 100).toFixed(1);
    var winnersText = round.winners.length ? round.winners.join('、') : '（尚未抽取）';
    var lines = [
      '抽奖时间：' + formatTime(date),
      '参与人数：' + total,
      '每人中奖概率：' + rate + '%',
      '奖品设置：' + round.prizes.join('、') + '（三个奖品平级，每人最多中一个）',
      '抽奖方式：先抽 3 位中奖者，再随机分配奖品',
      '中奖编号（按抽出顺序）：' + winnersText,
      ''
    ];
    if (round.assigned) {
      lines.push('奖品分配：');
      round.results().forEach(function (item) {
        lines.push(item.prize + '：' + item.id);
      });
    } else {
      lines.push('奖品分配：待分配');
    }
    if (round.excluded.length) {
      lines.push('', '作废（中奖者未到场）：' + round.excluded.join('、'));
    }
    return lines.join('\n') + '\n';
  }

  return {
    DEFAULT_PRIZES: DEFAULT_PRIZES,
    WINNER_COUNT: WINNER_COUNT,
    MIN_PLAYERS: MIN_PLAYERS,
    DrawError: DrawError,
    Round: Round,
    parseIds: parseIds,
    cleanIds: cleanIds,
    cleanIdList: cleanIdList,
    cleanPrizeNames: cleanPrizeNames,
    randomIndex: randomIndex,
    reportText: reportText,
    formatTime: formatTime,
    formatStamp: formatStamp,
    formatShortTime: formatShortTime
  };
});
