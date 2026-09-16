# Open Canvas

Open Canvas 是本地优先的 AI 创作画布。用户通过 Codex 对话创建和修改节点，第一方 CLI 执行项目操作与媒体生成，独立 Studio 提供可编辑的无限画布。三者共用项目文档和核心操作逻辑。

## 一、当前范围

新建入口聚焦四类节点，新项目从空画布开始。

| 节点 | 当前能力 |
| --- | --- |
| 文本 | 编辑正文或提示词，作为下游媒体节点的文本上下文 |
| 图片 | 生图、导入结果、预览及输出参数设置 |
| 视频 | 生视频、导入结果、播放及输出参数设置 |
| 音频 | 文字转语音（TTS）、导入结果、播放、音色/语速/格式设置 |

媒体节点支持历史结果选择、重新生成及单节点结果导出。旧项目中的脚本、角色、分析、剪辑等节点继续保留和编辑，但不再出现在当前创建菜单中。

当前不包含独立 LLM 聊天节点、音乐生成、声音克隆、完整时间线剪辑或成片合成渲染。可复用方向、参考素材与结果历史均属于本地项目，没有全局素材库。

## 二、快速开始

需要 Node.js 和支持 workspaces 的 npm。以下命令均从仓库根目录执行。

```sh
npm install
npm run build
npm run dev --workspace @open-canvas/preview -- --host 127.0.0.1 --port 4173 --strictPort
```

保持开发服务运行，在另一个终端创建并打开项目：

```sh
node packages/cli/bin/open-canvas.js init ../my-canvas --title "我的画布"
node packages/cli/bin/open-canvas.js open --project ../my-canvas
```

`open` 启动单项目本地桥接并打开浏览器；它不启动 Studio 开发服务。默认 Studio 地址为 `http://127.0.0.1:4173/`。如使用其他端口，传入 `--url http://127.0.0.1:<port>/`；只需要链接时添加 `--no-open`。桥接链接含本地访问令牌，不要公开分享。

直接打开 Studio 地址可编辑临时空画布；需要写回磁盘上的项目时，使用上述 CLI 打开方式，再点击“保存本地项目”。“导出 JSON”下载项目文档，不打包媒体文件。

### 2.1 通过 Codex 使用

将 [open-canvas Skill](skills/open-canvas/SKILL.md) 所在目录安装或链接到本地 Codex skills 目录。向 Codex 提供项目路径后，可直接提出原子操作：

- “在当前画布增加一个雨夜城市的图片节点。”
- “把这个节点改成清晨，先不要生成。”
- “增加一个音频节点，用这段文字生成旁白。”

创建或编辑节点不隐含生成授权。只有明确要求生成时，Codex 才通过 CLI 调用配置的提供方。

### 2.2 不调用付费 API 的本地试用

```sh
node packages/cli/bin/open-canvas.js node add --project ../my-canvas --kind shot --media-kind audio --title "旁白测试" --prompt "你好，欢迎来到我的故事。"
```

从命令返回值取出节点 ID，替换下面的 `<node-id>`：

```sh
node packages/cli/bin/open-canvas.js generate --project ../my-canvas --node <node-id> --provider mock
node packages/cli/bin/open-canvas.js context --project ../my-canvas --node <node-id>
```

`mock` 必须显式选择，只用于测试。它生成确定性占位素材；音频是一秒静音，不是合成语音。Studio 没有未保存编辑时会自动读取 CLI 的新版本；有未保存编辑时保留当前内容，并提示处理外部更新。

## 三、生成与 BYOK

当前代码中的内置 adapter 如下；实际可用性取决于配置的模型、账户权限和节点要求，不能据此推定覆盖所有厂商或模型。

| Adapter ID | 代码适配范围 | 默认凭证环境变量 |
| --- | --- | --- |
| `volcengine-ark` | 火山引擎 Ark 生图、生视频 | `ARK_API_KEY` |
| `openai` | 图片生成与参考图输入 | `OPENAI_API_KEY` |
| `google-gemini` | 视频生成与参考图输入 | `GEMINI_API_KEY` |
| `openai-speech` | TTS，输出 WAV 或 MP3 | `OPENAI_API_KEY` |

凭证应由用户在本地环境中安全设置。不要把密钥写入项目 JSON、provider 配置、源码或聊天。CLI 只持久化安全的 provider ID、模型 ID 与任务记录。

```sh
node packages/cli/bin/open-canvas.js provider list
```

该命令显示安全配置与凭证是否存在，不打印密钥，也不验证远端账户或模型可用性。真实生成使用 `generate`，去掉 `--provider mock` 后会选择符合要求的已配置路由，可能产生费用；没有可用路由时失败，不自动回退 mock。

自定义提供方实例使用 `--provider-config <path>` 或 `OPEN_CANVAS_PROVIDER_CONFIG`，配置文件替换内置默认列表。文件仅允许版本、实例 ID、adapter、凭证环境变量名、模型 ID 与优先级等安全字段。详见 [Provider 契约](docs/provider-contract.md)。

Studio 的“应用提示词”更新项目文档，“重新生成”将节点准备为待生成状态；实际请求仍由 Codex/CLI 执行。音频节点的正文用于朗读，不是音乐描述。Speech 同步请求中断后无法从官方接口续查，本地不会自动重发，但原请求可能已计费。

完整的音频导入、单节点导出及历史选择命令见 [四类节点使用说明](docs/four-node-usage.md)。

## 四、开发与验证

- `packages/core`：schema、共享操作、校验、任务状态及 provider adapter。
- `packages/cli`：项目持久化、凭证读取、生成执行与本地预览桥接。
- `packages/preview`：React Flow Studio，详见 [Studio README](packages/preview/README.md)。
- `skills/open-canvas`：Codex 创建 Skill。
- `docs/schema`：权威项目 schema；修改后由 Core 构建生成对应代码。

```sh
npm run check
npm test
npm run build
git diff --check
```

四类节点首版在 2026-09-15 的本地验收中通过 158 项测试，以及浏览器音频播放、下载校验、设置保存和历史结果选择。此次验收使用 mock 或模拟 transport，没有验证真实付费 API 的账户权限、输出质量与时延。详细证据和限制见 [验收记录](docs/qa/four-nodes-2026-09-15/README.md)。

项目范围与开发约束见 [Context Pack](docs/context-pack.md) 和 [AGENTS.md](AGENTS.md)。
