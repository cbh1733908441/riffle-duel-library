# Riffle · 独立对抗选题库

将 Steam 与 Roblox 本地资料统一为「模板分类 → 独立对抗模板 → 游戏及模式」的选题工作台。默认浏览由玩家独立完成、可研究 NPC 对手替代的玩法；合作／组队资料归档，依据不足的模式保留待核验。

## 内容

- 完整目录 8,749 条：Steam 1,238 条、Roblox 7,511 条。
- 已解构 1,530 款：Steam 500 款、Roblox 1,030 款，共 1,552 个模式记录。
- 初版已评级独立对抗 102 款、105 个模式；同一游戏的多模式共用基础资料。
- Steam 沿用此前逐模式 NPC 适配层；Roblox 逐卡阅读评估 20 个模式，其余使用明确标记的初筛，未人工确认的不会自动获得评级。

高／中／低是轻量改编的尝试优先级，未经 NPC 原型或趣味性测试，不代表原作原生机器人支持。纯比成绩、长线策略和社交表达的限制在详情中保留。平台目录规模不是平台游戏总数。

## 使用

直接打开 `dist/index.html`，或运行：

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory dist
```

打开 http://127.0.0.1:8770/ 。支持平台、适配度、资料范围、模板、文字搜索，条件组合在同一个模式上匹配。网址保留筛选和模式；可导出单游戏、筛选结果和整库 JSON。

## 重新生成

```sh
python3 scripts/build.py
```

使用仓库内资料快照，无需密钥、网络或父目录。若要导入新的本地源库：

```sh
python3 scripts/build.py --import-local /path/to/原工作区
```

该目录需要包含 `steam-library/dist/library.json` 和 `roblox-library/dist/library.json`。Roblox 已评级卡片的原文发生变化时会提示旧评估失效，需复核 `data/roblox-reviews.json` 后再生成。原始库不会被修改。

## 结构

- `data/*-source.json`：此次原始库的可重现快照。
- `data/roblox-reviews.json`：具体模式的 NPC 设计判断与资料指纹。
- `scripts/build.py`：统一平台标识、模式、范围、模板和统计。
- `dist/`：无需安装依赖的完整静态网站和导出数据。
- `tests/check.py`、`tests/ui.cjs`：数据完整性与主要页面操作检查。

游戏原作、商标、图片和第三方资料各归原权利人。本站保存研究摘要和来源链接；原作事实与改编想法分开。源快照含历史核验范围，初筛不等于已重新验证原作。
