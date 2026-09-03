/* =========================================================================
 * 数织无尽模式生成器与核心逻辑自检脚本
 * 运行：node test.js
 * 校验内容：
 *   1. 求解器正确性（已知唯一解 / 已知多解的用例）
 *   2. 尺寸与难度映射（9×9 → 12×12 → 15×15，难度单调不减）
 *   3. 图案库：每个图案在 9/12/15 三种尺寸下都合法、每行每列都有黑格；
 *      12×12 全部唯一，9×9 / 15×15 至少 16 个唯一（不唯一的由生成器跳过）
 *   4. 生成关卡：名字与图案一致、唯一解（图案严格由数字决定）、无空行空列、
 *      前几关互不相同（回归）
 *   5. 生成确定性（同一关编号 = 同一谜题）与性能基准
 *   6. 自动填充/锁定核心逻辑（正例、负例、部分正确、矛盾检测）
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
vm.runInThisContext(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), { filename: 'game.js' });
vm.runInThisContext(fs.readFileSync(path.join(dir, 'generator.js'), 'utf8'), { filename: 'generator.js' });

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
}

/* ---------- 独立段长实现（用于交叉验证） ---------- */
function independentRuns(bits, n) {
  const res = [];
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (bits[i]) cnt++;
    else if (cnt) { res.push(cnt); cnt = 0; }
  }
  if (cnt) res.push(cnt);
  return res;
}

/* ---------- 测试 1：求解器正确性 ---------- */
console.log('== 求解器正确性 ==');
{
  const heart = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  assert(countSolutionsBudget(heart, 5, 0) === 1, '爱心 5×5：唯一解（1 个）');
  const ambiguous = ['#.', '.#'];
  assert(countSolutionsBudget(ambiguous, 2, 0) === 2, '2×2 对角：两个解（2 个）');
  const fallback = fallbackLevel(30, 15).grid;
  assert(countSolutionsBudget(fallback, 15, 0) === 1, '保底下三角 15×15：唯一解');
  assert(everyLineHasBlack(fallback), '保底下三角：每行每列都有黑格');
}

/* ---------- 测试 2：尺寸与难度映射 ---------- */
console.log('== 尺寸与难度映射 ==');
assert(
  JSON.stringify([0, 9, 10, 24, 25, 99].map(sizeForLevel)) === JSON.stringify([9, 9, 12, 12, 15, 15]),
  '尺寸映射：前 10 关 9×9，11~25 关 12×12，之后 15×15'
);
{
  let mono = true;
  for (let i = 0; i < 80; i++) {
    if (difficultyForLevel(i + 1) < difficultyForLevel(i) - 1e-9) mono = false;
  }
  assert(mono, '难度系数随关卡编号单调不减');
}

