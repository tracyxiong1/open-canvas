function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function localBridgeUrl(value, path) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !isLoopbackHost(url.hostname) || url.pathname !== path) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function localProjectUrl(value) {
  return localBridgeUrl(value, "/project.json");
}

export function localAssetUrl(value) {
  return localBridgeUrl(value, "/asset");
}

export function resolveBridgeAssetUrl(asset, bridgeAssetUrl) {
  if (!bridgeAssetUrl) return null;
  const url = new URL(bridgeAssetUrl);
  url.searchParams.set("id", asset.id);
  return url.toString();
}
