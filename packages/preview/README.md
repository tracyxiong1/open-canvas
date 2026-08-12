# Creator Canvas preview

Standalone, read-only preview for the canonical Creator Canvas project document.

```bash
npm install
npm run dev
```

The app opens `docs/examples/canvas-v1-shot2-night.json` by default. Use **打开项目** to inspect another schema-v1 JSON document. The preview adapter in `src/project-document.js` never mutates or persists the canonical document; `src/demo-assets.js` is an isolated visual fixture map for the checked-in examples.

Checks:

```bash
npm test
npm run test:sites
npm run build
```
