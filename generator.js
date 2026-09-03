/* =========================================================================
 * 数织（Nonogram）无尽模式关卡生成器
 *  - 纯函数，无 DOM 依赖
 *  - 关卡 = 程序化绘制的真实图案（名字与图案一致），保证唯一解（图案严格由数字决定）
 *  - 同一关卡编号始终生成同一谜题（种子随机），通关后重玩图案不变
 *  - 尺寸随关卡推进：9×9 → 12×12 → 15×15，难度递增
 *    · 每个尺寸阶段内按图案复杂度从易到难排列
 *  - 所有尺寸（含 15×15）保证每一行、每一列都至少有一个黑格
 * ========================================================================= */

/* ----------------------------- 种子随机数 ----------------------------- */
// mulberry32：轻量、可复现的 32 位种子 PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 关卡编号 → 种子（保证同一关永远生成同一谜题）
function seedForLevel(levelIndex) {
  return (Math.imul(levelIndex + 1, 2654435761) ^ 0x9E3779B9) >>> 0;
}

/* ----------------------------- 难度配置 ----------------------------- */

// 关卡编号 → 棋盘大小：前 10 关 9×9，11~25 关 12×12，之后 15×15（无尽）
function sizeForLevel(levelIndex) {
  if (levelIndex < 10) return 9;
  if (levelIndex < 25) return 12;
  return 15;
}

// 关卡编号 → 难度系数 0..1（用于选关界面星级显示，全程单调不减）
function difficultyForLevel(levelIndex) {
  if (levelIndex < 10) return (levelIndex / 9) * 0.5;
  if (levelIndex < 25) return 0.5 + ((levelIndex - 10) / 14) * 0.35;
  return Math.min(0.98, 0.85 + ((levelIndex - 25) / 60) * 0.13);
}

/* ----------------------------- 图案库 ----------------------------- */
// 每个图案 = {name, paint(x, y)}，x、y 为归一化坐标 [0,1]
// 所有图案都横跨/纵贯整个画布，保证任意尺寸下每行每列都有黑格

