const MAX_SPLASH_MS = 9000;

export interface SplashVideoHandle {
  settle: () => Promise<void>;
  stop: () => void;
}

export function attachSplashVideo(status: HTMLElement): SplashVideoHandle {
  const video = status.querySelector<HTMLVideoElement>("#boot-video");
  if (!video) {
    return { settle: async () => {}, stop: () => {} };
  }

  let settled = false;
  let release: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });

  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(capTimer);
    release();
  };

  const showCard = (): void => {
    status.classList.remove("boot-video-ready");
    video.hidden = true;
    video.pause();
    finish();
  };

  const showVideo = (): void => {
    video.hidden = false;
    status.classList.add("boot-video-ready");
  };

  const capTimer = setTimeout(() => {
    video.pause();
    finish();
  }, MAX_SPLASH_MS);

  if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
    showCard();
    return {
      settle: () => done,
      stop: () => finish(),
    };
  }

  video.addEventListener("playing", showVideo);
  video.addEventListener("ended", finish);
  video.addEventListener("error", showCard, true);

  const started = video.play();
  if (started) started.catch(showCard);

  return {
    settle: () => done,
    stop: () => {
      video.pause();
      video.removeEventListener("playing", showVideo);
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", showCard, true);
      finish();
    },
  };
}