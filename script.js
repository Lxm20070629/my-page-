/* ============================================================
   "数字忆长征，AI 启初心" 红色主题网页
   交互脚本 script.js  —— 原生 JavaScript，无任何第三方依赖
   模块一览：
     1. 基础工具与主题配色
     2. 顶栏导航、滚动进度、返回顶部
     3. 首屏 Canvas 星火粒子背景
     4. 首屏终端打字机效果
     5. 长征路线动画地图（Canvas 逐段绘制 + 节点联动）
     6. 长征大事记：十段史料 + 讲解视频
     7. 讲解视频播放浮层
     8. 长征精神翻转卡片 + 语音讲解
     9. 数据长征：数字滚动动画
    10. 长征知识小自测
    11. 滚动出现动画、主题切换与初始化

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

  /* 运行时报错自检：页面脚本一旦抛错，就在顶部显示一条提示条，
     避免出现"点了没反应、用户完全不知道哪里坏了"的情况。
     正式展示时若无报错，这个条不会出现。 */
  function reportError(msg, where) {
    try {
      var bar = $('#errBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'errBar';
        bar.className = 'err-bar';
        var host = document.body || document.documentElement;
        host.insertBefore(bar, host.firstChild);
      }
      bar.innerHTML = '<b>页面脚本执行出错</b><span>' + msg +
        (where ? '（' + where + '）' : '') + '</span>' +
        '<button type="button" onclick="this.parentNode.remove()">知道了</button>';
    } catch (err) { /* 报错条自身出错就静默，绝不二次抛出 */ }
  }

  function initErrorReporter() {
    window.addEventListener('error', function (ev) {
      reportError(String(ev.message || '未知错误'),
        (ev.filename || '').split('/').pop() + ':' + (ev.lineno || '?'));
    });
    window.addEventListener('unhandledrejection', function (ev) {
      reportError('Promise 未捕获异常：' +
        (ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
    });
  }

  /* 兜底显示：把所有 .reveal 元素强制点亮。
     预览面板、整页截图、打印 PDF 时不会触发出场动画，
     若不兜底，屏外内容会长期停在半透明状态（曾导致答题选项"看不清"）。 */
  function forceRevealAll() {
    var els = $$('.reveal');
    els.forEach(function (el) { el.classList.add('is-visible'); });
  }

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
     4. 首屏 · 数字长征史料检索（可交互）
     ------------------------------------------------------------
     做成一个可点击的检索面板：左侧是检索项，点一下右侧就展出一段
     史料。首屏默认把"行程总览"逐字打印出来，其余条目点击后即时切换。
     文字全部为中文，不含任何英文命令行；标点使用 ASCII 竖线与半角
     逗号——全角逗号（U+FF0C）在等宽字体里会撑出双倍空白、中点
     （U+00B7）会显得像浮着的小点，二者都容易被误认为乱码。
     ============================================================ */
  var ARCHIVE = [
    {
      id: 'route',
      label: '行程总览',
      icon: 'route',
      lines: [
        { t: 'hl', s: '二万五千里 | 十四省 | 十八座大山 | 二十四条大河' },
        { t: 'out', s: '1934年10月出发, 1936年10月三大主力会师, 历时两年。' },
        { t: 'out', s: '途经江西、福建、广东、湖南、广西、贵州、云南、四川、西康、甘肃、陕西等14省。' },
        { t: 'out', s: '翻越18座大山, 跨越24条大河, 进行重要战役战斗600余次, 攻占县城700余座。' }
      ]
    },
    {
      id: 'start',
      label: '出发地与集结',
      icon: 'flag',
      lines: [
        { t: 'hl', s: '1934年10月 | 江西瑞金、于都' },
        { t: 'out', s: '中央红军8.6万余人从江西瑞金、于都等地出发, 开始战略转移。' },
        { t: 'out', s: '于都百姓拆下自家门板, 在河上架起浮桥, 送红军渡河。' },
        { t: 'out', s: '为掩护主力转移, 红十军团等部北上抗日, 方志敏在战斗中被捕, 1935年8月就义。' }
      ]
    },
    {
      id: 'battle',
      label: '重要战役与转折',
      icon: 'star',
      lines: [
        { t: 'hl', s: '湘江血战 | 遵义会议 | 四渡赤水' },
        { t: 'out', s: '1934年11月至12月, 红军在湘江两岸与敌血战, 突破第四道封锁线后由8.6万余人锐减至3万余人。' },
        { t: 'out', s: '1935年1月, 遵义会议确立了毛泽东在党中央和红军的领导地位, 是党的历史上一个生死攸关的转折点。' },
        { t: 'out', s: '此后四渡赤水、巧渡金沙江、强渡大渡河、飞夺泸定桥, 红军由被动转为主动。' }
      ]
    },
    {
      id: 'hard',
      label: '雪山草地',
      icon: 'snow',
      lines: [
        { t: 'hl', s: '夹金山 | 松潘草地' },
        { t: 'out', s: '1935年6月起, 红军翻越夹金山等终年积雪的高山, 空气稀薄, 严寒刺骨。' },
        { t: 'out', s: '8月穿越松潘草地, 泥沼遍布、粮尽水毒, 许多战士牺牲在草地上。' },
        { t: 'out', s: '翻雪山、过草地, 是长征中最艰苦的一段行程。' }
      ]
    },
    {
      id: 'gather',
      label: '会师与里程',
      icon: 'meet',
      lines: [
        { t: 'hl', s: '1935年10月吴起镇 | 1936年10月会宁' },
        { t: 'out', s: '1935年10月, 中央红军到达陕北吴起镇, 历时一年, 行程二万五千里。' },
        { t: 'out', s: '1936年10月, 红军三大主力在甘肃会宁、静宁将台堡会师, 长征胜利结束。' },
        { t: 'out', s: '二万五千里, 出自毛泽东1935年12月《论反对日本帝国主义的策略》。' }
      ]
    }
  ];

  var ARCHIVE_ICONS = {
    route: '<path d="M4 18c4 0 4-12 8-12s4 12 8 12"/><circle cx="4" cy="18" r="1.8"/><circle cx="20" cy="18" r="1.8"/>',
    flag: '<path d="M6 3v18"/><path d="M6 4h11l-2 3.5L17 11H6z"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"/>',
    snow: '<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>',
    meet: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>'
  };

  function initTerminal() {
    var body = $('#terminalBody');
    if (!body) return;
    var opts = $('#queryOpts');
    var label = $('#queryLabel');

    function plain(html) {
      return html.replace(/&gt;/g, '>').replace(/<[^>]+>/g, '');
    }

    /* 检索项按钮（类名用 arc- 前缀，避免与答题区 .q-opt 的浅底深字冲突） */
    if (opts) {
      opts.innerHTML = ARCHIVE.map(function (r, i) {
        return '<button class="arc-opt' + (i === 0 ? ' is-active' : '') + '" type="button" ' +
          'data-id="' + r.id + '" aria-pressed="' + (i === 0) + '">' +
          '<span class="arc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + ARCHIVE_ICONS[r.icon] + '</svg></span>' +
          '<span class="arc-txt">' + r.label + '</span></button>';
      }).join('');
    }

    /* 直接渲染（不带动画：用于减少动效偏好） */
    function renderLines(lines) {
      body.innerHTML = lines.map(function (l) {
        return '<p class="t-line ' + (l.t === 'hl' ? 't-hl' : 't-out') + '">' + l.s + '</p>';
      }).join('');
      body.scrollTop = body.scrollHeight;
    }

    /* 逐字打印：整行字符一次性建好，未打印的部分先以暗色呈现，
       打字时只翻转字符的样式类，行宽固定不抖动 */
    var typeTimer = null;
    function typeLines(lines) {
      if (typeTimer) { window.clearTimeout(typeTimer); typeTimer = null; }
      body.innerHTML = '';
      var li = 0, ci = 0, spans = null, node = null;

      function step() {
        if (li >= lines.length) { typeTimer = null; return; }
        var line = lines[li];
        var text = plain(line.s);
        if (ci === 0) {
          node = document.createElement('p');
          node.className = 't-line ' + (line.t === 'hl' ? 't-hl' : 't-out');
          var caret = document.createElement('span');
          caret.className = 'caret';
          node.appendChild(caret);
          spans = [];
          for (var i = 0; i < text.length; i++) {
            var sp = document.createElement('span');
            sp.className = 'dim';
            sp.textContent = text.charAt(i);
            node.insertBefore(sp, caret);
            spans.push(sp);
          }
          body.appendChild(node);
          body.scrollTop = body.scrollHeight;
        }
        if (spans[ci]) spans[ci].className = '';
        ci++;
        if (ci < text.length) {
          typeTimer = window.setTimeout(step, 22);
        } else {
          node.innerHTML = line.s;        // 整行完成，光标消失
          body.scrollTop = body.scrollHeight;
          li++; ci = 0;
          typeTimer = window.setTimeout(step, 130);
        }
      }
      step();
    }

    function showRecord(i, animate) {
      var rec = ARCHIVE[i];
      if (!rec) return;
      if (label) label.textContent = rec.label;
      if (opts) {
        Array.prototype.forEach.call(opts.children, function (b, k) {
          b.classList.toggle('is-active', k === i);
          b.setAttribute('aria-pressed', String(k === i));
        });
      }
      if (animate) typeLines(rec.lines); else renderLines(rec.lines);
    }

    /* 点击切换（事件委托，重绘后依然有效） */
    if (opts) {
      opts.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.arc-opt') : null;
        if (!btn) return;
        for (var i = 0; i < ARCHIVE.length; i++) {
          if (ARCHIVE[i].id === btn.dataset.id) { showRecord(i, !reduceMotion); return; }
        }
      });
    }

    /* 首屏：进入视野后把默认条目逐字打印出来 */
    var started = false;
    function kick() {
      if (started) return;
      started = true;
      showRecord(0, !reduceMotion);
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { kick(); io.disconnect(); } });
      }, { threshold: 0.1 });
      io.observe(body);
    } else {
      kick();
    }
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
     6. 长征大事记：十段史料 + 讲解视频
     ------------------------------------------------------------
     每段事记 = 原创插画（作视频封面）+ 日期 + 标题 + 史实 + 讲解视频。
     视频来源在页面末尾"资料来源"区逐条列出；cite 字段就是那里的出处。
     体积较大的视频一律 preload="none"：不点开就不下载，避免一进页面
     就拖走上百 MB；关闭浮层时销毁 <video>，释放解码器与内存。
     ============================================================ */
  var TIMELINE = [
    {
      date: '1934.10', title: '于都河畔，出发',
      desc: '中央红军8.6万余人从江西瑞金、于都等地出发，开始战略转移。于都百姓拆下门板搭起浮桥，送红军渡河。',
      poster: 'assets/media/01-yudu.svg',
      video: { src: 'assets/media/01-yidu.mp4', cite: '来源待补充' }
    },
    {
      date: '1934.11 — 12', title: '血战湘江',
      desc: '为突破第四道封锁线，红军在湘江两岸与敌血战，付出极其惨重的代价。这一战让全党全军开始深刻反思"左"倾错误的危害。',
      poster: 'assets/media/02-xiangjiang.svg',
      video: { src: 'assets/media/02-xiangjiang.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.01', title: '遵义会议，伟大转折',
      desc: '会议确立了毛泽东在党中央和红军的领导地位，在最危急关头挽救了党、挽救了红军、挽救了中国革命，是党的历史上一个生死攸关的转折点。',
      poster: 'assets/media/03-zunyi.svg',
      video: { src: 'assets/media/03-zunyi.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.01 — 05', title: '四渡赤水，神来之笔',
      desc: '在川黔滇边界，红军四次渡过赤水河，忽东忽西、声东击西，牢牢掌握战场主动权，被称为长征中最精彩的一仗。',
      poster: 'assets/media/04-chishui.svg',
      video: { src: 'assets/media/04-chishui.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.05', title: '巧渡金沙江',
      desc: '红军在皎平渡仅靠几只木船，用七天七夜渡过金沙江，把追兵远远甩在江南岸。',
      poster: 'assets/media/05-jinsha.svg',
      video: { src: 'assets/media/05-jinsha.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.05', title: '强渡大渡河 · 飞夺泸定桥',
      desc: '十七名勇士驾小船冒着弹雨强渡大渡河；随后二十二名突击队员攀着十三根铁索夺下泸定桥，为全军打开北上通道。',
      poster: 'assets/media/05-jinsha.svg',
      video: { src: 'assets/media/05b-dadu-luding.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.06', title: '翻雪山',
      desc: '红军翻越夹金山等终年积雪的高山，空气稀薄、严寒刺骨，战士们互相搀扶，翻过一座又一座雪山。',
      poster: 'assets/media/06-xueshan.svg',
      video: { src: 'assets/media/06-xueshan.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.08', title: '过草地',
      desc: '穿越茫茫松潘草地，泥沼遍布、粮尽水毒。饥饿、寒冷与沼泽夺走了许多战士的生命，队伍依旧向北。',
      poster: 'assets/media/06-xueshan.svg',
      video: { src: 'assets/media/06b-caodi.mp4', cite: '来源待补充' }
    },
    {
      date: '1935.10 — 1936.10', title: '到达陕北 · 三军会师',
      desc: '1935年10月，中央红军到达陕北吴起镇；1936年10月，红军三大主力在甘肃会宁、静宁将台堡会师，宣告长征胜利结束。',
      poster: 'assets/media/07-huining.svg',
      video: { src: 'assets/media/07-huining.mp4', cite: '来源待补充' }
    }
  ];

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initTimeline() {
    var list = $('#timelineList');
    if (!list) return;

    list.innerHTML = TIMELINE.map(function (e, i) {
      var media = '';
      if (e.poster) {
        var play = e.video && e.video.src
          ? '<button class="tl-play" type="button" data-tl="' + i + '" ' +
            'aria-label="播放讲解视频：' + escapeAttr(e.title) + '">' +
            '<span class="tl-play-ico">' + PLAY_ICON + '</span>观看讲解视频</button>'
          : '<span class="tl-novideo">暂无视频</span>';
        media =
          '<figure class="tl-media">' +
            '<img src="' + escapeAttr(e.poster) + '" alt="' + escapeAttr(e.title + '：原创矢量插画') +
              '" loading="lazy" decoding="async" width="640" height="360">' +
            '<figcaption>' + play + '</figcaption>' +
          '</figure>';
      }
      return '<li class="reveal">' +
        '<div class="tl-node" aria-hidden="true"></div>' +
        '<article class="tl-card">' + media +
          '<div class="tl-body">' +
            '<span class="tl-date">' + e.date + '</span>' +
            '<h3>' + e.title + '</h3>' +
            '<p>' + e.desc + '</p>' +
          '</div>' +
        '</article>' +
      '</li>';
    }).join('');

    /* 渲染视频来源清单（页面末尾"资料来源"区） */
    var srcList = $('#videoSources');
    if (srcList) {
      srcList.innerHTML = TIMELINE.map(function (e, i) {
        var cite = (e.video && e.video.cite) ? e.video.cite : '来源待补充';
        return '<li><span class="src-name">' + String(i).padStart(2, '0') + ' ' + e.title + '</span>' +
          '<span class="src-meta">' + cite + '</span></li>';
      }).join('');
    }

    /* 逐条点亮 */
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
     7. 讲解视频播放浮层
     ------------------------------------------------------------
     · 只在点击时创建 <video> 并设置 src：不点开就一个字节都不下载，
       十个视频合计上百 MB，预载会让页面直接卡死；
     · 关闭时移除 src 并销毁元素，释放解码器与内存；
     · 底部显示该段的来源标注，与页面末尾的"资料来源"区对应。
     ============================================================ */
  function initMediaPlayer() {
    var modal = $('#mediaModal');
    if (!modal) return;
    var body = $('#mediaBody');
    var titleEl = $('#mediaTitle');
    var srcEl = $('#mediaSource');
    var lastFocus = null;

    function close() {
      var v = body.querySelector ? body.querySelector('video') : null;
      if (v) {
        try { v.pause(); } catch (err) {}
        try { v.removeAttribute('src'); v.load && v.load(); } catch (err) {}
      }
      body.innerHTML = '';
      modal.hidden = true;
      document.documentElement.style.overflow = '';
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (err) {} }
    }

    function open(i, btn) {
      var item = TIMELINE[i];
      if (!item || !item.video || !item.video.src) return;
      lastFocus = btn || null;
      if (titleEl) titleEl.textContent = item.title;
      if (srcEl) srcEl.textContent = item.video.cite || '来源待补充';

      /* 先把弹层显示出来，再填内容：即使后续某一步出错，
         用户也能用关闭按钮退出，不会卡在打不开又关不掉的死局里 */
      modal.hidden = false;
      document.documentElement.style.overflow = 'hidden';

      body.innerHTML =
        '<div class="mm-stage">' +
          '<video class="mm-video" src="' + escapeAttr(item.video.src) + '" controls autoplay ' +
            'playsinline preload="metadata"></video>' +
          '<div class="mm-loading">视频加载中…</div>' +
        '</div>';

      var v = body.querySelector('video');
      var load = body.querySelector('.mm-loading');
      if (v) {
        v.addEventListener('loadeddata', function () { if (load) load.hidden = true; });
        v.addEventListener('playing', function () { if (load) load.hidden = true; });
        v.addEventListener('error', function () {
          if (load) load.innerHTML = '视频无法播放。<br>请确认文件已放入 源码/assets/media/ 目录，或用本地预览服务器打开。';
        });
        /* 保险：8 秒后仍未播起来，直接给出提示，不让用户对着黑屏干等 */
        window.setTimeout(function () {
          if (load && !load.hidden && v.readyState < 2) {
            load.innerHTML = '视频仍在加载或无法播放。<br>若持续如此，请用本地预览服务器打开页面。';
          }
        }, 8000);
      }
      var cb = $('.mm-close', modal);
      if (cb && cb.focus) { try { cb.focus(); } catch (err) {} }
    }

    /* 用捕获阶段监听：即使弹层内部有元素吞掉了冒泡，关闭依然有效 */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var play = t && t.closest ? t.closest('.tl-play') : null;
      if (play) { open(Number(play.dataset.tl), play); return; }
      if (t && t.closest && t.closest('[data-close]')) close();
    }, true);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !modal.hidden) close();
    });

    /* 双保险：直接挂在关闭按钮与遮罩上，不依赖事件委托 */
    $$('[data-close]', modal).forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        close();
      });
    });

    /* 初始化结束时强制关闭一次：确保页面一打开绝不会停在"黑框挡屏且关不掉"的状态 */
    modal.hidden = true;
    document.documentElement.style.overflow = '';
  }

  /* ============================================================
     8. 长征精神翻转卡片 + 语音讲解
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
     9. 数据长征：数字滚动
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
    10. 长征知识小自测
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
     11. 滚动出现动画、主题切换与初始化
     ============================================================ */
  /* 滚动出现动画。
     注意：内容绝不能长期停在"半透明 / 位移"状态——预览面板、整页截图、
     生成 PDF 或按 Ctrl+P 打印时，屏外元素不会触发出场动画，会一直看不清。
     所以这里给整批元素加一道 2.6 秒兜底：到点无论是否进入过视口都强制显示。
     正常滚动浏览时用户感知不到差别，屏外渲染也不会残留半透明。 */
  function initReveal() {
    var els = $$('.reveal');
    if (!els.length) return;

    function forceAll() {
      els.forEach(function (el) { el.classList.add('is-visible'); });
    }

    if (reduceMotion || !('IntersectionObserver' in window)) {
      forceAll();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    els.forEach(function (el) { io.observe(el); });

    window.setTimeout(forceAll, 2600);                  // 兜底：到点全部显示
    window.addEventListener('beforeprint', forceAll);   // 打印 / 另存 PDF 前全部显示
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

  /* 每个模块独立容错：任何一处出错都不再拖垮整页。
     之前是"一个 init 抛错，后面的板块全部空白"（线上就出现过这种现象），
     现在改为逐个 try/catch，并在控制台与页面报错条里指出是哪一步失败。 */
  function safeInit(name, fn) {
    try {
      fn();
      return true;
    } catch (err) {
      if (window.console && console.error) {
        console.error('[初始化失败] ' + name + '：', err);
      }
      if (typeof reportError === 'function') {
        reportError(name + ' 初始化失败：' + (err && err.message ? err.message : err));
      }
      return false;
    }
  }

  function init() {
    /* 报错条最先装好，后面的任何异常都能被发现 */
    safeInit('运行时报错提示条', initErrorReporter);
    safeInit('主题', initTheme);
    safeInit('顶栏导航', initNav);
    safeInit('首屏粒子背景', initHeroCanvas);
    safeInit('首屏标题渐变', initHeroTitle);
    safeInit('史料检索面板', initTerminal);
    safeInit('长征路线图', initRouteMap);
    safeInit('长征大事记与讲解视频', initTimeline);
    safeInit('视频播放浮层', initMediaPlayer);
    safeInit('长征精神卡片', initSpirit);
    safeInit('数据长征数字', initCounters);
    safeInit('知识自测', initQuiz);
    safeInit('滚动出现动画', initReveal);

    /* 兜底：确保视频浮层在页面加载时一定是关闭的，
       避免任何异常或环境干扰导致它一开始就挡住页面 */
    var modal = $('#mediaModal');
    if (modal) modal.hidden = true;
    /* 同时兜底：把可能残留的半透明内容强制显示 */
    if (typeof forceRevealAll === 'function') safeInit('兜底显示', forceRevealAll);

    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
