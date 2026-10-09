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
  /* 供测试触发已注册的事件（模拟 dispatchEvent） */
  dispatch(type, extra) {
    const ev = Object.assign({ type: type, target: this, preventDefault() {}, stopPropagation() {} }, extra || {});
    (this.listeners[type] || []).forEach(fn => fn(ev));
    return true;
  }
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
  'terminalBody', 'queryOpts', 'queryLabel', 'routeCanvas', 'routeList', 'mapTip', 'mapCaption',
  'playBtn', 'playLabel', 'resetBtn', 'timelineList', 'spiritGrid', 'quizForm', 'quizBody',
  'quizResult', 'themeBtn', 'hero', 'route', 'timeline', 'spirit', 'data', 'quiz', 'about'];
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

  // 1. 史料检索面板：等默认条目"行程总览"逐字打印完
  for (let i = 0; i < 90; i++) {
    if (bodyEl.innerHTML.includes('攻占县城700余座')) break;
    await sleep(50);
  }
  if (bodyEl.innerHTML.includes('二万五千里') && bodyEl.innerHTML.includes('攻占县城')) {
    ok('检索面板默认条目已完整打印（含行程总览全部四行）');
  } else {
    bad('检索面板内容未打完：' + bodyEl.innerHTML.replace(/<[^>]*>/g, '').slice(0, 100));
  }

  // 1b. 检索项按钮：5 个，且首个为选中态
  const optsEl = document.getElementById('queryOpts');
  const optCount = optsEl ? (optsEl.innerHTML.match(/class="arc-opt/g) || []).length : 0;
  const activeCount = optsEl ? (optsEl.innerHTML.match(/is-active/g) || []).length : 0;
  if (optCount === 5 && activeCount === 1) ok('检索项渲染 5 个按钮，默认选中 1 个');  else bad('检索项异常：按钮 ' + optCount + ' 个，选中 ' + activeCount + ' 个');

  // 1c. 终端内不得出现任何英文字母（作品呈现要求）
  const termHtml = bodyEl.innerHTML;
  const termPlain = termHtml.replace(/<[^>]*>/g, '').replace(/&gt;/g, '>');
  const latin = termPlain.match(/[A-Za-z]+/g);
  if (!latin) ok('史料文本不含任何英文字母');
  else bad('史料出现英文字母：' + Array.from(new Set(latin)).join('、'));
  // 1d. 不允许出现任何替换字符或私用区字符（编码损坏的典型特征）
  const badChars = termHtml.match(/[\uFFFD\uE000-\uF8FF]/g);
  if (!badChars) ok('史料文本无乱码字符（无 U+FFFD / 私用区）');
  else bad('史料文本含 ' + badChars.length + ' 个乱码字符');
  // 1e. 不应出现"全角逗号 / 中点"这类在等宽字体下易被误认为乱码的标点
  const oddPunct = termPlain.match(/[\uFF0C\u00B7\u30FB\u2022]/g);
  if (!oddPunct) ok('史料标点干净（无全角逗号 U+FF0C、无中点 U+00B7）');
  else bad('史料含易误判标点：' + oddPunct.map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase()).join('、'));

  // 1f. 互动性：模拟点击"重要战役与转折"，内容必须切换
  if (optsEl && optsEl.listeners.click && optsEl.listeners.click.length) {
    const fakeBtn = { dataset: { id: 'battle' }, classList: { toggle() {}, add() {}, remove() {} },
                      setAttribute() {}, getAttribute() { return null; } };
    const fakeTarget = { closest(sel) { return sel === '.arc-opt' ? fakeBtn : null; } };
    optsEl.dispatch('click', { target: fakeTarget });
    await sleep(60);
    for (let i = 0; i < 40; i++) {
      if (bodyEl.innerHTML.includes('遵义会议')) break;
      await sleep(50);
    }
    const labelEl = document.getElementById('queryLabel');
    if (bodyEl.innerHTML.includes('遵义会议') && bodyEl.innerHTML.includes('四渡赤水')) {
      ok('点击检索项可切换史料（已切到"重要战役与转折"）');
    } else {
      bad('点击检索项未切换内容：' + bodyEl.innerHTML.replace(/<[^>]*>/g, '').slice(0, 80));
    }
    if (labelEl && labelEl.innerHTML === '重要战役与转折') ok('右上角条目标签同步更新');
    else bad('条目标签未更新：' + (labelEl ? labelEl.innerHTML : '元素缺失'));
  } else {
    bad('检索项没有注册点击事件，交互失效');
  }

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
  const quizOptCount = quizEl ? (quizEl.innerHTML.match(/class="q-opt"/g) || []).length : 0;
  if (qCount === 5 && quizOptCount === 20) ok('知识自测渲染 5 题 / 20 个选项');
  else bad('知识自测渲染异常：题 ' + qCount + ' 选项 ' + quizOptCount);

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
  // 10. 滚动出现动画必须有兜底：屏外元素不能长期停在半透明
  //     （预览面板 / 整页截图 / 打印时不会触发出场动画，曾导致答题区看不清）
  if (/setTimeout\(forceAll,\s*2600\)/.test(code) && /beforeprint/.test(code)) {
    ok('出场动画带 2.6 秒兜底与打印前强制显示（避免屏外内容半透明）');
  } else {
    bad('缺少出场动画兜底：屏外内容可能长期半透明');
  }
  const printCss = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'style.css'), 'utf8');
  if (/@media print\{[\s\S]*?\.reveal\{opacity:1 !important/.test(printCss)) {
    ok('打印样式已强制显示 .reveal 内容');
  } else {
    bad('打印样式未处理 .reveal 隐藏，另存 PDF 会出现空白');
  }
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

