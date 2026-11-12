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
  var DEFAULT_FRAME_W = 300;
  var DEFAULT_FRAME_H = 180;
  var MIN_FRAME_W = 180;
  var MAX_FRAME_W = 420;
  var DEFAULT_GAP = 6;
  var MIN_GAP = 0;
  var MAX_GAP = 24;
  var MARGIN = 14;
  var STOP_SPEED = 12;
  var WALL_REST = 0.9;
  var HIT_REST = 0.94;
  var MAX_SECONDS = 9;
  var PLAN_DT = 1 / 60;
  var PLAN_MAX_STEPS = Math.ceil(MAX_SECONDS / PLAN_DT);
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

  function layoutTiles(ids, gap) {
    var n = ids.length;
    if (!n) return [];
    var cellGap = (typeof gap === 'number' && isFinite(gap)) ? gap : DEFAULT_GAP;
    var cols = columnsFor(n);
    var rows = Math.ceil(n / cols);
    var cellW = (BOARD_W - MARGIN * 2 - (cols - 1) * cellGap) / cols;
    var cellH = (BOARD_H - MARGIN * 2 - (rows - 1) * cellGap) / rows;
    var tiles = [];
    for (var i = 0; i < n; i += 1) {
      var row = Math.floor(i / cols);
      var col = i % cols;
      tiles.push({
        id: ids[i],
        x: MARGIN + col * (cellW + cellGap),
        y: MARGIN + row * (cellH + cellGap),
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

  /* ---------- 弹射前路径预演：固定步长、可回放 ---------- */

  function clonePlanFrame(frame, w, h) {
    return {
      x: clamp(Number(frame.x) || 0, 0, BOARD_W - w),
      y: clamp(Number(frame.y) || 0, 0, BOARD_H - h),
      w: w,
      h: h,
      vx: 0,
      vy: 0,
      k: 0,
      stopped: true
    };
  }

  function simCollide(frames, stats) {
    for (var i = 0; i < frames.length; i += 1) {
      for (var j = i + 1; j < frames.length; j += 1) {
        var a = frames[i];
        var b = frames[j];
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
            if (stats) stats.frameHits += 1;
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
            if (stats) stats.frameHits += 1;
          }
        }
      }
    }
  }

  function simStep(frames, dt, stats) {
    frames.forEach(function (frame) {
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
      var oldX = frame.x;
      var oldY = frame.y;
      frame.x += frame.vx * dt;
      frame.y += frame.vy * dt;
      stats.distance += Math.hypot(frame.x - oldX, frame.y - oldY);

      if (frame.x < 0) {
        frame.x = 0;
        frame.vx = Math.abs(frame.vx) * WALL_REST;
        stats.wallHits += 1;
      }
      if (frame.x + frame.w > BOARD_W) {
        frame.x = BOARD_W - frame.w;
        frame.vx = -Math.abs(frame.vx) * WALL_REST;
        stats.wallHits += 1;
      }
      if (frame.y < 0) {
        frame.y = 0;
        frame.vy = Math.abs(frame.vy) * WALL_REST;
        stats.wallHits += 1;
      }
      if (frame.y + frame.h > BOARD_H) {
        frame.y = BOARD_H - frame.h;
        frame.vy = -Math.abs(frame.vy) * WALL_REST;
        stats.wallHits += 1;
      }
    });

    for (var iteration = 0; iteration < 4; iteration += 1) {
      simCollide(frames, stats);
    }

    frames.forEach(function (frame) {
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
  }

  function simSeparate(frames) {
    for (var i = 0; i < 8; i += 1) simCollide(frames, null);
    frames.forEach(function (frame) {
      frame.x = clamp(frame.x, 0, BOARD_W - frame.w);
      frame.y = clamp(frame.y, 0, BOARD_H - frame.h);
    });
  }

  function simAllStopped(frames) {
    return frames.every(function (frame) { return frame.stopped; });
  }

  function makeLaunchParams(startFrames) {
    var frictions = [0.70, 0.92, 1.14];
    for (var s = frictions.length - 1; s > 0; s -= 1) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = frictions[s];
      frictions[s] = frictions[j];
      frictions[j] = tmp;
    }
    return startFrames.map(function (frame, index) {
      var targetX = BOARD_W / 2 + rand(-190, 190);
      var targetY = BOARD_H / 2 + rand(-120, 120);
      var angle = Math.atan2(targetY - (frame.y + frame.h / 2),
        targetX - (frame.x + frame.w / 2)) + rand(-0.4, 0.4);
      var speed = rand(640, 840);
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        k: frictions[index] + rand(-0.04, 0.04)
      };
    });
  }

  function framesWithParams(startFrames, params) {
    return startFrames.map(function (frame, index) {
      return {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        vx: params[index].vx,
        vy: params[index].vy,
        k: params[index].k,
        stopped: false
      };
    });
  }

  function coverageInfo(frames, tiles, targetIndex) {
    var targetMax = false;
    var allCover = true;
    var targetRatio = 0;
    var targetFrame = -1;
    frames.forEach(function (frame, frameIndex) {
      var maxArea = 0;
      var targetArea = 0;
      tiles.forEach(function (tile, index) {
        var width = Math.min(frame.x + frame.w, tile.x + tile.w) - Math.max(frame.x, tile.x);
        var height = Math.min(frame.y + frame.h, tile.y + tile.h) - Math.max(frame.y, tile.y);
        var area = width > 0 && height > 0 ? width * height : 0;
        if (area > maxArea) maxArea = area;
        if (index === targetIndex) targetArea = area;
      });
      if (maxArea <= 1) allCover = false;
      if (targetArea >= maxArea - 1 && maxArea > 1) {
        targetMax = true;
        var ratio = targetArea / (frame.w * frame.h);
        if (ratio > targetRatio) {
          targetRatio = ratio;
          targetFrame = frameIndex;
        }
      }
    });
    return {
      targetMax: targetMax,
      allCover: allCover,
      targetRatio: targetRatio,
      targetFrame: targetFrame
    };
  }

  function simulateCandidate(startFrames, params, tiles, targetIndex) {
    var frames = framesWithParams(startFrames, params);
    var stats = { wallHits: 0, frameHits: 0, distance: 0 };
    var steps = 0;
    for (; steps < PLAN_MAX_STEPS; steps += 1) {
      simStep(frames, PLAN_DT, stats);
      if (simAllStopped(frames)) break;
    }
    if (!simAllStopped(frames)) {
      frames.forEach(function (frame) {
        frame.vx = 0;
        frame.vy = 0;
        frame.stopped = true;
      });
    }
    simSeparate(frames);

    var displacement = 0;
    frames.forEach(function (frame, index) {
      displacement += Math.hypot(frame.x - startFrames[index].x, frame.y - startFrames[index].y);
    });
    var info = coverageInfo(frames, tiles, targetIndex);
    return {
      frames: frames,
      targetMax: info.targetMax,
      allCover: info.allCover,
      targetRatio: info.targetRatio,
      targetFrame: info.targetFrame,
      pathRatio: stats.distance / Math.max(displacement, 1),
      steps: steps + 1,
      stats: stats
    };
  }

  function recordTrajectory(startFrames, params, tiles) {
    var frames = framesWithParams(startFrames, params);
    var stats = { wallHits: 0, frameHits: 0, distance: 0 };
    var steps = [frames.map(function (frame) {
      return { x: frame.x, y: frame.y };
    })];

    for (var step = 0; step < PLAN_MAX_STEPS; step += 1) {
      simStep(frames, PLAN_DT, stats);
      steps.push(frames.map(function (frame) {
        return { x: frame.x, y: frame.y };
      }));
      if (simAllStopped(frames)) break;
    }
    if (!simAllStopped(frames)) {
      frames.forEach(function (frame) {
        frame.vx = 0;
        frame.vy = 0;
        frame.stopped = true;
      });
    }
    simSeparate(frames);
    steps.push(frames.map(function (frame) {
      return { x: frame.x, y: frame.y };
    }));

    return {
      steps: steps,
      frames: frames,
      stats: stats,
      duration: (steps.length - 1) * PLAN_DT
    };
  }

  function Board(canvas, options) {
    var opts = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frameW = clamp(Number(opts.frameWidth) || DEFAULT_FRAME_W, MIN_FRAME_W, MAX_FRAME_W);
    this.frameH = Math.round(this.frameW * 0.6);
    this.gap = (typeof opts.gap === 'number' && isFinite(opts.gap))
      ? clamp(opts.gap, MIN_GAP, MAX_GAP)
      : DEFAULT_GAP;
    this.ids = [];
    this.tiles = [];
    this.frames = [];
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.emptyFrames = [];
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
    this.launchPlan = null;
    this.tick = this.tick.bind(this);
    this.tickPlanned = this.tickPlanned.bind(this);
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
    this.tiles = layoutTiles(this.ids, this.gap);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.emptyFrames = [];
    this.mode = 'idle';
    this.measureIdFont();
    this.placeIdleFrames();
    this.draw();
  };

  Board.prototype.placeIdleFrames = function () {
    var w = this.frameW;
    var h = this.frameH;
    var spots = [
      { x: MARGIN, y: MARGIN },
      { x: BOARD_W - w - MARGIN, y: MARGIN },
      { x: (BOARD_W - w) / 2, y: BOARD_H - h - MARGIN }
    ];
    this.frames = spots.map(function (spot) {
      return {
        x: spot.x,
        y: spot.y,
        w: w,
        h: h,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: true
      };
    });
  };

  Board.prototype.configure = function (frameWidth, gap) {
    this.stop();
    var width = Number(frameWidth);
    var cellGap = Number(gap);
    this.frameW = clamp(isFinite(width) ? width : DEFAULT_FRAME_W, MIN_FRAME_W, MAX_FRAME_W);
    this.frameH = Math.round(this.frameW * 0.6);
    this.gap = clamp(isFinite(cellGap) ? cellGap : DEFAULT_GAP, MIN_GAP, MAX_GAP);
    this.tiles = layoutTiles(this.ids, this.gap);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.emptyFrames = [];
    this.mode = 'idle';
    this.measureIdFont();
    this.placeIdleFrames();
    this.draw();
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

  // 从框当前所在位置直接给初速度，不再瞬移到随机起点
  Board.prototype.armFrames = function () {
    if (this.frames.length !== 3) this.placeIdleFrames();

    var frictions = [0.70, 0.92, 1.14];
    for (var s = frictions.length - 1; s > 0; s -= 1) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = frictions[s];
      frictions[s] = frictions[j];
      frictions[j] = tmp;
    }

    var self = this;
    this.frames.forEach(function (frame, index) {
      frame.w = self.frameW;
      frame.h = self.frameH;
      frame.x = clamp(frame.x, 0, BOARD_W - frame.w);
      frame.y = clamp(frame.y, 0, BOARD_H - frame.h);
      var targetX = BOARD_W / 2 + rand(-190, 190);
      var targetY = BOARD_H / 2 + rand(-120, 120);
      var angle = Math.atan2(targetY - (frame.y + frame.h / 2),
        targetX - (frame.x + frame.w / 2)) + rand(-0.4, 0.4);
      var speed = rand(640, 840);
      frame.vx = Math.cos(angle) * speed;
      frame.vy = Math.sin(angle) * speed;
      frame.k = frictions[index] + rand(-0.04, 0.04);
      frame.stopped = false;
    });
  };

  Board.prototype.launch = function (ids) {
    this.stop();
    this.launchPlan = null;
    this.ids = (ids || []).slice();
    this.tiles = layoutTiles(this.ids, this.gap);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.emptyFrames = [];
    this.measureIdFont();
    this.armFrames();
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

  Board.prototype.launchPlanned = function (ids, options) {
    this.stop();
    this.ids = (ids || []).slice();
    this.tiles = layoutTiles(this.ids, this.gap);
    this.highlightIds = [];
    this.prizeLabels = ['', '', ''];
    this.emptyFrames = [];
    this.measureIdFont();

    var self = this;
    if (this.frames.length !== 3) this.placeIdleFrames();
    var startFrames = this.frames.map(function (frame) {
      return clonePlanFrame(frame, self.frameW, self.frameH);
    });
    var plan = this.findPlan(startFrames, options || {});
    this.launchPlan = plan;

    this.frames = startFrames.map(function (frame) {
      return {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: false
      };
    });
    if (plan) {
      plan.steps[0].forEach(function (position, index) {
        self.frames[index].x = position.x;
        self.frames[index].y = position.y;
      });
    }

    this.mode = 'running';
    this.startedAt = performance.now();
    this.last = this.startedAt;
    this.draw();

    return new Promise(function (resolve) {
      self.resolveLaunch = resolve;
      if (plan) {
        self.raf = global.requestAnimationFrame(self.tickPlanned);
      } else {
        self.armFrames();
        self.raf = global.requestAnimationFrame(self.tick);
      }
    });
  };

  Board.prototype.findPlan = function (startFrames, options) {
    var opts = options || {};
    var targetId = opts.targetId;
    var targetIndex = -1;
    for (var i = 0; i < this.tiles.length; i += 1) {
      if (this.tiles[i].id === targetId) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex < 0) return null;

    var maxCandidates = opts.maxCandidates || 600;
    var validate = opts.validate;
    var passes = [
      { wall: 1, frame: 1, total: 3 },
      { wall: 1, frame: 1, total: 2 },
      { wall: 0, frame: 1, total: 2 },
      { wall: 1, frame: 0, total: 1 },
      { wall: 0, frame: 0, total: 0 }
    ];
    var totalCandidates = 0;

    for (var p = 0; p < passes.length; p += 1) {
      var pass = passes[p];
      var accepted = [];
      for (var c = 0; c < maxCandidates; c += 1) {
        totalCandidates += 1;
        var params = makeLaunchParams(startFrames);
        var sim = simulateCandidate(startFrames, params, this.tiles, targetIndex);
        if (!sim.allCover || !sim.targetMax) continue;

        var totalBounces = sim.stats.wallHits + sim.stats.frameHits;
        if (totalBounces < pass.total) continue;
        if (sim.stats.wallHits < pass.wall || sim.stats.frameHits < pass.frame) continue;
        if (validate && !validate(sim.frames, this.tiles)) continue;

        accepted.push({
          params: params,
          stats: sim.stats,
          pathRatio: sim.pathRatio,
          targetRatio: sim.targetRatio
        });
        if (accepted.length >= 16) break;
      }

      if (accepted.length) {
        var normal = accepted.filter(function (item) {
          return item.targetRatio >= 0.5;
        });
        var close = accepted.filter(function (item) {
          return item.targetRatio < 0.5;
        });
        var pool = accepted;
        if (normal.length && close.length) {
          pool = Math.random() < 0.7 ? normal : close;
        } else if (normal.length) {
          pool = normal;
        } else if (close.length) {
          pool = close;
        }
        var chosen = pool[Math.floor(Math.random() * pool.length)];
        var plan = recordTrajectory(startFrames, chosen.params, this.tiles);
        plan.stats = chosen.stats;
        plan.pathRatio = chosen.pathRatio;
        plan.targetRatio = chosen.targetRatio;
        plan.candidates = totalCandidates;
        return plan;
      }
    }

    return null;
  };

  Board.prototype.tickPlanned = function (now) {
    if (this.mode !== 'running' || !this.launchPlan) return;
    var plan = this.launchPlan;
    var maxIndex = plan.steps.length - 1;
    var elapsed = (now - this.startedAt) / 1000;
    var index = elapsed / PLAN_DT;
    if (!isFinite(index) || index < 0) index = 0;

    if (index >= maxIndex) {
      var finalPositions = plan.steps[maxIndex];
      for (var i = 0; i < this.frames.length; i += 1) {
        this.frames[i].x = finalPositions[i].x;
        this.frames[i].y = finalPositions[i].y;
        this.frames[i].vx = 0;
        this.frames[i].vy = 0;
        this.frames[i].stopped = true;
      }
      this.mode = 'stopped';
      this.raf = 0;
      this.launchPlan = null;
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

    var stepIndex = Math.floor(index);
    var frac = index - stepIndex;
    var from = plan.steps[stepIndex];
    var to = plan.steps[stepIndex + 1];
    for (var k = 0; k < this.frames.length; k += 1) {
      this.frames[k].x = from[k].x + (to[k].x - from[k].x) * frac;
      this.frames[k].y = from[k].y + (to[k].y - from[k].y) * frac;
      this.frames[k].stopped = false;
    }
    this.draw();
    this.raf = global.requestAnimationFrame(this.tickPlanned);
  };

  Board.prototype.stop = function () {
    this.launchPlan = null;
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
    var w = this.frameW;
    var h = this.frameH;
    this.frames = frames.map(function (frame) {
      return {
        x: clamp(Number(frame.x) || 0, 0, BOARD_W - w),
        y: clamp(Number(frame.y) || 0, 0, BOARD_H - h),
        w: w,
        h: h,
        vx: 0,
        vy: 0,
        k: 0,
        stopped: true
      };
    });
    this.emptyFrames = [];
    this.mode = 'stopped';
    this.draw();
  };

  Board.prototype.setSelected = function (ids) {
    this.highlightIds = (ids || []).slice();
    this.draw();
  };

  Board.prototype.setEmptyFrames = function (indexes) {
    this.emptyFrames = (indexes || []).slice();
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
      var isEmpty = self.emptyFrames.indexOf(index) !== -1;
      var accent = isEmpty ? '#ff6b7f' : '#a9c6ff';

      ctx.save();
      ctx.shadowColor = isEmpty ? 'rgba(255, 107, 127, 0.28)' : 'rgba(110, 168, 254, 0.22)';
      ctx.shadowBlur = 22;
      roundedRect(ctx, x, y, frame.w, frame.h, 12);
      ctx.fillStyle = isEmpty ? 'rgba(255, 107, 127, 0.07)' : 'rgba(110, 168, 254, 0.055)';
      ctx.fill();
      ctx.restore();

      roundedRect(ctx, x, y, frame.w, frame.h, 12);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      roundedRect(ctx, x + 5, y + 5, frame.w - 10, frame.h - 10, 9);
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = isEmpty ? 'rgba(255, 107, 127, 0.32)' : 'rgba(169, 198, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      if (isEmpty) {
        var label = '框 ' + (index + 1) + ' · 空位';
        ctx.font = '700 12px ' + FONT_STACK;
        var labelWidth = ctx.measureText(label).width + 16;
        roundedRect(ctx, x + 9, y + 9, labelWidth, 24, 12);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 107, 127, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 17, y + 21.5);
      } else {
        roundedRect(ctx, x + 10, y + 10, 22, 22, 7);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(169, 198, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.font = '700 12px ' + FONT_STACK;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), x + 21, y + 21.5);
      }

      var prize = isEmpty ? '' : self.prizeLabels[index];
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
    DEFAULT_FRAME_W: DEFAULT_FRAME_W,
    DEFAULT_FRAME_H: DEFAULT_FRAME_H,
    FRAME_W: DEFAULT_FRAME_W,
    FRAME_H: DEFAULT_FRAME_H,
    MIN_FRAME_W: MIN_FRAME_W,
    MAX_FRAME_W: MAX_FRAME_W,
    DEFAULT_GAP: DEFAULT_GAP,
    MIN_GAP: MIN_GAP,
    MAX_GAP: MAX_GAP
  };
})(typeof window !== 'undefined' ? window : globalThis);
