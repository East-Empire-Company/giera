// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachSplashVideo } from "../../src/client/startup/splash-video";

afterEach(() => vi.restoreAllMocks());

describe("boot splash audio", () => {
  it("falls back to muted autoplay when autoplay needs a user gesture, then unmutes on gesture", async () => {
    document.body.innerHTML = '<section id="boot-status"><video id="boot-video" muted></video><div class="boot-card"></div></section>';
    const status = document.querySelector<HTMLElement>("#boot-status")!;
    const video = document.querySelector<HTMLVideoElement>("#boot-video")!;
    Object.defineProperty(video, "networkState", { value: 1, configurable: true });
    const play = vi.fn()
      .mockRejectedValueOnce(new DOMException("User gesture required", "NotAllowedError"))
      .mockResolvedValue(undefined);
    Object.defineProperty(video, "play", { value: play, configurable: true });
    Object.defineProperty(video, "pause", { value: () => {}, configurable: true });

    const splash = attachSplashVideo(status);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));

    expect(video.muted).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.hidden).toBe(false);
    expect(status.classList.contains("boot-video-ready")).toBe(true);

    window.dispatchEvent(new Event("pointerdown"));
    expect(video.muted).toBe(false);
    splash.stop();
  });

  it("shows controls when even muted autoplay is blocked", async () => {
    document.body.innerHTML = '<section id="boot-status"><video id="boot-video" muted></video><div class="boot-card"></div></section>';
    const status = document.querySelector<HTMLElement>("#boot-status")!;
    const video = document.querySelector<HTMLVideoElement>("#boot-video")!;
    Object.defineProperty(video, "networkState", { value: 1, configurable: true });
    const play = vi.fn().mockRejectedValue(new DOMException("User gesture required", "NotAllowedError"));
    Object.defineProperty(video, "play", { value: play, configurable: true });
    Object.defineProperty(video, "pause", { value: () => {}, configurable: true });

    const splash = attachSplashVideo(status);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));

    expect(video.muted).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.hidden).toBe(false);
    splash.stop();
  });
});
