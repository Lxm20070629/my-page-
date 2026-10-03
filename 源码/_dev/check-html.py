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

# 顶栏移动端抽屉：必须默认带 hidden 属性，且样式表要显式隐藏它，
# 否则桌面端会展开、把首屏内容顶下去（曾出现过这个缺陷）
css_text = ""
css_path = os.path.join(ROOT, "style.css")
if os.path.exists(css_path):
    css_text = io.open(css_path, encoding="utf-8").read()

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

# 与 script.js 的 id 引用交叉核对
js = io.open(os.path.join(ROOT, "script.js"), encoding="utf-8").read()
used = set(re.findall(r"""\$\(\s*['"]#([A-Za-z0-9_-]+)['"]""", js))
used |= set(re.findall(r"""getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]""", js))
missing = sorted(i for i in used if i not in p.ids)
if missing:
    problems.append("脚本引用了页面中不存在的 id：" + ", ".join(missing))
else:
    notes.append("脚本引用的 %d 个 id 在页面中都存在" % len(used))

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
