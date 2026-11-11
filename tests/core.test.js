'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PRIZES,
  WINNER_COUNT,
  MIN_PLAYERS,
  DrawError,
  Round,
  parseIds,
  selectWinners,
  reportText,
  formatStamp
} = require('../assets/core.js');

const PRIZES = ['蓝牙耳机', '保温杯', '帆布袋'];
const SAMPLE_IDS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(3, '0'));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRound(ids, seed, prizes) {
  const rng = mulberry32(seed);
  return new Round(ids, prizes || PRIZES, function (n) {
    return Math.floor(rng() * n);
  });
}

test('parseIds 只接受数字编号，支持换行/逗号/顿号并去重', function () {
  const parsed = parseIds('001\n002,003，004、005;006 007');
  assert.deepEqual(parsed.ids, ['001', '002', '003', '004', '005', '006', '007']);
  assert.deepEqual(parsed.invalid, []);
  assert.deepEqual(parseIds('001\n001\n002').ids, ['001', '002']);
});

test('parseIds 会收集非数字内容', function () {
  const parsed = parseIds('001\n张三\n002\n12x');
  assert.deepEqual(parsed.ids, ['001', '002']);
  assert.deepEqual(parsed.invalid, ['张三', '12x']);
});

test('Round 拒绝非数字编号和不足 4 个编号', function () {
  assert.throws(function () {
    return new Round(['001', '002', '张三', '004'], PRIZES);
  }, DrawError);
  assert.throws(function () {
    return new Round(['001', '002', '003'], PRIZES);
  }, DrawError);
  const round = new Round(['001', '002', '003', '004'], PRIZES);
  assert.equal(round.remaining, 4);
});

test('三个奖品必须各不相同且都有名称', function () {
  const ids = ['001', '002', '003', '004'];
  assert.throws(function () { return new Round(ids, ['奖品 A', '奖品 B']); }, DrawError);
  assert.throws(function () { return new Round(ids, ['奖品 A', '', '奖品 C']); }, DrawError);
  assert.throws(function () { return new Round(ids, ['奖品 A', '奖品 A', '奖品 C']); }, DrawError);
  const round = new Round(ids, PRIZES);
  assert.deepEqual(round.prizes, PRIZES);
});

test('默认三个奖品名称可用', function () {
  const round = new Round(['001', '002', '003', '004']);
  assert.deepEqual(round.prizes, DEFAULT_PRIZES);
});

test('第一步只抽人：4~50 个编号依次抽出 3 位不同中奖者，此时没有奖品', function () {
  for (let n = MIN_PLAYERS; n <= 50; n += 1) {
    const ids = Array.from({ length: n }, function (_, i) { return String(i + 1).padStart(3, '0'); });
    const round = seededRound(ids, n * 977);
    const winners = [];
    for (let i = 0; i < WINNER_COUNT; i += 1) {
      const result = round.draw();
      assert.equal(result.index, i + 1);
      winners.push(result.id);
      assert.equal(round.assigned, false);
    }
    assert.equal(new Set(winners).size, 3, n + ' 个编号时出现重复中奖');
    winners.forEach(function (id) {
      assert.ok(ids.includes(id));
    });
    assert.equal(round.allDrawn, true);
    assert.equal(round.assigned, false);
    assert.equal(round.nextIndex, null);
    assert.equal(round.remaining, n - 3);
    assert.throws(function () { round.draw(); }, DrawError);
  }
});

test('第二步随机分配：三位中奖者各得一个不同奖品', function () {
  for (let seed = 0; seed < 100; seed += 1) {
    const round = seededRound(SAMPLE_IDS, seed);
    for (let i = 0; i < WINNER_COUNT; i += 1) round.draw();
    const assignments = round.assignPrizes();
    assert.equal(assignments.length, 3);
    assert.deepEqual(assignments.map(function (a) { return a.id; }), round.winners);
    assert.deepEqual(assignments.map(function (a) { return a.prize; }).sort(), PRIZES.slice().sort());
    assert.equal(round.assigned, true);
  }
});

test('没抽满 3 位不能分配奖品，分配后不能重复分配', function () {
  const round = seededRound(SAMPLE_IDS, 1);
  round.draw();
  assert.throws(function () { round.assignPrizes(); }, DrawError);
  round.draw();
  round.draw();
  round.assignPrizes();
  assert.throws(function () { round.assignPrizes(); }, DrawError);
});

