import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createProject, loadProject, saveProjectAtomic } from "../src/index.js";

test("atomic persistence leaves the old document after an interrupted pre-rename save", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creator-canvas-core-"));
  const initial = createProject({
    title: "Original",
    projectId: "project_019c8f55-9100-7000-8000-000000000910",
    draftId: "draft_019c8f55-9101-7000-8000-000000000911",
    now: "2026-08-12T09:10:00Z",
  });
  await saveProjectAtomic(directory, initial);
  const changed = structuredClone(initial);
  changed.project.title = "Changed";

  await assert.rejects(
    saveProjectAtomic(directory, changed, {
      beforeRename: () => {
        throw new Error("simulated interruption");
      },
    }),
    /simulated interruption/,
  );

  assert.equal((await loadProject(directory)).project.title, "Original");
  assert.equal(JSON.parse(await readFile(join(directory, "project.json"), "utf8")).project.title, "Original");
});

test("save rejects a stale on-disk revision without changing project.json", async () => {
  const directory = await mkdtemp(join(tmpdir(), "creator-canvas-stale-"));
  const initial = createProject({ title: "Current" });
  await saveProjectAtomic(directory, initial);
  const candidate = structuredClone(initial);
  candidate.revision = 1;
  candidate.project.title = "Stale write";

  await assert.rejects(
    saveProjectAtomic(directory, candidate, { expectedCurrentRevision: 99 }),
    /project revision conflict/,
  );
  assert.equal((await loadProject(directory)).project.title, "Current");
});
