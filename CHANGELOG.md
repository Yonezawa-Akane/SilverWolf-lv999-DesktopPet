# 更新日志 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [2.1.1] — 2026-04-26

### 修复 / Fixed

- **Launcher 在不同分辨率电脑上消失** — 上次保存的位置（例如外接 4K 显示器右屏）拿到笔记本小屏上时，launcher 会落在屏幕外不可见。现在启动时校验保存坐标是否仍在某个显示器内，越界则自动回到主屏右下角
- **拔掉外接显示器后窗口卡在原位** — 监听 `display-removed` / `display-added` / `display-metrics-changed`，运行时自动救回所有越界窗口（launcher / 银狼 / sidebar / helper / pomodoro）
- **多显示器下 launcher 没法拖到副屏** — 之前 drag 只 clamp 在主屏内，导致拖到副屏时被拉回；现在按"扩展桌面 bounding box" clamp，可自由跨屏

---

## [2.1.0] — 2026-04-26

### 新增 / Added

- **文件转换功能**（拖拽到 sidebar 触发）
  - 图片互转：PNG / JPG / BMP / WebP
  - 图片 → PDF
  - PDF → PNG / JPG / TXT / DOCX
  - PDF 操作：✂ 拆分（每页独立 PDF）、↻ 旋转 90°
  - 文档互转：Word (DOCX) ↔ HTML / Markdown / TXT / PDF
  - 表格：Excel (XLSX/XLS) ↔ PDF / HTML / CSV
  - 多页 / 多文件输出自动包文件夹（如 `xxx_pages/`、`xxx_split/`）
- **桌面快捷方式管理**
  - 首次运行 `.exe` 时弹出对话框询问是否创建（只问一次）
  - Launcher 右键菜单一键切换
  - 设置面板带状态指示
  - 兼容 OneDrive 重定向 / 中文 "桌面" 文件夹
- **应用图标更新**为 🐺 wolf emoji（替换原几何图标）
  - 通过 `scripts/gen_icon.py` 渲染 Segoe UI Emoji 字体生成
  - 多尺寸 .ico (16/24/32/48/64/128/256) + 256×256 .png 给运行时窗口

### 修复 / Fixed

- 系统消息气泡中英文字号不一致问题（之前用了纯英文像素字体导致中文 fallback 变大）

### 依赖 / Dependencies

新增运行时依赖：`jimp` `pdf-lib` `pdfjs-dist` `mammoth` `marked` `turndown` `html-to-docx` `pdf-parse` `xlsx`

### 内部 / Internal

- 新建 `services/converter.js` 路由表 + 各 handler，纯 JS 主进程跑
- 新建 `services/pdf-render.html`（隐藏 BrowserWindow，PDF.js 渲染到 canvas）
- `main.js` 加 IPC：`convert-file` / `convert-targets` / `shortcut-status` / `shortcut-create` / `shortcut-remove`
- `package.json` build 脚本去掉 `--ignore=node_modules`，让 runtime 依赖打包进 .exe

---

## [2.0.0] — 2025-04-25

### 项目首次开源发布

- 银狼角色 + 长期记忆 + 跨日主动问候
- 全局截图快捷键 `Ctrl+Shift+\`，5 种分析模式
- 番茄钟（屏幕右上浮窗）
- 应用启动器（5 级 fallback 策略 + 中英别名）
- 任务清单（手动 + AI 同步）
- 三栏 sidebar（聊天 / 任务 / 内置说明书）