/* ---------- 测试 3：图案库全量验证 ---------- */
console.log('== 图案库验证（9×9 / 12×12 / 15×15） ==');
{
  const sizes = [9, 12, 15];
  sizes.forEach((size) => {
    let uniqueCount = 0;
    SHAPES.forEach((sh) => {
      const grid = drawShape(size, sh.paint);
      const tag = sh.name + ' ' + size + '×' + size;
      assert(grid.length === size && grid.every((row) => row.length === size), tag + '：尺寸合法');
      assert(grid.every((row) => /^[.#]+$/.test(row)), tag + '：字符合法');
      assert(everyLineHasBlack(grid), tag + '：每行每列都有黑格');
      if (countSolutionsBudget(grid, size, 0) === 1) uniqueCount++;
      else assert(size !== 12, tag + '：12×12 下应唯一');
    });
    assert(uniqueCount >= 16, size + '×' + size + '：至少 16 个图案唯一（实际 ' + uniqueCount + ' 个）');
  });
  // 图案互不相同
  const seen = new Set();
  let allDiff = true;
  SHAPES.forEach((sh) => {
    const key = drawShape(9, sh.paint).join('|');
    if (seen.has(key)) allDiff = false;
    seen.add(key);
  });
  assert(allDiff, '18 个图案在 9×9 下互不相同');
}

/* ---------- 测试 4：生成关卡质量 ---------- */
console.log('== 生成关卡质量 ==');
{
  const shapeNames = SHAPES.map((s) => s.name);
  const SAMPLE = [0, 1, 2, 3, 9, 10, 17, 24, 25, 30, 49, 99, 200];
  SAMPLE.forEach((i) => {
    const tag = '第 ' + (i + 1) + ' 关';
    const lv = generateLevel(i);
    const n = lv.size;
    assert(lv.grid.length === n && lv.grid.every((row) => row.length === n), tag + '：尺寸 ' + n + '×' + n + ' 合法');
    assert(shapeNames.indexOf(lv.name) >= 0 || lv.name === '三角', tag + '：名字「' + lv.name + '」来自图案库');
    assert(everyLineHasBlack(lv.grid), tag + '：每行每列都有黑格');
    const cnt = countSolutionsBudget(lv.grid, n, 0);
    assert(cnt === 1, tag + '：唯一解（实际 ' + cnt + ' 个）');
  });

  // 回归：前几关图案必须互不相同（曾因生成失败全部落到同一保底模板）
  const seen = new Set();
  let allDiff = true;
  for (let i = 0; i < 5; i++) {
    const key = generateLevel(i).grid.join('|');
    if (seen.has(key)) allDiff = false;
    seen.add(key);
  }
  assert(allDiff, '第 1~5 关图案互不相同（回归：不再出现重复关）');
}

// 15×15 硬性要求：连续生成 20 个 15×15 关卡（含高难度干扰黑格），绝不允许空行/空列
console.log('== 15×15 空行/空列硬性检查（连续 20 关） ==');
{
  let allOk = true;
  for (let i = 25; i < 45; i++) {
    const lv = generateLevel(i);
    if (lv.size !== 15) { allOk = false; break; }
    if (!everyLineHasBlack(lv.grid)) {
      allOk = false;
      console.error('    第 ' + (i + 1) + ' 关出现空行/空列！');
    }
  }
  assert(allOk, '15×15 连续 20 关均无空行/空列');
}

/* ---------- 测试 5：确定性与性能 ---------- */
console.log('== 确定性 ==');
{
  const a = generateLevel(12);
  const b = generateLevel(12);
  assert(JSON.stringify(a.grid) === JSON.stringify(b.grid) && a.name === b.name && a.size === b.size, '第 13 关重复生成结果一致');
}

console.log('== 生成性能基准（每关耗时） ==');
{
  const SAMPLE = [0, 9, 10, 24, 25, 30, 49, 99, 200, 400];
  let slow = false;
  SAMPLE.forEach((i) => {
    const t0 = Date.now();
    const lv = generateLevel(i);
    const ms = Date.now() - t0;
    if (ms > 3000) slow = true;
    console.log('  第 ' + (i + 1) + ' 关（' + lv.size + '×' + lv.size + '「' + lv.name + '」）：' + ms + 'ms');
  });
  assert(!slow, '所有抽样关卡生成耗时 < 3000ms');
}

/* ---------- 测试 6：提示计算交叉验证 ---------- */
console.log('== 提示计算 ==');
[0, 10, 30].forEach((i) => {
  const lv = generateLevel(i);
  const n = lv.size;
  const clues = computeClues(lv.grid);
  const tag = '第 ' + (i + 1) + ' 关';
  for (let r = 0; r < n; r++) {
    const bits = lv.grid[r].split('').map((ch) => (ch === '#' ? 1 : 0));
    assert(JSON.stringify(clues.rows[r]) === JSON.stringify(independentRuns(bits, n)), tag + '：第 ' + (r + 1) + ' 行提示');
  }
  for (let c = 0; c < n; c++) {
    const bits = [];
    for (let r = 0; r < n; r++) bits.push(lv.grid[r][c] === '#' ? 1 : 0);
    assert(JSON.stringify(clues.cols[c]) === JSON.stringify(independentRuns(bits, n)), tag + '：第 ' + (c + 1) + ' 列提示');
  }
});

/* ---------- 测试 7：自动填充核心逻辑 ---------- */
console.log('== 自动填充核心逻辑 ==');

// 正例：完全按答案涂黑 → 全部行/列完成、全部锁定、白色自动补全
[0, 10, 30].forEach((i) => {
  const lv = generateLevel(i);
  const n = lv.size;
  const sol = solutionArray(lv);
  const cells = new Uint8Array(sol);
  const locked = new Uint8Array(n * n);
  const rowSolved = new Array(n).fill(false);
  const colSolved = new Array(n).fill(false);
  let guard = 0;
  while (autoFillOnce(cells, locked, rowSolved, colSolved, sol, n) > 0) {
    if (++guard > 10 * n) break;
  }
  const blacksOk = Array.from(cells).every((v, k) => (sol[k] === 1 ? v === 1 : v === 2));
  assert(
    rowSolved.every(Boolean) && Array.from(locked).every((v) => v === 1) && blacksOk,
    '第 ' + (i + 1) + ' 关：按答案涂黑后全部锁定且白色自动补全'
  );
});

// 负例：错放黑格不应触发任何自动填充
{
  const lv = generateLevel(0);
  const n = lv.size;
  const sol = solutionArray(lv);
  const cells = new Uint8Array(n * n);
  const firstWhite = sol.indexOf(0);
  cells[firstWhite] = 1; // 答案空白处画黑 = 错误
  const locked = new Uint8Array(n * n);
  const rowSolved = new Array(n).fill(false);
  const colSolved = new Array(n).fill(false);
  autoFillOnce(cells, locked, rowSolved, colSolved, sol, n);
  assert(
    rowSolved.every((v) => !v) && Array.from(locked).every((v) => v === 0),
    '负例：错放黑格不会触发自动填充'
  );
}

// 部分正确：某行黑格全部画对 → 该行自动补白并锁定
{
  const house = ['..#...', '.###..', '#####.', '.###..', '.###..', '..#...'];
  const n = house.length;
  const sol = solutionArray({ size: n, grid: house });
  const cells = new Uint8Array(n * n);
  const r = 2; // 房子第 3 行 '#####.'，5 个黑格
  for (let c = 0; c < n; c++) if (sol[r * n + c] === 1) cells[r * n + c] = 1;
  const locked = new Uint8Array(n * n);
  const rowSolved = new Array(n).fill(false);
  const colSolved = new Array(n).fill(false);
  autoFillOnce(cells, locked, rowSolved, colSolved, sol, n);
  assert(rowSolved[r], '部分正确：第 3 行黑格画对后被判定完成');
  let whitesOk = true;
  for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (sol[i] === 0 && (cells[i] !== 2 || locked[i] !== 1)) whitesOk = false;
  }
  assert(whitesOk, '部分正确：该行空白格被自动填充为白色并锁定');
}

// 矛盾检测：错黑 / 错白都会让提示变红
{
  const heart = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  const n = heart.length;
  const sol = solutionArray({ size: n, grid: heart });
  const cells = new Uint8Array(n * n);
  cells[0] = 1; // 答案第 1 格是白，涂黑 → 矛盾
  assert(rowHasErrorState(0, cells, sol, n), '矛盾检测：黑格画在空白处报错（行）');
  assert(colHasErrorState(0, cells, sol, n), '矛盾检测：黑格画在空白处报错（列）');
  cells[0] = 0;
  const blackIdx = sol.indexOf(1);
  cells[blackIdx] = 2; // 答案黑格被标白 → 矛盾
  assert(rowHasErrorState(Math.floor(blackIdx / n), cells, sol, n), '矛盾检测：白格标在黑格处报错（行）');
}

/* ---------- 测试 8：错误计数 / 提示选格 / 问号标记 ---------- */
console.log('== 错误计数 / 提示选格 / 问号标记 ==');
{
  // 错误计数：黑画在白处 +1，白标在黑处 +1，问号(3)不计错
  const heart = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  const n = heart.length;
  const sol = solutionArray({ size: n, grid: heart });
  const cells = new Uint8Array(n * n);
  assert(countErrorsState(cells, sol, n) === 0, '错误计数：空盘为 0');
  cells[0] = 1;            // 答案白处画黑（heart 第 1 格是 '.'）
  cells[1] = 2;            // 答案黑处标白（heart 第 2 格是 '#'）
  cells[2] = 3;            // 问号标在第 3 格（'.'），不计错
  assert(countErrorsState(cells, sol, n) === 2, '错误计数：黑/白标错各计 1，问号不计');
}
{
  // 提示选格：优先提示"该填黑却未填"的格子；全部正确后无可提示
  const heart = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  const n = heart.length;
  const sol = solutionArray({ size: n, grid: heart });
  const locked = new Uint8Array(n * n);
  const cells = new Uint8Array(n * n);
  const firstBlack = sol.indexOf(1);
  assert(pickHintCell(cells, sol, locked, n) === firstBlack, '提示选格：空盘优先提示第一个黑格');
  cells[firstBlack] = 1;
  const second = sol.indexOf(1, firstBlack + 1);
  assert(pickHintCell(cells, sol, locked, n) === second, '提示选格：继续提示下一个未填黑格');
  // 黑格全填 + 白格全标（cells: 黑=1 白=2）→ 全部确定，无可提示
  const full = new Uint8Array(n * n);
  for (let i = 0; i < full.length; i++) full[i] = sol[i] === 1 ? 1 : 2;
  assert(pickHintCell(full, sol, locked, n) === -1, '提示选格：全部格子确定后无可提示');
  // 锁定格不可被提示
  const locked2 = new Uint8Array(n * n);
  locked2.fill(1);
  assert(pickHintCell(cells, sol, locked2, n) === -1, '提示选格：全部锁定后无可提示');
}
{
  // 问号标记：标在答案白处不阻塞行完成，且自动补白会覆盖问号；标在答案黑处则阻塞
  const heart = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  const n = heart.length;
  const sol = solutionArray({ size: n, grid: heart });
  // 场景 A：第 2 行(全黑) 的黑格全填对，行内留空问号于……全黑行无白格；改用爱心第 1 行 .#.#.
  const cellsA = new Uint8Array(n * n);
  const r0 = 0;
  for (let c = 0; c < n; c++) if (sol[r0 * n + c] === 1) cellsA[r0 * n + c] = 1;
  for (let c = 0; c < n; c++) if (sol[r0 * n + c] === 0) cellsA[r0 * n + c] = 3; // 白格全标问号
  const lockedA = new Uint8Array(n * n);
  const rowA = new Array(n).fill(false);
  const colA = new Array(n).fill(false);
  autoFillOnce(cellsA, lockedA, rowA, colA, sol, n);
  assert(rowA[r0], '问号标记：答案白处的问号不阻塞行完成');
  let overwritten = true;
  for (let c = 0; c < n; c++) {
    const i = r0 * n + c;
    if (sol[i] === 0 && cellsA[i] !== 2) overwritten = false;
  }
  assert(overwritten, '问号标记：自动补白把问号覆盖为白色');
  // 场景 B：答案黑处标问号 → 该行不完成
  const cellsB = new Uint8Array(n * n);
  cellsB[firstBlackOf(heart, n)] = 3;
  const lockedB = new Uint8Array(n * n);
  const rowB = new Array(n).fill(false);
  const colB = new Array(n).fill(false);
  autoFillOnce(cellsB, lockedB, rowB, colB, sol, n);
  assert(!rowB[Math.floor(firstBlackOf(heart, n) / n)], '问号标记：答案黑处的问号阻塞该行完成');
}
function firstBlackOf(grid, n) {
  return solutionArray({ size: n, grid: grid }).indexOf(1);
}

console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail > 0 ? 1 : 0);
