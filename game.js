/* =========================================================================
 * 数织（Nonogram）小游戏
 *  - 核心逻辑为纯函数，不依赖 DOM，可直接用 node test.js 测试
 *  - UI 部分仅在浏览器环境中初始化
 *  - 格子状态：0 = 空白，1 = 黑格，2 = 白格（标记空白）
 * ========================================================================= */

/* ----------------------------- 核心逻辑 ----------------------------- */

// 计算一行字符串的连续黑格段长（'#' 黑格，'.' 空白）
function runLengths(rowStr) {
  const res = [];
  let count = 0;
  for (let i = 0; i < rowStr.length; i++) {
    if (rowStr[i] === '#') count++;
    else if (count) { res.push(count); count = 0; }
  }
  if (count) res.push(count);
  return res;
}

// 由网格字符串计算全部行/列提示
function computeClues(grid) {
  const n = grid.length;
  const rows = grid.map(runLengths);
  const cols = [];
  for (let c = 0; c < n; c++) {
    const runs = [];
    let count = 0;
    for (let r = 0; r < n; r++) {
      if (grid[r][c] === '#') count++;
      else if (count) { runs.push(count); count = 0; }
    }
    if (count) runs.push(count);
    cols.push(runs);
  }
  return { rows, cols };
}

// 网格字符串 → 0/1 平面数组（1 = 黑格）
function solutionArray(lv) {
  const n = lv.size;
  const sol = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) sol[r * n + c] = lv.grid[r][c] === '#' ? 1 : 0;
  }
  return sol;
}

// 某行/某列：玩家黑格集合是否与答案黑格完全一致
function rowMatchesState(r, cells, solution, n) {
  for (let c = 0; c < n; c++) {
    if ((cells[r * n + c] === 1) !== (solution[r * n + c] === 1)) return false;
  }
  return true;
}
function colMatchesState(c, cells, solution, n) {
  for (let r = 0; r < n; r++) {
    if ((cells[r * n + c] === 1) !== (solution[r * n + c] === 1)) return false;
  }
  return true;
}

// 某行/某列：是否存在矛盾（黑格画在空白处，或白格标在黑格处）
function rowHasErrorState(r, cells, solution, n) {
  for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if ((cells[i] === 1 && solution[i] === 0) || (cells[i] === 2 && solution[i] === 1)) return true;
  }
  return false;
}
function colHasErrorState(c, cells, solution, n) {
  for (let r = 0; r < n; r++) {
    const i = r * n + c;
    if ((cells[i] === 1 && solution[i] === 0) || (cells[i] === 2 && solution[i] === 1)) return true;
  }
  return false;
}

// 行/列完全正确：锁定整行/列，并把非黑格自动填充为白色（2）
function lockRowWhites(r, cells, locked, n) {
  for (let c = 0; c < n; c++) {
    const i = r * n + c;
    locked[i] = 1;
    if (cells[i] !== 1) cells[i] = 2;
  }
}
function lockColWhites(c, cells, locked, n) {
  for (let r = 0; r < n; r++) {
    const i = r * n + c;
    locked[i] = 1;
    if (cells[i] !== 1) cells[i] = 2;
  }
}

// 一轮自动填充：找出所有黑格已完全正确的行/列并锁定补白，返回新增数量
function autoFillOnce(cells, locked, rowSolved, colSolved, solution, n) {
  let solved = 0;
  for (let r = 0; r < n; r++) {
    if (!rowSolved[r] && rowMatchesState(r, cells, solution, n)) {
      rowSolved[r] = true;
      lockRowWhites(r, cells, locked, n);
      solved++;
    }
  }
  for (let c = 0; c < n; c++) {
    if (!colSolved[c] && colMatchesState(c, cells, solution, n)) {
      colSolved[c] = true;
      lockColWhites(c, cells, locked, n);
      solved++;
    }
  }
  return solved;
}

// 错误格子数：黑格画在空白处 或 白格标在黑格处（问号不算错）
function countErrorsState(cells, solution, n) {
  let e = 0;
  for (let i = 0; i < n * n; i++) {
    if ((cells[i] === 1 && solution[i] === 0) || (cells[i] === 2 && solution[i] === 1)) e++;
  }
  return e;
}

