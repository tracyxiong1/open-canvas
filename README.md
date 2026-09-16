# Open Canvas

用自然语言创建和修改本地 AI 创作画布。通过 Codex Skill 描述想要的内容，CLI 执行节点操作与媒体生成，Studio 展示可编辑的无限画布。

[npm 安装包](https://www.npmjs.com/package/open-canvas-cli) · [CLI 使用说明](packages/cli/README.md) · [Codex Skill](skills/open-canvas/SKILL.md) · [Studio 使用说明](packages/preview/README.md)

- **对话创作**：增加节点、修改提示词、连接参考素材或创建草稿，按当前请求逐步编辑。
- **本地项目**：CLI、Skill 和 Studio 共用项目文档，素材与结果历史保存在项目中。
- **四类节点**：文本、图片、视频、音频，支持媒体导入、预览和单节点结果导出。
- **自带密钥（BYOK）**：真实生成使用用户配置的提供方；创建和编辑画布无需 API key。

CLI 和 Skill 已通过 npm 发布。**Studio 目前需要从源码启动，npm 包不包含 Studio 服务。**

## 一、安装与快速开始

需要 **Node.js 22.16 或更高版本**和 npm。

```sh
npm install -g open-canvas-cli --registry=https://registry.npmjs.org/
open-canvas --version
open-canvas --help
```

npm 包名是 `open-canvas-cli`，安装后的命令是 `open-canvas`。在选定目录中创建空项目：

```sh
open-canvas init ./my-canvas --title "我的画布"
open-canvas context --project ./my-canvas
```

CLI 输出 JSON，便于查看项目、草稿和节点 ID，也便于脚本或智能体调用。创建项目后，可以通过下面的 Codex Skill 或 CLI 继续编辑。

只想查看命令、暂不全局安装时：

```sh
npm exec --yes --registry=https://registry.npmjs.org/ --package=open-canvas-cli -- open-canvas --help
```

旧包 `@tracyxiong1/open-canvas` 已下架。如果曾全局安装旧包，先运行 `npm uninstall -g @tracyxiong1/open-canvas`，再安装 `open-canvas-cli`，避免同名命令冲突。现有画布项目可以继续使用。

## 二、通过 Codex Skill 使用

全局安装 CLI 后执行：

```sh
open-canvas skill install
```

默认安装目录是 `${CODEX_HOME:-$HOME/.codex}/skills/open-canvas`。自定义目录可用 `open-canvas skill install --dir /absolute/path/to/skills`。

在 Codex 新任务中提供项目路径并调用 `$open-canvas`，例如：

```text
用 $open-canvas 编辑 ./my-canvas：增加一个雨夜城市的图片节点，先不要生成。
```

之后可以继续说：

- “把这个图片节点改成清晨。”
- “增加一个音频节点，用这段文字生成旁白。”
- “保留当前草稿，再做一版竖屏方案。”

Skill 通过同一套 CLI 修改项目。创建或编辑节点不会自动发起模型请求；只有明确要求生成时，才执行配置的提供方调用。

重复安装相同 Skill 不会修改文件。已有内容不同时，安装器会保留原文件并报错；更新前请备份并移走旧目录。源码开发者也可以把仓库中的 `skills/open-canvas` 链接到本地技能目录。

## 三、直接使用 CLI

在已有项目中增加一个图片节点，不调用生成接口：

```sh
open-canvas node add --project ./my-canvas --kind shot --media-kind image --title "雨夜城市" --prompt "雨夜的城市街道，路面倒映灯光"
open-canvas context --project ./my-canvas
```

从返回的 JSON 中取得 `nodeId`，替换下面的 `<node-id>`，只修改这个节点：

```sh
open-canvas node update --project ./my-canvas --node <node-id> --prompt "清晨的城市街道，柔和的阳光"
```

### 3.1 无需 API key 的本地试用

以下示例创建一个独立项目，并在节点上显式设置 mock 提供方：

```sh
open-canvas init ./mock-demo --title "本地试用"
open-canvas node add --project ./mock-demo --kind shot --media-kind audio --title "旁白测试" --prompt "你好，欢迎来到我的故事。" --provider mock
```

用返回的 `nodeId` 替换 `<node-id>`，再执行：

```sh
open-canvas generate --project ./mock-demo --node <node-id>
open-canvas context --project ./mock-demo --node <node-id>
```

mock 生成确定性占位素材；音频是一秒静音，不是合成语音，也不需要远端 API。`--provider` 和 `--model` 在 `node add/update` 时设置，`generate` 使用节点已保存的路由，不接受这两个参数。

素材导入、历史结果选择和导出命令见 [四类节点使用说明](docs/four-node-usage.md)。

## 四、启动 Studio

Studio 提供可拖动、缩放、连线的无限画布。先克隆公开仓库并启动开发服务：

```sh
git clone https://github.com/tracyxiong1/open-canvas.git
cd open-canvas
npm ci
npm run build
npm run dev --workspace @open-canvas/preview -- --host 127.0.0.1 --port 4173 --strictPort
```

保持服务运行，在另一个终端打开之前创建的项目。将 `/absolute/path/to/my-canvas` 替换为项目的绝对路径：

```sh
open-canvas open --project /absolute/path/to/my-canvas
```

`open` 启动单项目的本地桥接，并在浏览器中打开 Studio。默认 Studio 地址是 `http://127.0.0.1:4173/`；其他本地地址可通过 `--url` 指定，只获取链接可添加 `--no-open`。该命令不会启动 Studio 开发服务。

在 Studio 中点击“保存本地项目”写回磁盘。CLI 更新项目后，Studio 在没有未保存编辑时自动加载新版本；存在未保存编辑时，会保留当前内容并提示处理外部更新。

直接访问 Studio 地址会打开临时空画布。“导出 JSON”下载项目文档，不包含媒体文件。桥接链接含本地访问令牌，不应公开分享。更多操作见 [Studio 使用说明](packages/preview/README.md)。

## 五、当前能力

| 节点 | 能力 |
| --- | --- |
| 文本 | 编辑正文或提示词，为下游媒体节点提供文本上下文 |
| 图片 | 图片生成、本地导入、预览、输出参数设置 |
| 视频 | 视频生成、本地导入、播放、输出参数设置 |
| 音频 | 文字转语音（TTS）、本地导入、播放、音色/语速/格式设置 |

媒体节点支持多次生成、历史结果选择和单节点导出。参考素材、可复用创作方向和结果历史属于当前项目。

当前不包含独立 LLM 聊天节点、音乐生成、声音克隆、完整时间线剪辑、成片合成渲染或全局素材库。旧项目中的脚本、角色、分析、剪辑等节点可以继续读取和编辑，新建菜单只提供上述四类节点。

## 六、配置真实生成

真实生成需要用户在本地环境中配置提供方凭证。密钥不应写入项目 JSON、provider 配置文件、源码或聊天。

| Adapter ID | 适配能力 | 默认凭证环境变量 |
| --- | --- | --- |
| `volcengine-ark` | 火山引擎 Ark 图片、视频生成 | `ARK_API_KEY` |
| `openai` | 图片生成与参考图输入 | `OPENAI_API_KEY` |
| `google-gemini` | 视频生成与参考图输入 | `GEMINI_API_KEY` |
| `openai-speech` | TTS，输出 WAV 或 MP3 | `OPENAI_API_KEY` |

配置好环境变量后，查看 CLI 的安全配置和凭证可用状态：

```sh
open-canvas provider list
```

`provider list` 不显示密钥，也不验证远端账户权限或模型可用性。未指定路由的节点在执行 `generate` 时自动选择符合要求的已配置真实提供方，可能产生费用；没有可用路由时失败，不会回退到 mock。

自定义提供方实例使用 `--provider-config <path>` 或 `OPEN_CANVAS_PROVIDER_CONFIG`。配置只记录实例 ID、adapter、模型 ID、优先级和凭证环境变量名等安全信息。详见 [Provider 契约](docs/provider-contract.md)。

Studio 的“应用提示词”保存节点修改，“重新生成”将节点准备为待生成状态；实际生成请求由 Codex/CLI 执行。TTS 节点的正文用于朗读。语音同步请求中断后不会自动重发，原请求可能已计费。

## 七、开发与验证

| 目录 | 职责 |
| --- | --- |
| `packages/core` | 项目 schema、共享操作、校验、任务状态和提供方适配 |
| `packages/cli` | 项目持久化、生成执行、Skill 安装和本地预览桥接 |
| `packages/preview` | React Flow Studio |
| `skills/open-canvas` | 随 CLI 分发的 Codex Skill 源文件 |
| `docs/schema` | 权威项目 schema，Core 构建时生成对应代码 |

在仓库根目录执行：

```sh
npm run check
npm test
npm run build
npm run test:package
git diff --check
```

本地打包可运行 `npm run pack:cli`，产物位于 `artifacts/open-canvas-cli-<version>.tgz`。

### 7.1 GitHub CI 与 npm 自动发布

PR 和 `main` 提交会触发 [CI](https://github.com/tracyxiong1/open-canvas/actions/workflows/ci.yml)，在 Node.js 22.16 和 24 上执行类型检查、源码测试、全量构建和独立安装包验证。通过验证的 npm tarball 保存在该次运行的 Artifacts 中。

发布沿用 [md-review-server](https://github.com/tracyxiong1/md-review-server) 的 Release Please 流程：

1. 使用 `fix:`、`feat:` 等 Conventional Commits 合并改动到 `main`。
2. [Release Please](https://github.com/tracyxiong1/open-canvas/actions/workflows/release-please.yml) 自动创建或更新版本 PR，同步版本号、锁文件和 CHANGELOG。
3. 合并版本 PR 后，自动创建 `vX.Y.Z` 标签和 GitHub Release，重新验证并发布 `open-canvas-cli`。

发布使用 npm Trusted Publishing（GitHub OIDC），不需要 `NPM_TOKEN`。npm 可信发布者绑定仓库 `tracyxiong1/open-canvas` 和工作流 `release-please.yml`；修改仓库或工作流文件名时，需要同步 npm 设置。构建、验证与发布使用同一个 tarball，并附带来源证明（provenance）。

版本覆盖整个仓库，以包含 CLI 所依赖的 Core、schema 和 Skill 改动；只有 `open-canvas-cli` 会上传 npm。当前 `0.x` 阶段，普通功能与修复递增 patch，破坏性改动需在提交中明确标记。

Release Please 使用 `GITHUB_TOKEN` 创建的 PR 不会自动触发另一条 CI；审核版本 PR 时可在 CI 页面手动选择其分支运行。发布任务仍会完整检查通过后才上传 npm。如果标签已创建但发布失败，可在 Release Please 页面手动运行并填写已有标签重试；已发布版本不能覆盖。

`0.1.0` 发布时通过 159 项源码测试和独立安装包集成测试，并验证了 Node.js 22.16、公共 npm 匿名安装、mock 生成与 Skill 安装。测试使用 mock 或模拟 transport，不代表真实付费 API 的账户权限、质量和时延已验收。

- [npm 发布与审查记录](docs/qa/npm-cli-2026-09-16/README.md)
- [四类节点与浏览器验收记录](docs/qa/four-nodes-2026-09-15/README.md)
- [项目范围与约定](docs/context-pack.md)
- [开发者约束](AGENTS.md)
