# -*- coding: utf-8 -*-
"""静态检查页面结构：标签配平、锚点可达、资源存在、id 不重复、语言/编码声明。"""
import io, os, re, sys, html.parser, collections

sys.stdout.reconfigure(encoding='utf-8')
ROOT = r"D:\Users\Documents\deepseek-harness\default-workspace\changan-90\源码"
path = os.path.join(ROOT, "index.html")
src = io.open(path, encoding="utf-8").read()

problems, notes = [], []

VOID = {"area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"}

class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = collections.Counter()
        self.hrefs = []
        self.srcs = []
        self.errors = []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if "id" in d:
            self.ids[d["id"]] += 1
        if tag == "a" and "href" in d:
            self.hrefs.append(d["href"])
        if tag in ("script", "link") and ("src" in d or "href" in d):
            self.srcs.append(d.get("src") or d.get("href"))
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append("多余的结束标签 </%s> 行 %d" % (tag, self.getpos()[0]))
            return
        top, pos = self.stack.pop()
        if top != tag:
            self.errors.append("标签不匹配：<%s>（行 %d）被 </%s>（行 %d）关闭" % (top, pos[0], tag, self.getpos()[0]))

p = P()
p.feed(src)

if p.stack:
    for tag, pos in p.stack:
        problems.append("未闭合标签 <%s>（行 %d）" % (tag, pos[0]))
problems += p.errors

dups = [k for k, v in p.ids.items() if v > 1]
if dups:
    problems.append("重复 id：" + ", ".join(dups))
else:
    notes.append("id 唯一，共 %d 个" % len(p.ids))

# 锚点可达
bad = [h for h in p.hrefs if h.startswith("#") and h[1:] and h[1:] not in p.ids]
if bad:
    problems.append("锚点找不到目标：" + ", ".join(sorted(set(bad))))
else:
    notes.append("锚点全部可达（%d 处）" % len([h for h in p.hrefs if h.startswith('#')]))

# 资源文件
for r in set(p.srcs):
    f = os.path.join(ROOT, r)
    if os.path.exists(f):
        notes.append("资源存在：%s（%d 字节）" % (r, os.path.getsize(f)))
    else:
        problems.append("资源缺失：%s" % r)

# 时间轴由 script.js 的 TIMELINE 数据驱动渲染（HTML 里只留空容器），
# 核对数据表的段数与文字完整性。
js_text = ""
js_path = os.path.join(ROOT, "script.js")
if os.path.exists(js_path):
    js_text = io.open(js_path, encoding="utf-8").read()

tl_block = re.search(r'var TIMELINE = \[(.*?)\n  \];', js_text, re.S)
if not tl_block:
    problems.append("未找到 script.js 中的 TIMELINE 数据表")
else:
    data = tl_block.group(1)
    titles = re.findall(r"title: '([^']+)'", data)
    dates = re.findall(r"date: '([^']+)'", data)
    descs = re.findall(r"desc: '([^']*)'", data)
    if len(titles) < 9:
        problems.append("大事记段数不足：%d 段（应为 9 段）" % len(titles))
    else:
        notes.append("大事记共 %d 段（日期 %d、标题 %d、叙述 %d）"
                     % (len(titles), len(dates), len(titles), len(descs)))
    empty = [t for t, d in zip(titles, descs + [''] * len(titles)) if not d.strip()]
    if empty:
        problems.append("以下事记缺少叙述文字：" + ", ".join(empty))
    else:
        notes.append("每段事记都有完整叙述文字")

    if '.mp4' in data:
        problems.append("TIMELINE 数据里仍残留视频文件引用")
    else:
        notes.append("大事记已不含任何视频引用（纯文字时间轴）")