// 基础几何判定
function inCircle(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}
function inEllipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx, dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
function inRect(px, py, x0, y0, x1, y1) {
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}
function inPoly(px, py, pts) {
  // 射线法（even-odd）
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SHAPES = [
  {
    name: '爱心',
    paint(x, y) {
      return inCircle(x, y, 0.32, 0.26, 0.3)
        || inCircle(x, y, 0.68, 0.26, 0.3)
        || inPoly(x, y, [[0.5, 1.0], [-0.06, 0.44], [1.06, 0.44]]);
    },
  },
  {
    name: '五角星',
    paint(x, y) {
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const a1 = a0 + Math.PI / 5;
        pts.push([0.5 + 0.65 * Math.cos(a0), 0.5 + 0.65 * Math.sin(a0)]);
        pts.push([0.5 + 0.25 * Math.cos(a1), 0.5 + 0.25 * Math.sin(a1)]);
      }
      return inPoly(x, y, pts);
    },
  },
  {
    name: '小房子',
    paint(x, y) {
      const roof = inPoly(x, y, [[0.5, 0.0], [-0.05, 0.44], [1.05, 0.44]]);
      const body = inRect(x, y, 0.05, 0.44, 0.95, 0.98);
      const door = inRect(x, y, 0.42, 0.66, 0.58, 0.98);
      return roof || (body && !door);
    },
  },
  {
    name: '圣诞树',
    paint(x, y) {
      return inPoly(x, y, [[0.5, 0.0], [0.14, 0.34], [0.86, 0.34]])
        || inPoly(x, y, [[0.5, 0.26], [0.1, 0.62], [0.9, 0.62]])
        || inPoly(x, y, [[0.5, 0.5], [-0.09, 0.92], [1.09, 0.92]])
        || inRect(x, y, 0.43, 0.88, 0.57, 0.99);
    },
  },
  {
    name: '小鱼',
    paint(x, y) {
      const body = inEllipse(x, y, 0.5, 0.5, 0.48, 0.5);
      const tail = inPoly(x, y, [[0.05, 0.5], [0.0, 0.06], [0.0, 0.94]]);
      const eye = inCircle(x, y, 0.62, 0.36, 0.06);
      return (body || tail) && !eye;
    },
  },
  {
    name: '小船',
    paint(x, y) {
      const hull = inEllipse(x, y, 0.5, 0.84, 0.5, 0.16) && y >= 0.68;
      const mast = inRect(x, y, 0.44, 0.0, 0.56, 0.74);
      const flag = inPoly(x, y, [[0.53, 0.0], [0.53, 0.16], [0.95, 0.08]]);
      const sail = inPoly(x, y, [[0.53, 0.12], [0.98, 0.5], [0.53, 0.5]]);
      return hull || mast || flag || sail;
    },
  },
  {
    name: '雨伞',
    paint(x, y) {
      const dome = inEllipse(x, y, 0.5, 0.42, 0.52, 0.4) && y <= 0.42;
      const handle = inRect(x, y, 0.44, 0.42, 0.56, 0.98);
      const hook = inRect(x, y, 0.44, 0.88, 0.97, 0.98);
      return dome || handle || hook;
    },
  },
  {
    name: '雪人',
    paint(x, y) {
      const b1 = inCircle(x, y, 0.5, 0.78, 0.48);
      const b2 = inCircle(x, y, 0.5, 0.44, 0.3);
      const b3 = inCircle(x, y, 0.5, 0.16, 0.17);
      const hat = inRect(x, y, 0.42, 0.0, 0.58, 0.06) || inRect(x, y, 0.34, 0.06, 0.66, 0.1);
      const eye1 = inCircle(x, y, 0.44, 0.13, 0.045);
      const eye2 = inCircle(x, y, 0.56, 0.13, 0.045);
      return (b1 || b2 || b3 || hat) && !eye1 && !eye2;
    },
  },
  {
    name: '火箭',
    paint(x, y) {
      const nose = inPoly(x, y, [[0.5, 0.0], [0.24, 0.24], [0.76, 0.24]]);
      const body = inRect(x, y, 0.32, 0.24, 0.68, 0.72);
      const window = inCircle(x, y, 0.5, 0.46, 0.07);
      const finL = inRect(x, y, 0.0, 0.58, 0.34, 0.92);
      const finR = inRect(x, y, 0.66, 0.58, 1.0, 0.92);
      const flame = inCircle(x, y, 0.5, 0.9, 0.17) && y >= 0.72;
      return (nose || body || finL || finR || flame) && !window;
    },
  },
  {
    name: '钻石',
    paint(x, y) {
      const dx = Math.abs(x - 0.5), dy = Math.abs(y - 0.5);
      // 实心钻石 + 三个不对称孔洞（打破对称、保证唯一解）
      return dx + dy <= 0.5
        && !inCircle(x, y, 0.42, 0.42, 0.06)
        && !inCircle(x, y, 0.58, 0.5, 0.05)
        && !inCircle(x, y, 0.5, 0.62, 0.06);
    },
  },
  {
    name: '花朵',
    paint(x, y) {
      if (inCircle(x, y, 0.5, 0.5, 0.15)) return true;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        if (inCircle(x, y, 0.5 + 0.28 * Math.cos(a), 0.5 + 0.28 * Math.sin(a), 0.22)) return true;
      }
      return false;
    },
  },
  {
    name: '蘑菇',
    paint(x, y) {
      const cap = inEllipse(x, y, 0.5, 0.32, 0.52, 0.3) && y <= 0.32;
      const stem = inRect(x, y, 0.42, 0.32, 0.58, 0.98);
      const s1 = inCircle(x, y, 0.34, 0.2, 0.05);
      const s2 = inCircle(x, y, 0.62, 0.26, 0.05);
      return (cap || stem) && !s1 && !s2;
    },
  },
  {
    name: '幽灵',
    paint(x, y) {
      const head = inCircle(x, y, 0.5, 0.36, 0.47);
      const body = inRect(x, y, 0.03, 0.36, 0.97, 0.97);
      const n1 = inCircle(x, y, 0.28, 0.98, 0.09);
      const n2 = inCircle(x, y, 0.5, 1.01, 0.09);
      const n3 = inCircle(x, y, 0.72, 0.98, 0.09);
      const e1 = inCircle(x, y, 0.42, 0.3, 0.055);
      const e2 = inCircle(x, y, 0.58, 0.3, 0.055);
      return (head || body) && !n1 && !n2 && !n3 && !e1 && !e2;
    },
  },
  {
    name: '月亮',
    paint(x, y) {
      const moon = inCircle(x, y, 0.5, 0.5, 0.5);
      const c1 = inCircle(x, y, 0.4, 0.36, 0.05);
      const c2 = inCircle(x, y, 0.62, 0.58, 0.045);
      return moon && !c1 && !c2;
    },
  },
  {
    name: '太阳',
    paint(x, y) {
      // 圆脸（眼睛 + 微笑的孔洞）打破对称；光线末端带横杠
      if (inCircle(x, y, 0.5, 0.5, 0.2) && !inCircle(x, y, 0.4, 0.45, 0.07)
        && !inCircle(x, y, 0.6, 0.45, 0.07)
        && !(inCircle(x, y, 0.5, 0.56, 0.1) && y >= 0.56)) return true;
      return inRect(x, y, 0.44, 0.0, 0.56, 0.26)
        || inRect(x, y, 0.44, 0.74, 0.56, 1.0)
        || inRect(x, y, 0.0, 0.44, 0.26, 0.56)
        || inRect(x, y, 0.74, 0.44, 1.0, 0.56)
        || inRect(x, y, 0.36, 0.0, 0.64, 0.08)
        || inRect(x, y, 0.36, 0.92, 0.64, 1.0)
        || inRect(x, y, 0.0, 0.36, 0.08, 0.64)
        || inRect(x, y, 0.92, 0.36, 1.0, 0.64)
        || inRect(x, y, 0.18, 0.18, 0.32, 0.32)
        || inRect(x, y, 0.68, 0.18, 0.82, 0.32)
        || inRect(x, y, 0.18, 0.68, 0.32, 0.82)
        || inRect(x, y, 0.68, 0.68, 0.82, 0.82);
    },
  },
  {
    name: '蝴蝶',
    paint(x, y) {
      const wL = inEllipse(x, y, 0.28, 0.5, 0.26, 0.48);
      const wR = inEllipse(x, y, 0.72, 0.5, 0.26, 0.48);
      const body = inEllipse(x, y, 0.5, 0.5, 0.05, 0.48);
      const hL = inCircle(x, y, 0.28, 0.5, 0.08);
      const hR = inCircle(x, y, 0.72, 0.5, 0.08);
      const antL = inRect(x, y, 0.35, 0.02, 0.41, 0.2);
      const antR = inRect(x, y, 0.59, 0.02, 0.65, 0.2);
      return (wL || wR || body || antL || antR) && !hL && !hR;
    },
  },
  {
    name: '皇冠',
    paint(x, y) {
      const base = inRect(x, y, 0.04, 0.62, 0.96, 0.98);
      const s1 = inPoly(x, y, [[0.0, 0.66], [0.08, 0.2], [0.32, 0.62]]);
      const s2 = inPoly(x, y, [[0.4, 0.62], [0.5, 0.06], [0.6, 0.62]]);
      const s3 = inPoly(x, y, [[0.68, 0.62], [0.92, 0.2], [1.0, 0.66]]);
      const b1 = inCircle(x, y, 0.08, 0.16, 0.075);
      const b2 = inCircle(x, y, 0.5, 0.04, 0.06);
      const b3 = inCircle(x, y, 0.92, 0.16, 0.075);
      const mark = inCircle(x, y, 0.68, 0.78, 0.05); // 非对称小标记，保证唯一解
      return (base || s1 || s2 || s3 || b1 || b2 || b3) && !mark;
    },
  },
  {
    name: '雨滴',
    paint(x, y) {
      const body = inCircle(x, y, 0.5, 0.62, 0.36);
      const tip = inPoly(x, y, [[0.5, 0.0], [-0.05, 0.44], [1.05, 0.44]]);
      const bubble = inCircle(x, y, 0.5, 0.72, 0.06);
      return (body || tip) && !bubble;
    },
  },
];

