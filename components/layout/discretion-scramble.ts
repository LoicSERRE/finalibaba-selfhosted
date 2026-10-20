import { DISCRETION_TARGETS, SCRAMBLED_ATTRIBUTE, scrambleText } from "@/lib/domain/discretion";

/**
 * The DOM side of discretion mode (v2.18): replaces the figures inside every
 * target with noise (lib/domain/discretion.ts's scrambleText), keeps doing it
 * as React re-renders, and puts the real text back when the mode is turned
 * off.
 *
 * It edits text nodes React owns, which is safe because React never reads
 * text back after hydration: an update writes the new value straight over
 * ours, the observer below sees that write before the next paint, and
 * scrambles again. Hydration is the one moment React does compare, so a node
 * is only touched once React has claimed it - a streamed Suspense boundary
 * is in the DOM before it is hydrated, and scrambling it then would be a
 * hydration mismatch. Until then the target keeps globals.css's blur.
 */

const TARGETS = DISCRETION_TARGETS.join(", ");
const PENDING = DISCRETION_TARGETS.map((target) => `${target}:not([${SCRAMBLED_ATTRIBUTE}])`).join(", ");

// Their value is not a text node: they stay blurred.
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const FIRST_RETRY_MS = 100;
const MAX_RETRY_MS = 2000;
const PRUNE_ABOVE = 1000;

/** React tags every node it has hydrated or created with this expando. */
function claimedByReact(node: Node | null): boolean {
  return node !== null && Object.keys(node).some((key) => key.startsWith("__reactFiber$"));
}

// A lone string child has no fiber of its own: its element carries it.
function isHydrated(text: Text): boolean {
  return claimedByReact(text) || claimedByReact(text.parentNode);
}

function randomSalt(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(36)).join("");
}

type Replacement = { original: string; shown: string };

/** Starts scrambling under `root`; the returned function stops and restores. */
export function startScrambling(root: Element = document.body, salt: string = randomSalt()): () => void {
  const replaced = new Map<Text, Replacement>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = FIRST_RETRY_MS;

  /** What a node really says, whether or not it currently shows noise. */
  function realText(text: Text): string {
    const value = text.nodeValue ?? "";
    const known = replaced.get(text);
    return known?.shown === value ? known.original : value;
  }

  function scrambleNode(text: Text, context: { before: string; after: string }) {
    const value = text.nodeValue ?? "";
    if (replaced.get(text)?.shown === value) return; // our own write
    const shown = scrambleText(value, salt, context);
    if (shown === value) {
      replaced.delete(text);
      return;
    }
    replaced.set(text, { original: value, shown });
    text.nodeValue = shown;
  }

  /** False when part of the target is still waiting for hydration. */
  function scrambleTarget(target: Element): boolean {
    if (FORM_FIELDS.has(target.tagName)) return true;
    const texts: Text[] = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    if (!claimedByReact(target) || !texts.every(isHydrated)) {
      target.removeAttribute(SCRAMBLED_ATTRIBUTE);
      return false;
    }
    // Neighbouring nodes are context: `({sign}{value}%)` is three of them.
    const real = texts.map(realText);
    texts.forEach((text, i) => scrambleNode(text, { before: real[i - 1] ?? "", after: real[i + 1] ?? "" }));
    target.setAttribute(SCRAMBLED_ATTRIBUTE, "");
    return true;
  }

  function scrambleAll(targets: Iterable<Element>) {
    let waiting = false;
    for (const target of targets) if (!scrambleTarget(target)) waiting = true;
    if (waiting) scheduleRetry();
    else retryMs = FIRST_RETRY_MS;
  }

  // Hydration changes nothing in the DOM, so no mutation announces it: poll
  // the targets still blurred, backing off until they are all done.
  function scheduleRetry() {
    if (retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      scrambleAll(root.querySelectorAll(PENDING));
    }, retryMs);
  }

  function prune() {
    if (replaced.size <= PRUNE_ABOVE) return;
    for (const text of replaced.keys()) if (!text.isConnected) replaced.delete(text);
  }

  const observer = new MutationObserver((records) => {
    const touched = new Set<Element>();
    for (const record of records) {
      const parent = record.target instanceof Element ? record.target : record.target.parentElement;
      const target = parent?.closest(TARGETS);
      if (target) touched.add(target);
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches(TARGETS)) touched.add(added);
        for (const inner of added.querySelectorAll(TARGETS)) touched.add(inner);
      }
    }
    scrambleAll(touched);
    prune();
  });

  scrambleAll(root.querySelectorAll(TARGETS));
  observer.observe(root, { childList: true, characterData: true, subtree: true });

  return () => {
    observer.disconnect();
    clearTimeout(retryTimer);
    // A node React rewrote since we last saw it already holds the real text.
    for (const [text, { original, shown }] of replaced) if (text.nodeValue === shown) text.nodeValue = original;
    replaced.clear();
    for (const target of root.querySelectorAll(`[${SCRAMBLED_ATTRIBUTE}]`)) target.removeAttribute(SCRAMBLED_ATTRIBUTE);
  };
}
