/**
 * The trailer on the "ready" screen loads only when someone presses Play. The video is ~8.6 MB; with a src and
 * preload="metadata" the browser still fetched almost all of it on every "See a paid order", at the same time as the
 * files being checked. So the video gets no src until the Play button is pressed: until then nothing of it is fetched.
 * The subtitles track is added before (it is a small blob), so it plays with the subtitles from the first second.
 */

/** The parts of a <video> this needs (a real HTMLVideoElement in the page, a plain object in tests). */
export interface TrailerVideo {
  src: string;
  controls: boolean;
  preload: string;
  play(): Promise<void> | void;
  textTracks?: ArrayLike<{ kind: string; mode: string }>;
}

/**
 * Turn the subtitles on. A `default` track is not enough everywhere: WebKit (Safari) leaves it off when the person's
 * caption setting is "Automatic", and the point of this trailer is to show the accepted subtitles.
 */
function showSubtitles(video: TrailerVideo): void {
  const tracks = video.textTracks ? Array.from(video.textTracks) : [];
  const t = tracks.find((x) => x.kind === 'subtitles');
  if (t) t.mode = 'showing';
}

/** The Play button over the video. */
export interface PlayButton {
  hidden: boolean | string; // as HTMLElement.hidden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as HTMLElement.onclick (a PointerEvent in the page)
  onclick: ((ev?: any) => unknown) | null;
}

const started = new WeakSet<object>();

/** Whether the trailer has been started (its src set) in this video. */
export function trailerStarted(video: TrailerVideo): boolean {
  return started.has(video);
}

/**
 * Shows the Play button and keeps the video without a src until it is pressed. Once started, the video keeps playing
 * as it is when the screen fills again (only its subtitles track may change).
 */
export function armTrailer(video: TrailerVideo, play: PlayButton, url: string): void {
  if (started.has(video)) {
    video.controls = true;
    play.hidden = true;
    showSubtitles(video); // the new track of a refilled screen
    return;
  }
  video.preload = 'none';
  video.controls = false;
  play.hidden = false;
  play.onclick = () => {
    if (started.has(video)) return;
    started.add(video);
    play.hidden = true;
    video.controls = true;
    video.src = url;
    showSubtitles(video);
    // called inside the click, so the browser (iPhone too) lets it play with sound; if it still refuses, the controls are there
    try {
      void Promise.resolve(video.play()).catch(() => undefined);
    } catch {
      /* the controls are there */
    }
  };
}
