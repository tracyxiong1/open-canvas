# Open Canvas visual fidelity QA — 2026-08-20

## Comparison target

- **Source visual truth:** user-authorized live creative canvas, captured at 716 × 994 CSS px and 1× density.
- **Implementation:** local preview captured at the same 716 × 994 CSS px and 1× density.
- **States compared:** default canvas, selected image node, full nine-node operation topology, active edge flow, portrait/grid-split menus, add-node menu, toolbox, library, role library, history, shortcuts, and asset sidebar.
- **Evidence handling:** the raw audit captures remain local-only and are excluded from Git; no source artwork, session data, or branding is shipped.

**Viewport and normalization**

- Both sides use the same viewport, dark canvas, 50% zoom, a completed image node linked to a pending text node, and a matching selected-node state.
- Narrow-window behavior is deliberately matched: the authored graph keeps its world origin rather than auto-fitting, so right-side nodes naturally crop when the window is narrow.
- Dock surfaces use their own measured responsive anchoring instead of sharing a generic menu layout.
- The final review includes both full-canvas and focused selected-node comparisons. The focused crop covers the context bar, media card, connector, prompt composer, and lower action row.

The product keeps independent project labels, iconography, and an original generated demo image. No source logo, source artwork, source session data, or source-branded copy ships in the app.

## Findings

The current pass closes the newly re-audited default/hover/selected connector states, selected-node toolbar icon semantics, modal stacking, and asset-sidebar focus behavior in addition to the earlier selected-node, nine-node topology, edge-flow, dock-overlay, shortcut-sheet, toolbox, zoom, add-menu, and contextual-menu work. Visual QA remains open for continued state-by-state review, and end-to-end completion is still blocked on command execution: the non-destructive contextual menus now open and dismiss, but their generation/edit operations are not yet connected to an AI provider/job pipeline.

- [P1] Contextual image commands do not yet execute a generation or editing job
  - **Location:** selected image node → **高清** / **九宫格** contextual menus.
  - **Evidence:** the source/local comparisons `151-reference-hd-menu-pressed.png` / `154-local-hd-menu-icons-final.png` and `156-reference-nine-grid-menu-pressed.png` / `157-local-nine-grid-menu-final.png` verify the menus' visual geometry and interactive open/close state. The implementation currently dismisses an item selection without dispatching an engine command.
  - **Impact:** the canvas now presents the correct editing affordance, but transformations such as upscaling, outpainting, and preset storyboards cannot yet run end-to-end.
  - **Next step:** route menu selections through the shared command core into a provider-neutral generation/edit job envelope, then bind that envelope to the user-supplied API-key runtime.

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

- Dragged the completed image node in the browser: the node moved and its selected quick bar followed by the same delta; the browser was then restored to the baseline fixture state.
- Clicked the image node: it selected the node and exposed the matching contextual toolbar and prompt composer.
- Rechecked the idle, hovered, and selected connector states: connector glyphs are hidden at rest, appear on node hover or selection, and retain their inward hover motion without changing the media-card border.
- Opened and closed **资产管理**; the generated image appears as a focusable asset entry.
- Selected the off-screen text node from **资产管理**: the sidebar stayed open, its semantic node order and active-row actions matched the reference, and the node was centered in the remaining canvas at 100% zoom.
- Opened **添加节点** and created a **文本** node; the menu closed and the graph gained the new editable node.
- Opened and closed the toolbox, library, role library, history, shortcut sheet, and tutorial surfaces; each has its own responsive geometry and dialog/menu semantics.
- Verified role/history modal stacking after selecting an image: the modal backdrop and panel now cover the node toolbar instead of allowing it to bleed through.
- Opened and dismissed the selected-node **人像质感调节**, **高清** image-action, and **九宫格** storyboard-preset menus. All preserve keyboard semantics, pointer focus behavior, and measured narrow-viewport anchoring.
- Rechecked the selected toolbar and composer at 1× after dependency-safe icon replacement: panorama rotation, portrait adjustment, marker, and style controls now use closer open-source icon silhouettes without copying source artwork.
- Opened **宫格切分** and verified its five rows, separator, 150 × 225.25 px inner menu, and persistent node editing mode after switching menus or reselecting the node.
- Panned across the full operation graph and verified the central image, text node, five compact enhancement nodes, panoramic node, role-view node, and eight fan-out edges against the same live viewport coordinates.
- Selected and deselected the central image node and verified all adjacent edges switch between the neutral 2 px line and three-segment flowing highlight state.
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

