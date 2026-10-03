/* ============================================================
   自动化自测脚本 self-test.js（开发用，不参与网页运行）
   做法：用最小 DOM / Canvas 打桩，把 script.js 真实执行一遍，
        验证"不抛异常、关键 DOM 被正确渲染、路线几何正确"。
   运行：node self-test.js ../源码/script.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const scriptPath = process.argv[2] || path.join(__dirname, '..', '源码', 'script.js');
const code = fs.readFileSync(scriptPath, 'utf8');

const log = [];
const problems = [];
function ok(msg) { log.push('  [ok]   ' + msg); }
function bad(msg) { problems.push(msg); log.push('  [FAIL] ' + msg); }

/* ---------- 元素打桩 ---------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  toString() { return [...this.set].join(' '); }
}

class El {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this._html = '';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.classList = new ClassList(this);
    this.listeners = {};
    this.hidden = false;
    this.dataset_ok = true;
    this.width = 0; this.height = 0;
    this.parentElement = null;
    /* 终端自适应字号会读取这两个尺寸，给一个合理的模拟值 */
    this.clientWidth = 700;
    this.scrollWidth = 0;
    this.scrollHeight = 0;
    this.clientHeight = 158;
    this.scrollTop = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList = new ClassList(this); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    if (!this._child) this._child = new El('span');
  }
  get lastElementChild() { return this._child || null; }
  get firstElementChild() { return this._child || null; }
  get textContent() { return this._html.replace(/<[^>]*>/g, '').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  set textContent(v) { this._html = String(v); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener() {}
  /* 终端打字机用 appendChild 逐行追加，这里做等价打桩：
     追加一个子元素并把它的 innerHTML 同步回父元素，模拟真实渲染结果 */
  appendChild(child) {
    this.children.push(child);
    this._child = child;
    this._html = String(this._html || '') + '<p class="t-line">' + String(child.innerHTML || '') + '</p>';
    const parent = this;
    Object.defineProperty(child, 'innerHTML', {
      configurable: true,
      get() { return child._html || ''; },
      set(v) { child._html = String(v); parent._html = parent._render(); }
    });
    return child;
  }
  insertBefore(child, ref) {
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    this._child = child;
    const parent = this;
    Object.defineProperty(child, 'innerHTML', {
      configurable: true,
      get() { return child._html || ''; },
      set(v) { child._html = String(v); parent._html = parent._render(); }
    });
    this._html = this._render();
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    this._html = this._render();
    return child;
  }
  /* 隐藏测量元素没有子节点，offsetWidth 用文本长度粗估即可满足测试 */
  get offsetWidth() { return String(this._text || '').length * 8; }
  _render() {
    return this.children.map(function (c) {
      return '<p class="t-line">' + String(c.innerHTML || '') + '</p>';
    }).join('');
  }
  getBoundingClientRect() { return { top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  scrollIntoView() {}
  focus() {}
  getContext() { return stubCtx; }
}

/* ---------- Canvas 2D 上下文打桩（记录调用次数） ---------- */
const ctxCalls = { fill: 0, stroke: 0, arc: 0, fillText: 0, setTransform: 0, clearRect: 0,
  drawImage: 0, createRadialGradient: 0, createLinearGradient: 0, shadowBlurSet: 0 };
const stubCtx = {
  setTransform() { ctxCalls.setTransform++; },
  clearRect() { ctxCalls.clearRect++; },
  fillRect() {}, beginPath() {}, ellipse() {}, moveTo() {}, lineTo() {},
  bezierCurveTo() {}, arc() { ctxCalls.arc++; }, fill() { ctxCalls.fill++; },
  stroke() { ctxCalls.stroke++; }, save() {}, restore() {}, setLineDash() {},
  fillText() { ctxCalls.fillText++; },
  drawImage() { ctxCalls.drawImage++; },
  createLinearGradient() { ctxCalls.createLinearGradient++; return { addColorStop() {} }; },
  createRadialGradient() { ctxCalls.createRadialGradient++; return { addColorStop() {} }; },
  measureText() { return { width: 10 }; },
  set shadowBlur(v) { if (v) ctxCalls.shadowBlurSet++; },
  get shadowBlur() { return 0; },
  shadowColor: '', globalAlpha: 1, font: '', textAlign: '', fillStyle: '', strokeStyle: '',
  lineWidth: 1, lineCap: '', lineJoin: ''
};

/* ---------- 文档打桩：按 id / 选择器返回预置元素 ---------- */
const IDS = ['nav', 'progressBar', 'toTop', 'menuBtn', 'mobileMenu', 'navLinks', 'heroCanvas',
  'terminalBody', 'routeCanvas', 'routeList', 'mapTip', 'mapCaption', 'playBtn', 'playLabel',
  'resetBtn', 'timelineList', 'spiritGrid', 'quizForm', 'quizBody', 'quizResult', 'themeBtn',
  'hero', 'route', 'timeline', 'spirit', 'data', 'quiz', 'about'];
const els = {};
IDS.forEach(id => { els['#' + id] = new El('div', id); });
els['#heroCanvas'].parentElement = new El('section');
els['#routeCanvas'].parentElement = new El('div');
/* 说明：打桩下 querySelectorAll 一律返回空数组，
   因此列表项数量通过 innerHTML 字符串统计，而非遍历子元素。 */

const document = {
  documentElement: new El('html'),
  body: new El('body'),
  readyState: 'complete',
  hidden: false,
  listeners: {},
  getElementById(id) { return els['#' + id] || new El('div', id); },
  querySelector(sel) {
    if (sel in els) return els[sel];
    return null;
  },
  querySelectorAll() { return []; },
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  createElement(tag) { return new El(tag); }
};
document.documentElement.setAttribute('data-theme', 'light');

const rafQueue = [];
const window = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  pageYOffset: 0,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  dispatchEvent() { return true; },
  /* 提供 getComputedStyle 打桩，便于验证渐变字的能力检测分支 */
  getComputedStyle: () => ({ webkitBackgroundClip: 'text', backgroundClip: 'text' }),
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout: (fn, t) => setTimeout(fn, Math.min(t || 0, 1)),
  clearTimeout,
  speechSynthesis: undefined,
  Event: function (n) { this.type = n; },
  IntersectionObserver: undefined
};

/* 浏览器的 IntersectionObserver 在 Node 中不存在，这里提供一个"视为已相交"的打桩版本：
   observe() 时异步回调一次 isIntersecting = true，以便验证依赖相交的初始化逻辑。 */
function StubIO(cb) { this.cb = cb; this.n = ++StubIO.n; }
StubIO.n = 0;
StubIO.prototype.observe = function (el) {
  const cb = this.cb, self = this;
  setTimeout(function () { cb([{ isIntersecting: true, target: el }], self); }, 0);
};
StubIO.prototype.unobserve = function () {};
StubIO.prototype.disconnect = function () {};
global.IntersectionObserver = StubIO;
window.IntersectionObserver = StubIO;

/* ---------- 执行 script.js ---------- */
let threw = null;
try {
  const fn = new Function('window', 'document', 'performance', 'localStorage', 'console',
    'setTimeout', 'clearTimeout', 'Event', 'navigator', code + '\n//# sourceURL=script.js');
  fn(window, document, { now: () => Date.now() }, { getItem: () => null, setItem() {} },
    console, window.setTimeout, clearTimeout, window.Event, { userAgent: 'node' });
  ok('script.js 完整执行，未抛出异常');
} catch (err) {
  threw = err;
  bad('执行时抛出异常：' + err.message + '\n' + (err.stack || '').split('\n').slice(0, 4).join('\n'));
}

/* ---------- 断言（含异步：终端打字机需等待计时器） ---------- */
async function assertAll() {
  if (threw) return;
  const bodyEl = document.getElementById('terminalBody');
  const routeListEl = document.getElementById('routeList');
  const spiritEl = document.getElementById('spiritGrid');
  const quizEl = document.getElementById('quizBody');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1. 终端打字机：等它把整段输出打完（新节奏约 2.5 秒）
  if (process.env.ST_DEBUG) console.log('[dbg] t0 html len =', bodyEl.innerHTML.length);
  for (let i = 0; i < 80; i++) {
    if (bodyEl.innerHTML.includes('90 年后')) break;
    await sleep(50);
    if (process.env.ST_DEBUG && i % 5 === 0) console.log('[dbg] t' + ((i + 1) * 50) + ' html len =', bodyEl.innerHTML.length);
  }
  if (process.env.ST_DEBUG) console.log('[dbg] final html len =', bodyEl.innerHTML.length, JSON.stringify(bodyEl.innerHTML.slice(0, 80)));
  if (bodyEl.innerHTML.includes('long-march')) ok('首屏终端打字机已输出命令');
  else bad('首屏终端内容未渲染：' + bodyEl.innerHTML.slice(0, 120));
  if (bodyEl.innerHTML.includes('90 年后')) ok('终端三段输出完整打完（末段含高亮文字）');
  else bad('终端输出未跑完，末段缺失');

  // 2. 路线节点列表：12 项
  const routeItems = routeListEl ? (routeListEl.innerHTML.match(/class="route-item/g) || []).length : 0;
  if (routeItems === 12) ok('路线事件列表渲染 12 个可点击节点');
  else bad('路线事件列表数量异常：' + routeItems);

  // 3. 精神卡片：5 张
  const spiritCount = spiritEl ? (spiritEl.innerHTML.match(/class="spirit-card/g) || []).length : 0;
  if (spiritCount === 5) ok('长征精神卡片渲染 5 张');
  else bad('长征精神卡片数量异常：' + spiritCount);

  // 3. 翻转按钮与语音按钮
  const speakCount = spiritEl ? (spiritEl.innerHTML.match(/class="speak-btn"/g) || []).length : 0;
  if (speakCount === 5) ok('每张精神卡片都带语音讲解按钮');
  else bad('语音按钮数量异常：' + speakCount);

  // 4. 答题题目：5 题、每题 4 个选项
  const qCount = quizEl ? (quizEl.innerHTML.match(/class="q-item"/g) || []).length : 0;
  const optCount = quizEl ? (quizEl.innerHTML.match(/class="q-opt"/g) || []).length : 0;
  if (qCount === 5 && optCount === 20) ok('知识自测渲染 5 题 / 20 个选项');
  else bad('知识自测渲染异常：题 ' + qCount + ' 选项 ' + optCount);

  // 5. Canvas 首帧真的画了东西（初始化阶段只画一帧，用较宽松的下限判断）
  if (ctxCalls.setTransform > 0 && ctxCalls.drawImage > 0 && ctxCalls.fill >= 2) {
    ok('Canvas 首帧绘制正常（setTransform=' + ctxCalls.setTransform + ', drawImage=' + ctxCalls.drawImage +
      ', fill=' + ctxCalls.fill + '）；动画帧的绘制量见下一项');
  } else {
    bad('Canvas 疑似未绘制：' + JSON.stringify(ctxCalls));
  }

  // 6. 播放动画推进：手动执行 rAF 回调若干帧
  let frames = 0;
  for (let i = 0; i < 60 && rafQueue.length; i++) {
    const fn = rafQueue.shift();
    try { fn(performance.now() + i * 16); frames++; } catch (e) { bad('rAF 帧执行异常：' + e.message); break; }
  }
  if (frames > 10) ok('requestAnimationFrame 动画循环运行 ' + frames + ' 帧无异常');
  else bad('动画循环未运行');

  // 6b. 性能优化核验：稳定帧里应使用缓存底图与贴图光晕，而不是逐帧重建渐变 / shadowBlur
  const before = { ...ctxCalls };
  for (let i = 0; i < 40 && rafQueue.length; i++) {
    const fn = rafQueue.shift();
    try { fn(performance.now() + 1000 + i * 16); } catch (e) { bad('性能帧执行异常：' + e.message); break; }
  }
  const dImage = ctxCalls.drawImage - before.drawImage;
  const dGrad = ctxCalls.createLinearGradient - before.createLinearGradient;
  const dRad = ctxCalls.createRadialGradient - before.createRadialGradient;
  const dShadow = ctxCalls.shadowBlurSet - before.shadowBlurSet;
  if (dImage >= 40) ok('静态底图与光晕走贴图缓存（40 帧内 drawImage ' + dImage + ' 次）');
  else bad('贴图缓存未生效：drawImage 仅 ' + dImage + ' 次');
  if (dGrad === 0 && dRad === 0) ok('稳定帧内不再重建渐变（linear=' + dGrad + ', radial=' + dRad + '）');
  else bad('稳定帧仍在创建渐变：linear=' + dGrad + ', radial=' + dRad);
  if (dShadow === 0) ok('稳定帧内未使用 shadowBlur（已改为贴图叠加）');
  else bad('仍在逐帧使用 shadowBlur：' + dShadow + ' 次');

  // 7. 主题切换不报错
  try {
    const themeBtn = document.getElementById('themeBtn');
    themeBtn.listeners.click.forEach(f => f());
    ok('主题切换交互无异常，当前主题：' + document.documentElement.getAttribute('data-theme'));
  } catch (e) { bad('主题切换异常：' + e.message); }
}

/* ---------- 路线几何校验（直接从源码提取站点坐标重算） ---------- */
function checkGeometry() {
const m = code.match(/var ROUTE = \[([\s\S]*?)\n  \];/);
if (!m) {
  bad('未能从源码中解析出 ROUTE 数据');
} else {
  const nodes = [...m[1].matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)].map(g => ({ x: +g[1], y: +g[2] }));
  if (nodes.length !== 12) bad('路线站点数量异常：' + nodes.length);
  else ok('路线站点共 12 个，已解析坐标');

  const W = 1000, H = 760, PAD = 18;
  const src = nodes.map(n => ({ x: n.x * (W - PAD * 2) / W + PAD, y: n.y * (H - PAD * 2) / H + PAD }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  src.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  if (minX < 0 || maxX > W || minY < 0 || maxY > H) bad('存在超出画布的站点');
  else ok('全部站点位于画布内（x: ' + minX.toFixed(0) + '-' + maxX.toFixed(0) + ', y: ' + minY.toFixed(0) + '-' + maxY.toFixed(0) + '）');

  // 平滑与累计长度
  const pts = [];
  for (let i = 0; i < src.length - 1; i++) {
    const p0 = src[i - 1] || src[i], p1 = src[i], p2 = src[i + 1], p3 = src[i + 2] || src[i + 1];
    for (let t = 0; t < 1; t += 0.04) {
      const t2 = t * t, t3 = t2 * t;
      pts.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      });
    }
  }
  pts.push(src[src.length - 1]);

  let total = 0; const cum = [0];
  for (let k = 1; k < pts.length; k++) { total += Math.hypot(pts[k].x - pts[k-1].x, pts[k].y - pts[k-1].y); cum.push(total); }
  ok('平滑路径 ' + pts.length + ' 个点，累计长度 ' + total.toFixed(1) + ' 逻辑像素');

  const at = src.map(s => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < pts.length; j++) { const d = Math.hypot(pts[j].x - s.x, pts[j].y - s.y); if (d < bd) { bd = d; best = j; } }
    return best;
  });
  const prog = at.map(i => cum[i] / total);
  const mono = prog.every((p, i) => i === 0 || p >= prog[i-1] - 1e-9);
  if (mono && prog[0] < 0.02 && prog[prog.length-1] > 0.97) {
    ok('站点进度序列单调递增，首站 ' + prog[0].toFixed(3) + ' 末站 ' + prog[prog.length-1].toFixed(3));
  } else {
    bad('站点进度序列异常：' + prog.map(p => p.toFixed(2)).join(','));
  }
  const maxJump = Math.max(...prog.map((p, i) => i ? p - prog[i-1] : 0));
  log.push('  [info] 相邻站点最大里程间隔 ' + maxJump.toFixed(3) + '（约 ' + (maxJump * 100).toFixed(1) + '% 总里程）');
  if (maxJump < 0.26) ok('站点沿路线分布均匀，无超长空档');
  else bad('相邻站点进度间隔过大：' + maxJump.toFixed(3));
}
}

/* ---------- 输出 ---------- */
async function main() {
  await assertAll();
  checkGeometry();
  summary();
}

/* 供其它调试脚本复用打桩环境 */
function summary() {
  console.log('=== 自测结果 ===');
  log.forEach(l => console.log(l));
  console.log('----------------');
  if (problems.length) {
    console.log('未通过 ' + problems.length + ' 项：');
    problems.forEach(p => console.log(' - ' + p));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✅');
  }
}

if (typeof require === 'function') {
  global.__DSH_TEST__ = { document, window, rafQueue, ctxCalls, stubCtx, El, StubIO, code };
  main();
}

