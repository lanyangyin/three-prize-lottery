'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIZES,
  MIN_PLAYERS,
  DrawError,
  Round,
  cleanNames,
  parseNames,
  reportText,
  formatStamp
} = require('../assets/core.js');

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

function seededRound(names, seed) {
  const rng = mulberry32(seed);
  return new Round(names, function (n) {
    return Math.floor(rng() * n);
  });
}

test('cleanNames 去空白、空行与重复，保留顺序', function () {
  assert.deepEqual(cleanNames(['张三', ' 张三 ', '', '   ', '李四', '李四']), ['张三', '李四']);
});

test('parseNames 支持换行、逗号、顿号、分号', function () {
  assert.deepEqual(
    parseNames('张三\n李四,王五，赵六、钱七；孙八\t周九'),
    ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九']
  );
});

test('名字内部的空格会保留', function () {
  assert.deepEqual(parseNames('Mary Jane\n张三'), ['Mary Jane', '张三']);
});

test('少于 4 人无法开始，4 人可以', function () {
  assert.throws(function () {
    return new Round(['甲', '乙', '丙']);
  }, DrawError);
  const round = new Round(['甲', '乙', '丙', '丁']);
  assert.equal(round.remaining, 4);
});

test('4~50 人时三个奖中奖者不重复且都属于名单', function () {
  for (let n = MIN_PLAYERS; n <= 50; n += 1) {
    const names = Array.from({ length: n }, function (_, i) { return 'P' + i; });
    const round = seededRound(names, n * 977);
    const winners = [];
    for (let i = 0; i < 3; i += 1) {
      const result = round.draw();
      winners.push(result.name);
      assert.equal(result.prize, PRIZES[i]);
    }
    assert.equal(new Set(winners).size, 3, n + ' 人时出现重复中奖');
    winners.forEach(function (name) {
      assert.ok(names.includes(name));
    });
    assert.equal(round.remaining, n - 3);
    assert.equal(round.finished, true);
    assert.equal(round.nextPrize, null);
  }
});

test('第四个奖会被拒绝', function () {
  const round = seededRound(['A', 'B', 'C', 'D', 'E'], 1);
  round.draw();
  round.draw();
  round.draw();
  assert.throws(function () { round.draw(); }, DrawError);
});

test('中奖分布接近 3/n', function () {
  const names = Array.from({ length: 10 }, function (_, i) { return 'P' + i; });
  const counts = Object.fromEntries(names.map(function (name) { return [name, 0]; }));
  const rounds = 3000;
  for (let seed = 0; seed < rounds; seed += 1) {
    const round = seededRound(names, seed + 1);
    round.draw();
    round.draw();
    round.draw();
    Object.keys(round.winners).forEach(function (prize) {
      counts[round.winners[prize]] += 1;
    });
  }
  names.forEach(function (name) {
    const rate = counts[name] / rounds;
    assert.ok(Math.abs(rate - 0.3) < 0.05, name + ' 中奖率 ' + rate.toFixed(3) + ' 偏离过大');
  });
});

test('重抽会作废旧中奖者并从剩余名单中换人', function () {
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const round = seededRound(names, 42);
  const first = round.draw();
  const again = round.redraw();
  assert.equal(again.prize, first.prize);
  assert.notEqual(again.name, first.name);
  assert.equal(round.winners[first.prize], again.name);
  assert.deepEqual(round.excluded, [first.name]);
  assert.ok(!Object.values(round.winners).includes(first.name));
});

test('没抽过奖时不能重抽', function () {
  const round = seededRound(['A', 'B', 'C', 'D'], 9);
  assert.throws(function () { round.redraw(); }, DrawError);
});

test('剩余名单抽空后重抽失败且不破坏已有结果', function () {
  const names = ['A', 'B', 'C', 'D'];
  const round = seededRound(names, 5);
  round.draw();
  round.draw();
  round.draw();
  round.redraw();
  assert.equal(round.remaining, 0);
  const before = Object.assign({}, round.winners);
  assert.throws(function () { round.redraw(); }, DrawError);
  assert.deepEqual(Object.assign({}, round.winners), before);
});

test('snapshot / fromSnapshot 能恢复进度', function () {
  const names = Array.from({ length: 12 }, function (_, i) { return 'P' + i; });
  const round = seededRound(names, 88);
  round.draw();
  round.draw();
  const restored = Round.fromSnapshot(round.snapshot());
  assert.deepEqual(restored.names, round.names);
  assert.deepEqual(Object.assign({}, restored.winners), Object.assign({}, round.winners));
  assert.equal(restored.nextPrize, round.nextPrize);
  assert.equal(restored.remaining, round.remaining);
});

test('fromSnapshot 只接受连续的前缀结果', function () {
  const names = ['A', 'B', 'C', 'D', 'E'];
  const restored = Round.fromSnapshot({
    names: names,
    winners: { 三等奖: '不存在的人', 二等奖: 'B', 一等奖: 'C' }
  });
  assert.deepEqual(Object.assign({}, restored.winners), {});
  assert.equal(restored.nextPrize, '三等奖');
});

test('结果按一等奖到三等奖输出', function () {
  const round = seededRound(['A', 'B', 'C', 'D', 'E'], 3);
  round.draw();
  round.draw();
  round.draw();
  assert.deepEqual(round.results().map(function (item) { return item.prize; }),
    ['一等奖', '二等奖', '三等奖']);
});

test('中奖记录包含人数、概率、名单和作废信息', function () {
  const round = seededRound(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], 12);
  round.draw();
  round.draw();
  round.draw();
  round.redraw();
  const text = reportText(round, new Date(2026, 10, 12, 9, 30, 0));
  assert.match(text, /抽奖时间：2026-11-12 09:30:00/);
  assert.match(text, /参与人数：10/);
  assert.match(text, /每人中奖概率：30\.0%/);
  assert.match(text, /一等奖：/);
  assert.match(text, /作废（中奖者未到场）：/);
});

test('formatStamp 生成文件名时间戳', function () {
  assert.equal(formatStamp(new Date(2026, 10, 12, 9, 5, 7)), '20261112_0905');
});
