const DEMO_ASSET_URLS = Object.freeze({
  asset_sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:
    "/assets/shot-arrival.webp",
  asset_sha256_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:
    "/assets/shot-crossing.webp",
  asset_sha256_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:
    "/assets/shot-signal.webp",
  asset_sha256_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd:
    "/assets/shot-signal.webp",
});

/**
 * Visual-only catalog for the checked-in contract fixture. Real project assets
 * are resolved by the preview host from their project-relative paths.
 */
export function resolveDemoAssetUrl(asset) {
  return DEMO_ASSET_URLS[asset.id] ?? null;
}
