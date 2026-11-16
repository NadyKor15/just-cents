// Build assets/MANIFEST.json: name, bytes, sha256 and measured facts for every file in assets/.
// usage: node specialists/scripts/make-manifest.mjs   (run from code/just-cents)
import { franc } from 'franc'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstSentence } from './check-langs.mjs'

const A = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const ONLY = ['spa', 'fra', 'deu', 'por', 'ita', 'eng', 'cat', 'glg', 'nld']
const LANG = {
  'description-en.txt': 'eng',
  'description-es.txt': 'spa',
  'description-fr.txt': 'fra',
  'description-de.txt': 'deu',
  'description-pt-instead-of-es.txt': 'por',
}
const NOTES = {
  'icon.svg': 'hand-authored source of the icon; no <text> elements',
  'icon-b.svg': 'variant B source: dusk sky, camp tent with pennant, dotted route, smiling agent orb; no <text> elements',
  'icon-b-1024.png': 'variant B rasterized from icon-b.svg; no letters or digits',
  'icon-b-preview-128.png': 'variant B 128 px preview, same watermark treatment as icon-preview-128.png; no letters (mark has a cent-sign glyph)',
  'icon-1024.png':'rasterized icon.svg; no letters or digits',
  'icon-preview-128.png': '128 px downscale + brand-mark watermark (s5-icon.png at ~40 % opacity, 3 copies) + 4 thin diagonal lines; no letters',
  'icon-bad-512-with-text.png': 'TEST ONLY: deliberately wrong, contains the word PLAY',
  'description-pt-instead-of-es.txt': 'TEST ONLY: Portuguese delivered when Spanish was requested',
  'voice-script.txt': 'English trailer script, spoken by macOS say, voice Samantha',
  'voice-full.mp3': 'full voice-over, mono 44.1 kHz 96 kbps',
  'voice-preview-3s.mp3': 'first 3.0 s of voice-full.mp3 with 0.4 s fade-out',
  'voice-bad-32s.mp3': 'TEST ONLY: deliberately too long (~30 s)',
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const probe = (p, args) => execFileSync(args[0], [...args.slice(1), p], { encoding: 'utf8' }).trim()

const files = readdirSync(A).filter((f) => f !== 'MANIFEST.json' && !f.startsWith('.') && statSync(join(A, f)).isFile()).sort()
const out = { generated_at: new Date().toISOString(), files: [] }
for (const name of files) {
  const p = join(A, name)
  const e = { name, bytes: statSync(p).size, sha256: sha(p) }
  if (NOTES[name]) e.note = NOTES[name]
  if (name.endsWith('.png')) {
    const [w, h] = probe(p, ['magick', 'identify', '-format', '%w %h']).split(' ').map(Number)
    e.width = w
    e.height = h
  } else if (name.endsWith('.mp3')) {
    e.duration_s = Number(Number(probe(p, ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0'])).toFixed(2))
    const s = probe(p, ['ffprobe', '-v', 'error', '-show_entries', 'stream=channels,sample_rate,bit_rate', '-of', 'csv=p=0']).split(',')
    e.sample_rate = Number(s[0])
    e.channels = Number(s[1])
    e.bit_rate = Number(s[2])
  } else if (LANG[name]) {
    const t = readFileSync(p, 'utf8').trim()
    const first = firstSentence(t)
    e.words = t.split(/\s+/).filter(Boolean).length
    e.language_expected = LANG[name]
    e.franc_whole = franc(t, { only: ONLY })
    e.franc_first_sentence = franc(first, { only: ONLY })
    e.first_sentence = first
  } else if (name === 'voice-script.txt') {
    e.words = readFileSync(p, 'utf8').split(/\s+/).filter(Boolean).length
  }
  out.files.push(e)
}
writeFileSync(join(A, 'MANIFEST.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote MANIFEST.json (${out.files.length} files)`)
