// Big sealed files are also published in parts, so a download that stalls loses one part, not the whole file.
// Cloudflare Pages ignores Range on static files (it answers 200 with the whole file), so the parts are plain static
// files beside the whole one: <sealed>.part0, <sealed>.part1, … (not .p8 & co.: Cloudflare maps .p7/.p8/.p12 to
// crypto media types). Joined in order they are the sealed file, byte for byte;
// the page checks the joined bytes against the signed fingerprint, so a part can never change what is paid for.
// The build cuts them (vite.config.ts → scripts/split-sealed.ts); the whole file stays for the order API (/kit).

/** Size of one part; the last part is shorter. */
export const PART_BYTES = 512 * 1024;

/** How many parts a file of `size` bytes is published in; 0 = only whole (it is small enough). */
export function partCount(size: number): number {
  return Number.isInteger(size) && size > PART_BYTES ? Math.ceil(size / PART_BYTES) : 0;
}

/** Bytes in part `i` of a file of `size` bytes. */
export function partLength(size: number, i: number): number {
  return Math.max(0, Math.min(PART_BYTES, size - i * PART_BYTES));
}

/** Where part `i` of a published file lives. */
export function partPath(path: string, i: number): string {
  return `${path}.part${i}`;
}
