// The example order shown on the home page and served to assistants. Everything an example is "about" lives here:
// the request, the names and labels of its three parts, the demo specialists' names, the clip's lines and game material.
// The mechanics (offers, rules, the careless specialist, the choice by taste, receipt, payment, delivery) do not depend
// on it. Another example = another version of this file + the specialists' files and offers (scripts/sign-offers.ts).
//
// Three roles, fixed by the mechanics:
//   choice — two variants pass the same rules; the person picks one by taste (offer keys `icon`, `icon:b`)
//   pair   — two specialists, one careless on purpose; the careless one is rejected at 0¢ (`sam:good|careless`, `lena:…`)
//   single — one specialist (`voice`)

export type Who = 'sam' | 'lena';

export const EXAMPLE = {
  /** What the person types (and what an assistant asks for). */
  request: 'Make me a kit to list my game.',
  /** The order field in "Your assistant" mode. */
  assistantAsk: 'Asking for: a kit to list my game.',
  /** MCP tool description for create_order. */
  mcpOrder:
    'Order a kit to list a game in a store: an icon (1024x1024, no text), 15 s of music for the clip (CC0 or CC BY, the licence written into the file), and a 10-15 s voice-over.',

  choice: {
    /** label in receipt, kit and API, e.g. "Icon (A)" */
    label: 'Icon',
    apiPart: 'icon',
    specialist: 'icon (demo specialist)',
    /** how the API checks it (shown to assistants) */
    howApi: 'size from the signed offer here; "no letters" is checked by OCR in the browser on the pay page, before the wallet is asked',
    previewAlt: 'Icon preview, 128 px, watermarked',
  },
  pair: {
    label: 'Music',
    apiPart: 'music',
    names: { sam: 'Sam', lena: 'Lena' } as Record<Who, string>,
    howApi: 'length and licence from the signed offer here; the pay page checks the licence written into the file, and the length is measured again on the full file after payment',
  },
  single: {
    label: 'Voice-over',
    apiPart: 'voice',
    specialist: 'voice (demo specialist)',
    howApi: 'length from the signed offer here, measured again on the full file after payment',
  },

  /** The clip: game material first (not sold by anyone), then the chosen part and these lines. */
  clip: {
    frames: ['/game-frames/first-call.jpg', '/game-frames/hike-day.jpg', '/game-frames/build-a-rule.jpg'],
    gameplay: '/game-frames/gameplay.mp4',
    title: 'Autopilot: Summer Rules',
    tagline: 'Your AI. Your rules. Your money.',
  },
} as const;

export const pairName = (w: Who) => EXAMPLE.pair.names[w];