test('第一步中奖分布接近 3/n', function () {
  const ids = SAMPLE_IDS.slice(0, 10);
  const counts = Object.fromEntries(ids.map(function (id) { return [id, 0]; }));
  const rounds = 3000;
  for (let seed = 0; seed < rounds; seed += 1) {
    const round = seededRound(ids, seed + 1);
    round.draw();
    round.draw();
    round.draw();
    round.winners.forEach(function (id) {
      counts[id] += 1;
    });
  }
  ids.forEach(function (id) {
    const rate = counts[id] / rounds;
    assert.ok(Math.abs(rate - 0.3) < 0.05, id + ' 中奖率 ' + rate.toFixed(3) + ' 偏离过大');
  });
});

test('奖品分配对每位中奖者是均匀随机的', function () {
  const rounds = 3000;
  const counts = {};
  PRIZES.forEach(function (prize) {
    counts[prize] = [0, 0, 0];
  });
  for (let seed = 0; seed < rounds; seed += 1) {
    const round = seededRound(SAMPLE_IDS, seed + 1);
    round.draw();
    round.draw();
    round.draw();
    round.assignPrizes().forEach(function (item, index) {
      counts[item.prize][index] += 1;
    });
  }
  PRIZES.forEach(function (prize) {
    counts[prize].forEach(function (count, index) {
      const rate = count / rounds;
      assert.ok(Math.abs(rate - 1 / 3) < 0.05,
        prize + ' 在第 ' + (index + 1) + ' 位的分配率 ' + rate.toFixed(3) + ' 偏离过大');
    });
  });
});

test('选框停下后各选覆盖面积最大的编号', function () {
  const tiles = [
    { id: '001', x: 0, y: 0, w: 100, h: 100 },
    { id: '002', x: 100, y: 0, w: 100, h: 100 },
    { id: '003', x: 200, y: 0, w: 100, h: 100 },
    { id: '004', x: 300, y: 0, w: 100, h: 100 }
  ];
  const frames = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 110, y: 0, w: 100, h: 100 },
    { x: 300, y: 0, w: 100, h: 100 }
  ];
  const result = selectWinners(frames, tiles, { randomFn: function () { return 0; } });
  assert.deepEqual(result.picks.map(function (p) { return p.id; }), ['001', '002', '004']);
  assert.deepEqual(result.emptyFrames, []);
  assert.equal(new Set(result.picks.map(function (p) { return p.id; })).size, 3);
});

test('两个框同时盖住同一张编号时，结果仍然不重复', function () {
  const tiles = [
    { id: '001', x: 0, y: 0, w: 100, h: 100 },
    { id: '002', x: 100, y: 0, w: 100, h: 100 },
    { id: '003', x: 200, y: 0, w: 100, h: 100 },
    { id: '004', x: 300, y: 0, w: 100, h: 100 }
  ];
  const frames = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 300, y: 0, w: 100, h: 100 }
  ];
  const result = selectWinners(frames, tiles, { randomFn: function () { return 0; } });
  const ids = result.picks.map(function (p) { return p.id; });
  assert.equal(new Set(ids).size, 3);
  assert.equal(ids[2], '004');
  assert.ok(result.picks.some(function (p) { return p.area === 10000; }));
});

test('框停在空位：重抽模式返回空结果，最近的模式补一个最近编号', function () {
  const tiles = [
    { id: '001', x: 0, y: 0, w: 100, h: 100 },
    { id: '002', x: 100, y: 0, w: 100, h: 100 },
    { id: '003', x: 200, y: 0, w: 100, h: 100 }
  ];
  const frames = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 100, y: 0, w: 100, h: 100 },
    { x: 500, y: 0, w: 100, h: 100 }
  ];

  const retry = selectWinners(frames, tiles, {
    emptyMode: 'retry',
    randomFn: function () { return 0; }
  });
  assert.deepEqual(retry.picks, []);
  assert.deepEqual(retry.emptyFrames, [2]);

  const nearest = selectWinners(frames, tiles, {
    emptyMode: 'nearest',
    randomFn: function () { return 0; }
  });
  assert.equal(nearest.picks.length, 3);
  assert.deepEqual(nearest.emptyFrames, [2]);
  assert.equal(nearest.picks[2].id, '003');
  assert.equal(nearest.picks[2].area, 0);
  assert.equal(new Set(nearest.picks.map(function (p) { return p.id; })).size, 3);
});

test('setWinners 接受三个不同的数字编号并可直接分配奖品', function () {
  const round = new Round(['001', '002', '003', '004', '005'], PRIZES);
  round.setWinners(['003', '001', '004']);
  assert.deepEqual(round.winners, ['003', '001', '004']);
  assert.equal(round.allDrawn, true);
  assert.equal(round.remaining, 2);
  round.assignPrizes();
  assert.deepEqual(round.assignments.map(function (a) { return a.id; }), ['003', '001', '004']);
  assert.deepEqual(round.assignments.map(function (a) { return a.prize; }).sort(), PRIZES.slice().sort());
});