6. **P1 — narrow shortcut sheet hierarchy and shortcut keycaps drifted from the reference.**
   - **Fix:** rebuilt the sheet around a 795 px nested scroll region, 14 px labels, 28 px outlined keycaps, explicit `+` separators, inline drag suffixes, and a measured scroll indicator.
   - **Post-fix result:** `118-reference-local-shortcuts-comparison.png` confirms the quick bar remains above the sheet while the node body stays correctly behind it.

7. **P1 — selected-node menus and connector internals looked static or optically wrong.**
   - **Fix:** moved the selected quick bar into a high-layer portal, added the measured **人像质感调节**, **高清**, and **九宫格** submenus, removed pointer-only focus rings, and reduced the connection-plus glyph to the measured 3.5 px displayed size while preserving its 40 px hit target and hover position.
   - **Post-fix result:** `150-reference-local-selected-handle-final.png`, `155-reference-local-hd-menu-icons-comparison.png`, `158-reference-local-nine-grid-menu-comparison.png`, and `163-reference-local-portrait-menu-comparison.png` show matching anchors, menu density, connector geometry, and active states apart from intentional independent artwork and icon silhouettes.

8. **P1 — menu state and the inline composer were incorrectly coupled.**
   - **Fix:** separated persistent per-node editing mode from transient popover state, added the measured five-item grid-split menu, and preserved the selected mode through menu switches and node reselection.
   - **Post-fix result:** `10-comparison-grid-split.png` and `11-comparison-grid-persistent-mode.png` show matching menu geometry and composer controls in the same state.

9. **P1 — the fixture exposed only the central image and text nodes, so the graph density and edge behavior did not match the reference.**
   - **Fix:** added the complete independently authored nine-node demo topology, measured compact/panorama/wide operation sizes, selection-driven fan-out edge flow, the text-node status marker, and the 12-point generation indicator.
   - **Post-fix result:** `14-comparison-selected-detail.png` and `15-comparison-full-topology.png` verify the selected and full-graph states at the same viewport; node bounds differ only by subpixel rounding.

10. **P1 — default connector visibility, modal stacking, and asset-list focus still diverged in normal use.**
   - **Fix:** hide connector glyphs until node hover/selection, preserve the neutral card border and cursor on hover, lower the selected-node toolbar beneath modal layers, and implement the reference asset-list behavior: persistent sidebar, semantic ordering, active-row actions, 100% zoom, and centering within the remaining canvas.
   - **Post-fix result:** `21-comparison-default-after.png`, `30-local-role-z-fixed.png`, `35-comparison-asset-focus-text.png`, and `39-comparison-selected-menu-final.png` cover the corrected default, modal, asset-focus, and selected-menu states.

11. **P2 — several generic toolbar glyphs still read as the wrong actions at normal zoom.**
   - **Fix:** replace the panorama thumbnail glyph with Tabler's open-source numeric panorama icon, align the portrait menu with the same user silhouette, and switch the prompt marker/style chips to pin and cube glyphs.
   - **Post-fix result:** `43-comparison-open-source-icon.png` verifies the same selected-node/menu state side by side; remaining differences are independent media artwork and source-specific branding.

## Implementation checklist

- [x] Source and implementation captured in the same selected-node canvas state at 716 × 994 CSS px and 1× density.
- [x] Full-view and focused side-by-side comparisons reviewed for default, selected, role-library, and history states.
- [x] Default fixture validates through the canonical canvas schema and fingerprint checks.
- [x] Browser-level drag, selection, asset management, node creation, role filtering, history, and dock-surface flows exercised.
- [x] Revised shortcut sheet, toolbox, zoom, add menu, connector, and contextual menus re-captured at 716 × 994 and compared side by side.
- [x] Re-captured idle connector, selected toolbar, modal layering, and asset-sidebar focus states at 716 × 994 after the interaction refinement.
- [x] `npm test --workspace @open-canvas/preview` passed: 21 tests.
- [x] `npm run check` and `npm run build --workspace @open-canvas/preview` passed after the current connector/menu refinement.
- [ ] Bind contextual menu selections to the provider-neutral job pipeline, then repeat an end-to-end generated-asset state review.

## Follow-up polish

- [P3] Consider code-splitting the preview bundle before a production release; Vite reports the existing 500 kB chunk-size advisory.

final result: blocked
