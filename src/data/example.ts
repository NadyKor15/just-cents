// The example order shown on the home page and served to assistants. Everything an example is "about" lives here:
// the request, the names and labels of its three parts, the demo specialists and the tools they use, the order's inputs.
// The mechanics (offers, rules, the careless specialist, the choice by taste, receipt, payment, delivery) do not depend
// on it. Another example = another version of this file + the specialists' files and offers (scripts/sign-offers.ts).
//
// Three roles, fixed by the mechanics:
//   choice — two variants pass the same rules; the person picks one by taste (offer keys `cover`, `cover:b`)
//   pair   — two specialists, one careless on purpose; the careless one is rejected at 0¢ (`sam:good|careless`, `lena:…`)
//   single — one specialist (`logo`)

export type Who = 'sam' | 'lena';

export const EXAMPLE = {
  /** What the person types (and what an assistant asks for). */
  request: 'Get my game ready to list.',
  /** The order field in "Your assistant" mode. */
  assistantAsk: 'Asking to get my game ready to list.',
  /** MCP tool description for create_order. */
  mcpOrder:
    'Order the files to list a game in a store: subtitles for its trailer (SRT, every line on its spoken words), a big store cover from a game frame (at least 2560x1600, two variants, the person picks one), and its logo traced from a sketch into a clean SVG.',

  choice: {
    /** label in receipt, kit and API, e.g. "Cover (A)" */
    label: 'Cover',
    apiPart: 'cover',
    specialist: 'cover (demo specialist)',
    tool: 'Stability AI Fast Upscaler',
    /** how the API checks it (shown to assistants) */
    howApi: 'size, proportions and file size from the signed offer here; after payment the page measures the full file again, including that it is sharper than the frame simply stretched',
    previewAlt: 'Cover preview, 320 px, watermarked',
    /** the game frames the two variants were made from (the order's own input) */
    frames: { a: '/game-frames/cover-frame-a.png', b: '/game-frames/cover-frame-b.png' },
    frameSize: { width: 1024, height: 640 },
    variants: { a: 'Your first call', b: 'Sticker stall' },
  },
  pair: {
    label: 'Subtitles',
    apiPart: 'subtitles',
    names: { sam: 'Sam', lena: 'Lena' } as Record<Who, string>,
    tools: { sam: 'Deepgram Nova-3', lena: 'Deepgram Nova-2' } as Record<Who, string>,
    howApi: 'the start of the first line from the signed offer here, against the trailer\'s first spoken word; the pay page checks the first three lines of the file, and the whole file after payment',
  },
  single: {
    label: 'Logo from sketch',
    apiPart: 'logo',
    specialist: 'logo (demo specialist)',
    tool: 'VTracer (open source, MIT), run by the Just Cents team',
    howApi: 'SVG, colours, outlines and file size from the signed offer here; after payment the page reads the SVG itself and compares it with the sketch',
    sketch: '/game-frames/logo-sketch.png',
  },

  /** The trailer whose words are the subtitles' yardstick (measured once, before any specialist works). */
  trailer: { title: 'Autopilot: Summer Rules — gameplay trailer', seconds: 116.92, video: '/game-frames/trailer-720.mp4' },

  /** The end of the scene, after payment: the accepted parts together, as on the game's page. */
  ready: {
    /** her choice, TG 8927 */
    title: 'Ready for your game page',
    trailer: 'Trailer with the accepted subtitles',
    cover: 'Store cover',
    logo: 'Logo from sketch',
    download: 'Download all files',
  },
} as const;

export const pairName = (w: Who) => EXAMPLE.pair.names[w];