// 提示选格：优先找该填黑却未填（空白/问号）的格子，其次找未确定的空白格；无可提示返回 -1
function pickHintCell(cells, solution, locked, n) {
  for (let i = 0; i < n * n; i++) {
    if (!locked[i] && solution[i] === 1 && cells[i] !== 1) return i;
  }
  for (let i = 0; i < n * n; i++) {
    if (!locked[i] && solution[i] === 0 && cells[i] !== 2) return i;
  }
  return -1;
}

/* ----------------------------- 浏览器 UI ----------------------------- */
// Beta 版：显示全部关卡，可自由选择游玩（不按顺序解锁）
// 关卡由 generator.js 的 generateLevel() 自动生成（确定性种子）
const SAVE_KEY = 'nonogram-beta-v1';
const TOTAL_LEVELS = 60; // Beta 版关卡总数（1~10 关 9×9，11~25 关 12×12，26~60 关 15×15）

const UI = {};          // DOM 引用，initGame() 中填充
let state = null;       // 当前关卡状态
let painting = false;   // 是否正在拖拽涂色
let timerStart = null;
let timerInterval = null;
let toastTimer = null;

function initGame() {
  Object.assign(UI, {
    menuScreen: document.querySelector('#menu'),
    gameScreen: document.querySelector('#game'),
    levelListEl: document.querySelector('#level-list'),
    boardEl: document.querySelector('#board'),
    levelTitle: document.querySelector('#level-title'),
    timerEl: document.querySelector('#timer'),
    leftCountEl: document.querySelector('#left-count'),
    errCountEl: document.querySelector('#err-count'),
    progressTextEl: document.querySelector('#progress-text'),
    progressFillEl: document.querySelector('#progress-fill'),
    toastEl: document.querySelector('#toast'),
    modalEl: document.querySelector('#modal'),
    modalTextEl: document.querySelector('#modal-text'),
    btnNext: document.querySelector('#btn-next'),
    btnMenu: document.querySelector('#btn-menu'),
    btnBack: document.querySelector('#btn-back'),
    btnRestart: document.querySelector('#btn-restart'),
    btnHint: document.querySelector('#btn-hint'),
    btnReset: document.querySelector('#btn-reset-progress'),
  });
  const saved = loadProgress();
  UI.completed = saved.completed; // 已通关关卡 [{idx, name, size}]（名字通关后才记录）

  UI.btnBack.addEventListener('click', toMenu);
  UI.btnRestart.addEventListener('click', () => { hideModal(); if (state) startLevel(state.idx); });
  UI.btnHint.addEventListener('click', applyHint);
  UI.btnNext.addEventListener('click', () => { hideModal(); if (state) startLevel(state.idx + 1); });
  UI.btnMenu.addEventListener('click', () => { hideModal(); toMenu(); });
  UI.btnReset.addEventListener('click', () => {
    if (confirm('确定要重置全部通关进度吗？')) {
      UI.completed = [];
      saveProgress();
      renderMenu();
    }
  });

  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state) return;
      state.tool = btn.dataset.tool;
      updateToolbar();
    });
  });

  window.addEventListener('keydown', (e) => {
    if (!state) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'h') { applyHint(); return; }
    const map = { '1': 'black', '2': 'white', '3': 'erase', '4': 'question', b: 'black', w: 'white', e: 'erase', q: 'question' };
    const t = map[key];
    if (t) { state.tool = t; updateToolbar(); }
  });

  window.addEventListener('resize', debounce(() => {
    if (!state) return;
    buildBoard();
    refreshAllCells();
    updateClueStyles();
    updateProgress();
  }, 200));

  // 点击 / 拖拽涂色
  const board = UI.boardEl;
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('pointerdown', (e) => {
    if (!state || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    painting = true;
    applyAt(e);
  });
  window.addEventListener('pointermove', (e) => { if (painting) applyAt(e); });
  window.addEventListener('pointerup', endPaint);
  window.addEventListener('pointercancel', endPaint);

  renderMenu();
}

/* ----------------------------- 选关界面（Beta：全部关卡自由选择） ----------------------------- */

