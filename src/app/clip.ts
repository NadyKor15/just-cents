// Just Cents puts a short clip together from the accepted parts and the game's own material:
// a few seconds of gameplay (no sound), stills of the game, then the new icon with the first line of each
// description; the accepted voice-over plays across the whole clip. Drawn on a canvas and recorded in the
// browser in real time. Hard cuts and a slow push-in only: no blur, no still moments.
export type ClipInput = { icon: Blob; lines: { lang: string; text: string }[]; voice: ArrayBuffer; frames?: string[]; gameplay?: string };
export type Clip = { blob: Blob; ext: 'webm' | 'mp4'; seconds: number };

/** Game material from the game's own public store page and its recorded play-through. */
export const GAME_FRAMES = ['/game-frames/first-call.jpg', '/game-frames/hike-day.jpg', '/game-frames/build-a-rule.jpg'];
export const GAMEPLAY = '/game-frames/gameplay.mp4';
export const MAX_SECONDS = 15;

function pickType(): { mime: string; ext: 'webm' | 'mp4' } | null {
  const c = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' as const },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' as const },
    { mime: 'video/webm', ext: 'webm' as const },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' as const },
    { mime: 'video/mp4', ext: 'mp4' as const },
  ];
  return c.find((x) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(x.mime)) ?? null;
}

function wrap(x: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function bitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

async function videoEl(url: string): Promise<HTMLVideoElement | null> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  const ok = await new Promise<boolean>((resolve) => {
    v.oncanplaythrough = () => resolve(true);
    v.onerror = () => resolve(false);
    setTimeout(() => resolve(v.readyState >= 3), 8000);
  });
  return ok ? v : null;
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

export async function makeClip(input: ClipInput, onProgress?: (p: number) => void): Promise<Clip> {
  const type = pickType();
  if (!type) throw new Error('this browser cannot record video');
  const W = 1280, H = 720;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  const icon = await createImageBitmap(input.icon);
  const frames = (await Promise.all((input.frames ?? GAME_FRAMES).map(bitmap))).filter((b): b is ImageBitmap => !!b);
  const play = await videoEl(input.gameplay ?? GAMEPLAY);
  const ac = new AudioContext();
  const buf = await ac.decodeAudioData(input.voice.slice(0));
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 3_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // timeline: gameplay → stills → icon with the description lines; voice over all of it
  const G = play ? Math.min(3, play.duration || 2.6) : 0;
  const PER_FRAME = 1.1;
  const ICON = G + frames.length * PER_FRAME;
  const total = Math.min(MAX_SECONDS, Math.max(buf.duration + 0.6, ICON + 6.6));
  const LINES = ICON + 0.5;
  const perLine = (total - LINES) / input.lines.length;
  let t0 = 0;
  let raf = 0;

  const cover = (img: CanvasImageSource, iw: number, ih: number, zoom: number) => {
    const s = Math.max(W / iw, H / ih) * zoom;
    const w = iw * s, h = ih * s;
    x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  };

  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#fbf7f4');
    g.addColorStop(1, '#efe6f1');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    if (play && t < G) {
      cover(play, play.videoWidth, play.videoHeight, 1 + 0.06 * (t / G));
    } else if (t < ICON && frames.length) {
      const k = Math.min(frames.length - 1, Math.floor((t - G) / PER_FRAME));
      const ft = t - G - k * PER_FRAME;
      const f = frames[k]!;
      cover(f, f.width, f.height, 1.02 + 0.07 * (ft / PER_FRAME));
    } else {
      // the new icon, rising, then breathing slowly while the lines run
      const it = t - ICON;
      const k = ease(it / 0.5);
      const s = 300 + 14 * Math.sin(it * 1.6);
      x.save();
      x.shadowColor = 'rgba(40,20,40,.35)';
      x.shadowBlur = 30;
      x.shadowOffsetY = 12;
      x.globalAlpha = k;
      x.drawImage(icon, 110, H / 2 - s / 2 - 30 + (1 - k) * 40, s, s);
      x.restore();
      if (t >= LINES) {
        const i = Math.min(input.lines.length - 1, Math.floor((t - LINES) / perLine));
        const line = input.lines[i]!; // hard cut between lines, no fade
        x.font = '800 26px Figtree, system-ui, sans-serif';
        x.fillStyle = '#9a4f95';
        x.fillText(line.lang.toUpperCase(), 500, 250);
        x.font = '700 40px Figtree, system-ui, sans-serif';
        x.fillStyle = '#231a2b';
        wrap(x, line.text, 680).slice(0, 5).forEach((l, j) => x.fillText(l, 500, 310 + j * 52));
      }
    }
    x.fillStyle = '#d6f45a';
    x.fillRect(0, H - 8, (W * Math.min(t, total)) / total, 8);
    onProgress?.(Math.min(1, t / total));
    if (t < total) raf = requestAnimationFrame(draw);
  };
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  t0 = performance.now();
  if (play) {
    play.currentTime = 0;
    void play.play().catch(() => {});
  }
  src.start(ac.currentTime + 0.3);
  draw();
  await new Promise((r) => setTimeout(r, total * 1000));
  cancelAnimationFrame(raf);
  rec.stop();
  await done;
  await ac.close();
  return { blob: new Blob(chunks, { type: type.mime.split(';')[0] }), ext: type.ext, seconds: total };
}
