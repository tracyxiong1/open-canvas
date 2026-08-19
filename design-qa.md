# Open Canvas visual fidelity QA — 2026-08-20

## Scope and source of truth

- **Reference:** the user-authorized live creative canvas, inspected in the user's chosen browser.
- **Implementation:** `packages/preview`, rendered from the independent Open Canvas project document.
- **Viewports:** 1280 × 994 and 716 × 994 CSS px at 1× density.
- **Compared states:** clean canvas, selected image node, selected text node, zoom menu, add menu, tutorial menu, toolbox, material library, role library, history, shortcuts, asset sidebar, connector hover/selection, and narrow-view fitting.
- **Evidence policy:** reference captures and side-by-side comparisons remain in local-only QA folders. No reference logo, session data, media, or proprietary icon asset ships with Open Canvas.

The reference and implementation were captured at the same viewport, zoom, selected node, and open-panel state before each judgment. Each review used a side-by-side combined image, rather than separate screenshots viewed from memory.

## Final findings

No P0, P1, or P2 visual-fidelity issue remains in the audited canvas states.

- [P3] Open-source icon silhouettes differ optically from reference-specific icons.
  - **Location:** project mark, panorama command, contextual actions, and account/agent controls.
  - **Disposition:** intentional independent product identity. The implementation uses the closest Phosphor/Tabler icon instead of copying proprietary vectors.
- [P3] Demo artwork is independently generated.
  - **Location:** completed image node and role-card thumbnails.
  - **Disposition:** intentional. Geometry, crop, hierarchy, and contrast match; the pixels remain Open Canvas assets.
- [P3] The preview bundle retains Vite's existing 500 kB chunk advisory.
  - **Disposition:** production optimization follow-up; it does not affect the audited interaction or visual result.

Provider-backed generation jobs remain a later product milestone and are outside this visual-alignment pass. Prompt editing, submission intent, node creation, graph editing, and project JSON mutation are already interactive.

## Measured alignment

At 1280 × 994:

- Selected image frame: reference and local both resolve to approximately `x 149.986 / y 415.872 / w 288.353 / h 162.256`.
- Selected-node quick bar: both resolve to `x -156.648 / y 344.734 / w 901.609 / h 50`.
- Compact media composer: both resolve to approximately `x -35.838 / y 585.546 / w 660 / h 192`.
- Center dock: both resolve to `x 470.5 / y 932 / w 339 / h 50`; every dock button and icon uses the measured 32 px and 16 px boxes.
- Lower-left controls, top-right action group, zoom menu, and tutorial menu match their measured fractional bounds.

At 716 × 994 after **适合屏幕**:

- Canvas zoom: both resolve to `30.842%`, displayed as `31%`.
- Central image frame: both resolve to approximately `x 33 / y 443.026 / w 191.837 / h 107.947`.
- Selected quick bar: reference `y 375.609`; local `y 375.617` (1/128 px rounding difference).
- Media composer: both resolve to approximately `x -201.081 / y 555.908 / w 660 / h 192`.
- Text composer: both resolve to approximately `x 12.345 / y 555.908 / w 660 / h 203.797`.
- Text model, utility, cost, and submit controls share the measured footer positions at `x 21.345`, `551.345`, `591.345`, and `631.345`.

## Side-by-side evidence

All paths below are local QA artifacts and intentionally excluded from publication:

1. `docs/qa/alignment-pass-2026-08-20-continuation/127-clean-final-comparison-1280.png`
2. `docs/qa/alignment-pass-2026-08-20-continuation/139-selected-detail-pass-comparison.png`
3. `docs/qa/alignment-pass-2026-08-20-continuation/133-zoom-proper-font-comparison.png`
4. `docs/qa/alignment-pass-2026-08-20-continuation/136-tutorial-detail-comparison.png`
5. `docs/qa/alignment-pass-2026-08-20-continuation/144-fit-716-comparison.png`
6. `docs/qa/alignment-pass-2026-08-20-continuation/147-selected-716-comparison.png`
7. `docs/qa/alignment-pass-2026-08-20-continuation/156-text-data-final-716-comparison.png`

## Interaction verification

- Clicking an image or text node selects it and exposes the correct fixed-size composer.
- A real pointer drag moved the selected node; its label, handles, edges, and floating controls followed. The fixture was then restored.
- **适合屏幕** reaches the same 30.842% narrow-view zoom as the reference; zoom-menu pointer focus is released and clicking a node/canvas dismisses the menu.
- Prompt submission is available for an existing non-empty prompt, matching the repeat-generation affordance.
- Text nodes include reference thumbnail/count/remove affordances, expand/collapse, model selection, translation, generation cost, and submit controls.
- Image nodes include contextual portrait, panorama, multi-angle, lighting, grid, high-definition, split, marker, rotate, download, and preview controls.
- Add, toolbox, material, role, history, shortcut, tutorial, zoom, and asset-manager surfaces open, close, and retain their measured responsive geometry.
- Handles remain hidden at rest, appear on hover/selection, preserve large hit targets, and support valid dependency/sequence connections.
- Bottom dock and top chrome use the reference's narrow-window behavior without hiding core canvas controls.

## Verification commands

- `npm run test --workspace @open-canvas/preview -- --run` — 22 tests passed.
- `npm run check` — passed.
- `npm run build --workspace @open-canvas/preview` — passed.
- `git diff --check` — passed.

The known jsdom SVG `NaN` warnings emitted by React Flow remain non-failing test-environment warnings.

final result: passed
