# Open Canvas CLI

本地优先的画布 CLI，支持文本、图片、视频和音频节点。需要 Node.js 22.16+。
包内包含共享 Core 和 Codex Skill，安装后执行 CLI 无需源码、TypeScript 或构建工具。

通过公共 npm registry 安装：

```sh
npm install -g open-canvas-cli --registry=https://registry.npmjs.org/
open-canvas --version
open-canvas --help
open-canvas init ./my-canvas --title "我的画布"
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

如果已全局安装旧包 `@tracyxiong1/open-canvas`，先执行
`npm uninstall -g @tracyxiong1/open-canvas`，再安装新包，避免同名命令冲突。
现有画布项目可以继续使用。

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

`open --project <dir>` 提供项目桥接，但仍需要另行运行 Studio
（默认 `http://127.0.0.1:4173/`，可通过 `--url` 指定其他本地地址）。
CLI 包不包含 Studio 开发服务器。
