/**
 * Copy text to the clipboard. The async Clipboard API can hang (permission prompt, page without focus),
 * so it gets a short timeout and a fallback through a hidden textarea. Returns whether it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      const ok = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 800)),
      ]);
      if (ok) return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** What a "Copy" button needs: its label and a class for the short confirmation. */
export interface CopyButton {
  textContent: string | null;
  classList: { add(...t: string[]): void; remove(...t: string[]): void };
}

const idleLabel = new WeakMap<CopyButton, string>();
const resetTimer = new WeakMap<CopyButton, ReturnType<typeof setTimeout>>();

/**
 * A "Copy" button: copies the text, says "Copied" (or "Copy failed") for a moment, then shows its own label again.
 * Clicking again while it says "Copied" copies again and keeps the original label (it is remembered once).
 */
export async function copyAndConfirm(btn: CopyButton, text: string, copy: (t: string) => Promise<boolean> = copyText, ms = 1600): Promise<boolean> {
  if (!idleLabel.has(btn)) idleLabel.set(btn, btn.textContent ?? '');
  const ok = await copy(text);
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  btn.classList.remove('copied', 'copy-failed');
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  clearTimeout(resetTimer.get(btn));
  resetTimer.set(
    btn,
    setTimeout(() => {
      btn.textContent = idleLabel.get(btn) ?? '';
      btn.classList.remove('copied', 'copy-failed');
    }, ms),
  );
  return ok;
}
