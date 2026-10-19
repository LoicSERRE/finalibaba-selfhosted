import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * <main> must not set an overflow (v2.14). It never has a bounded height -
 * the window scrolls - so an overflow there scrolls nothing, yet it makes
 * <main> the scroll container every `position: sticky` inside it is measured
 * against, and they all silently stop sticking. That shipped: the offline
 * banner, the Settings tab menu and the ledger's bulk toolbar all scrolled
 * away (measured in a browser: 0/3 sticking with `overflow-y-auto`, 3/3
 * without). `overflow-*-clip` would be harmless - clip is not a scroll
 * container - so only the scrolling values are refused.
 */
describe("the main region", () => {
  const source = readFileSync("components/layout/main-content.tsx", "utf8");
  const mainTag = source.slice(source.indexOf("<main"), source.indexOf(">", source.indexOf("className={", source.indexOf("<main"))) + 1);

  it("is found where expected", () => {
    expect(mainTag).toContain('id="main-content"');
  });

  it("never becomes a scroll container", () => {
    const block = source.slice(source.indexOf("<main"), source.indexOf("</main>"));
    const mainClasses = block.slice(0, block.indexOf("{/*"));
    expect(mainClasses).not.toMatch(/overflow(-[xy])?-(auto|scroll|hidden)/);
  });

  it("can still shrink below its content width, which is what the overflow used to provide", () => {
    expect(source).toMatch(/"flex-1 min-w-0/);
  });
});
