# npm CLI 与 Skill 发布审查

日期：2026-09-16。最终包名：`open-canvas-cli@0.1.0`，命令名 `open-canvas`。
以下保留首次 scoped 发布记录；更名及旧包下架结果见文末。

## 审查结论

CLI 打包共享 Core 和规范 Skill、Studio 独立运行的边界可保留。
已修复以下发布问题：

| 优先级 | 问题 | 处理 |
| --- | --- | --- |
| P1 | `@open-canvas/cli` 已由其他维护者发布，不能用于本项目发布 | 改为当前账号 scope 下的 `@tracyxiong1/open-canvas`，同步 workspace、测试和文档 |
| P1 | CLI 仍标记 `private`，且没有显式公共 registry 配置 | 移除 CLI 的 private 标记，设置 `publishConfig.access=public` 和公共 npm registry；其他 workspace 保持私有 |
| P1 | `generate --provider mock` 静默忽略参数，可能执行节点原有的真实路由 | 在生成前拒绝 provider/model 路由参数，提示通过 `node add/update` 设置；测试验证项目文件完全不变 |
| P2 | Skill 仍假定 CLI 未公开发布，部分文字引导创建旧角色节点 | 更新公共包调用方式；新建上下文统一使用 text 节点，保留旧项目角色的编辑能力 |

发布内容限定为 7 个文件：CLI 入口、独立运行 bundle、Skill 与 UI 元数据、
README、package.json、第三方依赖许可。安装不依赖 workspace Core 包，
没有安装时脚本；发布包检查未发现凭证格式内容、内部 registry 或本机绝对路径。

## 验证

- `npm run check`：通过；新增生成参数校验后再执行 CLI 类型检查通过。
- `npm test`：Core 65 项、Studio 68 项通过；最终 CLI 单独重跑 26 项通过，共 159 项。
- `npm run build`：所有 workspace 构建通过。
- `npm run test:package`：完整 npm 包集成测试通过。
- Node.js 22.16.0 直接执行 `packages/cli/test/package.test.mjs`：通过。
- Skill `quick_validate.py`、`git diff --check`：通过。
- `npm publish ./artifacts/tracyxiong1-open-canvas-0.1.0.tgz --dry-run --ignore-scripts --access public --registry=https://registry.npmjs.org/`：通过。

包集成测试在临时目录验证离线安装、本地 npm exec、一次性 tarball 执行、
版本/帮助、节点增改、mock 音频生成/导出、独立 bundle 的预览桥接和认证、
Skill 默认及自定义目录安装、幂等安装、用户修改和正常/断开的符号链接保护。

最低 Node 版本首次通过嵌套 npm exec 启动时受到父进程 npm 配置影响；
改为直接执行已下载的 Node.js 22.16.0 二进制后通过。发布 dry-run 首次路径
缺少 `./` 被 npm 解释为 GitHub shorthand；最终发布使用上述显式本地路径。

## 范围与限制

Studio 未随 npm 包分发，`open` 仍需要已启动的本地 Studio；README 已说明。
本轮不调用真实付费媒体 API。Studio 测试有 SVG NaN 警告，构建有 chunk
体积提示，均未导致失败；本轮未修改 Studio 源码。

## 首次发布状态（迁移前）

已发布到 [npm](https://www.npmjs.com/package/@tracyxiong1/open-canvas)。
公共 registry 回读版本及 `latest` 均为 `0.1.0`，维护者为 `tracyxiong1`。
实际发布使用通过检查的 tarball，并经 npm 网页身份验证完成。

使用空 user/global npm 配置和新的临时 cache，匿名安装公共包成功；CLI、
本地 npm exec、项目创建、mock 音频生成/导出和 Skill 安装均通过。
从公共 tarball URL 下载的字节与本地审核产物完全一致，SHA-512 integrity：

```text
sha512-mqxboROVRpdpJ8b0hkchWT12zeW7bAGAIQt9zY4qOMIDETg1tzrTMxiAw5x1aKb7/DFn7Kj/0ACL99YTecth9A==
```

## 主要变更文件

- `packages/cli/package.json`、`scripts/build.mjs`：公共包配置、Core bundle、规范 Skill 和依赖许可打包。
- `packages/cli/src/skill.ts`、`args.ts`、`commands.ts`：版本、Skill 安装、生成路由参数校验。
- `packages/cli/test/package.test.mjs`、`cli.test.ts`：安装产物及生成边界回归验证。
- 根目录 `package.json`、`package-lock.json`：workspace 包名与打包/测试入口。
- `README.md`、`packages/cli/README.md`、`docs/context-pack.md`、`skills/open-canvas/SKILL.md`：公共安装说明和一致的调用约定。

## 更名为 open-canvas-cli

按用户要求，公开包名从 `@tracyxiong1/open-canvas` 改为 `open-canvas-cli`。
命令和 Skill 名仍是 `open-canvas`，现有项目文档兼容。已同步 workspace、
lockfile、包测试、README、Context Pack 和 Skill 中的安装入口。

更名后重新运行包集成测试、全仓库类型检查、CLI/Core 构建、Skill 验证、
`git diff --check` 和发布 dry-run，均通过。没有修改 Core、CLI 业务或 Studio 行为。

`open-canvas-cli@0.1.0` 已发布到 [npm](https://www.npmjs.com/package/open-canvas-cli)，
`latest` 为 `0.1.0`，维护者为 `tracyxiong1`。用空 npm 配置和新缓存匿名安装后，
CLI/npm exec、mock 音频生成/导出及 Skill 安装均通过。公共 tarball 与本地
审核产物字节完全一致：

```text
sha512-0RaLP+HeRqjTfu4vzScGQ9+yowbObcabJysG7uBaqttmp4hw6jkPgsTMolhK3cSRCxtc6vFJzf0PasikNK++Bg==
```

旧包经实时核对仅有 `0.1.0` 版本。用户明确要求下架移除，已执行
`npm unpublish @tracyxiong1/open-canvas --force --registry=https://registry.npmjs.org/`，
经 npm 网页身份验证后下架成功。公共 registry 复查旧包元数据、`latest`
及旧 tarball 均返回 HTTP 404；新包 `open-canvas-cli@0.1.0` 返回 HTTP 200。
`md-review-server@0.9.3` 仍正常可用，未作修改。