// 按归一化坐标绘制图案
function drawShape(n, paint) {
  const rows = [];
  for (let j = 0; j < n; j++) {
    let row = '';
    for (let i = 0; i < n; i++) {
      row += paint((i + 0.5) / n, (j + 0.5) / n) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

/* ----------------------------- 回溯求解器（生成校验与自检） ----------------------------- */
// 生成关卡要求唯一解：保证图案严格由行列数字决定（不唯一则跳过该图案换下一个）

// 一行提示的所有可能摆法（位掩码，第 c 位 = 第 c 列）
function placements(n, runs) {
  if (runs.length === 0) return [0];
  const res = [];
  const k = runs.length;
  const suffix = runs.map((_, i) => runs.slice(i).reduce((a, b) => a + b, 0) + (k - 1 - i));
  const starts = [];
  function rec(i, minStart) {
    if (i === k) {
      let m = 0;
      for (let j = 0; j < k; j++) {
        for (let b = starts[j]; b < starts[j] + runs[j]; b++) m |= 1 << b;
      }
      res.push(m);
      return;
    }
    for (let s = minStart; s <= n - suffix[i]; s++) {
      starts.push(s);
      rec(i + 1, s + runs[i] + 1);
      starts.pop();
    }
  }
  rec(0, 0);
  return res;
}

// 统计解的数量（最多数到 2 个即停）
//  - maxChecks > 0：候选尝试预算，超出抛 SOLVER_BUDGET（由调用方决定是否重试）
//  - 返回 -1 表示预算耗尽
//  - 行按候选数从少到多处理（MRV 启发式）；列的摆法掩码同步按处理顺序重排，
//    新掩码第 k 位 = 原掩码第 order[k] 位（即第 k 个被处理的行），与 fixed 的位序一致
function countSolutionsBudget(grid, n, maxChecks) {
  const clues = computeClues(grid);
  const rowOpts = clues.rows.map((runs) => placements(n, runs));
  const colOpts = clues.cols.map((runs) => placements(n, runs));
  const order = rowOpts.map((_, r) => r).sort((a, b) => rowOpts[a].length - rowOpts[b].length);
  const colOptsPerm = colOpts.map((opts) =>
    opts.map((m2) => {
      let p = 0;
      for (let k = 0; k < n; k++) p |= ((m2 >>> order[k]) & 1) << k;
      return p;
    })
  );
  const fixed = new Array(n).fill(0);
  let count = 0;
  let checks = 0;
  function dfs(r) {
    if (count > 1) return;
    if (r === n) { count++; return; }
    const fullMask = (1 << (r + 1)) - 1;
    const origRow = order[r];
    for (const m of rowOpts[origRow]) {
      if (maxChecks > 0 && ++checks > maxChecks) throw new Error('SOLVER_BUDGET');
      let ok = true;
      for (let c = 0; c < n; c++) {
        const target = fixed[c] | (((m >>> c) & 1) << r);
        if (!colOptsPerm[c].some((m2) => (m2 & fullMask) === target)) { ok = false; break; }
      }
      if (!ok) continue;
      for (let c = 0; c < n; c++) fixed[c] |= (((m >>> c) & 1) << r);
      dfs(r + 1);
      for (let c = 0; c < n; c++) fixed[c] &= ~(((m >>> c) & 1) << r);
    }
  }
  try {
    dfs(0);
  } catch (e) {
    if (e && e.message === 'SOLVER_BUDGET') return -1;
    throw e;
  }
  return count;
}

/* ----------------------------- 网格生成 ----------------------------- */

// 每行每列是否都至少有一个黑格（15×15 硬性要求，全部尺寸统一保证）
function everyLineHasBlack(grid) {
  const n = grid.length;
  for (let r = 0; r < n; r++) {
    let has = false;
    for (let c = 0; c < n; c++) if (grid[r][c] === '#') { has = true; break; }
    if (!has) return false;
  }
  for (let c = 0; c < n; c++) {
    let has = false;
    for (let r = 0; r < n; r++) if (grid[r][c] === '#') { has = true; break; }
    if (!has) return false;
  }
  return true;
}

// 行/列提示的平均段数（用于图案难度排序）
function avgRunCount(grid) {
  const clues = computeClues(grid);
  let total = 0;
  for (const runs of clues.rows) total += runs.length;
  for (const runs of clues.cols) total += runs.length;
  return total / (2 * grid.length);
}

// 图案按该尺寸下的难度（平均段数）从易到难排序（按尺寸缓存）
const _complexityCache = {};
function shapesSortedByComplexity(size) {
  if (_complexityCache[size]) return _complexityCache[size];
  const scored = SHAPES.map((sh) => ({ sh: sh, score: avgRunCount(drawShape(size, sh.paint)) }));
  scored.sort((a, b) => a.score - b.score);
  _complexityCache[size] = scored.map((s) => s.sh);
  return _complexityCache[size];
}

// 保底模板：下三角（可证明唯一解，且每行每列都有黑格）
function fallbackLevel(levelIndex, size) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    let row = '';
    for (let c = 0; c < size; c++) row += c <= r ? '#' : '.';
    grid.push(row);
  }
  return { levelIndex, size, name: '三角', grid };
}

// 生成第 levelIndex 关（确定性：同一编号永远同一谜题）
// 图案必须严格符合行列数字：求解器验证唯一解，不唯一则按种子顺序换图案重试
function generateLevel(levelIndex) {
  const size = sizeForLevel(levelIndex);
  const rng = mulberry32(seedForLevel(levelIndex));
  const stageStart = levelIndex < 10 ? 0 : levelIndex < 25 ? 10 : 25;
  const ordered = shapesSortedByComplexity(size);
  const baseIdx = (levelIndex - stageStart) % ordered.length;
  // 可复现的尝试顺序：先主选图案，再按种子洗牌后的其余图案
  const order = [];
  for (let i = 0; i < ordered.length; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  const tryOrder = [baseIdx].concat(order.filter((v) => v !== baseIdx));
  for (const idx of tryOrder) {
    const sh = ordered[idx];
    const grid = drawShape(size, sh.paint);
    if (!everyLineHasBlack(grid)) continue;
    if (countSolutionsBudget(grid, size, 60000) === 1) {
      return { levelIndex, size, name: sh.name, grid };
    }
  }
  return fallbackLevel(levelIndex, size);
}
