# Open Canvas Studio

Studio 是项目文档的独立 React Flow 编辑器。浏览器与 CLI 共用 `@open-canvas/core` 的操作和校验逻辑，项目文档是唯一数据源。

## 一、启动与项目加载

从仓库根目录执行：

```sh
npm install
npm run build
npm run dev --workspace @open-canvas/preview -- --host 127.0.0.1 --port 4173 --strictPort
```

直接访问开发服务会打开临时空画布，不默认加载示例。页面“打开”可加载 schema-v1 JSON，“导出 JSON”下载校验后的文档；JSON 本身不包含项目目录中的媒体字节。

要编辑磁盘项目，在另一个终端从仓库根目录执行：

```sh
node packages/cli/bin/open-canvas.js open --project <project-directory>
```

替换 `<project-directory>` 为已有项目目录。创建项目的步骤见 [根 README](../../README.md)。`open` 启动回环地址上的单项目桥接并打开页面，不启动 Vite；默认连接 4173 端口。其他端口使用 `--url http://127.0.0.1:<port>/`，只获取链接使用 `--no-open`。

桥接仅暴露该项目及其声明的资产。点击“保存本地项目”才会经 CLI 校验、revision 冲突检查和原子写入保存到磁盘。CLI 更新项目时，Studio 在没有未保存编辑的情况下自动刷新；存在本地编辑时保留内容并提示外部版本变化。桥接链接包含访问令牌，不应公开分享。

## 二、四类节点与操作边界

添加菜单和空画布引导仅提供文本、图片、视频、音频。旧项目中的其他节点继续保留和编辑。

- 文本：编辑正文和提示词，连接到下游节点；不提供独立 LLM 聊天服务。
- 图片、视频：编辑提示词、输出要求及项目内参考素材，预览图片或播放视频。
- 音频：编辑朗读正文、音色、语速及输出格式，使用原生播放器预览。TTS 输出为 WAV/MP3，导入格式能否播放取决于浏览器编解码支持。
- 共用操作：节点移动、连线、删除、项目内分组、撤销/重做、媒体历史结果选择和预览下载。行内编辑器跟随节点，水平边界限制保证窄屏控件可触达。

“应用提示词”更新文档，“重新生成”将节点准备为待生成；实际付费生成由 Codex/CLI 显式执行。浏览器不读取提供方 API key。音频预览区区分 AI 合成声音、导入素材与 mock 静音测试素材。

选择历史输出后，该输出用于预览、导出及下游引用；当前提示词和原始任务不变，下游节点失效。选择旧输出不会把当前参数标记为已经生成成功。

本地素材导入使用 CLI 的 `asset import`；把素材作为节点结果使用 `result import`。完整命令见 [四类节点使用说明](../../docs/four-node-usage.md)。结果历史属于原节点，参考素材属于当前项目，没有全局素材或历史面板。音乐生成、声音克隆、波形剪辑及成片合成渲染不在当前范围。

`src/demo-assets.js` 仅为仓库示例提供隔离的视觉测试素材映射，不是默认项目或真实生成服务。

## 三、验证

从仓库根目录执行：

```sh
npm run test --workspace @open-canvas/preview
npm run build --workspace @open-canvas/preview
```

Sites 交付前额外执行：

```sh
npm run test:sites --workspace @open-canvas/preview
```

Sites 构建保留 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。当前四类节点的桌面、窄屏和浏览器操作证据见 [本地验收记录](../../docs/qa/four-nodes-2026-09-15/README.md)；该记录不代表真实付费 API 或生成质量验收通过。
