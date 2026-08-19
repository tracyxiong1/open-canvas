# Open Canvas visual fidelity QA — 2026-08-19

## Comparison target

- **Source visual truth:** `docs/qa/toolbar-audit-current-2026-08-19/07-reference-selected-toolbar.png`
- **Implementation:** `docs/qa/toolbar-audit-current-2026-08-19/27-local-reference-selected-final.png`
- **Full-view side-by-side evidence:** `docs/qa/toolbar-audit-current-2026-08-19/28-reference-local-selected-final-comparison.png`
- **Focused node / contextual-toolbar evidence:** `docs/qa/toolbar-audit-current-2026-08-19/29-reference-local-focused-node-toolbar.png`

**Viewport and normalization**

- The source capture is a 1280 × 606 content-only desktop canvas at 1× density.
- The implementation was captured at a 1280 × 720 CSS-px desktop viewport at 1× density.
- The selected-node state has the same 1280-pixel content width in both captures. The implementation was cropped to its top 606 pixels for the full-view and focused comparisons, matching the source’s visible canvas frame rather than comparing browser/UI chrome or a different device density.
- State matched: dark canvas, 50% zoom, one completed image node linked to one pending text node, with the image node selected, contextual action bar visible, and prompt composer expanded.

The product keeps independent project labels, iconography, and an original generated demo image. No source logo, source artwork, source session data, or source-branded copy ships in the app.

## Findings

No actionable P0, P1, or P2 visual differences remain in the scoped selected-node canvas state.

- [P3] Icon silhouette variance
  - **Location:** compact header, contextual action bar, and lower controls.
  - **Evidence:** the focused comparison shows equivalent control count, grouping, spacing, and active states; the implementation uses the closest matching Phosphor icon family rather than source-specific icon assets.
  - **Impact:** minor optical variance only; controls remain labeled, keyboard reachable, and visually consistent with the standalone product.
  - **Disposition:** intentional independent iconography; no source asset is imported.

- [P3] Original demo illustration instead of the reference’s illustration
  - **Location:** completed image node.
  - **Evidence:** both images use a centered cool-blue concentric-ring composition at the same 16:9 crop. The implementation asset is an original generated raster stored at `packages/preview/public/assets/reference-blue-orbit-v2.png`.
  - **Impact:** the canvas hierarchy and palette are preserved while avoiding source media reuse.
  - **Disposition:** intentional, non-actionable product identity difference.

## Required fidelity surfaces

- **Fonts and typography:** compact system/Inter fallback retains the small muted labels, 13 px-ish control text, medium-weight node titles, metadata placement, and one-line truncation hierarchy of the reference. Chinese node and prompt copy fit without wrapping or clipping in the compared state.
- **Spacing and layout rhythm:** selected quick bar, media card, text card, connector points, and prompt panel are aligned within a few pixels in the normalized comparison. The card/toolbar grouping, 12 px-ish radii, thin outlines, and direct horizontal connection preserve the reference’s rhythm.
- **Colors and visual tokens:** dark near-black canvas, sparse gray dot plane, charcoal floating surfaces, muted neutral controls, cyan `NEW`/accent treatment, and green completion cue reproduce the visible contrast hierarchy without source branding.
- **Image quality and asset fidelity:** the completed image is a real locally served PNG, not CSS art, inline SVG, a placeholder, or a screenshot. It is sharp at the rendered 16:9 node crop and follows the centered blue-ring art direction.
- **Copy and content:** generic independent labels (`工作区`, `画布 1`, `Agent`) replace source-specific identity. The compared node labels and prompt are concise, meaningful canvas content, and the action/control labels have semantic names.
- **Accessibility and affordances:** canvas controls have accessible names; node surfaces are keyboard-focusable buttons; selected state is exposed with `aria-pressed`; the prompt is an associated text input; dialogs and menus expose their semantic roles.

## Interaction checks

- Dragged the completed image node in the browser: the interface showed `节点位置已更新`, confirming the visible drag writes canonical coordinates.
- Clicked the image node: it selected the node and exposed the matching contextual toolbar and prompt composer.
- Opened and closed **资产管理**; the generated image appears as a focusable asset entry.
- Opened **添加节点** and created a **视频** node; it appeared selected with its editable prompt configuration.
- Verified the edge, minimap, snap, zoom, pan, asset-manager, add-menu, and prompt flows in the preview test suite.
- After correcting the temporary fixture fingerprint during this QA pass, reloaded the browser successfully. No application error remained on the final reload.

## Comparison history

1. **P1 — initial node scale and canvas composition drifted from the selected-node reference.**
   - **Earlier evidence:** `docs/qa/toolbar-audit-current-2026-08-19/15-reference-local-selected-first-comparison.png`
   - **Fix:** project canonical positions into a 2× presentation surface at the 50% default viewport, change the default fixture to an image → text two-node graph, and preserve canonical storage coordinates on drag/add.
   - **Post-fix evidence:** `28-reference-local-selected-final-comparison.png` shows equivalent card scale, node placement, and connection geometry.

2. **P1 — floating controls did not follow the reference’s compact grouping or selected-node state.**
   - **Earlier evidence:** `docs/qa/toolbar-audit-current-2026-08-19/12-local-before-toolbar-rebuild.png`
   - **Fix:** rebuilt the project chrome, center dock, lower-left control row, contextual image actions, prompt composer, zoom menu, and asset manager around the measured reference dimensions.
   - **Post-fix evidence:** `29-reference-local-focused-node-toolbar.png` shows the context bar, two cards, ports, and prompt panel at the matched state.

3. **P2 — demo media did not support the target’s blue circular visual hierarchy.**
   - **Earlier evidence:** `docs/qa/toolbar-audit-current-2026-08-19/23-local-reference-selected.png`
   - **Fix:** added an original real raster asset with a centered blue concentric-ring composition and bound it through a checksum-valid fixture asset.
   - **Post-fix evidence:** `27-local-reference-selected-final.png` and the right half of `28-reference-local-selected-final-comparison.png`.

## Implementation checklist

- [x] Source and implementation captured in the same selected-node canvas state.
- [x] Full-view and focused side-by-side visual comparisons reviewed.
- [x] Default fixture validates through the canonical canvas schema and fingerprint checks.
- [x] Browser-level drag, selection, asset management, and node creation exercised.
- [x] `npm test` passed: core 31, CLI 4, preview 18.
- [x] `npm run check` and `npm run build` passed.

## Follow-up polish

- [P3] Consider code-splitting the preview bundle before a production release; Vite reports the existing 500 kB chunk-size advisory.

final result: passed
