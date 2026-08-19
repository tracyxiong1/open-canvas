# Open Canvas visual fidelity QA — 2026-08-19

## Follow-up: focused-node interaction and complete palette

The latest pass was checked in the running local studio after the canvas
rescale. The source evidence used for this pass is the permitted local capture
set under `docs/qa/libtv-live-capture-2026-08-19/`; it is intentionally not a
runtime asset. The current product uses its own generic labels and iconography.

- Default load now leaves every node unselected.
- Clicking `Shot 2 — Crossing` changed the React Flow viewport from `43%` to
  `100%`, centered the selected square card, exposed its left/right ports, and
  opened the in-world prompt composer. This was verified in the in-app browser
  with the viewport transform and selected/composer DOM state, then visually
  checked in the rendered browser view.
- The compact add menu contains the complete product-owned palette: text,
  image, video, editing, storyboard, shot analysis, audio, script, asset,
  upload, and generation-history entry points. Each non-generating surface is
  persisted as a typed context node with an editable prompt, rather than a
  decorative menu item.
- Top chrome, bottom tool dock, lower-left assets/zoom controls, 44-unit dot
  plane, 350 × 350 cards, circular `+` ports, and neutral curved links are
  fixed/transforming in the intended layers.

The existing archived side-by-side images below remain evidence for the first
canvas baseline. The live interaction check above supersedes their old
622-pixel card geometry.

**Comparison target**

- Source visual truth (temporary, intentionally untracked capture): `/tmp/open-canvas-qa-20260819/reference-current.jpg`.
- Browser-rendered implementation: `/tmp/open-canvas-qa-20260819/implementation-current-panned-final.jpg`.
- Full-view, side-by-side comparison: `/tmp/open-canvas-qa-20260819/comparison-current-panned-final.jpg`.
- Focused node/grid comparison: `/tmp/open-canvas-qa-20260819/comparison-grid-crop.jpg` and `/tmp/open-canvas-qa-20260819/comparison-text-selected-final.jpg`.
- Normalization: both full-view captures are 778 × 994 px at a 778 × 994 CSS-px viewport. The browser was running at device scale factor 2; the capture transport normalized both images to 1× before comparison. Both canvases were unselected and panned to put their first three nodes on the same baseline. The source zoom was 36.67%; the implementation zoom was 36%.

The comparison is about the visible canvas grammar rather than project identity or fixture content. The implementation deliberately uses its own project title, copy, icons, and local fixture media; it does not include source branding, source assets, or source-specific product data.

**Findings**

- No actionable P0, P1, or P2 fidelity issues remain in the captured canvas state.
- The final compact top chrome was also checked in the running browser after the visual iterations: at a 1280 × 720 viewport, the left canvas control, right helper controls, bottom dock, asset controls, and zoom controls remain fixed while the React Flow world pans beneath them. This is a DOM/layout check for the final small chrome adjustment; the full-view visual comparison remains the evidence for canvas, nodes, edges, grid, and dock surfaces.

**Required Fidelity Surfaces**

- Fonts and typography: a compact system/Inter fallback hierarchy mirrors the target's small, medium-weight canvas labels, muted metadata, and low-emphasis controls. Node titles truncate instead of reflowing; prompt text is constrained inside its editable card.
- Spacing and layout rhythm: the working world uses compact 350 × 350 cards
  for all node types, with source-aligned label offsets, 44-unit dots, direct
  handles, curved links, and fixed 38–50 px control groups.
- Colors and visual tokens: `#141414` canvas, subdued `#525252` dot field, neutral `#86909c` edges, charcoal surfaces, and a restrained cyan interaction accent preserve the reference's contrast hierarchy without importing its brand palette.
- Image quality and asset fidelity: media uses only local Open Canvas fixture previews at their native crops. Icons are from the Phosphor icon family; no source images, logos, inline SVG recreations, or hotlinked media are shipped.
- Copy and content: the UI uses independent Open Canvas terminology. Text,
  editing, storyboard, analysis, audio, script, and asset-context nodes persist
  real canvas prompts; image, video, and composition nodes retain their own
  canonical project data.

**Interaction checks**

- Direct drag from a node label moves the node and records the canonical position update; nested media controls do not accidentally start a drag.
- Initial load is unselected. Clicking a node selects it, focuses the canvas at
  100%, and opens the matching inline composer.
- The hand tool pans the transformed canvas while header and tool chrome remain fixed.
- The add menu creates text, image, video, editing, storyboard, analysis,
  audio, script, asset, upload, and history-context entries at the current
  viewport center; context prompts are editable and survive the shared command
  path.
- Typed sequence and dependency handles accept valid graph connections, render curved solid links, and preserve canonical edge semantics.
- A full reload returned the preview to the saved fixture state. The browser had no application console errors after reload; Vite and React DevTools informational messages were ignored.

**Comparison History**

1. **P1 — canvas scale and card geometry.** The earlier media cards were too wide for the focused-node reference state. **Fix:** converged every canvas surface on a 350 × 350 square card, moved the fixture graph to a 430-unit horizontal rhythm, and kept the composer as a slightly wider panel below the selected card. **Post-fix evidence:** the current in-app-browser selected-node check shows the card, ports, and composer at 100% focus.
2. **P1 — dot field was hidden by the React Flow pane.** The first local capture lost the target's visible dotted plane. **Fix:** made `.react-flow__pane` transparent and set an explicit 44-unit dot background. **Post-fix evidence:** `comparison-grid-crop.jpg`.
3. **P2 — edge and handle treatment drifted.** Dependency links were dashed and their handles were cyan at rest, unlike the neutral solid-link state in the source. **Fix:** use solid neutral curved edges and neutral resting handles; reserve cyan for interaction. **Post-fix evidence:** the full-view comparison and focused node capture.
4. **P2 — context nodes were only a text placeholder.** The canvas needed the full generic creative palette without introducing fake provider jobs. **Fix:** added typed persisted context roles for text, editing, storyboard, shot analysis, audio, script, and asset reference; each requires a prompt, accepts context links, and explicitly rejects generation jobs. **Post-fix evidence:** palette/UI tests, schema validation tests, mutation/job tests, and the live menu check.
5. **P2 — compact header composition was too product-dashboard-like.** **Fix:** aligned narrow canvas chrome to a left canvas selector and compact helper controls while retaining the standalone product's own labels and actions. **Post-fix evidence:** running-browser layout check described above.

**Open Questions**

- The reference did not expose a complete provider-generation or editing timeline flow in the captured state. Those capabilities remain intentionally out of the visual clone scope; the canvas protocol already has typed nodes, assets, graph edges, durable prompts, and a composition node to support the next provider/CLI phase.

**Implementation Checklist**

- [x] Compared source and implementation at the same compact canvas viewport and similar pan/zoom state.
- [x] Verified focused grid, selected text node, node handles, and curved links.
- [x] Exercised direct drag, hand pan, add menu, prompt update, zoom, and fit.
- [x] Passed core tests (31), CLI tests (4), preview tests (16), and the production preview build.
- [x] Kept all temporary source evidence out of shipped product assets.

**Follow-up Polish**

- P3: split the large React Flow/preview bundle before a production release; the current production build passes but Vite reports a 500 kB chunk-size advisory.

final result: passed
