# Open Canvas visual fidelity QA — 2026-08-20

## Comparison target

- **Source visual truth:** user-authorized live creative canvas, captured at 716 × 994 CSS px and 1× density.
- **Implementation:** local preview captured at the same 716 × 994 CSS px and 1× density.
- **States compared:** default canvas, selected image node, add-node menu, toolbox, library, role library, history, shortcuts, and asset sidebar.
- **Evidence handling:** the raw audit captures remain local-only and are excluded from Git; no source artwork, session data, or branding is shipped.

**Viewport and normalization**

- Both sides use the same viewport, dark canvas, 50% zoom, a completed image node linked to a pending text node, and a matching selected-node state.
- Narrow-window behavior is deliberately matched: the authored graph keeps its world origin rather than auto-fitting, so right-side nodes naturally crop when the window is narrow.
- Dock surfaces use their own measured responsive anchoring instead of sharing a generic menu layout.
- The final review includes both full-canvas and focused selected-node comparisons. The focused crop covers the context bar, media card, connector, prompt composer, and lower action row.

The product keeps independent project labels, iconography, and an original generated demo image. No source logo, source artwork, source session data, or source-branded copy ships in the app.

## Findings

The final pass covers the default, selected, menu, sidebar, and dock-overlay states. No P0, P1, or P2 findings remain after the final browser and build rerun. The closeout below records only intentional product-identity differences.

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

- **Fonts and typography:** compact system/Inter fallback retains the small muted labels, 13 px control text, medium-weight node titles, metadata placement, and one-line truncation hierarchy of the reference. Chinese node and prompt copy fit without wrapping or clipping in the compared state.
- **Spacing and layout rhythm:** selected quick bar, media card, text card, connector points, prompt panel, and dock align to the measured 716 px state. The selected quick bar and composer are within roughly 0.5 px of the measured source bounds; their grouped controls use matching 32 px rows, 8 px gaps, separators, and radii.
- **Colors and visual tokens:** dark near-black canvas, sparse gray dot plane, charcoal floating surfaces, muted neutral controls, cyan `NEW`/accent treatment, and green completion cue reproduce the visible contrast hierarchy without source branding.
- **Image quality and asset fidelity:** completed media and role cards use real locally served PNG/WebP assets, not CSS art, inline SVG, placeholders, or screenshots. They remain sharp at their node and role-card crops.
- **Copy and content:** generic independent labels (`工作区`, `画布 1`, `Agent`) replace source-specific identity. The compared node labels and prompt are concise, meaningful canvas content, and the action/control labels have semantic names.
- **Accessibility and affordances:** canvas controls have accessible names; node surfaces are keyboard-focusable buttons; selected state is exposed with `aria-pressed`; the prompt is an associated text input; dialogs and menus expose their semantic roles.

## Interaction checks

- Dragged the completed image node in the browser: the interface showed `节点位置已更新`, confirming the visible drag writes canonical coordinates.
- Clicked the image node: it selected the node and exposed the matching contextual toolbar and prompt composer.
- Opened and closed **资产管理**; the generated image appears as a focusable asset entry.
- Opened **添加节点** and created a **文本** node; the menu closed and the graph gained the new editable node.
- Opened and closed the toolbox, library, role library, history, shortcut sheet, and tutorial surfaces; each has its own responsive geometry and dialog/menu semantics.
- Toggled the role-library “recent” checkbox; it updated without dismissing the dialog.
- Rechecked the history modal’s panel, navigation, date, thumbnail, and empty-state bounds in the same 716 × 994 viewport.
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

4. **P1 — selected-node toolbar and lower composer controls used a generic flat layout.**
   - **Fix:** measured the live selected-node state, rebuilt the control groups and separators, and matched the 32 px control rows, 8 px gaps, contextual action widths, blue preset marker, aperture control, and bottom-right control grouping.
   - **Post-fix result:** the selected quick bar, composer bounds, and major control positions match the normalized live state to within rounding differences.

5. **P1 — node ports and high-visibility dock surfaces drifted from the target’s visual hierarchy.**
   - **Fix:** moved ports to zero-size anchors with 40 px hit targets, rebuilt their visual affordances, and matched the measured add menu, library, role library, history panel, dot-grid color, dock, and lower-left controls.
   - **Post-fix result:** all final P1/P2 visual findings were rerun in the local browser and cleared.

## Implementation checklist

- [x] Source and implementation captured in the same selected-node canvas state at 716 × 994 CSS px and 1× density.
- [x] Full-view and focused side-by-side comparisons reviewed for default, selected, role-library, and history states.
- [x] Default fixture validates through the canonical canvas schema and fingerprint checks.
- [x] Browser-level drag, selection, asset management, node creation, role filtering, history, and dock-surface flows exercised.
- [x] `npm test` passed: core 31, CLI 4, preview 19 tests.
- [x] `npm run check` and `npm run build --workspace @open-canvas/preview` passed.

## Follow-up polish

- [P3] Consider code-splitting the preview bundle before a production release; Vite reports the existing 500 kB chunk-size advisory.

final result: passed — P0: 0, P1: 0, P2: 0; intentional P3 identity differences remain documented above.