function renderMenu() {
  const el = UI.levelListEl;
  el.innerHTML = '';
  // 按尺寸分组：9×9 / 12×12 / 15×15
  const groups = [
    { size: 9, from: 0, to: Math.min(10, TOTAL_LEVELS) },
    { size: 12, from: 10, to: Math.min(25, TOTAL_LEVELS) },
    { size: 15, from: 25, to: TOTAL_LEVELS },
  ];
  groups.forEach((g) => {
    if (g.from >= g.to) return;
    const header = document.createElement('div');
    header.className = 'level-group-title';
    header.textContent = g.size + ' × ' + g.size + ' 关卡（第 ' + (g.from + 1) + ' ~ ' + g.to + ' 关）';
    el.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let i = g.from; i < g.to; i++) grid.appendChild(levelCard(i));
    el.appendChild(grid);
  });
}

// 单个关卡卡片（自由选择，点击即玩；名字通关后才揭晓）
function levelCard(i) {
  const done = UI.completed[i];
  const stars = 1 + Math.floor(difficultyForLevel(i) * 4.999);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'level-card' + (done ? ' done' : '');
  card.innerHTML =
    '<div class="lc-num">' + (i + 1) + '</div>' +
    '<div class="lc-name">' + (done ? done.name : '？？？') + '</div>' +
    '<div class="lc-size">' + sizeForLevel(i) + ' × ' + sizeForLevel(i) + '</div>' +
    '<div class="lc-stars">' + '★'.repeat(stars) + '☆'.repeat(5 - stars) + '</div>' +
    '<div class="lc-status">' + (done ? '✓ 已通关' : '▶ 游玩') + '</div>';
  card.addEventListener('click', () => startLevel(i));
  return card;
}

function toMenu() {
  stopTimer();
  painting = false;
  state = null;
  hideModal();
  UI.gameScreen.classList.remove('active');
  UI.menuScreen.classList.add('active');
  renderMenu();
}

/* ----------------------------- 开局与棋盘 ----------------------------- */

function startLevel(idx) {
  const lv = generateLevel(idx); // 自动生成（确定性：同一编号同一谜题）
  if (!lv) return;
  const n = lv.size;
  const clues = computeClues(lv.grid);
  state = {
    idx: idx,
    lv: lv,
    n: n,
    solution: solutionArray(lv),
    rowsClues: clues.rows,
    colsClues: clues.cols,
    clueRows: Math.max(1, ...clues.rows.map((a) => a.length)),
    clueCols: Math.max(1, ...clues.cols.map((a) => a.length)),
    cells: new Uint8Array(n * n),
    locked: new Uint8Array(n * n),
    rowSolved: new Array(n).fill(false),
    colSolved: new Array(n).fill(false),
    tool: 'black',
    paints: 0,
    cellEls: [],
    cell: 0,
  };
  painting = false;
  resetTimer();
  buildBoard();
  refreshAllCells();
  updateClueStyles();
  updateProgress();
  updateToolbar();
  // 名字通关前不显示，通关（或重玩已通关关卡）后才显示
  UI.levelTitle.textContent = '第 ' + (idx + 1) + ' 关 · ' + lv.size + '×' + lv.size +
    (UI.completed[idx] ? ' · ' + lv.name : '');
  UI.menuScreen.classList.remove('active');
  UI.gameScreen.classList.add('active');
  window.scrollTo(0, 0);
}

