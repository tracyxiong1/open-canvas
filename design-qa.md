# Open Canvas visual fidelity QA — 2026-08-19

## Comparison target

- **Source visual truth:** user-authorized live creative canvas, captured at 689 × 994 CSS px and 1× density.
- **Implementation:** local preview captured at the same 689 × 994 CSS px and 1× density.
- **States compared:** default canvas, selected image node, add-node menu, toolbox, library, role library, history, shortcuts, and asset sidebar.
- **Evidence handling:** the raw audit captures remain local-only and are excluded from Git; no source artwork, session data, or branding is shipped.

**Viewport and normalization**

- Both sides use the same viewport, dark canvas, 50% zoom, a completed image node linked to a pending text node, and a matching selected-node state.
- Narrow-window behavior is deliberately matched: the authored graph keeps its world origin rather than auto-fitting, so right-side nodes naturally crop when the window is narrow.
- Dock surfaces use their own measured responsive anchoring instead of sharing a generic menu layout.

The product keeps independent project labels, iconography, and an original generated demo image. No source logo, source artwork, source session data, or source-branded copy ships in the app.

## Findings

The final pass covers the default, selected, menu, sidebar, and dock-overlay states. The closeout below records the remaining intentional product-identity differences only.

- [P3] Icon silhouette variance
  - **Location:** compact header, contextual action bar, and lower controls.
  - **Evidence:** the focused comparison shows equivalent control count, grouping, spacing, and active states; the implementation uses the closest matching Phosphor icon family rather than source-specific icon assets.
  - **Impact:** minor optical variance only; controls remain labeled, keyboard reachable, and visually consistent with the standalone product.
  - **Disposition:** intentional independent iconography; no source asset is imported.

- [P3] Original demo illustrations instead of source illustrations
  - **Location:** completed image node.
  - **Evidence:** both states preserve the same media-card hierarchy and crop. The implementation uses original generated rasters, including `packages/preview/public/assets/reference-blue-orbit-v2.png` and `packages/preview/public/assets/character-portrait-v1.png`.
  - **Impact:** the canvas hierarchy and palette are preserved while avoiding source media reuse.
  - **Disposition:** intentional, non-actionable product identity difference.

## Required fidelity surfaces

- **Fonts and typography:** compact system/Inter fallback retains the small muted labels, 13 px-ish control text, medium-weight node titles, metadata placement, and one-line truncation hierarchy of the reference. Chinese node and prompt copy fit without wrapping or clipping in the compared state.
- **Spacing and layout rhythm:** selected quick bar, media card, text card, connector points, and prompt panel are aligned within a few pixels in the normalized comparison. The card/toolbar grouping, 12 px-ish radii, thin outlines, and direct horizontal connection preserve the reference’s rhythm.
- **Colors and visual tokens:** dark near-black canvas, sparse gray dot plane, charcoal floating surfaces, muted neutral controls, cyan `NEW`/accent treatment, and green completion cue reproduce the visible contrast hierarchy without source branding.
- **Image quality and asset fidelity:** completed media and role cards use real locally served PNG/WebP assets, not CSS art, inline SVG, placeholders, or screenshots. They remain sharp at their node and role-card crops.
- **Copy and content:** generic independent labels (`工作区`, `画布 1`, `Agent`) replace source-specific identity. The compared node labels and prompt are concise, meaningful canvas content, and the action/control labels have semantic names.
- **Accessibility and affordances:** canvas controls have accessible names; node surfaces are keyboard-focusable buttons; selected state is exposed with `aria-pressed`; the prompt is an associated text input; dialogs and menus expose their semantic roles.

## Interaction checks

- Dragged the completed image node in the browser: the interface showed `节点位置已更新`, confirming the visible drag writes canonical coordinates.
- Clicked the image node: it selected the node and exposed the matching contextual toolbar and prompt composer.
- Opened and closed **资产管理**; the generated image appears as a focusable asset entry.
- Opened **添加节点** and created a **视频** node; it appeared selected with its editable prompt configuration.
- Opened and closed the toolbox, library, role library, history, shortcut sheet, and tutorial surfaces; each has its own responsive geometry and dialog/menu semantics.
- Verified edge, minimap, snap, zoom, pan, asset-manager, add-menu, prompt, and dock-surface flows in the preview test suite.

## Comparison history

1. **P1 — initial node scale and canvas composition drifted from the selected-node reference.**
   - **Fix:** project canonical positions into a 2× presentation surface at the 50% default viewport, change the default fixture to an image → text two-node graph, and preserve canonical storage coordinates on drag/add.
   - **Post-fix result:** same-state review shows equivalent card scale, node placement, and connection geometry.

2. **P1 — floating controls did not follow the reference’s compact grouping or selected-node state.**
   - **Fix:** rebuilt the project chrome, center dock, lower-left control row, contextual image actions, prompt composer, zoom menu, and asset manager around the measured reference dimensions.
   - **Post-fix result:** the context bar, two cards, ports, prompt panel, and state-specific dock surfaces share the measured geometry.

3. **P2 — demo media did not support the target’s blue circular visual hierarchy.**
   - **Fix:** added an original real raster asset with a centered blue concentric-ring composition and bound it through a checksum-valid fixture asset.
   - **Post-fix result:** the fixture uses a checksum-valid original raster with the intended centered blue-ring hierarchy.

## Implementation checklist

- [x] Source and implementation captured in the same selected-node canvas state.
- [x] Full-view side-by-side comparisons reviewed for default, selected, and role-library states.
- [x] Default fixture validates through the canonical canvas schema and fingerprint checks.
- [x] Browser-level drag, selection, asset management, and node creation exercised.
- [x] `npm test` passed: core 31, CLI 4, preview 19 tests.
- [x] `npm run check` and `npm run build` passed.

## Follow-up polish

- [P3] Consider code-splitting the preview bundle before a production release; Vite reports the existing 500 kB chunk-size advisory.

final result: passed
