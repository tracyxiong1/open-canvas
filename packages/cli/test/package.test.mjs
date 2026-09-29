import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repository = resolve(import.meta.dirname, "../../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("packed npm CLI works outside the checkout and installs the canonical Skill safely", { timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-package-"));
  try {
    const runNpm = (args, cwd = root) => execFileSync(npm, args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_cache: join(root, "cache"), npm_config_audit: "false", npm_config_fund: "false" },
    });
    if (!process.env.OPEN_CANVAS_TARBALL) {
      runNpm(["pack", "--workspace", "open-canvas-cli", "--pack-destination", root], repository);
    }
    const tarball = process.env.OPEN_CANVAS_TARBALL
      ? resolve(repository, process.env.OPEN_CANVAS_TARBALL)
      : join(root, (await readdir(root)).find((name) => name.endsWith(".tgz")));
    await writeFile(join(root, "package.json"), '{"private":true}');
    runNpm(["install", "--ignore-scripts", "--omit=dev", tarball]);
    const installed = join(root, "node_modules/open-canvas-cli");
    assert.equal((await lstat(installed)).isSymbolicLink(), false);
    const packageJson = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe"]);
    assert.notEqual(packageJson.private, true);
    assert.equal(packageJson.publishConfig.registry, "https://registry.npmjs.org/");
    assert.equal(packageJson.publishConfig.access, "public");
    assert.deepEqual((await readdir(installed)).sort(), ["README.md", "bin", "dist", "package.json"]);
    const cli = (args, env = {}) => JSON.parse(execFileSync(process.execPath, [join(installed, "bin/open-canvas.js"), ...args], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env },
    }));
    assert.equal(cli(["--version"]).version, packageJson.version);
    assert.equal(cli(["-v"]).version, packageJson.version);
    assert.ok(cli(["--help"]).commands.some((entry) => entry.startsWith("skill install")));
    assert.equal(JSON.parse(runNpm(["exec", "--offline", "--", "open-canvas", "--version"])).version, packageJson.version);
    // A fresh npm-exec working directory exercises one-off tarball execution.
    const once = await mkdtemp(join(root, "once-"));
    assert.equal(JSON.parse(runNpm(["exec", "--yes", "--offline", `--package=${tarball}`, "--", "open-canvas", "--version"], once)).version, packageJson.version);
    const project = join(root, "canvas with spaces");
    const created = cli(["init", project, "--title", "Package QA"]);
    const node = cli(["node", "add", "--project", project, "--kind", "shot", "--media-kind", "audio", "--title", "旁白", "--prompt", "测试", "--provider", "mock"]);
    cli(["node", "update", "--project", project, "--node", node.nodeId, "--prompt", "清晨"]);
    assert.throws(() => cli(["generate", "--project", project, "--node", node.nodeId, "--provider", "mock"]), /node add\/update/);
    const generated = cli(["generate", "--project", project, "--node", node.nodeId]);
    assert.equal(generated.status, "succeeded");
    const output = join(root, "result.wav");
    cli(["export", "--project", project, "--draft", created.activeDraftId, "--node", node.nodeId, "--output", output]);
    assert.equal((await readFile(output)).toString("ascii", 0, 4), "RIFF");
    assert.ok(cli(["context", "--project", project]));
    // Exercise the detached bundled entrypoint, not just source-mode bridge tests.
    const preview = cli(["open", "--project", project, "--no-open"]);
    const projectUrl = new URL(preview.url).searchParams.get("project-url");
    const stopUrl = new URL(projectUrl);
    stopUrl.pathname = "/bridge";
    try {
      assert.equal(new URL(preview.url).origin, preview.bridgeUrl);
      const html = await (await fetch(preview.url)).text();
      assert.match(html, /<div id="root">/);
      const script = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
      assert.equal((await fetch(new URL(script, preview.url))).status, 200);
      const response = await fetch(projectUrl, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).activeDraftId, created.activeDraftId);
      const anonymous = await fetch(`${preview.bridgeUrl}/project.json`, { signal: AbortSignal.timeout(5000) });
      assert.equal(anonymous.status, 404);
      const video = cli(["node", "add", "--project", project, "--kind", "shot", "--media-kind", "video", "--title", "Clip", "--prompt", "Fixture", "--provider", "mock"]);
      cli(["generate", "--project", project, "--node", video.nodeId]);
      const film = join(root, "film.mp4");
      cli(["render", "--project", project, "--nodes", video.nodeId, "--audio", node.nodeId, "--output", film]);
      assert.equal((await readFile(film)).toString("ascii", 4, 8), "ftyp");
      const archive = join(root, "portable.ocanvas");
      cli(["project", "pack", "--project", project, "--output", archive]);
      const restored = join(root, "restored");
      cli(["project", "unpack", "--file", archive, "--project", restored]);
      assert.deepEqual(await readFile(join(restored, "project.json")), await readFile(join(project, "project.json")));
    } finally {
      const stopped = await fetch(stopUrl, { method: "DELETE", signal: AbortSignal.timeout(5000) });
      assert.equal(stopped.status, 204);
    }

    const codexHome = join(root, "codex home");
    const skill = cli(["skill", "install"], { CODEX_HOME: codexHome });
    assert.equal(skill.path, join(codexHome, "skills/open-canvas"));
    assert.equal(skill.status, "installed");
    for (const file of ["SKILL.md", "agents/openai.yaml"]) {
      assert.deepEqual(await readFile(join(skill.path, file)), await readFile(join(repository, "skills/open-canvas", file)));
    }
    assert.equal(cli(["skill", "install"], { CODEX_HOME: codexHome }).status, "unchanged");
    const custom = join(root, "custom skills");
    assert.equal(cli(["skill", "install", "--dir", custom]).path, join(custom, "open-canvas"));
    await writeFile(join(skill.path, "SKILL.md"), "User's custom skill");
    assert.throws(() => cli(["skill", "install"], { CODEX_HOME: codexHome }), /preserved existing files/);
    assert.equal(await readFile(join(skill.path, "SKILL.md"), "utf8"), "User's custom skill");
    await rm(join(custom, "open-canvas"), { recursive: true });
    await symlink(join(repository, "skills/open-canvas"), join(custom, "open-canvas"), "dir");
    assert.equal(cli(["skill", "install", "--dir", custom]).status, "unchanged");
    assert.equal((await lstat(join(custom, "open-canvas"))).isSymbolicLink(), true);
    await rm(join(custom, "open-canvas"));
    await symlink(join(root, "missing-skill"), join(custom, "open-canvas"), "dir");
    assert.throws(() => cli(["skill", "install", "--dir", custom]), /preserved existing files/);
    assert.equal((await lstat(join(custom, "open-canvas"))).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
