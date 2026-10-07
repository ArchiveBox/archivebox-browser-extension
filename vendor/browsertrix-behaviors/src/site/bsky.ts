import { type AbstractBehavior, type Context } from "../lib/behavior";

type BlueskyState = Record<string, never>;

/**
 * Fetches all JavaScript chunks from the Bluesky app.
 *
 * Bluesky puts different languages in different chunks, including English
 * variants like UK English. Without this, replay can fail when the replay
 * browser has a different primary language setting than the crawler.
 */
export class BlueskyBehavior implements AbstractBehavior<BlueskyState> {
  static id = "Bluesky" as const;

  static init() {
    return {
      state: {},
    };
  }

  static isMatch() {
    return /(^|\.)bsky\.app$/.test(window.location.hostname);
  }

  extractChunkFileNames(code: string) {
    const mappingRegex =
      /"static\/js\/"\s*\+\s*e\s*\+\s*"\."\s*\+\s*\{([\s\S]+?)}\s*\[\s*e]\s*\+\s*"\.chunk\.js"/;
    const mapMatch = code.match(mappingRegex);
    if (!mapMatch) {
      return [];
    }

    const pairRegex = /"?(\d+)"?:"([^"]+)"/g;
    const chunks = new Set<string>();

    for (const match of mapMatch[1].matchAll(pairRegex)) {
      const [, id, hash] = match;
      chunks.add(`/static/js/${id}.${hash}.chunk.js`);
    }

    return [...chunks];
  }

  async *run(_ctx: Context<BlueskyState>) {
    const mainScript = document.querySelector<HTMLScriptElement>(
      'script[src*="/static/js/main."]',
    );
    if (!mainScript) {
      yield { msg: "No main.js script found" };
      return;
    }

    const mainScriptUrl = mainScript.src;
    const mainScriptResponse = await fetch(mainScriptUrl);
    const mainScriptCode = await mainScriptResponse.text();
    const chunkFiles = this.extractChunkFileNames(mainScriptCode);

    await Promise.allSettled(
      chunkFiles.map(async (chunkFile) =>
        fetch(new URL(chunkFile, mainScriptUrl)),
      ),
    );

    yield { msg: "Loaded chunk.js files", chunkFiles };
  }
}
