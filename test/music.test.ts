import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMusic, readId3 } from '../src/core/music';

const read = (p: string) => {
  const f = readFileSync(p);
  return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
};
// decoded length, measured independently with ffprobe (the page uses OfflineAudioContext)
const seconds = (p: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString());

describe('music rules on the delivered files', () => {
  it('both 15 s pieces pass: CC0 text, author and source are in the file', () => {
    for (const [f, who] of [['specialists/assets/music-sam-good.mp3', 'cynicmusic'], ['specialists/assets/music-lena-good.mp3', 'Kistol']] as const) {
      const v = checkMusic(read(f), seconds(f));
      expect(v.ok, v.reason).toBe(true);
      expect(v.license).toBe('CC0-1.0');
      expect(v.author).toBe(who);
      expect(v.source).toMatch(/^https:\/\/opengameart\.org\/content\//);
    }
  });

  it('the careless musician’s 17.2 s piece is rejected for length', () => {
    const f = 'specialists/assets/music-sam-careless.mp3';
    const v = checkMusic(read(f), seconds(f));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('asked for 15.0 s, got 17.2 s');
  });

  it('a file without a licence, or with one not on the list, or without the text, is rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jc-music-'));
    const src = 'specialists/assets/music-sam-good.mp3';
    const strip = join(dir, 'none.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-c', 'copy', strip]);
    expect(checkMusic(read(strip), 15).reason).toBe('no licence in the file');
    const nc = join(dir, 'nc.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c', 'copy', '-id3v2_version', '4', '-metadata', 'LICENSE=CC-BY-NC-4.0', nc]);
    expect(checkMusic(read(nc), 15).reason).toMatch(/not on the allowed list/);
    const notext = join(dir, 'notext.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c', 'copy', '-id3v2_version', '4', '-metadata', 'LICENSE_TEXT=see website', notext]);
    expect(checkMusic(read(notext), 15).reason).toMatch(/licence text is missing/);
    expect(readId3(read(notext))?.txxx['LICENSE']).toBe('CC0-1.0');
  });
});
