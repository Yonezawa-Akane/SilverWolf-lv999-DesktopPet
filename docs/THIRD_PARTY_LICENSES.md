# Third-Party Licenses · 第三方组件许可声明

> 本文档列出 Silver Wolf Pet 项目使用的全部第三方组件、依赖、模型权重及其各自的开源协议。
>
> This document enumerates every third-party component, dependency, and model weight bundled with Silver Wolf Pet, along with their respective open-source licenses.
>
> 项目主体代码采用 [MIT License](../LICENSE)。第三方组件保留其原始协议；用户在使用、再分发本项目时，需同时遵守下列各组件的协议条款。
>
> The main project code is licensed under the [MIT License](../LICENSE). Third-party components retain their original licenses; users redistributing this project must also comply with each component's license terms.

---

## 1. 运行时 npm 依赖 / Runtime npm Dependencies

| 包名 / Package | 用途 / Purpose | 协议 / License | SPDX |
|---|---|---|---|
| [`html-to-docx`](https://github.com/privateOmega/html-to-docx) | HTML → Word 文档转换 | MIT | `MIT` |
| [`jimp`](https://github.com/jimp-dev/jimp) | 纯 JS 图像处理（缩放/格式互转） | MIT | `MIT` |
| [`mammoth`](https://github.com/mwilliamson/mammoth.js) | Word → HTML/Markdown 提取 | BSD-2-Clause | `BSD-2-Clause` |
| [`marked`](https://github.com/markedjs/marked) | Markdown → HTML 渲染 | MIT | `MIT` |
| [`pdf-lib`](https://github.com/Hopding/pdf-lib) | PDF 创建 / 拆分 / 旋转 | MIT | `MIT` |
| [`pdf-parse`](https://gitlab.com/autokent/pdf-parse) | PDF 文本提取 | MIT | `MIT` |
| [`pdfjs-dist`](https://github.com/mozilla/pdf.js) | PDF 渲染（PDF → 图片） | Apache-2.0 | `Apache-2.0` |
| [`turndown`](https://github.com/mixmark-io/turndown) | HTML → Markdown 反向转换 | MIT | `MIT` |
| [`xlsx`](https://github.com/SheetJS/sheetjs) | Excel 文件读写 | Apache-2.0 | `Apache-2.0` |

---

## 2. 语音输入相关 / Voice Input Components

### 2.1 引擎与绑定 / Engines & Bindings

| 包名 / Package | 用途 / Purpose | 协议 / License | SPDX |
|---|---|---|---|
| [`sherpa-onnx-node`](https://github.com/k2-fsa/sherpa-onnx) | 离线 ASR 引擎 Node.js 绑定 | Apache-2.0 | `Apache-2.0` |
| [`onnxruntime`](https://github.com/microsoft/onnxruntime) (经 sherpa-onnx 传递依赖) | ONNX 模型推理后端 | MIT | `MIT` |
| [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) | 全局键盘 keydown/keyup 监听（PTT 实现） | MIT | `MIT` |

### 2.2 模型权重 / Model Weights ⚠️ 特别注意

| 资产 / Asset | 来源 / Source | 协议 / License |
|---|---|---|
| [SenseVoice-Small（int8 量化版）](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17) | FunAudioLLM / 阿里达摩院 | **FunASR Model License** ([MODEL_LICENSE](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)) |

**SenseVoice 模型不属于标准 OSI 开源协议。** 它使用阿里巴巴的"FunASR Model License"自定义协议。关键条款摘要：

- ✅ **允许商用与再分发** —— 个人和组织均可
- ⚠️ **必须保留原作者署名与模型出处** —— 即"FunAudioLLM / FunASR / 阿里巴巴达摩院"
- ⚠️ **必须保留模型名称**（"SenseVoice"）于衍生作品中
- ⚠️ **不得对该软件进行无端贬低、恶意诋毁或无根据的侮辱**——违反则自动失效
- ⚠️ **AS-IS 免责**：阿里不承担任何直接/间接损失责任

完整协议文本随模型一并存放于 `assets/models/sense-voice/LICENSE.txt`（如缺失，从上方链接重新下载）。

**SenseVoice is NOT under a standard OSI-approved open-source license.** It uses Alibaba's custom "FunASR Model License". Key terms:

- ✅ Commercial use and redistribution **permitted** (for individuals and organizations)
- ⚠️ Must retain original author attribution ("FunAudioLLM / FunASR / Alibaba DAMO Academy")
- ⚠️ Must retain the model name ("SenseVoice") in derivative works
- ⚠️ **Disparagement clause**: must not engage in unjustified denigration or baseless insults of the software (violation auto-forfeits the license)
- ⚠️ AS-IS warranty disclaimer

The full license text is bundled at `assets/models/sense-voice/LICENSE.txt` (re-download from the link above if missing).

---

## 3. 美术与角色资产 / Art & Character Assets

| 资产 / Asset | 权属 / Ownership | 状态 / Status |
|---|---|---|
| `assets/sw_sheet.png`、`assets/sw_*.png` | © miHoYo / HoYoverse / Cognosphere（角色"银狼"及《崩坏：星穹铁道》衍生美术） | 非营利合理使用收录；如版权方要求，将立即移除 |
| `assets/icon.ico` / `assets/icon.png` | 项目原创（基于 🐺 Unicode emoji 程序化生成） | MIT（随项目主协议） |
| `assets/launcher_icon.png` | 项目原创 | MIT（随项目主协议） |

### 角色与世界观 IP / Character & Setting IP

"银狼 (Silver Wolf)"角色、《崩坏：星穹铁道》(Honkai: Star Rail) 相关名称、剧情、美术、商标，**版权全部归属米哈游 (miHoYo Co., Ltd.) / HoYoverse / Cognosphere Pte. Ltd.**。

本项目为非营利粉丝二创，与米哈游无任何关联，未获其授权或背书。MIT 协议**不**授予任何角色 IP 相关权利。详见根目录 [LICENSE](../LICENSE) 的 NOTICE 章节。

The "Silver Wolf" character, Honkai: Star Rail names, plot, artwork, and trademarks are the intellectual property of **miHoYo Co., Ltd. / HoYoverse / Cognosphere Pte. Ltd.**

This project is an unofficial, non-commercial fan project, not affiliated with or endorsed by miHoYo. The MIT License does **NOT** grant any character IP rights. See the NOTICE section of [LICENSE](../LICENSE) for details.

---

## 4. 角色人格蒸馏方案 / Character Persona Distillation

`docs/silver-wolf-skill-distilled.md` 中的角色人格定义参考自 GitHub 上开源的 `花火.skill` 蒸馏方案。**人格设定文本本身**为项目原创二次创作，但蒸馏方法论受社区共享。

The character persona definition in `docs/silver-wolf-skill-distilled.md` is built on the open-source `花火.skill` distillation methodology from GitHub. The **persona text itself** is original derivative writing for this project; the distillation methodology is community-shared.

---

## 5. 协议兼容性矩阵 / License Compatibility Matrix

| 来源协议 | 与 MIT 项目分发 | 是否需保留 NOTICE/LICENSE 文本 |
|---|---|---|
| MIT | ✅ 完全兼容 | ✅ 必须保留版权与许可声明 |
| BSD-2-Clause | ✅ 完全兼容 | ✅ 必须保留版权与许可声明 |
| Apache-2.0 | ✅ 单向兼容 | ✅ 必须保留 NOTICE 文件、声明修改、保留版权与许可声明 |
| FunASR Model License | ⚠️ 非 OSI 协议，但允许打包分发 | ✅ 必须保留作者署名与模型名称 |

**实操层面**：所有 npm 依赖的 `LICENSE` 文件在 `node_modules/<pkg>/LICENSE` 已自动随包发布；electron-packager 的 `prune: false` 配置确保它们进入最终 `dist/` 产物。SenseVoice 模型的 license 由 `assets/models/sense-voice/LICENSE.txt` 单独承载。

In practical terms: every npm dependency's `LICENSE` file lives at `node_modules/<pkg>/LICENSE` and is auto-bundled by electron-packager (`prune: false` is set). The SenseVoice model license is carried separately at `assets/models/sense-voice/LICENSE.txt`.

---

## 6. 二次分发指引 / Redistribution Guidance

如你 fork 本项目并对外分发：

1. **保留 `LICENSE`、本文档、`docs/silver-wolf-skill-distilled.md`** 不得删除
2. **保留 `node_modules/*/LICENSE`** 跟随 release 一起分发（`build.js` 已自动包含）
3. **保留 `assets/models/sense-voice/LICENSE.txt`** 与模型文件同目录
4. **保留米哈游版权声明** —— 角色 IP 不得用于商业用途
5. **如需移除语音功能**，可删除 `assets/models/sense-voice/`、`services/voice.js`、相关 npm 依赖；删除后本节"语音输入相关"组件无须保留 attribution
6. **如需替换 SenseVoice 模型**，可改用 Whisper（MIT）或 Paraformer（同 FunASR Model License）等其他 ONNX 模型；改换后请更新本文档

If you fork and redistribute this project:

1. **Keep `LICENSE`, this document, and `docs/silver-wolf-skill-distilled.md`** — do not delete
2. **Keep `node_modules/*/LICENSE`** alongside releases (auto-handled by `build.js`)
3. **Keep `assets/models/sense-voice/LICENSE.txt`** in the same directory as model files
4. **Retain the miHoYo copyright notice** — character IP must not be used commercially
5. **If removing voice features**, delete `assets/models/sense-voice/`, `services/voice.js`, and related npm deps; attributions in §2 are no longer required
6. **If swapping SenseVoice for another model** (e.g., Whisper-MIT or Paraformer), update this document accordingly

---

## 7. 联系方式 / Contact

如对本许可声明有疑问，或你是上述任何资产的版权方希望调整使用方式，请通过 GitHub Issues 联系项目维护者。

For questions about this license notice, or if you are a rights holder of any asset listed above and wish to amend usage, please contact the project maintainer via GitHub Issues.

---

*Last updated: 2026-04-26*
