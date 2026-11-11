/* 三人抽奖器 · 静态网页
 *
 * 规则：三个奖品位完全平级，依次抽出 3 位中奖者；
 *       中奖者立即从名单移除，每人最多中一个。
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

  // 三个平级名额，编号只表示抽奖顺序，没有高低之分
  var SLOTS = ['第 1 位', '第 2 位', '第 3 位'];
  var MIN_PLAYERS = 4; // 3 位中奖者 + 至少 1 位备选
  var NAME_SPLIT = /[\n\r,，、;；\t]+/;

  function DrawError(message) {
    var err = Error.call(this, message);
    this.message = message;
    this.name = 'DrawError';
    this.stack = err.stack;
  }
  DrawError.prototype = Object.create(Error.prototype);
  DrawError.prototype.constructor = DrawError;

  function cleanNames(raw) {
    var seen = Object.create(null);
    var names = [];
    (raw || []).forEach(function (item) {
      var name = String(item == null ? '' : item).trim();
      if (name && !seen[name]) {
        seen[name] = true;
        names.push(name);
      }
    });
    return names;
  }

  function parseNames(text) {
    return cleanNames(String(text == null ? '' : text).split(NAME_SPLIT));
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

  function Round(names, randomFn) {
    this.names = cleanNames(names);
    if (this.names.length < MIN_PLAYERS) {
      throw new DrawError('至少需要 ' + MIN_PLAYERS + ' 位参与者（当前 ' + this.names.length + ' 位）');
    }
    this.slots = SLOTS.slice();
    this._rng = typeof randomFn === 'function' ? randomFn : randomIndex;
    this._pool = this.names.slice();
    this._next = 0;
    this.winners = Object.create(null);
    this.excluded = [];
  }

  Object.defineProperties(Round.prototype, {
    remaining: {
      get: function () { return this._pool.length; }
    },
    nextSlot: {
      get: function () { return this._next < this.slots.length ? this.slots[this._next] : null; }
    },
    lastSlot: {
      get: function () { return this._next > 0 ? this.slots[this._next - 1] : null; }
    },
    finished: {
      get: function () { return this._next >= this.slots.length; }
    }
  });

  Round.prototype.draw = function () {
    var slot = this.nextSlot;
    if (!slot) {
      throw new DrawError('三个奖品都已经抽完了');
    }
    if (!this._pool.length) {
      throw new DrawError('名单已抽空，没有可抽的人了');
    }
    var index = this._rng(this._pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= this._pool.length) {
      throw new Error('随机数生成器返回了无效下标');
    }
    var name = this._pool.splice(index, 1)[0];
    this.winners[slot] = name;
    this._next += 1;
    return { slot: slot, name: name };
  };

  Round.prototype.redraw = function () {
    var slot = this.lastSlot;
    if (!slot) {
      throw new DrawError('还没有抽出任何中奖者');
    }
    if (!this._pool.length) {
      throw new DrawError('剩余名单已抽空，无法重抽');
    }
    var index = this._rng(this._pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= this._pool.length) {
      throw new Error('随机数生成器返回了无效下标');
    }
    var oldName = this.winners[slot];
    var name = this._pool.splice(index, 1)[0];
    this.excluded.push(oldName);
    this.winners[slot] = name;
    return { slot: slot, name: name };
  };

  Round.prototype.results = function () {
    var self = this;
    return this.slots.filter(function (slot) {
      return Boolean(self.winners[slot]);
    }).map(function (slot) {
      return { slot: slot, name: self.winners[slot] };
    });
  };

  Round.prototype.snapshot = function () {
    var winners = {};
    Object.keys(this.winners).forEach(function (slot) {
      winners[slot] = this.winners[slot];
    }, this);
    return {
      names: this.names.slice(),
      winners: winners,
      excluded: this.excluded.slice()
    };
  };

  Round.fromSnapshot = function (data) {
    var source = data || {};
    var names = cleanNames(source.names || []);
    var round = new Round(names);
    var excluded = cleanNames(source.excluded || []);
    var winners = {};
    var won = Object.create(null);
    var sequential = true;

    SLOTS.forEach(function (slot) {
      if (!sequential) return;
      var name = source.winners ? source.winners[slot] : null;
      if (name && names.indexOf(name) !== -1 && excluded.indexOf(name) === -1 && !won[name]) {
        winners[slot] = name;
        won[name] = true;
      } else {
        sequential = false;
      }
    });

    var keptExcluded = excluded.filter(function (name) {
      return names.indexOf(name) !== -1 && !won[name];
    });
    var pool = names.filter(function (name) {
      return !won[name] && excluded.indexOf(name) === -1;
    });

    round.winners = winners;
    round.excluded = keptExcluded;
    round._pool = pool;
    round._next = Object.keys(winners).length;
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
    var total = round.names.length;
    var rate = (round.slots.length / total * 100).toFixed(1);
    var lines = [
      '抽奖时间：' + formatTime(date),
      '参与人数：' + total,
      '每人中奖概率：' + rate + '%',
      '奖品设置：3 个平级奖品，每人最多中一个',
      ''
    ];
    round.results().forEach(function (item) {
      lines.push(item.slot + '中奖者：' + item.name);
    });
    if (round.excluded.length) {
      lines.push('', '作废（中奖者未到场）：' + round.excluded.join('、'));
    }
    return lines.join('\n') + '\n';
  }

  return {
    SLOTS: SLOTS,
    MIN_PLAYERS: MIN_PLAYERS,
    DrawError: DrawError,
    Round: Round,
    cleanNames: cleanNames,
    parseNames: parseNames,
    randomIndex: randomIndex,
    reportText: reportText,
    formatTime: formatTime,
    formatStamp: formatStamp,
    formatShortTime: formatShortTime
  };
});