test('setWinners 拒绝重复、非数字和不在名单里的编号', function () {
  const round = new Round(['001', '002', '003', '004'], PRIZES);
  assert.throws(function () { round.setWinners(['001', '001', '003']); }, DrawError);
  assert.throws(function () { round.setWinners(['001', 'abc', '003']); }, DrawError);
  assert.throws(function () { round.setWinners(['001', '002', '999']); }, DrawError);
});

test('重抽只能替换最后一位，且作废后不再参与', function () {
  const round = seededRound(SAMPLE_IDS, 42);
  round.draw();
  round.draw();
  const oldId = round.lastWinner;
  const result = round.redrawLast();
  assert.equal(result.index, 2);
  assert.notEqual(result.id, oldId);
  assert.deepEqual(round.excluded, [oldId]);
  assert.equal(round.winners[1], result.id);
  assert.equal(round.winners.length, 2);
});

test('分配奖品后不能再重抽', function () {
  const round = seededRound(SAMPLE_IDS, 3);
  round.draw();
  round.draw();
  round.draw();
  round.assignPrizes();
  assert.throws(function () { round.redrawLast(); }, DrawError);
});

test('没抽人不能重抽；备选编号抽空后重抽失败且不破坏结果', function () {
  const round = seededRound(['001', '002', '003', '004'], 5);
  assert.throws(function () { round.redrawLast(); }, DrawError);
  round.draw();
  round.draw();
  round.draw();
  round.redrawLast();
  assert.equal(round.remaining, 0);
  const before = round.winners.slice();
  assert.throws(function () { round.redrawLast(); }, DrawError);
  assert.deepEqual(round.winners, before);
});

test('snapshot / fromSnapshot 恢复两位中奖、待分配状态', function () {
  const round = seededRound(SAMPLE_IDS, 88);
  round.draw();
  round.draw();
  const restored = Round.fromSnapshot(round.snapshot());
  assert.deepEqual(restored.ids, round.ids);
  assert.deepEqual(restored.prizes, PRIZES);
  assert.deepEqual(restored.winners, round.winners);
  assert.deepEqual(restored.assignments, []);
  assert.equal(restored.allDrawn, false);
  assert.equal(restored.nextIndex, 3);
});

test('snapshot / fromSnapshot 恢复已分配状态', function () {
  const round = seededRound(SAMPLE_IDS, 89);
  round.draw();
  round.draw();
  round.draw();
  round.assignPrizes();
  const restored = Round.fromSnapshot(round.snapshot());
  assert.deepEqual(restored.winners, round.winners);
  assert.deepEqual(restored.assignments, round.assignments);
  assert.equal(restored.assigned, true);
  assert.equal(restored.remaining, round.remaining);
});

test('fromSnapshot 不完整的编号结果只恢复成待抽状态', function () {
  const restored = Round.fromSnapshot({
    ids: SAMPLE_IDS,
    prizes: PRIZES,
    winners: ['001', '002', '003', '004'],
    assignments: []
  });
  assert.deepEqual(restored.winners, ['001', '002', '003']);
  assert.equal(restored.allDrawn, true);
  assert.equal(restored.assigned, false);
});

test('中奖记录包含两步流程、中奖编号和奖品分配', function () {
  const round = seededRound(SAMPLE_IDS.slice(0, 10), 12);
  round.draw();
  round.draw();
  round.draw();
  round.assignPrizes();
  const text = reportText(round, new Date(2026, 10, 12, 9, 30, 0));
  assert.match(text, /抽奖时间：2026-11-12 09:30:00/);
  assert.match(text, /参与人数：10/);
  assert.match(text, /每人中奖概率：30\.0%/);
  assert.match(text, /抽奖方式：三个选框随机弹射，各选覆盖面积最大的编号；再随机分配奖品/);
  assert.match(text, /中奖编号（按框序号）：/);
  assert.match(text, /奖品分配：/);
  round.results().forEach(function (item) {
    assert.match(text, new RegExp(item.prize + '：' + item.id));
  });
});

test('未分配时的记录会写待分配', function () {
  const round = seededRound(SAMPLE_IDS, 2);
  round.draw();
  const text = reportText(round, new Date(2026, 10, 12, 9, 30, 0));
  assert.match(text, /奖品分配：待分配/);
});

test('formatStamp 生成文件名时间戳', function () {
  assert.equal(formatStamp(new Date(2026, 10, 12, 9, 5, 7)), '20261112_0905');
});
