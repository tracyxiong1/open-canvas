# Open Canvas CLI

本地优先的画布 CLI，支持文本、图片、视频和音频节点。需要 Node.js 22.16+。
包内包含 Studio、共享 Core 和 Codex Skill，安装后执行 CLI 无需源码、TypeScript 或构建工具。

通过公共 npm registry 安装：

```sh
npm install -g open-canvas-cli --registry=https://registry.npmjs.org/
open-canvas --version
open-canvas --help
open-canvas init ./my-canvas --title "我的画布" --open
open-canvas node add --project ./my-canvas --kind shot --media-kind image --title "雨夜" --prompt "雨夜城市"
open-canvas context --project ./my-canvas
```

也支持项目本地安装：`npm install open-canvas-cli --registry=https://registry.npmjs.org/`，
然后用 `npx --no-install open-canvas --help` 调用。一次性运行：

```sh
npm exec --yes --registry=https://registry.npmjs.org/ --package=open-canvas-cli -- open-canvas --help
```

也可用 `npm install -g /absolute/path/open-canvas-cli-0.1.0.tgz`
安装本地打包产物。包名是 `open-canvas-cli`，可执行命令名是 `open-canvas`。

## Codex Skill

先全局安装 CLI，再执行：

```sh
open-canvas skill install
```

默认安装到 `${CODEX_HOME:-$HOME/.codex}/skills/open-canvas`。
自定义技能目录：`open-canvas skill install --dir /absolute/path/to/skills`。
重复安装相同内容不修改文件；已有不同内容时保留原文件并报错，更新前请自行移走旧目录。
安装后在 Codex 新任务中使用 `$open-canvas` 并提供项目路径，例如：
“用 $open-canvas 在 ./my-canvas 增加雨夜城市的图片节点，先不要生成。”
Skill 与直接 CLI 调用使用同一项目文档。

创建节点不会发起模型请求。真实生成需要用户环境中的 BYOK 凭证；
`provider list` 只显示安全配置与凭证是否存在。在 `node add/update` 时显式
设置 `--provider mock`，再调用 `generate --project <dir> --node <id>`
可用于无远端调用的演示。提供方和模型选择保存在节点上。

`open --project <dir>` 启动包内 Studio 和单项目服务，自动打开浏览器，无需源码或 Vite。使用 `--no-open` 只获取 URL；开发者可用 `--url` 连接已有本地开发服务。

本机私有 env 文件可通过 `--env-file /absolute/path/private.env` 加载。使用自定义模型时，为 `open` 或 `generate` 传入 `--provider-config /absolute/path/providers.json`。浏览器通过本地服务生成，不读取 API key。

```sh
open-canvas media import --project ./my-canvas --file ./clip.mp4
open-canvas project pack --project ./my-canvas --output ./my-canvas.ocanvas
open-canvas project unpack --file ./my-canvas.ocanvas --project ./restored --open
open-canvas render --project ./my-canvas --nodes <video-id-1>,<video-id-2> --audio <audio-id> --output ./film.mp4
```

`media import` 创建媒体节点，或用 `--node` 追加同类节点的结果历史。项目包包含所有已登记媒体，不包含本地凭证和服务配置；恢复目录必须不存在。单素材上限 256 MiB，项目媒体总量上限 4 GiB。

`render` 按 `--nodes` 的顺序使用节点当前选中结果，支持可选旁白、`--aspect-ratio 16:9|9:16|1:1`、`--original-volume` 和 `--narration-volume`（0–2）。旁白从片头开始，裁切到总画面长度。输出 H.264/AAC MP4；FFmpeg/FFprobe 随平台依赖安装，也可通过 `OPEN_CANVAS_FFMPEG`、`OPEN_CANVAS_FFPROBE` 指定本机工具路径。

视频生成中断后，对同一节点再次执行 `generate` 查询原任务。未收到任务 ID 的请求、同步图片和语音请求不会在恢复时自动重发；需检查提供方结果后明确重试。
