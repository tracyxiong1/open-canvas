import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetPreview, isPlayableVideoPreview } from "../src/media-preview.jsx";

describe("asset preview media selection", () => {
  it("renders a real project video as a playable video element", () => {
    const asset = {
      id: "asset_video",
      kind: "video",
      mediaType: "video/mp4",
      previewUrl: "http://127.0.0.1:43210/asset?id=asset_video",
    };

    render(<AssetPreview asset={asset} alt="镜头视频" controls />);

    const video = screen.getByLabelText("镜头视频");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("controls");
    expect(isPlayableVideoPreview(asset)).toBe(true);
  });

  it("keeps fixture-backed video covers as still images", () => {
    const asset = {
      id: "asset_fixture_video",
      kind: "video",
      mediaType: "video/mp4",
      previewUrl: "/assets/shot-arrival.webp",
    };

    render(<AssetPreview asset={asset} alt="镜头封面" />);

    expect(screen.getByAltText("镜头封面").tagName).toBe("IMG");
    expect(isPlayableVideoPreview(asset)).toBe(false);
  });
});