function buildBoard() {
  const board = UI.boardEl;
  const n = state.n;
  const gap = 2;
  const tracks = Math.max(state.clueRows, state.clueCols) + n;
  const avail = Math.min(window.innerWidth - 44, window.innerHeight - 260);
  let cell = Math.floor((avail - (tracks - 1) * gap) / tracks);
  cell = Math.max(18, Math.min(54, cell));
  state.cell = cell;
  board.style.setProperty('--cell', cell + 'px');
  board.style.gridTemplateColumns = 'repeat(' + state.clueCols + ', ' + cell + 'px) repeat(' + n + ', ' + cell + 'px)';
  board.style.gridTemplateRows = 'repeat(' + state.clueRows + ', ' + cell + 'px) repeat(' + n + ', ' + cell + 'px)';
  board.innerHTML = '';
  state.cellEls = [];

  // 左上角
  const corner = document.createElement('div');
  corner.className = 'corner';
  corner.style.gridRow = '1 / span ' + state.clueRows;
  corner.style.gridColumn = '1 / span ' + state.clueCols;
  board.appendChild(corner);

  // 列提示（数字靠底部对齐）
  for (let c = 0; c < n; c++) {
    const runs = state.colsClues[c].length ? state.colsClues[c] : [0];
    const offset = state.clueRows - runs.length;
    for (let k = 0; k < state.clueRows; k++) {
      const box = document.createElement('div');
      box.className = 'clue';
      box.dataset.kind = 'col';
      box.dataset.index = c;
      box.textContent = k >= offset ? runs[k - offset] : '';
      box.style.gridRow = (k + 1) + ' / ' + (k + 2);
      box.style.gridColumn = (state.clueCols + c + 1) + ' / ' + (state.clueCols + c + 2);
      board.appendChild(box);
    }
  }

  // 行提示（数字靠左对齐）
  for (let r = 0; r < n; r++) {
    const runs = state.rowsClues[r].length ? state.rowsClues[r] : [0];
    for (let k = 0; k < state.clueCols; k++) {
      const box = document.createElement('div');
      box.className = 'clue';
      box.dataset.kind = 'row';
      box.dataset.index = r;
      box.textContent = k < runs.length ? runs[k] : '';
      box.style.gridRow = (state.clueRows + r + 1) + ' / ' + (state.clueRows + r + 2);
      box.style.gridColumn = (k + 1) + ' / ' + (k + 2);
      board.appendChild(box);
    }
  }

  // 棋盘格子（r 外层、c 内层，索引 = r*n+c）
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.style.gridRow = (state.clueRows + r + 1) + ' / ' + (state.clueRows + r + 2);
      el.style.gridColumn = (state.clueCols + c + 1) + ' / ' + (state.clueCols + c + 2);
      board.appendChild(el);
      state.cellEls.push(el);
    }
  }
}

/* ----------------------------- 涂色交互 ----------------------------- */

function applyAt(e) {
  if (!state) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) return;
  // 从实际 DOM 位置计算格子索引（不依赖 CSS 布局假设）
  const el0 = state.cellEls[0].getBoundingClientRect();
  const el1 = state.cellEls[1].getBoundingClientRect();
  const elN = state.cellEls[state.n].getBoundingClientRect();
  const pitchX = el1.left - el0.left;
  const pitchY = elN.top - el0.top;
  const c = Math.floor((e.clientX - el0.left) / pitchX);
  const r = Math.floor((e.clientY - el0.top) / pitchY);
  if (r < 0 || r >= state.n || c < 0 || c >= state.n) return;
  paintCell(r, c);
}

function paintCell(r, c) {
  const n = state.n;
  const i = r * n + c;
  if (state.locked[i]) return; // 已锁定（行/列完成）的格子不可再改
  const target = state.tool === 'black' ? 1 : state.tool === 'white' ? 2 : state.tool === 'question' ? 3 : 0;
  if (state.cells[i] === target) return;
  state.cells[i] = target;
  state.paints++;
  startTimerIfNeeded();
  state.cellEls[i].className = cellClass(i);
  updateErrCount();
}

function endPaint() {
  if (!painting) return;
  painting = false;
  if (!state) return;
  checkAll();
}

/* ----------------------------- 判定与自动填充 ----------------------------- */

function checkAll() {
  let total = 0;
  let s = 0;
  do {
    s = autoFillOnce(state.cells, state.locked, state.rowSolved, state.colSolved, state.solution, state.n);
    total += s;
  } while (s > 0);
  if (total > 0) {
    refreshAllCells();
    showToast('✓ 已自动填充白色'); // 不提示填充了多少
  }
  updateClueStyles();
  updateProgress();
  if (state.rowSolved.every(Boolean)) win();
}

// 格子是否与答案冲突（错误高亮用；锁定格不会错）
function isErrorCellState(i) {
  const v = state.cells[i], s = state.solution[i];
  return (v === 1 && s === 0) || (v === 2 && s === 1);
}

function cellClass(i) {
  const v = state.cells[i];
  let cls = 'cell';
  if (v === 1) cls += ' black';
  else if (v === 2) cls += state.locked[i] ? ' auto' : ' white';
  else if (v === 3) cls += ' question';
  if (state.locked[i]) cls += ' locked';
  else if (isErrorCellState(i)) cls += ' err'; // 错误高亮
  return cls;
}

function refreshAllCells() {
  const els = state.cellEls;
  for (let i = 0; i < els.length; i++) els[i].className = cellClass(i);
}

