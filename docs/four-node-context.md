# Context Pack: 四类基础节点

日期：2026-09-15。状态：已完成首轮实现，本地验收通过，真实 API 验收待补。
本文保留实施前的背景快照；下方“已知事实”等章节描述收集时的状态，不代表当前缺口。
当前行为和使用说明见 `docs/four-node-usage.md`，验证记录见 `docs/qa/four-nodes-2026-09-15/README.md`。

## 任务摘要

- 原始诉求：当前阶段简化为文本、图片、视频、音频四类节点，保证功能完备。
- 当前理解：用户已确认音频先支持文字转语音、导入和播放；其他节点从创建入口隐藏，保留旧项目兼容。
- 非目标：音乐及音效生成、声音克隆、时间线剪辑、合成渲染、全局资源库；本次未要求整体迁移 provider SDK。
- 共同验收目标：创建、编辑、连接、复制、删除、移动、撤销/重做、本地保存恢复。媒体节点支持导入、生成、预览或播放、重新生成、历史结果选择及导出；生成状态、失败反馈和中断恢复需要覆盖真实使用路径。

## 已知事实

| 事实 | 来源 | 置信度 |
| --- | --- | --- |
| 创建菜单仍有 12 种入口，包括旧音频上下文节点 | `packages/preview/src/CanvasViewport.jsx` / 添加画布节点菜单 | 高 |
| 可生成镜头和资产的媒体枚举仅包含 image、video | `docs/schema/canvas-document-v1.schema.json`、`packages/core/src/providers.ts` | 高 |
| CLI 素材读取仅接受图片和视频，没有音频扩展名映射 | `packages/cli/src/commands.ts` / inferredMediaType、importedAssetKind | 高 |
| 预览组件只有 video 与 img 分支 | `packages/preview/src/media-preview.jsx` / AssetPreview | 高 |
| 历史输出当前只能作为参考输入复用，不能替换当前输出 | `packages/preview/src/CanvasViewport.jsx` / historyPicker | 高 |
| 任务恢复机制及测试已经存在 | `packages/cli/src/commands.ts` / generateCommand；`packages/cli/test/cli.test.ts` / generate resumes | 高 |

## 业务/领域规则

| 术语或规则 | 含义 | 来源 | 误判风险 |
| --- | --- | --- | --- |
| 文本节点 | 编辑文字并作为媒体生成上下文；未要求自动文本生成 | 本轮用户确认、现有上下文节点 | 不应额外引入聊天模型需求 |
| 音频节点 | 本次目标为可导入、播放及执行 TTS 的媒体节点 | 本轮用户确认 | 现有 audio role 只是上下文，不能宣称已有音频生成 |
| 隐藏旧入口 | 保留旧节点数据和读取能力 | 本轮用户确认 | 不得删除旧项目内容 |
| 本地 BYOK | 凭证留在本地环境，项目只保存安全路由和本地资产 | `AGENTS.md`、`docs/context-pack.md` | 不得在浏览器、日志或项目中保存密钥 |
| 显式生成 | 继续由 Codex/CLI 按用户请求执行 | `docs/context-pack.md` | 修改提示词不应自动调用付费 API |

## 相关代码地图

| 路径/符号 | 职责 | 相关原因 | 置信度 |
| --- | --- | --- | --- |
| `docs/schema/canvas-document-v1.schema.json` | 权威数据结构 | 媒体枚举、旧节点兼容 | 高 |
| `packages/core/scripts/generate-schema.mjs` | 派生 schema 和 TypeScript 类型 | 派生文件不应手改 | 高 |
| `packages/core/src/jobs.ts`、`providers.ts` | 生成、路由及结果归档 | 当前仅图片/视频媒体类型 | 高 |
| `packages/cli/src/commands.ts`、`provider-config.ts` | 导入、生成、导出及安全配置 | 音频完整 CLI 路径 | 高 |
| `packages/preview/src/CanvasViewport.jsx`、`media-preview.jsx` | 创建入口、节点交互、媒体播放 | 四类入口及音频展示 | 高 |

## 现有行为与相似实现

| 位置 | 可复用模式 | 差异 | 来源 |
| --- | --- | --- | --- |
| generateCommand | 本地任务、provider 快照、结果下载、本地资产持久化 | 缺少 audio 媒体及 TTS adapter | CLI 代码 |
| AssetPreview | 项目资产使用受限本地桥接 URL 播放 | 无 audio 元素 | Preview 代码 |
| historyPicker | 节点内保留旧任务结果 | 当前是参考复用，用户确认的是历史结果选择 | Preview 代码 |

## 数据、配置、运行时影响

| 对象 | 影响 | 来源 | 风险 |
| --- | --- | --- | --- |
| 旧项目 | 旧角色、脚本、音频上下文等仍需可读 | 用户确认及现有 schema | 隐藏入口不能改变存量节点语义 |
| 音频资产 | 涉及 schema、导入、任务结果、播放和导出 | 上述代码证据 | 只扩展菜单无法形成闭环 |
| 工作区 | 已有 20 个 tracked 文件修改和 untracked provider 配置等 | 本轮 git status --short | 必须保留并区分已有工作 |

## 验证线索

| 线索 | 验证方式 | 来源 |
| --- | --- | --- |
| 旧文档及任务行为 | schema、Core 和 CLI 回归测试 | `packages/core/test`、`packages/cli/test` |
| 四类入口及播放器 | 组件测试与真实浏览器操作 | `packages/preview/tests/App.test.jsx`、`media-preview.test.jsx` |
| 真实生成 | 有授权的 BYOK 请求、任务 ID、本地输出、播放及重开证据 | 当前尚未取得；模拟请求不能替代 |
| 当前测试基线 | 本轮仅阅读测试，未重新执行；上一轮记录为 60/22/65 通过 | 当前任务上一轮验证记录 |

## 未知项

| 问题 | 当前假设 | 风险 | 是否阻塞 | 解决方式 |
| --- | --- | --- | --- | --- |
| TTS 提供方、模型及音色 | 尚未选择，不推定用户已有凭证 | API 能力或本地配置不可用 | 阻塞真实 TTS 验收；不阻塞本地实现讨论 | 实现阶段核对官方协议和安全配置 |
| 历史结果选择语义 | 需保持输出来源可追踪，不能伪造当前参数生成成功 | 参数、结果及下游失效不一致 | 需要设计判断，无需重复确认四节点范围 | 基于现有任务和依赖模型确定行为 |

## 不可得来源

| 来源 | 状态 | 对结论的影响 |
| --- | --- | --- |
| 真实 TTS API、音色、当前凭证可用性 | 本轮未访问或检查 | 不宣称已经接通或可生成 |
| 四类节点浏览器验收 | 本轮未执行 | 本文只描述代码现状和验收目标 |

## 下一步建议

- 建议路径：进入四类节点的实现阶段。
- 原因：范围已确认，入口、数据模型、任务和预览的缺口已有代码证据。
- 最小下一步：以本文为背景输入确定兼容语义和验收用例；不需要用户再次确认相同产品范围。