# 新增的四个板块：容器必须在页面里，数据表必须有内容
section_checks = [
    ('id="forces"', 'forcesBody', 'FORCES', 4, '四路红军'),
    ('id="battles"', 'battleGrid', 'BATTLES', 5, '重要战斗'),
    ('id="youth"', 'youthGrid', 'YOUTH', 4, '青春的长征'),
    ('id="sites"', 'siteList', 'SITES', 12, '遗址与纪念地'),
]
for sec_id, holder, table, expect, label in section_checks:
    if sec_id not in src:
        problems.append("页面缺少板块 %s（%s）" % (label, sec_id))
        continue
    if ('id="%s"' % holder) not in src:
        problems.append("板块 %s 缺少渲染容器 #%s" % (label, holder))
        continue
    blk = re.search(r'var ' + table + r' = \[(.*?)\n  \];', js_text, re.S)
    if not blk:
        problems.append("script.js 缺少数据表 %s" % table)
        continue
    n = len(re.findall(r"\{\s*(?:name|date|num):", blk.group(1)))
    if n < expect:
        problems.append("%s 数据条目不足：%d 条（应为 %d 条）" % (label, n, expect))
    else:
        notes.append("%s 板块就位，数据 %d 条" % (label, n))

# 视频相关残留检查：撤掉视频功能后，这些痕迹都不应存在
leftovers = []
for f, keys in [(js_path, ['initMediaPlayer', 'videoSources', 'tl-play', 'assets/media']),
                (os.path.join(ROOT, "index.html"), ['mediaModal', 'videoSources', 'id="sources"', 'tl-play']),
                (css_path if 'css_path' in dir() else os.path.join(ROOT, "style.css"),
                 ['.mm-', '.tl-play', '.tl-media', 'media-modal'])]:
    if not os.path.exists(f):
        continue
    txt = io.open(f, encoding="utf-8").read()
    for k in keys:
        if k in txt:
            leftovers.append("%s 中的 %s" % (os.path.basename(f), k))
if leftovers:
    problems.append("视频功能残留：" + "；".join(leftovers))
else:
    notes.append("视频功能已彻底移除（脚本 / 页面 / 样式均无残留）")

# 浅色底组件绝不能被设成浅色文字（曾把首屏的浅金文字套到浅色答题卡上，
# 选项几乎看不见）。这里对答题区与正文区的类逐条检查其 color 取值。
css_text = ""
css_path = os.path.join(ROOT, "style.css")
if os.path.exists(css_path):
    css_text = io.open(css_path, encoding="utf-8").read()

def strip_media(css):
    """剥掉 @media 块：其中的配色属于上下文覆盖（打印、减少动效），不参与判断"""
    out, i = [], 0
    while i < len(css):
        m = re.compile(r'@media[^{]*\{').search(css, i)
        if not m:
            out.append(css[i:])
            break
        out.append(css[i:m.start()])
        depth, j = 1, m.end()
        while j < len(css) and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        i = j
    return ''.join(out)

base_css = strip_media(css_text)

LIGHT_TEXT = re.compile(r'color\s*:\s*(#f[0-9a-fA-F]{2,5}\b|#fff\b|white|rgba\(255|var\(--hero-text|var\(--gold)', re.I)
SHALLOW_BG_CLASSES = ['q-opt', 'q-title', 'q-explain', 'q-item', 'q-opts',
                      'spirit-face', 'spirit-front', 'tl-card', 'tl-body', 'tl-date',
                      'card', 'stat-card', 'quiz-card', 'route-item', 'ri-name', 'ri-desc',
                      'src-card', 'src-link', 'src-desc', 'src-note', 'aside-card']
light_hits = []
for m in re.finditer(r'\{([^{}]*)\}', base_css):
    head = base_css[:m.start()]
    selector = re.split(r'[};]', head)[-1].strip()
    # 只看"该类自身的规则"：选择器去掉伪类后必须正好以该类结尾
    # （.route-item.is-active .ri-idx 这种后代配色属于另一层，不在此判断）
    for cls in SHALLOW_BG_CLASSES:
        if not re.search(r'\.' + re.escape(cls) + r'(?![\w-])', selector):
            continue
        tail = re.sub(r':[a-z-]+(\([^)]*\))?', '', selector).strip()
        if not tail.endswith('.' + cls):
            continue
        mm = LIGHT_TEXT.search(m.group(1))
        if mm:
            light_hits.append("%s -> %s（规则：%s）" % (cls, mm.group(0).strip(), selector[:40]))
