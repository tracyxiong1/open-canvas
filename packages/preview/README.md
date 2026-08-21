# Open Canvas studio

Standalone React Flow editor for the canonical Open Canvas project document.

```bash
npm install
npm run dev
```

The app opens `docs/examples/canvas-v1-shot2-night.json` by default. Use **打开** to load another schema-v1 JSON document. Node moves, creation, deletion (including incident edge/job cleanup and undo), project-local group frames (selection, one-shot whole-group movement, and durable member IDs), prompt edits (including persisted context canvas nodes for text, editing, directing, analysis, audio, scripts, asset references, characters, and scene/style), shot-level project-local reference-asset selection, composition-output relationships, and graph connections run through the same browser-safe command core used by the CLI. **导出 JSON** downloads the validated local result. When launched through `open-canvas open`, the CLI starts a loopback bridge for only that project: Studio loads the real document and declared local assets, and its explicit save button writes back through CLI validation and atomic persistence. Local image/video import (`open-canvas asset import`) remains a CLI responsibility. The Studio has no global role or material library; references stay on canvas nodes or on the consuming image/video shot. `src/demo-assets.js` is an isolated visual fixture map for the checked-in examples.

Checks:

```bash
npm test
npm run test:sites
npm run build
```
