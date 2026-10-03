/* ============================================================
   "数字忆长征，AI 启初心" 红色主题网页
   交互脚本 script.js  —— 原生 JavaScript，无任何第三方依赖
   模块一览：
     1. 基础工具与主题配色
     2. 顶栏导航、滚动进度、返回顶部
     3. 首屏 Canvas 星火粒子背景
     4. 首屏终端打字机效果
     5. 长征路线动画地图（Canvas 逐段绘制 + 节点联动）
     6. 长征大事记时间轴
     7. 长征精神翻转卡片 + Web Speech 语音讲解
     8. 数据长征：数字滚动动画
     9. 长征知识小自测
    10. 滚动出现动画、主题切换与初始化

   流畅度优化要点（v2）：
     · Canvas 静态底图（底色 / 地形 / 网格 / 比例尺）绘制一次后缓存到
       离屏画布，每帧只做一次 drawImage；
     · 光晕改用预算贴图叠加，彻底去掉 shadowBlur（阴影模糊是最贵的
       Canvas 操作）；
     · 路线坐标预计算为扁平数组 + 进度数组，每帧二分查找终点；
     · 站点名称只绘制"当前站点 / 悬停站点"，其余不再逐帧写字；
     · 页面重绘全部合并到同一个 rAF，同帧多次请求只画一次；
     · 滚动事件用 rAF 节流，阅读进度条改用 transform:scaleX 走合成层；
     · 窗口尺寸变化做防抖，避免拖动窗口时反复重建缓存。
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     1. 基础工具与主题配色
     ============================================================ */

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 兼容旧浏览器：requestAnimationFrame / cancelAnimationFrame 兜底 */
  var raf = window.requestAnimationFrame
    ? function (fn) { return window.requestAnimationFrame(fn); }
    : function (fn) { return window.setTimeout(function () { fn(Date.now()); }, 16); };
  var caf = window.cancelAnimationFrame
    ? function (id) { return window.cancelAnimationFrame(id); }
    : function (id) { return window.clearTimeout(id); };

  /* 读取主题相关配色（与 style.css 的变量保持一致，便于 Canvas 与页面同色） */
  function themeColors() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? {
      deep:   '#160606',
      mid:    '#3a0c0c',
      land:   '#1d1514',
      landHi: '#2a1c1a',
      grid:   'rgba(255,235,210,0.055)',
      text:   '#e8ded7',
      faint:  'rgba(255,235,210,0.32)',
      route:  '#e8604f',
      done:   'rgba(255,235,210,0.20)',
      node:   '#ffd9a0',
      nodeFill: '#3a1010'
    } : {
      deep:   '#fdfaf5',
      mid:    '#f6ece1',
      land:   '#f0e4d5',
      landHi: '#e6d6c2',
      grid:   'rgba(140,22,22,0.06)',
      text:   '#4a3a33',
      faint:  'rgba(74,58,51,0.42)',
      route:  '#a81f1f',
      done:   'rgba(74,58,51,0.18)',
      node:   '#8c1616',
      nodeFill: '#fff8f1'
    };
  }

  /* ============================================================
     2. 顶栏导航、滚动进度、返回顶部
     ============================================================ */
  function initNav() {
    var nav = $('#nav');
    var bar = $('#progressBar');
    var toTop = $('#toTop');
    var menuBtn = $('#menuBtn');
    var mobileMenu = $('#mobileMenu');

    /* 滚动处理合并到一帧内执行，避免滚动过程中反复读写布局造成卡顿 */
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      raf(function () {
        ticking = false;
        var y = window.pageYOffset || document.documentElement.scrollTop || 0;
        if (nav) nav.classList.toggle('scrolled', y > 10);
        if (bar) {
          var h = document.documentElement.scrollHeight - window.innerHeight;
          bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0) + ')';
        }
        if (toTop) toTop.hidden = y < 600;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }

    if (menuBtn && mobileMenu) {
      menuBtn.addEventListener('click', function () {
        var open = mobileMenu.hidden;
        mobileMenu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', String(open));
      });
      $$('a', mobileMenu).forEach(function (a) {
        a.addEventListener('click', function () {
          mobileMenu.hidden = true;
          menuBtn.setAttribute('aria-expanded', 'false');
        });
      });
      /* 回到桌面宽度时收起抽屉，避免状态残留 */
      window.addEventListener('resize', function () {
        if (window.innerWidth > 900 && !mobileMenu.hidden) {
          mobileMenu.hidden = true;
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    /* 当前阅读区块高亮 */
    var links = $$('#navLinks a');
    var sections = links.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
    if ('IntersectionObserver' in window && sections.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id);
          });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(function (s) { io.observe(s); });
    }
  }

  /* ============================================================
     3. 首屏 Canvas 星火粒子背景
     ============================================================ */
  function initHeroCanvas() {
    var canvas = $('#heroCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var particles = [];
    var w = 0, h = 0, dpr = 1;
    var frameId = null;
    var running = false;
    var glowSprite = null;          // 预渲染的光晕贴图（避免逐帧创建渐变）
    var lastTs = 0;

    /* 把"光晕"预先画进一张小图，每帧只需 drawImage，
       比逐帧 createRadialGradient 快一个数量级 */
    function buildGlowSprite() {
      var size = Math.max(8, Math.round(56 * dpr));
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var g2 = c.getContext('2d');
      var r = size / 2;
      var grad = g2.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255,214,150,1)');
      grad.addColorStop(0.45, 'rgba(255,196,120,0.42)');
      grad.addColorStop(1, 'rgba(255,180,110,0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, size, size);
      glowSprite = c;
    }

    function resize() {
      var box = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      /* 手机上点距更粗，进一步降低像素填充率 */
      if (window.innerWidth < 760) dpr = Math.min(dpr, 1.5);
      w = canvas.width = Math.max(1, Math.round(box.width * dpr));
      h = canvas.height = Math.max(1, Math.round(box.height * dpr));
      canvas.style.width = box.width + 'px';
      canvas.style.height = box.height + 'px';
      buildGlowSprite();
    }

    function makeParticles() {
      var count = window.innerWidth < 760 ? 36 : 96;
      particles = [];
      for (var i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (Math.random() * 1.9 + 0.7) * dpr,
          vy: -(Math.random() * 0.26 + 0.08) * dpr,      // 缓慢上升：向上、向前的意象
          vx: (Math.random() - 0.5) * 0.16 * dpr,
          a: Math.random() * 0.5 + 0.16,
          tw: Math.random() * Math.PI * 2                // 闪烁相位
        });
      }
    }

    function frame(ts) {
      if (!running) return;
      /* 按时间步进，使不同刷新率（60Hz / 120Hz）下速度一致 */
      var dt = lastTs ? Math.min(2.5, (ts - lastTs) / 16.7) : 1;
      lastTs = ts;

      ctx.clearRect(0, 0, w, h);
      if (glowSprite) {
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.tw += 0.035 * dt;
          if (p.y < -12) { p.y = h + 10; p.x = Math.random() * w; }
          if (p.x < -12) p.x = w + 10;
          if (p.x > w + 12) p.x = -10;

          var alpha = p.a * (0.55 + 0.45 * Math.sin(p.tw));
          var d = p.r * 14;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.drawImage(glowSprite, p.x - d / 2, p.y - d / 2, d, d);

          ctx.globalAlpha = Math.min(1, alpha * 2.2);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,240,220,1)';
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      frameId = raf(frame);
    }

    function start() {
      if (running || reduceMotion) return;
      running = true;
      lastTs = 0;
      frameId = raf(frame);
    }
    function stop() {
      running = false;
      if (frameId) caf(frameId);
      frameId = null;
    }

    resize();
    makeParticles();
    if (reduceMotion) {
      /* 关闭动效时只绘制一帧静态星点 */
      ctx.clearRect(0, 0, w, h);
      particles.forEach(function (p) {
        ctx.fillStyle = 'rgba(255,230,190,' + (p.a * 0.8).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      start();
    }

    /* 窗口尺寸变化做防抖，避免拖动过程中反复重建画布 */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        resize();
        makeParticles();
      }, 180);
    });

    /* 首屏离开视野时暂停动画，节省性能 */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) start(); else stop();
        });
      }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  }

  /* ============================================================
     4. 首屏终端打字机
     ============================================================ */
  function initTerminal() {
    var body = $('#terminalBody');
    if (!body) return;

    var lines = [
      { t: 'cmd', s: '$ ./long-march --route --search "瑞金"' },
      { t: 'out', s: '&gt; 1934年10月，中央红军8.6万余人从江西瑞金、于都等地出发，踏上长征路。' },
      { t: 'out', s: '&gt; 途经14省 · 翻越18座大山 · 跨越24条大河 · 行程约二万五千里。' },
      { t: 'out', s: '&gt; <span class="hl">90 年后，这条路仍在被重新走一遍。</span>' }
    ];

    function plain(html) {
      return html.replace(/&gt;/g, '>').replace(/<[^>]+>/g, '');
    }
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function renderStatic() {
      body.innerHTML = lines.map(function (l) {
        return '<p class="t-line ' + (l.t === 'cmd' ? '' : 't-out') + '">' +
          (l.t === 'cmd' ? '<span class="t-prompt">$ </span>' + l.s.slice(2) : l.s) + '</p>';
      }).join('');
    }

    if (reduceMotion) { fitTerminalText(); renderStatic(); return; }

    /* ---- 打字机 ----------------------------------------------------
       节奏刻意压紧（全程约 2.5 秒），用户不必等太久就能看到完整输出，
       也不会出现"只看到半行就停住"的错觉。

       顺滑做法：整行字符一次性建好，未打出的部分先以暗色呈现，
       打字时只翻转每个字符的 class（不重建 DOM、不引起重排），
       所以盒子宽度从一开始就固定，逐字过程完全不抖动。 */
    var SPEED = { cmd: 42, out: 15 };
    var HOLD = { cmd: 240, out: 110 };

    var li = 0, ci = 0, hl = -1;
    var lastLine = null, lastChars = null;
    var maxScroll = 0;

    function measureScroll() {
      maxScroll = Math.max(0, body.scrollHeight - (body.clientHeight || body.offsetHeight || 0));
    }

    function scrollToBottom() {
      if (maxScroll > 0 && typeof body.scrollTop === 'number') body.scrollTop = maxScroll;
    }

    /* 自适应字号：按"最长一行"所需宽度反推字号并夹在 10-14px 之间，
       保证终端里每一行都能完整放下，手机上也不会被横向裁掉。
       注意：测量必须用隐藏的临时元素，绝不能借用正文容器——那会清掉已打印的内容。 */
    function fitTerminalText() {
      var aw = body.clientWidth || body.offsetWidth;
      if (!aw) return;
      var cs = window.getComputedStyle ? window.getComputedStyle(body) : null;

      var probe = document.createElement('p');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;' +
        'margin:0;padding:0;border:0;white-space:nowrap;' +
        'font-family:' + (cs && cs.fontFamily ? cs.fontFamily : 'monospace') + ';' +
        'font-size:' + (cs && cs.fontSize ? cs.fontSize : '14px') + ';' +
        'line-height:normal;letter-spacing:' + (cs && cs.letterSpacing ? cs.letterSpacing : 'normal') + ';';
      body.appendChild(probe);

      var maxW = 0;
      for (var i = 0; i < lines.length; i++) {
        probe.textContent = plain(lines[i].s);
        maxW = Math.max(maxW, probe.offsetWidth);
      }
      body.removeChild(probe);

      var cur = cs ? parseFloat(cs.fontSize) : 14;
      if (!cur) cur = 14;
      if (maxW > aw) {
        body.style.fontSize = Math.max(10, Math.min(14, cur * aw / maxW)) + 'px';
      }
      measureScroll();
      scrollToBottom();
    }

    /* 把一行文字拆成逐字 span；需要高亮的目标文字在点亮时再加 hl 类 */
    function buildLine(line, text) {
      var p = document.createElement('p');
      p.className = 't-line' + (line.t === 'cmd' ? '' : ' t-out');
      if (line.t === 'cmd') {
        var prompt = document.createElement('span');
        prompt.className = 't-prompt';
        prompt.textContent = '$ ';
        p.appendChild(prompt);
      }
      var caret = document.createElement('span');
      caret.className = 'caret';
      p.appendChild(caret);

      var spans = [];
      for (var i = 0; i < text.length; i++) {
        var sp = document.createElement('span');
        sp.className = 'dim';
        sp.textContent = text.charAt(i);
        p.insertBefore(sp, caret);
        spans.push(sp);
      }
      return { el: p, spans: spans, caret: caret };
    }

    /* 完成整行：用原始 HTML 替换，保留设计好的高亮样式 */
    function finishLine(line, node) {
      node.el.innerHTML = line.t === 'cmd'
        ? '<span class="t-prompt">$ </span>' + escapeHtml(plain(line.s))
        : line.s;
    }

    function type() {
      if (li >= lines.length) return;
      var line = lines[li];
      var text = plain(line.s);

      if (ci === 0) {
        hl = text.indexOf('90 年后');
        var built = buildLine(line, text);
        lastLine = built;
        lastChars = built.spans;
        body.appendChild(built.el);
        measureScroll();
        scrollToBottom();
      }

      var sp = lastChars[ci];
      if (sp) {
        sp.className = (hl >= 0 && ci >= hl && ci < hl + 4) ? 'hl' : '';
      }
      ci++;

      if (ci < text.length) {
        window.setTimeout(type, SPEED[line.t] || 20);
      } else {
        finishLine(line, lastLine);
        li++; ci = 0;
        window.setTimeout(type, HOLD[line.t] || 120);
      }
    }

    /* 进入视野后再开始，避免用户还没看到就播完 */
    var started = false;
    function kick() {
      if (started) return;
      started = true;
      fitTerminalText();                 // 先按最长一行定好字号，再开始打字
      window.setTimeout(type, 400);
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { kick(); io.disconnect(); } });
      }, { threshold: 0.1 });
      io.observe(body);
    } else {
      kick();
    }

    /* 窗口尺寸变化后重新适配字号（防抖），保证换设备/转屏后仍然完整显示 */
    var fitTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(function () {
        body.style.fontSize = '';         // 先回到样式表基准值再重新测量
        fitTerminalText();
        scrollToBottom();
      }, 200);
    });
  }

  /* ============================================================
     5. 长征路线动画地图
     ------------------------------------------------------------
     站点坐标按真实经纬度线性投影到画布，路线采用 Catmull-Rom
     样条平滑，红点按累计里程匀速前进，并与右侧事件列表联动。
     ============================================================ */

  /* 路线站点：x / y 为经纬度投影后的相对坐标（0-1000 / 0-760） */
  var ROUTE = [
    { x: 826, y: 497, year: '1934', date: '1934年10月', name: '于都河畔出发',
      place: '江西 · 瑞金 / 于都', desc: '中央红军8.6万余人从江西瑞金、于都等地出发，开始战略转移。' },
    { x: 730, y: 545, year: '1934', date: '1934年11-12月', name: '血战湘江',
      place: '广西 · 湘江', desc: '红军突破第四道封锁线，付出极其惨重的代价，也由此开始深刻反思"左"倾错误。' },
    { x: 478, y: 452, year: '1935', date: '1935年1月', name: '遵义会议',
      place: '贵州 · 遵义', desc: '确立毛泽东在党中央和红军的领导地位，在最危急关头挽救了党、挽救了红军、挽救了中国革命。' },
    { x: 510, y: 471, year: '1935', date: '1935年1-3月', name: '四渡赤水',
      place: '川黔滇边 · 赤水河', desc: '红军四次渡过赤水河，忽东忽西、声东击西，牢牢掌握战场主动权。' },
    { x: 374, y: 500, year: '1935', date: '1935年5月', name: '巧渡金沙江',
      place: '云南 · 皎平渡', desc: '仅靠几只木船，红军用七天七夜渡过金沙江，把追兵远远甩在江南岸。' },
    { x: 392, y: 469, year: '1935', date: '1935年5月', name: '强渡大渡河',
      place: '四川 · 安顺场', desc: '十七名勇士驾小船冒着枪林弹雨强渡成功，为全军打开渡口。' },
    { x: 407, y: 427, year: '1935', date: '1935年5月', name: '飞夺泸定桥',
      place: '四川 · 泸定', desc: '二十二名突击队员攀着十三根铁索冒弹雨夺桥，为全军打开北上通道。' },
    { x: 378, y: 351, year: '1935', date: '1935年6月', name: '翻越夹金山',
      place: '四川 · 宝兴', desc: '红军翻越终年积雪的大雪山，缺氧严寒中互相搀扶，翻过第一座雪山。' },
    { x: 415, y: 290, year: '1935', date: '1935年8月', name: '穿越茫茫草地',
      place: '四川 · 松潘草地', desc: '沼泽、饥饿与寒冷夺走了许多战士的生命，队伍依旧向北。' },
    { x: 465, y: 315, year: '1935', date: '1935年9月', name: '激战腊子口',
      place: '甘肃 · 腊子口', desc: '红军攻克天险腊子口，打开了北上甘南的最后一道门户。' },
    { x: 566, y: 191, year: '1935', date: '1935年10月', name: '到达陕北吴起镇',
      place: '陕西 · 吴起', desc: '中央红军历时一年、行程二万五千里，胜利到达陕北。' },
    { x: 398, y: 247, year: '1936', date: '1936年10月', name: '红军三大主力会师',
      place: '甘肃 · 会宁', desc: '红一、红二、红四方面军在甘肃会宁、静宁将台堡会师，长征胜利结束。' }
  ];

  function initRouteMap() {
    var canvas = $('#routeCanvas');
    var list = $('#routeList');
    var tip = $('#mapTip');
    var caption = $('#mapCaption');
    var playBtn = $('#playBtn');
    var playLabel = $('#playLabel');
    var resetBtn = $('#resetBtn');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var W = 1000, H = 760;        // 逻辑坐标尺寸（与站点坐标同一坐标系）
    var MAP_PAD = 18;
    var pts = [];                 // 平滑后的路径点
    var cum = [];                 // 累计长度
    var total = 0;
    var nodeAt = [];              // 每个站点对应的路径点索引
    var progAt = [];              // 每个路径点的进度（0-1），供二分查找
    var pathFlat = [];            // 路径坐标扁平数组 [x0,y0,x1,y1,...]
    var pathFlatSparse = [];      // 抽稀后的路径，用于虚线底纹
    var base = null;              // 静态底图缓存（离屏画布）
    var baseColors = null;        // 底图对应的主题配色
    var drawnTheme = null;        // 上次绘制使用的主题，用于判断底图是否失效
    var glowSprite = null;        // 光晕贴图（避免 shadowBlur 与逐帧渐变）
    var progress = 0;             // 0 - 1
    var playing = !reduceMotion;
    var hidden = false;           // 区块是否离开视野
    var frameId = null;
    var dpr = 1;
    var hoverIdx = -1;
    var activeIdx = 0;
    var lastTs = 0;
    var renderScheduled = false;

    /* ----- 几何：Catmull-Rom 样条平滑 ----- */
    function buildPath() {
      var src = ROUTE.map(function (n) {
        return {
          x: n.x * (W - MAP_PAD * 2) / W + MAP_PAD,
          y: n.y * (H - MAP_PAD * 2) / H + MAP_PAD
        };
      });
      pts = [];
      for (var i = 0; i < src.length - 1; i++) {
        var p0 = src[i - 1] || src[i];
        var p1 = src[i];
        var p2 = src[i + 1];
        var p3 = src[i + 2] || src[i + 1];
        for (var t = 0; t < 1; t += 0.04) {
          var t2 = t * t, t3 = t2 * t;
          pts.push({
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
          });
        }
      }
      pts.push(src[src.length - 1]);

      cum = [0];
      total = 0;
      for (var k = 1; k < pts.length; k++) {
        total += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
        cum.push(total);
      }

      /* 预计算每个点的进度与扁平坐标；虚线底纹每 3 个点取 1 个，
         肉眼无差别但绘制量降到 1/3 */
      progAt = new Array(pts.length);
      pathFlat = [];
      pathFlatSparse = [];
      for (var j = 0; j < pts.length; j++) {
        progAt[j] = cum[j] / total;
        pathFlat.push(pts[j].x, pts[j].y);
        if (j % 3 === 0 || j === pts.length - 1) pathFlatSparse.push(pts[j].x, pts[j].y);
      }

      /* 记录每个站点最接近的路径点 */
      nodeAt = src.map(function (s) {
        var best = 0, bd = Infinity;
        for (var m = 0; m < pts.length; m++) {
          var d = Math.hypot(pts[m].x - s.x, pts[m].y - s.y);
          if (d < bd) { bd = d; best = m; }
        }
        return best;
      });
    }

    function pointAt(p) {
      var target = Math.max(0, Math.min(1, p)) * total;
      var lo = 0, hi = cum.length - 1;
      while (lo < hi - 1) {
        var mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid; else hi = mid;
      }
      var seg = cum[hi] - cum[lo] || 1;
      var f = (target - cum[lo]) / seg;
      return {
        x: pts[lo].x + (pts[hi].x - pts[lo].x) * f,
        y: pts[lo].y + (pts[hi].y - pts[lo].y) * f
      };
    }

    function nodeProgress(i) { return progAt[nodeAt[i]]; }

    /* ----- 尺寸与重绘调度 ----- */
    function resize() {
      var box = canvas.parentElement.getBoundingClientRect();
      var cssW = Math.max(280, box.width);
      var cssH = Math.round(cssW * H / W);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.height = cssH + 'px';
      base = null;                 // 尺寸变了，底图缓存作废
      baseColors = null;
      renderNow();                 // 立即出图，避免窗口变化时出现空帧
    }

    /* 立即绘制一帧（用于尺寸变化、初始化等必须即时出图的场合） */
    function renderNow() {
      renderScheduled = false;
      draw(lastTs);
    }

    /* 把同一次事件循环内的多次重绘合并为一帧，避免连续 draw */
    function scheduleRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      raf(function (ts) {
        renderScheduled = false;
        lastTs = ts || lastTs;
        draw(lastTs);
      });
    }

    /* ----- 光晕贴图：预算一次，供路线高亮与行进红点叠加使用 ----- */
    function buildGlowSprite() {
      var size = 64;
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var g = c.getContext('2d');
      var r = size / 2;
      var grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255,120,90,0.95)');
      grad.addColorStop(0.35, 'rgba(255,110,80,0.42)');
      grad.addColorStop(1, 'rgba(255,90,60,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      glowSprite = c;
    }

    /* ----- 静态底图：只在尺寸或主题变化时重建 ----- */
    function buildBaseLayer() {
      var c = themeColors();
      baseColors = c;
      if (!base || base.width !== canvas.width || base.height !== canvas.height) {
        base = document.createElement('canvas');
        base.width = canvas.width;
        base.height = canvas.height;
      }
      var g = base.getContext('2d');
      var sx = base.width / W;
      g.setTransform(sx, 0, 0, sx, 0, 0);
      g.clearRect(0, 0, W, H);

      /* 底色 */
      var grad = g.createLinearGradient(0, 0, W * 0.4, H);
      grad.addColorStop(0, c.deep);
      grad.addColorStop(1, c.mid);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);

      /* 大陆示意面（松潘草地一带） */
      g.beginPath();
      g.ellipse(470, 330, 250, 200, -0.16, 0, Math.PI * 2);
      g.fillStyle = c.land;
      g.fill();

      /* 山地肌理：夹金山 / 岷山一带 */
      g.strokeStyle = c.landHi;
      g.lineWidth = 2;
      g.beginPath();
      [[300, 400, 420, 250, 40], [520, 430, 640, 300, 30],
       [640, 250, 780, 170, 26], [860, 200, 960, 150, 20]].forEach(function (r) {
        g.moveTo(r[0], r[1]);
        g.lineTo((r[0] + r[2]) / 2, r[1] - r[4]);
        g.lineTo(r[2], r[3]);
      });
      g.stroke();

      /* 河流示意：金沙江 / 大渡河 */
      g.strokeStyle = c.grid;
      g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(240, 560); g.bezierCurveTo(360, 520, 420, 470, 560, 430); g.stroke();
      g.beginPath(); g.moveTo(300, 470); g.bezierCurveTo(340, 430, 380, 400, 430, 360); g.stroke();

      /* 网格（技术制图感）：一次成路径后统一描边 */
      g.strokeStyle = c.grid;
      g.lineWidth = 1;
      g.beginPath();
      for (var x = 0; x <= W; x += 50) { g.moveTo(x, 0); g.lineTo(x, H); }
      for (var y = 0; y <= H; y += 50) { g.moveTo(0, y); g.lineTo(W, y); }
      g.stroke();

      /* 比例尺（示意） */
      g.strokeStyle = c.faint;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(W - 150, H - 34); g.lineTo(W - 40, H - 34);
      g.moveTo(W - 150, H - 38); g.lineTo(W - 150, H - 30);
      g.moveTo(W - 40, H - 38); g.lineTo(W - 40, H - 30);
      g.stroke();
      g.font = '12px "Microsoft YaHei",system-ui,sans-serif';
      g.fillStyle = c.faint;
      g.textAlign = 'center';
      g.fillText('比例示意（非精确距离）', W - 95, H - 42);
    }

    /* ----- 每帧绘制 ----- */
    function draw(ts) {
      var c = themeColors();
      var sx = canvas.width / W;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(sx, 0, 0, sx, 0, 0);

      /* 1) 静态底图（缓存，每帧一次 drawImage） */
      if (!base || baseColors !== drawnTheme) buildBaseLayer();
      ctx.drawImage(base, 0, 0, W, H);
      drawnTheme = baseColors;

      var t = ts || 0;

      /* 2) 未走完的路线底纹 */
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([7, 9]);
      ctx.strokeStyle = c.done;
      ctx.beginPath();
      ctx.moveTo(pathFlatSparse[0], pathFlatSparse[1]);
      for (var i = 2; i < pathFlatSparse.length; i += 2) ctx.lineTo(pathFlatSparse[i], pathFlatSparse[i + 1]);
      ctx.stroke();
      ctx.setLineDash([]);

      /* 3) 已经走过的路线：二分查找本次画到第几个点 */
      var endP = pointAt(progress);
      var lo = 0, hi = pts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (progAt[mid] <= progress) lo = mid; else hi = mid - 1;
      }
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = c.route;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(pathFlat[0], pathFlat[1]);
      for (var a = 2; a <= lo * 2; a += 2) ctx.lineTo(pathFlat[a], pathFlat[a + 1]);
      ctx.lineTo(endP.x, endP.y);
      ctx.stroke();                    // 外层光晕
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.route;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(pathFlat[0], pathFlat[1]);
      for (var b = 2; b <= lo * 2; b += 2) ctx.lineTo(pathFlat[b], pathFlat[b + 1]);
      ctx.lineTo(endP.x, endP.y);
      ctx.stroke();                    // 内层实线
      ctx.restore();

      /* 4) 站点 */
      for (var n = 0; n < ROUTE.length; n++) {
        var p = pts[nodeAt[n]];
        var reached = progress >= progAt[nodeAt[n]] - 0.001;
        var isActive = n === activeIdx;
        var isHover = n === hoverIdx;

        if (!reached) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = c.done;
          ctx.fill();
          continue;
        }

        if ((isActive || isHover) && glowSprite) {
          /* 高亮站点的柔光：贴图叠加，替代 shadowBlur */
          var gd = (13 + Math.sin(t / 320) * 3) * 2.6;
          ctx.globalAlpha = 0.55;
          ctx.drawImage(glowSprite, p.x - gd / 2, p.y - gd / 2, gd, gd);
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, isActive ? 7 : 4.6, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? c.route : c.node;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.nodeFill;
        ctx.stroke();

        /* 站名：只画当前站点与悬停站点，减少每帧文字绘制 */
        if (isActive || isHover) {
          ctx.font = '600 15px "Microsoft YaHei",system-ui,sans-serif';
          ctx.fillStyle = c.text;
          ctx.textAlign = 'left';
          ctx.fillText(String(n + 1).padStart(2, '0') + ' ' + ROUTE[n].name, p.x + 15, p.y + 4);
        }
      }

      /* 5) 行进中的红点：贴图光晕 + 实心圆点 */
      if (glowSprite) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(glowSprite, endP.x - 17, endP.y - 17, 34, 34);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(endP.x, endP.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5b45';
      ctx.fill();

      /* 6) 起点 / 终点标注 */
      ctx.font = '600 13px "Microsoft YaHei",system-ui,sans-serif';
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.fillText('起点 · 江西瑞金', pts[0].x, pts[0].y - 22);
      var lastPt = pts[nodeAt[ROUTE.length - 1]];
      ctx.fillText('终点 · 甘肃会宁', lastPt.x + 12, lastPt.y - 18);
    }

    /* ----- 节点列表 ----- */
    function escapeAttr(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildList() {
      if (!list) return;
      list.innerHTML = ROUTE.map(function (n, i) {
        return '<li class="route-item' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" ' +
          'tabindex="0" role="button" aria-label="' + escapeAttr(n.date + ' ' + n.name + '，' + n.place) + '">' +
          '<span class="ri-idx">' + (i + 1) + '</span>' +
          '<span>' +
            '<span class="ri-date">' + n.date + ' · ' + n.place + '</span>' +
            '<span class="ri-name">' + n.name + '</span>' +
            '<span class="ri-desc">' + escapeAttr(n.desc) + '</span>' +
          '</span>' +
          '</li>';
      }).join('');
    }

    function setActive(i, fromUser) {
      var prev = activeIdx;
      activeIdx = Math.max(0, Math.min(ROUTE.length - 1, i));
      var items = $$('.route-item', list);

      /* 只在当前项变化时改动 DOM：动画每帧推进时避免整列表重排 */
      if (activeIdx !== prev) {
        for (var k = Math.min(prev, activeIdx); k <= Math.max(prev, activeIdx); k++) {
          var el = items[k];
          if (!el) continue;
          el.classList.toggle('is-active', k === activeIdx);
          el.classList.toggle('is-done', k < activeIdx);
        }
        var cur = items[activeIdx];
        if (cur && cur.scrollIntoView && list) {
          var box = list.getBoundingClientRect();
          var r = cur.getBoundingClientRect();
          if (r.top < box.top || r.bottom > box.bottom) {
            cur.scrollIntoView({ block: 'nearest', behavior: fromUser ? 'smooth' : 'auto' });
          }
        }
      }

      if (caption) {
        var html = '<span class="cap-year">' + ROUTE[activeIdx].year + '</span>' +
          '<span class="cap-text">' + ROUTE[activeIdx].date + '　' + ROUTE[activeIdx].name +
          '：' + ROUTE[activeIdx].desc + '</span>';
        if (caption.innerHTML !== html) caption.innerHTML = html;   // 内容未变则不碰 DOM
      }
      if (tip && !tip.hidden) showTip(activeIdx);
    }

    function showTip(i) {
      if (!tip) return;
      var p = pts[nodeAt[i]];
      var box = canvas.getBoundingClientRect();
      var stage = canvas.parentElement.getBoundingClientRect();
      var x = (p.x / W) * box.width + (box.left - stage.left);
      var y = (p.y / H) * box.height + (box.top - stage.top);
      tip.style.left = Math.max(120, Math.min(stage.width - 60, x)) + 'px';
      tip.style.top = Math.max(60, y) + 'px';
      tip.innerHTML = '<b>' + ROUTE[i].date + '</b>' + ROUTE[i].name + '（' + ROUTE[i].place + '）';
      tip.hidden = false;
    }

    function hideTip() { if (tip) tip.hidden = true; }

    /* ----- 动画循环 ----- */
    function tick(ts) {
      if (!playing || hidden) { frameId = null; return; }
      if (!lastTs) lastTs = ts;
      var dt = Math.min(64, ts - lastTs);
      lastTs = ts;

      /* 约 17 秒走完全程 */
      progress = Math.min(1, progress + dt / 17000);

      /* 走到某个站点就切换当前事件 */
      var nextActive = 0;
      for (var i = 0; i < ROUTE.length; i++) {
        if (progress >= nodeProgress(i) - 0.002) nextActive = i;
      }
      if (nextActive !== activeIdx) setActive(nextActive);

      draw(ts);

      if (progress >= 1) {
        playing = false;
        updatePlayUI();
        return;
      }
      frameId = raf(tick);
    }

    function play() {
      if (playing) return;
      if (progress >= 1) progress = 0;
      playing = true;
      lastTs = 0;
      updatePlayUI();
      if (!frameId) frameId = raf(tick);
    }
    function pause() {
      playing = false;
      lastTs = 0;
      if (frameId) { caf(frameId); frameId = null; }
      updatePlayUI();
      scheduleRender();
    }
    function updatePlayUI() {
      document.documentElement.classList.toggle('is-paused', !playing);
      if (playLabel) playLabel.textContent = playing ? '暂停' : (progress >= 1 ? '重新播放' : '继续');
      if (playBtn) playBtn.setAttribute('aria-pressed', String(playing));
    }

    /* ----- 交互 ----- */
    function hitTest(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var x = (clientX - rect.left) / rect.width * W;
      var y = (clientY - rect.top) / rect.height * H;
      for (var i = 0; i < ROUTE.length; i++) {
        var p = pts[nodeAt[i]];
        if (Math.hypot(p.x - x, p.y - y) < 22) return i;
      }
      return -1;
    }

    function jumpTo(i) {
      progress = Math.max(progress, nodeProgress(i));
      setActive(i, true);
      scheduleRender();
      updatePlayUI();
    }

    canvas.addEventListener('mousemove', function (e) {
      var i = hitTest(e.clientX, e.clientY);
      if (i !== hoverIdx) {
        hoverIdx = i;
        canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
        if (i >= 0) showTip(i); else hideTip();
        scheduleRender();
      }
    });
    canvas.addEventListener('mouseleave', function () {
      hoverIdx = -1;
      hideTip();
      scheduleRender();
    });
    canvas.addEventListener('click', function (e) {
      var i = hitTest(e.clientX, e.clientY);
      if (i >= 0) { jumpTo(i); showTip(i); }
    });

    if (list) {
      list.addEventListener('click', function (e) {
        var el = e.target.closest('.route-item');
        if (el) jumpTo(Number(el.dataset.idx));
      });
      list.addEventListener('keydown', function (e) {
        var el = e.target.closest('.route-item');
        if (!el) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jumpTo(Number(el.dataset.idx));
        }
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        if (playing) pause(); else play();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        progress = 0;
        activeIdx = 0;
        setActive(0);
        play();
      });
    }

    /* 主题切换：底图缓存失效后重绘 */
    window.addEventListener('lumen:theme', function () {
      drawnTheme = null;
      baseColors = null;
      base = null;
      scheduleRender();
    });

    /* 区块离开视野时暂停，回到视野继续 */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          hidden = !en.isIntersecting;
          if (!hidden && playing && !frameId) {
            lastTs = 0;
            frameId = raf(tick);
          }
        });
      }, { threshold: 0.08 }).observe(canvas.parentElement);
    }

    /* 窗口尺寸变化：重建底图缓存（防抖） */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 160);
    });

    /* ----- 启动 ----- */
    buildPath();
    buildList();
    setActive(0);
    buildGlowSprite();
    resize();
    updatePlayUI();
    if (reduceMotion) {
      progress = 1;                 // 关闭动效：直接展示完整路线
      setActive(ROUTE.length - 1);
      renderNow();
      updatePlayUI();
    } else {
      if (!frameId) frameId = raf(tick);
    }
  }

  /* ============================================================
     6. 长征大事记时间轴（滚动进入时逐条点亮）
     ============================================================ */
  function initTimeline() {
    var items = $$('#timelineList > li');
    if (!items.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (li) { li.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en, k) {
        if (en.isIntersecting) {
          var el = en.target;
          window.setTimeout(function () { el.classList.add('is-visible'); }, k * 90);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -60px 0px' });
    items.forEach(function (li) { io.observe(li); });
  }

  /* ============================================================
     7. 长征精神翻转卡片 + 语音讲解
     ============================================================ */
  var SPIRIT = [
    {
      title: '把全国人民和中华民族的根本利益看得高于一切',
      short: '坚定革命的理想和信念，坚信正义事业必然胜利——这是长征精神最深的底色。',
      full: '把全国人民和中华民族的根本利益看得高于一切，坚定革命的理想和信念，坚信正义事业必然胜利的精神。',
      quote: '雪山草地没有路，但心里有方向。',
      icon: 'flag'
    },
    {
      title: '为了救国救民，不怕任何艰难险阻',
      short: '不惜付出一切牺牲，是这支队伍穿越绝境的力量来源。',
      full: '为了救国救民，不怕任何艰难险阻，不惜付出一切牺牲的精神。',
      quote: '他们平均年龄不到 20 岁，却走了两万五千里。',
      icon: 'shield'
    },
    {
      title: '坚持独立自主、实事求是',
      short: '一切从实际出发，是遵义会议留给后人最宝贵的启示。',
      full: '坚持独立自主、实事求是，一切从实际出发的精神。',
      quote: '路是走出来的，也是想明白之后才走对的。',
      icon: 'compass'
    },
    {
      title: '顾全大局、严守纪律、紧密团结',
      short: '把大局放在个人之前，把队伍拧成一股绳。',
      full: '顾全大局、严守纪律、紧密团结的精神。',
      quote: '一个人可以走得很快，一群人才能走到陕北。',
      icon: 'hands'
    },
    {
      title: '紧紧依靠人民群众，同人民群众生死相依',
      short: '患难与共、艰苦奋斗，人民群众是长征胜利的根本保证。',
      full: '紧紧依靠人民群众，同人民群众生死相依、患难与共、艰苦奋斗的精神。',
      quote: '于都河上的浮桥，是百姓拆下自家门板搭起来的。',
      icon: 'heart'
    }
  ];

  var ICONS = {
    flag: '<path d="M5 3v18M5 4h12l-2 4 2 4H5"/>',
    shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 2 2-5z"/>',
    hands: '<path d="M7 11V6a2 2 0 1 1 4 0v5M11 11V5a2 2 0 1 1 4 0v6M15 11V7a2 2 0 1 1 4 0v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-2a2 2 0 1 1 4 0"/>',
    heart: '<path d="M12 20s-7-4.6-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.4 12 20 12 20z"/>'
  };

  function initSpirit() {
    var grid = $('#spiritGrid');
    if (!grid) return;

    grid.innerHTML = SPIRIT.map(function (s, i) {
      return '<div class="spirit-card reveal" data-idx="' + i + '" tabindex="0" role="button" ' +
        'aria-label="长征精神第 ' + (i + 1) + '条：' + s.title + '，点击查看完整表述">' +
        '<div class="spirit-inner">' +
          '<div class="spirit-face spirit-front">' +
            '<span class="sp-num">0' + (i + 1) + '</span>' +
            '<span class="sp-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
              'stroke-linecap="round" stroke-linejoin="round">' + ICONS[s.icon] + '</svg></span>' +
            '<h3>' + s.title + '</h3>' +
            '<p>' + s.short + '</p>' +
            '<span class="sp-hint">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 6l6 6-6 6"/></svg>' +
              '点击翻面看完整表述' +
            '</span>' +
          '</div>' +
          '<div class="spirit-face spirit-back">' +
            '<h4>长征精神 · 第 ' + (i + 1) + '条</h4>' +
            '<p class="sp-full">' + s.full + '</p>' +
            '<p class="sp-quote">' + s.quote + '</p>' +
            '<button class="speak-btn" type="button" data-speak="' + i + '" aria-label="朗读第 ' + (i + 1) + '条长征精神">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a7 7 0 0 1 0 11"/></svg>' +
              '语音讲解' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    /* 翻面：点击卡片（点喇叭不翻面） */
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.spirit-card');
      if (!card) return;
      if (e.target.closest('.speak-btn')) return;
      card.classList.toggle('flipped');
    });
    grid.addEventListener('keydown', function (e) {
      var card = e.target.closest('.spirit-card');
      if (!card) return;
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.speak-btn')) {
        e.preventDefault();
        card.classList.toggle('flipped');
      }
    });

    /* 语音讲解：使用浏览器内置 Web Speech API */
    var synth = window.speechSynthesis;
    var currentBtn = null;

    function stopSpeak() {
      if (synth) synth.cancel();
      if (currentBtn) { currentBtn.classList.remove('is-speaking'); currentBtn = null; }
    }

    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('.speak-btn');
      if (!btn) return;
      e.stopPropagation();

      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        var orig = btn.innerHTML;
        btn.textContent = '当前浏览器不支持语音';
        window.setTimeout(function () { btn.innerHTML = orig; }, 1800);
        return;
      }
      if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;

      var isSameBtn = currentBtn === btn;
      stopSpeak();
      if (isSameBtn) return;      // 再点一次即停止

      var s = SPIRIT[Number(btn.dataset.speak)];
      var u = new SpeechSynthesisUtterance('长征精神，' + s.full);
      u.lang = 'zh-CN';
      u.rate = 0.95;
      u.pitch = 1;
      var voices = synth.getVoices ? synth.getVoices() : [];
      for (var i = 0; i < voices.length; i++) {
        if (/zh|Chinese/i.test(voices[i].lang)) { u.voice = voices[i]; break; }
      }
      u.onend = function () { if (currentBtn === btn) { btn.classList.remove('is-speaking'); currentBtn = null; } };
      u.onerror = function () { if (currentBtn === btn) { btn.classList.remove('is-speaking'); currentBtn = null; } };
      btn.classList.add('is-speaking');
      currentBtn = btn;
      synth.speak(u);
    });

    window.addEventListener('beforeunload', stopSpeak);
  }

  /* ============================================================
     8. 数据长征：数字滚动
     ============================================================ */
  function initCounters() {
    var nodes = $$('.count');
    if (!nodes.length) return;

    function run(el) {
      var target = Number(el.dataset.target) || 0;
      var unit = el.dataset.unit || '';
      var dur = reduceMotion ? 0 : 1500;
      var start = performance.now();

      function step(now) {
        var p = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.round(target * eased);
        el.innerHTML = val.toLocaleString('zh-CN') + '<em>' + unit + '</em>';
        if (p < 1) raf(step);
      }
      raf(step);
    }

    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(run);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.5 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ============================================================
     9. 长征知识小自测
     ============================================================ */
  var QUIZ = [
    {
      q: '中央红军从江西瑞金、于都等地出发，开始长征是在哪一年？',
      opts: ['1934 年 10 月', '1935 年 1 月', '1935 年 10 月', '1936 年 10 月'],
      a: 0,
      ex: '1934 年 10 月，中央红军 8.6 万余人从江西瑞金、于都等地出发，开始战略转移。'
    },
    {
      q: '被称为"党的历史上一个生死攸关的转折点"的是哪次会议？',
      opts: ['八七会议', '遵义会议', '古田会议', '瓦窑堡会议'],
      a: 1,
      ex: '1935 年 1 月的遵义会议，确立了毛泽东在党中央和红军的领导地位，在最危急关头挽救了党、挽救了红军、挽救了中国革命。'
    },
    {
      q: '"四渡赤水"战役中，红军主要渡过的河流是？',
      opts: ['金沙江', '大渡河', '赤水河', '乌江'],
      a: 2,
      ex: '红军在川黔滇边界四次渡过赤水河，忽东忽西、声东击西，牢牢掌握战场主动权。'
    },
    {
      q: '红军三大主力会师、宣告长征胜利结束的地点是？',
      opts: ['陕西吴起镇', '甘肃会宁', '四川泸定', '贵州遵义'],
      a: 1,
      ex: '1936 年 10 月，红军三大主力在甘肃会宁、静宁将台堡会师，宣告长征胜利结束；吴起镇是 1935 年 10 月中央红军到达陕北的地点。'
    },
    {
      q: '下列哪一项不属于长征精神的内涵？',
      opts: ['把全国人民和中华民族的根本利益看得高于一切', '为了救国救民，不怕任何艰难险阻',
        '坚持独立自主、实事求是', '因循守旧，照搬既有经验'],
      a: 3,
      ex: '长征精神强调坚定理想信念、不怕牺牲、独立自主实事求是、顾全大局严守纪律、紧紧依靠人民群众。"因循守旧"与长征精神中的独立自主、实事求是完全相反。'
    }
  ];

  function initQuiz() {
    var form = $('#quizForm');
    var body = $('#quizBody');
    var result = $('#quizResult');
    if (!form || !body) return;

    body.innerHTML = QUIZ.map(function (item, i) {
      return '<div class="q-item" data-q="' + i + '">' +
        '<p class="q-title"><i>' + (i + 1) + '</i><span>' + item.q + '</span></p>' +
        '<div class="q-opts">' +
          item.opts.map(function (o, k) {
            return '<label class="q-opt">' +
              '<input type="radio" name="q' + i + '" value="' + k + '">' +
              '<span>' + String.fromCharCode(65 + k) + '. ' + o + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
        '<p class="q-explain"></p>' +
      '</div>';
    }).join('');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var score = 0, unanswered = 0;

      QUIZ.forEach(function (item, i) {
        var box = $('.q-item[data-q="' + i + '"]', body);
        var chosen = $('input[name="q' + i + '"]:checked', box);
        var ex = $('.q-explain', box);
        $$('.q-opt', box).forEach(function (l) { l.classList.remove('correct', 'wrong'); });

        var correctLabel = $$('.q-opt', box)[item.a];
        if (correctLabel) correctLabel.classList.add('correct');

        if (!chosen) {
          unanswered++;
        } else if (Number(chosen.value) === item.a) {
          score++;
        } else {
          var wrongLabel = chosen.closest('.q-opt');
          if (wrongLabel) wrongLabel.classList.add('wrong');
        }
        ex.innerHTML = '<b>答案：' + String.fromCharCode(65 + item.a) + '</b>　' + item.ex;
        ex.classList.add('show');
      });

      var msg;
      if (score === QUIZ.length) msg = '全部正确，这条路你已经走熟了。';
      else if (score >= 3) msg = '基础扎实，再回看一遍路线图会更加清晰。';
      else msg = '建议重新浏览"长征路线"与"大事记"两个板块后再来挑战。';
      if (unanswered) msg += '（有 ' + unanswered + ' 题未作答）';

      result.hidden = false;
      result.innerHTML = '<b>' + score + ' / ' + QUIZ.length + '</b><p>' + msg + '</p>';
      result.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    form.addEventListener('reset', function () {
      window.setTimeout(function () {
        $$('.q-explain', body).forEach(function (p) { p.classList.remove('show'); p.innerHTML = ''; });
        $$('.q-opt', body).forEach(function (l) { l.classList.remove('correct', 'wrong'); });
        result.hidden = true;
        result.innerHTML = '';
      }, 0);
    });
  }

  /* ============================================================
     10. 滚动出现动画、主题切换与初始化
     ============================================================ */
  function initReveal() {
    var els = $$('.reveal');
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  function initTheme() {
    var btn = $('#themeBtn');
    try {
      var saved = localStorage.getItem('changan-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (err) { /* 隐私模式下忽略 */ }

    if (!btn) return;
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('changan-theme', next); } catch (err) {}
      window.dispatchEvent(new Event('lumen:theme'));
    });
  }

  /* 首屏标题里的渐变字依赖 background-clip:text，个别旧内核可能不支持；
     不支持时文字会变透明，这里做一次能力检测并回退为纯色，避免标题"消失" */
  function initHeroTitle() {
    var grad = $('.hero-title .grad');
    if (!grad) return;
    var cs = window.getComputedStyle ? window.getComputedStyle(grad) : null;
    if (!cs) return;
    var clip = cs.webkitBackgroundClip || cs.backgroundClip || '';
    if (clip.indexOf('text') === -1) {
      grad.style.webkitTextFillColor = '';
      grad.style.background = 'none';
      grad.style.color = 'var(--gold-400)';
    }
  }

  function init() {
    initTheme();
    initNav();
    initHeroCanvas();
    initHeroTitle();
    initTerminal();
    initRouteMap();
    initTimeline();
    initSpirit();
    initCounters();
    initQuiz();
    initReveal();
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
