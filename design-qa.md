# Open Canvas visual fidelity QA — 2026-08-19

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
- Spacing and layout rhythm: the working world uses 622 × 350 media cards and 350 × 350 text cards, with source-aligned label offsets, 44-unit dots, direct handles, curved links, and fixed 38–46 px control groups.
- Colors and visual tokens: `#141414` canvas, subdued `#525252` dot field, neutral `#86909c` edges, charcoal surfaces, and a restrained cyan interaction accent preserve the reference's contrast hierarchy without importing its brand palette.
- Image quality and asset fidelity: media uses only local Open Canvas fixture previews at their native crops. Icons are from the Phosphor icon family; no source images, logos, inline SVG recreations, or hotlinked media are shipped.
- Copy and content: the UI uses independent Open Canvas terminology. Text nodes persist real canvas prompts; image, video, and composition nodes retain their own canonical project data.

**Interaction checks**

- Direct drag from a node label moves the node and records the canonical position update; nested media controls do not accidentally start a drag.
- The hand tool pans the transformed canvas while header and tool chrome remain fixed.
- The add menu creates text, image, video, and composition nodes at the current viewport center; text prompts are editable and survive the shared command path.
- Typed sequence and dependency handles accept valid graph connections, render curved solid links, and preserve canonical edge semantics.
- A full reload returned the preview to the saved fixture state. The browser had no application console errors after reload; Vite and React DevTools informational messages were ignored.

**Comparison History**

1. **P1 — canvas scale and card geometry.** The first implementation used a smaller world-card base, which forced a visibly higher fit zoom than the captured canvas. **Fix:** set media cards to 622 × 350, text cards to 350 × 350, then updated fixture positions and the compact fit cap. **Post-fix evidence:** `comparison-current-panned-final.jpg` shows matching first-node width and baseline at approximately 36% zoom.
2. **P1 — dot field was hidden by the React Flow pane.** The first local capture lost the target's visible dotted plane. **Fix:** made `.react-flow__pane` transparent and set an explicit 44-unit dot background. **Post-fix evidence:** `comparison-grid-crop.jpg`.
3. **P2 — edge and handle treatment drifted.** Dependency links were dashed and their handles were cyan at rest, unlike the neutral solid-link state in the source. **Fix:** use solid neutral curved edges and neutral resting handles; reserve cyan for interaction. **Post-fix evidence:** the full-view comparison and focused node capture.
4. **P2 — text node was only a visual placeholder.** A text card needed to represent editable creative context in the same durable document that the agent/CLI will consume. **Fix:** added `composition.role: "text"` plus a required persisted prompt, command-core mutation support, and no-op generation semantics. **Post-fix evidence:** `comparison-text-selected-final.jpg` and the text-node mutation/job tests.
5. **P2 — compact header composition was too product-dashboard-like.** **Fix:** aligned narrow canvas chrome to a left canvas selector and compact helper controls while retaining the standalone product's own labels and actions. **Post-fix evidence:** running-browser layout check described above.

**Open Questions**

- The reference did not expose a complete provider-generation or editing timeline flow in the captured state. Those capabilities remain intentionally out of the visual clone scope; the canvas protocol already has typed nodes, assets, graph edges, durable prompts, and a composition node to support the next provider/CLI phase.

**Implementation Checklist**

- [x] Compared source and implementation at the same compact canvas viewport and similar pan/zoom state.
- [x] Verified focused grid, selected text node, node handles, and curved links.
- [x] Exercised direct drag, hand pan, add menu, prompt update, zoom, and fit.
- [x] Passed core tests (29), preview tests (15), production preview build, and Sites worker tests (4).
- [x] Kept all temporary source evidence out of shipped product assets.

**Follow-up Polish**

- P3: split the large React Flow/preview bundle before a production release; the current production build passes but Vite reports a 500 kB chunk-size advisory.

final result: passed
