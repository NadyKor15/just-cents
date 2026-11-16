// Language check with franc (whole text + first sentence alone), restricted to a fixed language set.
// usage: node specialists/scripts/check-langs.mjs   (run from code/just-cents; prints JSON, exit 1 on mismatch)
import { franc } from 'franc'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const A = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const ONLY = ['spa', 'fra', 'deu', 'por', 'ita', 'eng', 'cat', 'glg', 'nld']
const FILES = {
  'description-en.txt': 'eng',
  'description-es.txt': 'spa',
  'description-fr.txt': 'fra',
  'description-de.txt': 'deu',
  'description-pt-instead-of-es.txt': 'por',
}

export function firstSentence(t) {
  // first sentence = up to the first . ! ? that is followed by whitespace and a capital (title colon is kept)
  const m = t.trim().match(/^(.+?[.!?])(?=\s+[A-ZÁÉÍÓÚÑÀÂÇÈÊËÎÏÔÙÛÜÄÖ¿¡]|\s*$)/s)
  return (m ? m[1] : t).trim()
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
const out = {}
let bad = 0
for (const [f, want] of isMain ? Object.entries(FILES) : []) {
  const t = readFileSync(join(A, f), 'utf8').trim()
  const first = firstSentence(t)
  const all = franc(t, { only: ONLY })
  const fs = franc(first, { only: ONLY })
  const words = t.split(/\s+/).filter(Boolean).length
  out[f] = { words, expected: want, franc_all: all, franc_first: fs, first_sentence: first, first_words: first.split(/\s+/).length }
  if (all !== want || fs !== want) bad++
}
if (isMain) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(bad ? 1 : 0)
}
