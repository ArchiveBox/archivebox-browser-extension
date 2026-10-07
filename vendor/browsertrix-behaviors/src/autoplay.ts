import { querySelectorAllDeep } from "query-selector-shadow-dom";

import { BackgroundBehavior } from "./lib/behavior";
import { sleep } from "./lib/utils";
import { type AutoFetcher } from "./autofetcher";

// ===========================================================================
export class Autoplay extends BackgroundBehavior {
  mediaSet: Set<string>;
  autofetcher: AutoFetcher;
  numPlaying: number;
  promises: Promise<boolean | undefined>[];
  _initDone: Function;
  running = false;
  polling = false;
  pollPromise?: Promise<void>;
  onLoad = () => { if(this.running) this.startPolling(); };
  startPolling() { this.pollPromise = this.pollAudioVideo().catch(error => { if(error?.name !== "AbortError") this.error(String(error)); }); }
  cleanup() { this.running = false; document.removeEventListener("DOMContentLoaded", this.onLoad); }
  seenElem = new WeakSet<HTMLElement>();

  static id = "Autoplay" as const;

  constructor(autofetcher: AutoFetcher) {
    super();
    this.mediaSet = new Set();
    this.autofetcher = autofetcher;
    this.numPlaying = 0;
    this.promises = [];
    this._initDone = () => null;
    this.promises.push(new Promise((resolve) => (this._initDone = resolve)));
    document.addEventListener("DOMContentLoaded", this.onLoad);
  }

  async start() {
    this.running = true;
    //this.initObserver();

    this.startPolling();

    this._initDone();
  }

  async pollAudioVideo() {


    if (this.polling) {
      return;
    }

    this.polling = true;

    // lite-youtube player won't actually load the video embed until
    // we click the element the first time.
    // (It also contains a <a> button inside, but the parent lite-youtube
    // player itself is clickable and loads the real embed.)
    for (const [, elem] of querySelectorAllDeep("lite-youtube").entries()) {
      // Avoid clicking the same element repeatedly should we happen to
      // run into it multiple times
      if (!this.seenElem.has(elem)) {
        elem.click();
        this.seenElem.add(elem);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (this.running) {
      for (const [, elem] of querySelectorAllDeep(
        "video, audio, picture",
      ).entries() as ArrayIterator<
        [number, HTMLVideoElement | HTMLAudioElement | HTMLPictureElement]
      >) {
        if (!elem["__bx_autoplay_found"]) {
          if (!this.running) {
            if (this.processFetchableUrl(elem as HTMLMediaElement)) {
              elem["__bx_autoplay_found"] = true;
            }
            continue;
          }

          await this.loadMedia(elem as HTMLMediaElement);
          elem["__bx_autoplay_found"] = true;
        }
      }

      await sleep(500);
    }

    this.polling = false;
  }

  fetchSrcUrl(source: HTMLMediaElement | HTMLSourceElement) {
    const url: string = source.src || (source as HTMLMediaElement).currentSrc;

    if (!url) {
      return false;
    }

    if (!url.startsWith("http:") && !url.startsWith("https:")) {
      return false;
    }

    if (this.mediaSet.has(url)) {
      return true;
    }

    this.debug("fetch media source URL: " + url);
    this.mediaSet.add(url);
    this.autofetcher.queueUrl(url);

    return true;
  }

  processFetchableUrl(media: HTMLMediaElement) {
    let found = this.fetchSrcUrl(media);

    const sources = media.querySelectorAll("source");

    for (const source of sources) {
      const foundSource = this.fetchSrcUrl(source);
      found = found || foundSource;
    }

    return found;
  }

  async loadMedia(media: HTMLMediaElement) {
    this.debug("processing media element: " + media.outerHTML);

    const found = this.processFetchableUrl(media);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!media.play) {
      this.debug("media not playable, skipping");
      return;
    }

    // if fixed URL found, stop playing
    if (found) {
      if (!media.paused) {
        media.pause();
        this.debug("media URL found, pausing playback");
      }
      return;
    }

    if (media.paused || media.currentTime) {
      if (media.paused) {
        this.debug(
          "no src url found, attempting to click or play: " + media.outerHTML,
        );
      } else {
        this.debug(
          "media already playing, waiting for full playback to finish: " +
            media.outerHTML,
        );
      }

      void this.attemptMediaPlay(media).then(async (finished) => {
        let check = true;

        if (finished) {
          // @ts-expect-error TODO: not sure what this is supposed to be, I believe `finished` is a boolean here?
          void finished.then(() => (check = false));
        }

        while (check) {
          if (this.processFetchableUrl(media)) {
            check = false;
          }
          this.debug(
            "Waiting for fixed URL or media to finish: " + media.currentSrc,
          );
          await sleep(1000);
        }
      }).catch(error => { if(error?.name !== "AbortError") this.error(String(error)); });
    } else if (media.currentSrc) {
      this.debug("media playing from non-URL source: " + media.currentSrc);
    }
  }

  async attemptMediaPlay(media: HTMLMediaElement) {
    // finished promise
    let resolveFinished: (value?: boolean) => void;

    const finished = new Promise<boolean | undefined>((res) => {
      resolveFinished = res;
    });

    // started promise
    let resolveStarted!: (value?: boolean) => void;

    const started = new Promise<boolean | undefined>((res) => {
      resolveStarted = res;
    });

    void started.then(() => this.promises.push(finished));

    // already started
    if (!media.paused && media.currentTime > 0) {
      resolveStarted();
    }

    media.addEventListener("loadstart", () => {
      this.debug("media event: loadstart");
      resolveStarted(true);
    });
    media.addEventListener("playing", () => {
      this.debug("media event: playing");
      resolveStarted(true);
    });

    media.addEventListener("loadeddata", () =>
      this.debug("media event: loadeddata"),
    );

    media.addEventListener("ended", () => {
      this.debug("media event: ended");
      resolveFinished();
    });
    media.addEventListener("pause", () => {
      this.debug("media event: pause");
      resolveFinished();
    });
    media.addEventListener("abort", () => {
      this.debug("media event: abort");
      resolveFinished();
    });
    media.addEventListener("error", () => {
      this.debug("media event: error");
      resolveFinished();
    });
    media.addEventListener("stalled", () => {
      this.debug("media event: stalled");
      resolveFinished();
    });
    media.addEventListener("suspend", () => {
      this.debug("media event: suspend");
      resolveFinished();
    });

    media.muted = true;

    if (!media.paused && media.currentTime > 0) {
      return finished;
    }

    const hasA = media.closest("a");

    // if contained in <a> tag, clicking may navigate away, so avoid
    if (!hasA) {
      media.click();

      if (await Promise.race([started, sleep(1000)])) {
        this.debug("play started after media.click()");
        return finished;
      }
    }

    void media.play().catch(error => this.debug(String(error)));

    if (await Promise.race([started, sleep(1000)])) {
      this.debug("play started after media.play()");
    }

    return finished;
  }

  async done() {
    return Promise.allSettled(this.promises);
  }
}
