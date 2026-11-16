// The helper puts a short clip together from the accepted parts: the icon, the first line of each
// description and the voice-over. Drawn on a canvas and recorded in the browser, in real time.
export type ClipInput = { icon: Blob; lines: { lang: string; text: string }[]; voice: ArrayBuffer };
export type Clip = { blob: Blob; ext: 'webm' | 'mp4'; seconds: number };

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

export async function makeClip(input: ClipInput, onProgress?: (p: number) => void): Promise<Clip> {
  const type = pickType();
  if (!type) throw new Error('this browser cannot record video');
  const W = 1280, H = 720;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  const icon = await createImageBitmap(input.icon);
  const ac = new AudioContext();
  const buf = await ac.decodeAudioData(input.voice.slice(0));
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const total = buf.duration + 0.6;
  const per = total / input.lines.length;
  let t0 = 0;
  let raf = 0;
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#fbf7f4');
    g.addColorStop(1, '#efe6f1');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    // icon with a soft rise
    const k = Math.min(1, t / 0.6);
    const s = 300 + 12 * Math.sin(t * 1.4);
    x.save();
    x.globalAlpha = k;
    x.shadowColor = 'rgba(90,60,90,.25)';
    x.shadowBlur = 40;
    x.shadowOffsetY = 18;
    x.drawImage(icon, 150, H / 2 - s / 2 + (1 - k) * 30, s, s);
    x.restore();
    // current line
    const i = Math.min(input.lines.length - 1, Math.floor(t / per));
    const lt = t - i * per;
    const a = Math.min(1, lt / 0.35) * Math.min(1, (per - lt) / 0.35 + 0.0001);
    const line = input.lines[i]!;
    x.globalAlpha = Math.max(0, a);
    x.fillStyle = '#9a4f95';
    x.font = '700 26px Figtree, system-ui, sans-serif';
    x.fillText(line.lang.toUpperCase(), 540, 250);
    x.fillStyle = '#231a2b';
    x.font = '700 40px Figtree, system-ui, sans-serif';
    wrap(x, line.text, 620).slice(0, 5).forEach((l, j) => x.fillText(l, 540, 310 + j * 52));
    x.globalAlpha = 1;
    // progress line in lime
    x.fillStyle = '#d6f45a';
    x.fillRect(0, H - 10, (W * Math.min(t, total)) / total, 10);
    onProgress?.(Math.min(1, t / total));
    if (t < total) raf = requestAnimationFrame(draw);
  };
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  t0 = performance.now();
  src.start();
  draw();
  await new Promise((r) => setTimeout(r, total * 1000));
  cancelAnimationFrame(raf);
  rec.stop();
  await done;
  await ac.close();
  return { blob: new Blob(chunks, { type: type.mime.split(';')[0] }), ext: type.ext, seconds: total };
}