if light_hits:
    problems.append("浅色底组件被设成浅色文字，会看不清：" + "；".join(light_hits))
else:
    notes.append("浅色底组件（答题区 / 卡片 / 列表）文字均为深色，浅色主题下可读")

# 深色底组件应显式声明浅色文字（防止被继承成深色而看不清）
if re.search(r'\.arc-opt\{[^}]*color\s*:', base_css):
    notes.append("深色底检索项已显式声明文字颜色")
else:
    problems.append("深色底检索项 .arc-opt 未声明文字颜色，可能继承成深色而看不清")

mm = re.search(r'<div class="mobile-menu"[^>]*>', src)
if not mm:
    problems.append("未找到移动端抽屉容器 .mobile-menu")
elif "hidden" not in mm.group(0):
    problems.append("移动端抽屉默认缺少 hidden 属性，桌面端会展开")
else:
    notes.append("移动端抽屉默认 hidden 属性正常")

if re.search(r'\.mobile-menu\[hidden\]\s*\{[^}]*display\s*:\s*none', css_text):
    notes.append("样式表已显式隐藏 [hidden] 抽屉，可覆盖 display:grid")
else:
    problems.append("样式表未显式隐藏 [hidden] 抽屉，桌面端可能被 display 规则覆盖")

# 基本声明
if not src.lstrip().lower().startswith("<!doctype html>"):
    problems.append("缺少 <!DOCTYPE html>")
if 'charset="UTF-8"' not in src and "charset=UTF-8" not in src:
    problems.append("缺少 UTF-8 编码声明")
if 'lang="zh-CN"' not in src:
    problems.append("html 缺少 lang 属性")
if 'name="viewport"' not in src:
    problems.append("缺少 viewport 适配声明")

# 与 script.js 的 id 引用交叉核对。
# 注意排除 JS 内部自己创建的 id（如报错提示条 errBar、播放器内的动态元素）：
# 只认"真的在页面标记里出现过"的 id 才需要核对。
js = io.open(os.path.join(ROOT, "script.js"), encoding="utf-8").read()
used = set(re.findall(r"""\$\(\s*['"]#([A-Za-z0-9_-]+)['"]""", js))
used |= set(re.findall(r"""getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]""", js))
# 动态创建的 id：在脚本里以 id = 'xxx' 或 id="xxx" 出现
dynamic_ids = set(re.findall(r"""\bid\s*=\s*['"]([A-Za-z0-9_-]+)['"]""", js))
missing = sorted(i for i in used if i not in p.ids and i not in dynamic_ids)
if missing:
    problems.append("脚本引用了页面中不存在的 id：" + ", ".join(missing))
else:
    notes.append("脚本引用的 %d 个 id 在页面中都存在（含 %d 个脚本内部动态创建的 id）"
                 % (len(used), len(used & dynamic_ids)))

# 脚本里 querySelectorAll 用到的选择器类名抽样核对
cls_used = set(re.findall(r"""\$\$\(\s*['"]\.([A-Za-z0-9_-]+)""", js))
cls_html = set(re.findall(r'class="([^"]+)"', src))
flat = set()
for c in cls_html:
    flat |= set(c.split())
mis = sorted(c for c in cls_used if c not in flat)
if mis:
    notes.append("提示：脚本使用但 HTML 静态标记中未出现的类（可能由 JS 动态生成）：" + ", ".join(mis))
else:
    notes.append("脚本查询的类名均存在于页面标记中")

print("=== HTML/JS 静态检查 ===")
for x in notes:
    print("  [ok]   " + x)
for x in problems:
    print("  [FAIL] " + x)
print("----------------")
print("问题数：%d" % len(problems))
sys.exit(1 if problems else 0)
