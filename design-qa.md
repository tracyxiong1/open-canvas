# Open Canvas visual fidelity QA — 2026-08-20

## Scope

- **Reference:** the user-authorized live creative canvas, exercised in the chosen in-app browser.
- **Implementation:** `packages/preview`, backed by the independent Open Canvas document model.
- **Primary viewport:** 716 × 714 CSS px at 1× density.
- **Audited states:** default canvas, selected image node, add/move/zoom menus, toolbox, material library, tutorial, shortcuts, role library, history assets, and arrange preview.
- **Evidence:** live reference and local captures were made at the same viewport and state, then judged side by side. Captures remain in local-only QA folders.

No reference logo, session data, source media, or proprietary icon asset ships with Open Canvas.

## Result

No P0, P1, or P2 issue remains in the audited high-priority canvas and toolbar states.

- [P3] Product mark and a few action-icon silhouettes intentionally use the closest Phosphor/Tabler alternatives instead of reference-specific vectors.
- [P3] Demo artwork is independently generated. Node geometry, crop, hierarchy, and contrast are aligned while the underlying pixels remain Open Canvas assets.
- [P3] Vite still reports the existing bundle-size advisory. This does not affect the audited interaction or rendering.

## Measured alignment at 716 × 714

- Initial viewport: `translate(-39.7956px, 290.195px) scale(0.302744)` in both implementations.
- First image node: `x 48 / y 290.1949 / w 188.3065 / h 105.9603` in both.
- Project chip: `x 16 / y 16 / w 129.5625 / h 32` in both.
- Center dock: `x 189 / y 613 / w 338 / h 49` in both.
- Lower-left toolbar: `x 16 / y 662 / w 274.1406 / h 40` in both.
- Selected-node quick bar: `x -308.1016 / y 223.9219 / w 900.5 / h 49` in both.
- Selected-node composer: `x -187.8467 / y 400.9990 / w 660 / h 191` in both.
- Arrange viewport: `translate(48px, 48px) scale(0.144803)` in both.
- Arrange confirmation: `x 50 / y 574 / w 162 / h 88` in both.
- Add menu: `x 115 / y 124 / w 196 / h 481` in both.
- Move menu: local `x 169.5 / y 515.7344 / w 168 / h 85.2656`; reference differs only by subpixel font rounding (`1/32px`).
- Zoom menu: local `x 172.7656 / y 383.1563 / w 186.6094 / h 276.8438`; reference differs by less than `0.06px` vertically.
- Shortcut sheet: `x 12 / y -3.1953 / w 692 / h 604.1953`; first row is `55.25px` high in both.
- Role library: `x 68 / y 60 / w 580 / h 594`; feature and carousel regions are `284px` and `236px` high in both.
- History panel: `x 35.7969 / y 80 / w 644.4 / h 554`; header, tabs, and content regions are `62px`, `48px`, and `443px` high.

## Interaction verification

- Clicking a node focuses it; clicking blank canvas clears selection and floating controls.
- A real pointer drag moved a node, marked the document unsaved, and `⌘Z` restored its exact original position.
- Arrange opens a non-destructive preview. **还原** restores positions and viewport; **保留** commits the arranged positions and marks the document unsaved.
- Add, move, toolbox, material, role, history, shortcut, tutorial, zoom, and asset-manager controls open and close independently.
- Node handles remain hidden at rest, appear on hover/selection, preserve large hit targets, and occupy the same measured positions as the reference.
- Zoom, canvas fitting, menus, selected-node controls, and narrow-window chrome remain interactive after repeated open/close cycles.

## Side-by-side evidence

Current local-only evidence is under `docs/qa/fidelity-pass-2026-08-20/`:

1. `58-final-default-comparison-716x714.png`
2. `60-final-selected-comparison-716x714.png`
3. `62-final-arrange-comparison-716x714.png`
4. `24-move-menu-comparison-716x714.png`
5. `27-toolbox-comparison-716x714.png`
6. `42-shortcuts-density-comparison-716x714.png`
7. `48-role-library-fixed-comparison-716x714.png`
8. `53-history-fixed-comparison-716x714.png`

## Verification commands

- `npm run test --workspace @open-canvas/preview -- --run` — 24 tests passed.
- `npm run check` — passed.
- `npm run build --workspace @open-canvas/preview` — passed with the existing Vite chunk-size advisory.
- `git diff --check` — passed.

The jsdom SVG `NaN` messages emitted by React Flow remain non-failing test-environment warnings.

final result: passed