// 行/列提示：绿 = 已完成，红 = 有矛盾
function updateClueStyles() {
  UI.boardEl.querySelectorAll('.clue').forEach((box) => {
    const kind = box.dataset.kind;
    const idx = Number(box.dataset.index);
    const solved = kind === 'row' ? state.rowSolved[idx] : state.colSolved[idx];
    const err = kind === 'row'
      ? rowHasErrorState(idx, state.cells, state.solution, state.n)
      : colHasErrorState(idx, state.cells, state.solution, state.n);
    box.classList.toggle('done', solved);
    box.classList.toggle('error', !solved && err);
  });
}

function updateProgress() {
  const n = state.n;
  const done = state.rowSolved.filter(Boolean).length + state.colSolved.filter(Boolean).length;
  const total = 2 * n;
  UI.progressFillEl.style.width = Math.round((done / total) * 100) + '%';
  UI.progressTextEl.textContent = '正确 ' + done + '/' + total + ' 行/列';
  let left = 0;
  for (let i = 0; i < state.solution.length; i++) {
    if (state.solution[i] === 1 && state.cells[i] !== 1) left++;
  }
  UI.leftCountEl.textContent = '剩余黑格 ' + left;
  updateErrCount();
}

function updateErrCount() {
  const e = countErrorsState(state.cells, state.solution, state.n);
  UI.errCountEl.textContent = '错误 ' + e;
  UI.errCountEl.classList.toggle('has-err', e > 0);
}

function applyHint() {
  if (!state) return;
  const i = pickHintCell(state.cells, state.solution, state.locked, state.n);
  if (i < 0) { showToast('没有可提示的格子了'); return; }
  state.cells[i] = state.solution[i] === 1 ? 1 : 2;
  state.cellEls[i].className = cellClass(i);
  const el = state.cellEls[i];
  el.style.outline = '3px solid #f5b93c';
  setTimeout(() => { el.style.outline = ''; }, 600);
  startTimerIfNeeded();
  showToast('已提示一格，继续加油！');
  checkAll();
}

function win() {
  stopTimer();
  // 记录通关（按关卡索引，不依赖顺序）
  if (!UI.completed[state.idx]) {
    UI.completed[state.idx] = { name: state.lv.name, size: state.lv.size };
    saveProgress();
  }
  const last = state.idx >= TOTAL_LEVELS - 1;
  UI.modalTextEl.innerHTML =
    '本关图案是「<b>' + state.lv.name + '</b>」！<br>' +
    '用时 <b>' + formatTime(timerElapsed()) + '</b>，涂改 <b>' + state.paints + '</b> 次。';
  UI.btnNext.style.display = last ? 'none' : ''; // 最后一关没有下一关
  UI.modalEl.classList.remove('hidden');
}

/* ----------------------------- 计时 / 提示 / 弹窗 ----------------------------- */

function resetTimer() {
  stopTimer();
  timerStart = null;
  UI.timerEl.textContent = '⏱ 00:00';
}
function startTimerIfNeeded() {
  if (timerStart != null) return;
  timerStart = Date.now();
  timerInterval = setInterval(() => {
    UI.timerEl.textContent = '⏱ ' + formatTime(Date.now() - timerStart);
  }, 500);
}
function stopTimer() {
  if (timerInterval != null) { clearInterval(timerInterval); timerInterval = null; }
}
function timerElapsed() { return timerStart == null ? 0 : Date.now() - timerStart; }
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function showToast(msg) {
  const el = UI.toastEl;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function hideModal() { UI.modalEl.classList.add('hidden'); }

function updateToolbar() {
  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === (state ? state.tool : ''));
  });
}

function debounce(fn, ms) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

/* ----------------------------- 进度存取 ----------------------------- */

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw.completed === 'object' && !Array.isArray(raw.completed)) {
      // 转换为对象 { idx: {name, size} }
      const completed = {};
      Object.keys(raw.completed).forEach((k) => {
        const x = raw.completed[k];
        if (x && typeof x.name === 'string' && Number.isFinite(x.size)) completed[k] = { name: x.name, size: x.size };
      });
      return { completed: completed };
    }
  } catch (e) {}
  return { completed: {} };
}
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ completed: UI.completed }));
  } catch (e) {}
}

/* ----------------------------- 启动 ----------------------------- */
if (typeof document !== 'undefined') initGame();
