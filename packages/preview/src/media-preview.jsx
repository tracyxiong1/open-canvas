const STATIC_IMAGE_PREVIEW_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

/**
 * Project assets retain their canonical media kind. The checked-in visual
 * fixture deliberately maps video assets to still WebP cover images, so use
 * that explicit preview URL shape to preserve the fixture while real bridge
 * URLs (which have no image suffix) render as playable video.
 */
export function isPlayableVideoPreview(asset) {
  if (!asset?.previewUrl) return false;
  if (asset.kind !== "video" && !asset.mediaType?.startsWith("video/")) return false;
  return !STATIC_IMAGE_PREVIEW_PATTERN.test(asset.previewUrl);
}

export function AssetPreview({ asset, alt = "", className, controls = false }) {
  if (isPlayableVideoPreview(asset)) {
    return (
      <video
        className={className}
        src={asset.previewUrl}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : "true"}
        controls={controls}
        muted={controls ? undefined : true}
        playsInline
        preload="metadata"
        draggable="false"
      />
    );
  }

  return <img className={className} src={asset.previewUrl} alt={alt} draggable="false" />;
}
