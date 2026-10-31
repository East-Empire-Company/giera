import { describe, expect, it } from "vitest";
import { parseGoogleFontCss, resolveKenneyZipUrl } from "../../scripts/fetch-assets";

describe("Kenney download resolution", () => {
  it("finds the current asset archive without pinning its changing hash", () => {
    const html = '<a href="/media/pages/assets/voxel-pack/a3f1/kenney_voxel-pack.zip">Download</a><a href="https://other.example/file.zip">Other</a>';
    expect(resolveKenneyZipUrl("voxel-pack", html)).toBe("https://kenney.nl/media/pages/assets/voxel-pack/a3f1/kenney_voxel-pack.zip");
  });

  it("rejects links outside the expected Kenney asset path", () => {
    expect(() => resolveKenneyZipUrl("voxel-pack", '<a href="https://evil.example/kenney_voxel-pack.zip">Download</a>')).toThrow("Kenney ZIP not found");
  });
});

describe("Google Fonts localization", () => {
  it("localizes TTF or WOFF2 source URLs and preserves CSS subsets", () => {
    const source = "@font-face { src: url(https://fonts.gstatic.com/font.ttf) format('truetype'); }";
    expect(parseGoogleFontCss(source)).toEqual({
      css: "@font-face { src: url(\"./pixelify-sans-0.ttf\") format('truetype'); }",
      files: [{ url: "https://fonts.gstatic.com/font.ttf", file: "pixelify-sans-0.ttf" }],
    });
  });
});
