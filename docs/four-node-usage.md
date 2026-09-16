# 四类节点使用说明

## 一、范围

当前创建入口仅提供文本、图片、视频、音频。旧项目中的角色、脚本、分析、剪辑、音频意图及合成节点继续保留和编辑；新项目从空画布开始。

文本用于编辑正文或提示词，并连接到媒体节点。图片、视频保留已有生成和导入链路。音频支持文字转语音、本地导入、播放、下载和导出，暂不包含音乐生成、声音克隆或时间线剪辑。

生成仍由 Codex/CLI 显式执行。Studio 的提示词按钮负责保存修改，“重新生成”负责将节点置为待生成，不会自行调用付费接口。

## 二、音频操作

从仓库根目录执行 `npm run build`。随后使用第一方 CLI；以下 `<project>`、`<node-id>` 和 `<draft-id>` 需要替换为实际值。

```sh
node packages/cli/bin/open-canvas.js init <project> --title 我的画布
node packages/cli/bin/open-canvas.js node add --project <project> --kind shot --media-kind audio --title 旁白 --prompt "你好，欢迎来到我的故事。" --voice coral --speed 1
node packages/cli/bin/open-canvas.js provider list
node packages/cli/bin/open-canvas.js generate --project <project> --node <node-id>
node packages/cli/bin/open-canvas.js open --project <project> --no-open
```

TTS 默认使用 OpenAI Speech adapter；用户的 `OPENAI_API_KEY` 必须已存在于本地环境。不要把密钥放入命令参数、项目 JSON 或聊天。以上生成命令会请求真实服务，测试时应显式配置 `--provider mock`；mock 音频是一秒静音，不是语音生成结果。

音频参数包括音色、语速和输出格式，Studio 可直接编辑。生成格式支持 WAV 和 MP3。音频节点的提示词及直接连接的文本上下文会作为朗读正文，节点标题和“创作上下文”标签不会被拼入正文。TTS 不接受图片、视频或音频参考输入。

已有录音可先用 `asset import --project <project> --file <file>` 加入项目。若要作为音频节点结果显示，使用：

```sh
node packages/cli/bin/open-canvas.js result import --project <project> --node <node-id> --file <audio-file>
node packages/cli/bin/open-canvas.js export --project <project> --draft <draft-id> --node <node-id> --output <new-output-file>
```

`result import` 当前要求节点待生成或失败。音频文件实际格式会记录到节点；若后续需要 TTS，选择 WAV 或 MP3 输出格式。浏览器使用原生音频播放器，支持播放、暂停、进度和音量；具体导入格式能否播放取决于浏览器编解码支持。预览弹窗提供下载。

## 三、重新生成与历史选择

再次执行 `generate` 会为成功节点创建新尝试，保留原始任务及输出。无可用路由时不提前清除成功结果。

节点内的结果面板支持预览及“设为选中结果”。CLI 对应命令：

```sh
node packages/cli/bin/open-canvas.js result select --project <project> --node <node-id> --asset <asset-id>
```

选中结果参与预览、导出和下游输入。该操作保留当前提示词与原始任务状态，不把旧输出伪装成当前参数生成的结果；下游节点会失效。修改提示词、输出要求或重新生成会清除选中状态。不能选择其他节点的历史输出；生成运行中不能切换结果。

## 四、验证边界

视频任务沿用持久化任务 ID 的恢复轮询。Speech 是同步接口：提交边界后中断时不能向官方接口续查，也不会静默重新发送请求；需明确发起新尝试，原调用可能已经计费。

自动化测试使用模拟 transport 或显式 mock。真实 TTS、生图及生视频的账户可用性、输出质量、时延和长任务行为仍需在用户授权的 BYOK 环境验收。
