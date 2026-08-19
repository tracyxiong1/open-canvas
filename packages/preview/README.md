# Open Canvas studio

Standalone React Flow editor for the canonical Open Canvas project document.

```bash
npm install
npm run dev
```

The app opens `docs/examples/canvas-v1-shot2-night.json` by default. Use **打开** to load another schema-v1 JSON document. Node moves, node creation, prompt edits (including persisted context canvas nodes for text, editing, directing, analysis, audio, scripts, and asset references), and graph connections run through the same browser-safe command core used by the CLI. **导出 JSON** downloads the validated local result; direct project-directory persistence remains a CLI responsibility. `src/demo-assets.js` is an isolated visual fixture map for the checked-in examples.

Checks:

```bash
npm test
npm run test:sites
npm run build
```
