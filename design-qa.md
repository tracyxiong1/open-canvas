# JIM-7 Design QA

**Findings**

- 未发现仍需处理的 P0、P1 或 P2 差异。实现保留了参考证据中的固定控制层、点阵画布、同坐标系节点/参数/连线、选中端口、移动端横向画布语义和素材直观预览，同时使用 Open Canvas 自有领域结构、文案、图标和原创素材。

**Comparison Artifacts**

- Source visual truth: `docs/references/libtv/desktop-1440x900-video-parameters.png`, `docs/references/libtv/desktop-1440x900-job-complete.png`, `docs/references/libtv/mobile-390x844-video-selected.png` and the interaction constraints in `docs/references/libtv/README.md`.
- Browser-rendered implementation: `docs/qa/jim-7/desktop-night-selected.png`, `docs/qa/jim-7/desktop-main-overview.png`, `docs/qa/jim-7/desktop-asset-preview.png`, `docs/qa/jim-7/mobile-night-selected.png`, `docs/qa/jim-7/mobile-main-fit.png`.
- Combined comparison inputs: `docs/qa/jim-7/compare-desktop-selected.png`, `docs/qa/jim-7/compare-desktop-generated.png`, `docs/qa/jim-7/compare-mobile-selected.png`.
- Desktop normalization: source and implementation are both 1440 × 900 px at a 1440 × 900 CSS viewport; effective density is 1:1.
- Mobile normalization: source and implementation are both 390 × 844 px at a 390 × 844 CSS viewport; effective density is 1:1.
- States: desktop night variation with a dirty shot selected and parameters expanded; desktop main draft with four succeeded nodes and dependency graph; expanded generated-asset preview; mobile dirty shot selected; mobile main draft fit to screen.

**Full-view Comparison Evidence**

- Desktop selected-state comparison confirms that the node, ports, parameter panel and edges move in one transformed layer while the header, legend, tool dock, zoom dock and read-only notice stay fixed.
- Desktop generated-state comparison confirms clear succeeded badges, in-node 16:9 imagery, sequence/dependency separation and the composition result. The denser four-node layout is intentional product data, not source-design drift.
- Mobile comparison confirms the same canvas coordinate system is retained rather than reflowed into a page; the selected node and parameter panel are reachable, fixed controls remain visible, and fit-to-screen provides a complete overview.

**Focused Region Comparison Evidence**

- Node headers, status badges, ports, prompt field, parameter grid and routing/fingerprint footer were readable in the selected-state combined inputs; no additional crop was needed.
- Generated images were checked both in-node and in the expanded 16:9 preview. Crops remain sharp and proportional, with no protected reference asset reuse.
- The partial pink circle at the right edge of Chrome captures and the console errors whose URLs begin with `chrome-extension://` come from installed browser extensions; neither is present in the app DOM or source bundle and both were excluded from implementation findings.

**Required Fidelity Surfaces**

- Fonts and typography: system/Inter fallbacks produce a restrained UI hierarchy; headings, metadata and monospaced identifiers remain distinguishable at desktop and mobile scales without broken wrapping.
- Spacing and layout rhythm: node widths, compact panels, dotted canvas, fixed docks and mobile overflow behavior track the approved evidence. Radii and borders are consistently tokenized.
- Colors and visual tokens: neutral near-black surfaces, quiet borders, cyan selection/dependency accents and semantic green/amber/purple/red states maintain contrast without borrowing source branding.
- Image quality and asset fidelity: all visible stills are original generated WebP assets sized for 16:9 node and dialog crops; icons come from one open-source Phosphor family; no CSS/inline-SVG replacement art is used.
- Copy and content: UI copy describes the standalone read-only project preview. Project, draft, prompt, route and generation data come from the canonical document adapter.
- Accessibility and interaction: semantic buttons/select/dialog labels, keyboard selection and escape handling, visible focus, reduced-motion support and practical mobile toolbar targets are present.

**Comparison History**

- Iteration 1 — P2 mobile positioning: the first 390 × 844 capture laid out around the first shot before the asynchronous initial selection moved to the dirty second shot, leaving the active node mostly off-screen.
- Fix: the viewport now keys mobile layout to both draft and selected node, recenters after selection, and responds when crossing the mobile breakpoint. A regression test asserts the initial mobile view transform.
- Post-fix evidence: `docs/qa/jim-7/mobile-night-selected.png` and `docs/qa/jim-7/compare-mobile-selected.png`; the selected dirty shot, both ports and its parameter panel are visible at the target viewport.

**Open Questions**

- The approved reference has no Open Canvas composition equivalent and no retainable queued/failed visual captures. Composition layout and all five generation-state semantics therefore follow `docs/schema/canvas-document-v1.schema.json` and the canonical examples, as required.

**Implementation Checklist**

- [x] Desktop and mobile source/implementation pairs compared at identical viewports.
- [x] Pan, zoom, fit, draft switch, node selection, edge toggle and asset dialog exercised in Chrome.
- [x] Application console checked; no error or warning originated from `localhost` (extension-only errors were observed and classified above).
- [x] Unit, adapter, responsive and production-build checks completed.

**Follow-up Polish**

- P3: a future real asset resolver can replace the fixture-only preview URL map when the CLI delivery defines project-relative binary serving. This does not affect the current read-only fixture acceptance path.

final result: passed
