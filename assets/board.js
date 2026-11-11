/* 三人抽奖器 · 编号板
 *
 * 把数字编号平铺在板子上，三个选框从随机方向弹射，
 * 选框之间会碰撞且不会重叠；三个框都停下后，
 * 每个框选覆盖面积最大的编号（重复时取整体最优的不同编号）。
 */
(function (global) {
  'use strict';

  var BOARD_W = 1000;
  var BOARD_H = 560;
  var FRAME_W = 190;
  var FRAME_H = 112;
  var MARGIN = 14;
  var GAP = 6;
  var STOP_SPEED = 12;
  var WALL_REST = 0.9;
  var HIT_REST = 0.94;
  var MAX_SECONDS = 9;
  var FONT_STACK = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  var MONO_STACK = '"Cascadia Mono", "Consolas", "Courier New", monospace';

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function speedOf(frame) {
    return Math.hypot(frame.vx, frame.vy);
  }

  function roundedRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function columnsFor(n) {
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    if (n <= 16) return 4;
    if (n <= 25) return 5;
    if (n <= 36) return 6;
    if (n <= 42) return 7;
    return 8;
  }

  function layoutTiles(ids) {
    var n = ids.length;
    if (!n) return [];
    var cols = columnsFor(n);
    var rows = Math.ceil(n / cols);
    var cellW = (BOARD_W - MARGIN * 2 - (cols - 1) * GAP) / cols;
    var cellH = (BOARD_H - MARGIN * 2 - (rows - 1) * GAP) / rows;
    var tiles = [];
    for (var i = 0; i < n; i += 1) {
      var row = Math.floor(i / cols);
      var col = i % cols;
      tiles.push({
        id: ids[i],
        x: MARGIN + col * (cellW + GAP),
        y: MARGIN + row * (cellH + GAP),
        w: cellW,
        h: cellH
      });
    }
    return tiles;
  }

  function rectsOverlap(a, b, pad) {
    var p = pad || 0;
    return a.x < b.x + b.w + p && a.x + a.w + p > b.x &&
      a.y < b.y + b.h + p && a.y + a.h + p > b.y;
  }

  function Board(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ids = [];
    this.tiles = [];
    this.frames = [];
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.maxId = '';
    this.idFontSize = 14;
    this.mode = 'idle';
    this.cw = 0;
    this.ch = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    this.raf = 0;
    this.resolveLaunch = null;
    this.startedAt = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
    this.resize();
    this.placeIdleFrames();
    this.draw();
  }

  Board.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.cw = rect.width;
    this.ch = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.scale = Math.min(rect.width / BOARD_W, rect.height / BOARD_H);
    this.offsetX = (rect.width - BOARD_W * this.scale) / 2;
    this.offsetY = (rect.height - BOARD_H * this.scale) / 2;
    this.measureIdFont();
    this.draw();
  };

  Board.prototype.setIds = function (ids) {
    this.stop();
    this.ids = (ids || []).slice();
    this.tiles = layoutTiles(this.ids);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.mode = 'idle';
    this.measureIdFont();
    this.placeIdleFrames();
    this.draw();
  };

  Board.prototype.placeIdleFrames = function () {
    var spots = [
      { x: 62, y: 82 },
      { x: 405, y: 224 },
      { x: 748, y: 366 }
    ];
    this.frames = spots.map(function (spot) {
      return {
        x: spot.x,
        y: spot.y,
        w: FRAME_W,
        h: FRAME_H,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: true
      };
    });
  };

  Board.prototype.measureIdFont = function () {
    if (!this.tiles.length) {
      this.idFontSize = 14;
      return;
    }
    var longest = '';
    this.tiles.forEach(function (tile) {
      if (tile.id.length > longest.length) longest = tile.id;
    });
    this.maxId = longest;
    var tile = this.tiles[0];
    var size = Math.min(20, Math.max(8, (tile.w - 16) / (Math.max(1, longest.length) * 0.62)));
    var ctx = this.ctx;
    ctx.save();
    ctx.font = '600 ' + size + 'px ' + MONO_STACK;
    while (size > 7 && ctx.measureText(longest).width > tile.w - 14) {
      size -= 1;
      ctx.font = '600 ' + size + 'px ' + MONO_STACK;
    }
    ctx.restore();
    this.idFontSize = size;
  };

  Board.prototype.placeLaunchFrames = function () {
    var frames = [];
    var fallback = [
      { x: 70, y: 90 },
      { x: 405, y: 224 },
      { x: 740, y: 358 }
    ];

    for (var i = 0; i < 3; i += 1) {
      var placed = false;
      var x = fallback[i].x;
      var y = fallback[i].y;
      for (var attempt = 0; attempt < 400; attempt += 1) {
        x = rand(10, BOARD_W - FRAME_W - 10);
        y = rand(10, BOARD_H - FRAME_H - 10);
        var candidate = { x: x - 10, y: y - 10, w: FRAME_W + 20, h: FRAME_H + 20 };
        var clash = frames.some(function (frame) {
          return rectsOverlap(candidate, frame, 0);
        });
        if (!clash) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        x = fallback[i].x;
        y = fallback[i].y;
      }
      frames.push({
        x: x,
        y: y,
        w: FRAME_W,
        h: FRAME_H,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: false
      });
    }

    var frictions = [0.70, 0.92, 1.14];
    for (var s = frictions.length - 1; s > 0; s -= 1) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = frictions[s];
      frictions[s] = frictions[j];
      frictions[j] = tmp;
    }

    frames.forEach(function (frame, index) {
      var targetX = BOARD_W / 2 + rand(-190, 190);
      var targetY = BOARD_H / 2 + rand(-120, 120);
      var angle = Math.atan2(targetY - (frame.y + FRAME_H / 2),
        targetX - (frame.x + FRAME_W / 2)) + rand(-0.4, 0.4);
      var speed = rand(640, 840);
      frame.vx = Math.cos(angle) * speed;
      frame.vy = Math.sin(angle) * speed;
      frame.k = frictions[index] + rand(-0.04, 0.04);
    });

    this.frames = frames;
  };

  Board.prototype.launch = function (ids) {
    this.stop();
    this.ids = (ids || []).slice();
    this.tiles = layoutTiles(this.ids);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.measureIdFont();
    this.placeLaunchFrames();
    this.mode = 'running';
    this.startedAt = performance.now();
    this.last = this.startedAt;
    this.draw();

    var self = this;
    return new Promise(function (resolve) {
      self.resolveLaunch = resolve;
      self.raf = global.requestAnimationFrame(self.tick);
    });
  };

  Board.prototype.stop = function () {
    if (this.raf) {
      global.cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.resolveLaunch) {
      var resolve = this.resolveLaunch;
      this.resolveLaunch = null;
      resolve(null);
    }
  };

  Board.prototype.tick = function (now) {
    if (this.mode !== 'running') return;
    var dt = Math.min((now - this.last) / 1000, 0.033);
    this.last = now;
    this.update(dt);
    this.draw();

    var elapsed = (now - this.startedAt) / 1000;
    if (this.allStopped() || elapsed > MAX_SECONDS) {
      if (!this.allStopped()) this.forceStop();
      this.separate();
      this.mode = 'stopped';
      this.raf = 0;
      this.draw();
      var resolve = this.resolveLaunch;
      this.resolveLaunch = null;
      if (resolve) {
        resolve({
          frames: this.getFrames(),
          tiles: this.tiles.map(function (tile) {
            return { id: tile.id, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
          })
        });
      }
      return;
    }
    this.raf = global.requestAnimationFrame(this.tick);
  };

  Board.prototype.update = function (dt) {
    this.frames.forEach(function (frame) {
      if (frame.stopped) return;
      var speed = speedOf(frame);
      if (speed < STOP_SPEED) {
        frame.vx = 0;
        frame.vy = 0;
        frame.stopped = true;
        return;
      }
      var damping = Math.exp(-frame.k * dt);
      frame.vx *= damping;
      frame.vy *= damping;
      frame.x += frame.vx * dt;
      frame.y += frame.vy * dt;

      if (frame.x < 0) {
        frame.x = 0;
        frame.vx = Math.abs(frame.vx) * WALL_REST;
      }
      if (frame.x + frame.w > BOARD_W) {
        frame.x = BOARD_W - frame.w;
        frame.vx = -Math.abs(frame.vx) * WALL_REST;
      }
      if (frame.y < 0) {
        frame.y = 0;
        frame.vy = Math.abs(frame.vy) * WALL_REST;
      }
      if (frame.y + frame.h > BOARD_H) {
        frame.y = BOARD_H - frame.h;
        frame.vy = -Math.abs(frame.vy) * WALL_REST;
      }
    });

    for (var iteration = 0; iteration < 4; iteration += 1) {
      this.collide();
    }

    this.frames.forEach(function (frame) {
      frame.x = clamp(frame.x, 0, BOARD_W - frame.w);
      frame.y = clamp(frame.y, 0, BOARD_H - frame.h);
      var speed = speedOf(frame);
      if (speed < STOP_SPEED) {
        frame.vx = 0;
        frame.vy = 0;
        frame.stopped = true;
      } else {
        frame.stopped = false;
      }
    });
  };

  Board.prototype.collide = function () {
    for (var i = 0; i < this.frames.length; i += 1) {
      for (var j = i + 1; j < this.frames.length; j += 1) {
        var a = this.frames[i];
        var b = this.frames[j];
        var overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        var overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (overlapX < overlapY) {
          var nx = (a.x + a.w / 2) < (b.x + b.w / 2) ? 1 : -1;
          var push = overlapX / 2;
          a.x -= nx * push;
          b.x += nx * push;
          var rvx = (b.vx - a.vx) * nx;
          if (rvx < 0) {
            var jx = -(1 + HIT_REST) * rvx / 2;
            a.vx -= jx * nx;
            b.vx += jx * nx;
          }
        } else {
          var ny = (a.y + a.h / 2) < (b.y + b.h / 2) ? 1 : -1;
          var pushY = overlapY / 2;
          a.y -= ny * pushY;
          b.y += ny * pushY;
          var rvy = (b.vy - a.vy) * ny;
          if (rvy < 0) {
            var jy = -(1 + HIT_REST) * rvy / 2;
            a.vy -= jy * ny;
            b.vy += jy * ny;
          }
        }
      }
    }
  };

  Board.prototype.separate = function () {
    for (var i = 0; i < 8; i += 1) {
      this.collide();
    }
    this.frames.forEach(function (frame) {
      frame.x = clamp(frame.x, 0, BOARD_W - frame.w);
      frame.y = clamp(frame.y, 0, BOARD_H - frame.h);
    });
  };

  Board.prototype.forceStop = function () {
    this.frames.forEach(function (frame) {
      frame.vx = 0;
      frame.vy = 0;
      frame.stopped = true;
    });
  };

  Board.prototype.allStopped = function () {
    return this.frames.every(function (frame) {
      return frame.stopped;
    });
  };

  Board.prototype.getFrames = function () {
    return this.frames.map(function (frame) {
      return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    });
  };

  Board.prototype.setFrames = function (frames) {
    if (!Array.isArray(frames) || frames.length !== 3) return;
    this.stop();
    this.frames = frames.map(function (frame) {
      return {
        x: clamp(Number(frame.x) || 0, 0, BOARD_W - FRAME_W),
        y: clamp(Number(frame.y) || 0, 0, BOARD_H - FRAME_H),
        w: FRAME_W,
        h: FRAME_H,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: true
      };
    });
    this.mode = 'stopped';
    this.draw();
  };

  Board.prototype.setSelected = function (ids) {
    this.highlightIds = (ids || []).slice();
    this.draw();
  };

  Board.prototype.setPrizeLabels = function (labels) {
    this.prizeLabels = ['', '', ''];
    (labels || []).slice(0, 3).forEach(function (label, index) {
      this.prizeLabels[index] = String(label || '');
    }, this);
    this.draw();
  };

  Board.prototype.draw = function () {
    if (!this.cw || !this.ch) return;
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, this.cw, this.ch);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    roundedRect(ctx, 0, 0, BOARD_W, BOARD_H, 18);
    var boardGradient = ctx.createLinearGradient(0, 0, 0, BOARD_H);
    boardGradient.addColorStop(0, '#10141f');
    boardGradient.addColorStop(1, '#0a0d15');
    ctx.fillStyle = boardGradient;
    ctx.fill();
    ctx.strokeStyle = '#232b40';
    ctx.lineWidth = 1;
    ctx.stroke();

    this.drawTiles(ctx);
    this.drawFrames(ctx);

    ctx.restore();
  };

  Board.prototype.drawTiles = function (ctx) {
    if (!this.tiles.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#59617c';
      ctx.font = '500 18px ' + FONT_STACK;
      ctx.fillText('填写数字编号后，编号会平铺在这里', BOARD_W / 2, BOARD_H / 2);
      return;
    }

    var self = this;
    var hasSelection = this.highlightIds.length > 0;
    this.tiles.forEach(function (tile) {
      var frameIndex = self.highlightIds.indexOf(tile.id);
      var selected = frameIndex !== -1;

      ctx.save();
      ctx.shadowColor = selected ? 'rgba(255, 204, 85, 0.26)' : 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = selected ? 16 : 6;
      ctx.shadowOffsetY = selected ? 0 : 2;
      roundedRect(ctx, tile.x, tile.y, tile.w, tile.h, 8);
      ctx.fillStyle = selected ? '#1c1a10' : (hasSelection ? '#111621' : '#141a27');
      ctx.fill();
      ctx.restore();

      roundedRect(ctx, tile.x, tile.y, tile.w, tile.h, 8);
      ctx.strokeStyle = selected ? '#ffcc55' : '#232c42';
      ctx.lineWidth = selected ? 2.5 : 1;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tile.x + 8, tile.y + 1);
      ctx.lineTo(tile.x + tile.w - 8, tile.y + 1);
      ctx.stroke();

      ctx.save();
      ctx.font = '600 ' + self.idFontSize + 'px ' + MONO_STACK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? '#ffe6a3' : (hasSelection ? '#9aa2bb' : '#cbd2e6');
      ctx.fillText(tile.id, tile.x + tile.w / 2, tile.y + tile.h / 2 + 0.5);
      ctx.restore();

      if (selected) {
        var badgeX = tile.x + tile.w - 15;
        var badgeY = tile.y + 15;
        ctx.save();
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc55';
        ctx.fill();
        ctx.fillStyle = '#1b1503';
        ctx.font = '700 10px ' + FONT_STACK;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(frameIndex + 1), badgeX, badgeY + 0.5);
        ctx.restore();
      }
    });
  };

  Board.prototype.drawFrames = function (ctx) {
    var now = performance.now();
    var self = this;

    this.frames.forEach(function (frame, index) {
      var bob = self.mode === 'idle' ? Math.sin(now / 750 + index * 2.1) * 3 : 0;
      var x = frame.x;
      var y = frame.y + bob;

      ctx.save();
      ctx.shadowColor = 'rgba(110, 168, 254, 0.22)';
      ctx.shadowBlur = 22;
      roundedRect(ctx, x, y, frame.w, frame.h, 12);
      ctx.fillStyle = 'rgba(110, 168, 254, 0.055)';
      ctx.fill();
      ctx.restore();

      roundedRect(ctx, x, y, frame.w, frame.h, 12);
      ctx.strokeStyle = '#a9c6ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      roundedRect(ctx, x + 5, y + 5, frame.w - 10, frame.h - 10, 9);
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(169, 198, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      var label = '框 ' + (index + 1);
      ctx.font = '700 12px ' + FONT_STACK;
      var labelWidth = ctx.measureText(label).width + 16;
      roundedRect(ctx, x + 9, y + 9, labelWidth, 24, 12);
      ctx.fillStyle = 'rgba(8, 10, 16, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(169, 198, 255, 0.38)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#cfe0ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 17, y + 21.5);

      var prize = self.prizeLabels[index];
      if (prize) {
        var fontSize = 13;
        ctx.font = '600 ' + fontSize + 'px ' + FONT_STACK;
        var maxWidth = frame.w - 28;
        var text = prize;
        while (text.length > 1 && ctx.measureText(text).width > maxWidth) {
          text = text.slice(0, -1);
        }
        if (text !== prize) text = text.slice(0, -1) + '…';

        var chipWidth = Math.min(maxWidth + 14, ctx.measureText(text).width + 18);
        var chipX = x + (frame.w - chipWidth) / 2;
        var chipY = y + frame.h - 34;
        roundedRect(ctx, chipX, chipY, chipWidth, 25, 12);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.86)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 204, 85, 0.34)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffe6a3';
        ctx.textAlign = 'center';
        ctx.fillText(text, x + frame.w / 2, chipY + 13);
      }
    });
  };

  global.LotteryBoard = {
    Board: Board,
    layoutTiles: layoutTiles,
    BOARD_W: BOARD_W,
    BOARD_H: BOARD_H,
    FRAME_W: FRAME_W,
    FRAME_H: FRAME_H
  };
})(typeof window !== 'undefined' ? window : globalThis);
