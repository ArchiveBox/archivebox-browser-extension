import { BackgroundBehavior } from "./lib/behavior";
import { addLink, addToExternalSet, sleep } from "./lib/utils";

export class AutoClick extends BackgroundBehavior {
  _donePromise: Promise<void>;
  _markDone!: () => void;
  selector: string;
  seenElem = new WeakSet<HTMLElement>();

  beforeUnload?: (event: BeforeUnloadEvent) => boolean;
  cancelHistoryWait?: () => void;
  stopped = false;
  cleanup() {
    this.stopped = true;
    if(this.beforeUnload) window.removeEventListener("beforeunload", this.beforeUnload);
    this.cancelHistoryWait?.();
  }

  static id = "Autoclick" as const;

  constructor(selector = "a") {
    super();
    this.selector = selector;
    this._donePromise = new Promise<void>(
      (resolve) => (this._markDone = resolve),
    );
  }

  nextSameOriginLink(): HTMLAnchorElement | null {
    try {
      const allLinks = document.querySelectorAll(this.selector);
      for (const el of allLinks) {
        const elem = el as HTMLAnchorElement;

        // skip URLs to different origin as they won't be handled dynamically, most likely just regular navigation
        if (elem.href && !elem.href.startsWith(self.location.origin)) {
          continue;
        }
        if (!elem.isConnected) {
          continue;
        }
        if (!elem.checkVisibility()) {
          continue;
        }
        if (this.seenElem.has(elem)) {
          continue;
        }
        this.seenElem.add(elem);
        return elem;
      }
    } catch (e) {
      this.debug((e as Error).toString());
    }

    return null;
  }

  async start() {
    this.stopped = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      return false;
    };

    // process all links (except hash links) which could result in attempted navigation
    this.beforeUnload = beforeUnload;
    window.addEventListener("beforeunload", beforeUnload);

    // process external links on current origin

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (!this.stopped) {
      const elem = this.nextSameOriginLink();

      if (!elem) {
        break;
      }

      await this.processElem(elem);
    }

    window.removeEventListener("beforeunload", beforeUnload);

    this._markDone();
  }

  async processElem(elem: HTMLAnchorElement) {
    if (elem.target) {
      return;
    }

    if (elem.href) {
      // skip if already clicked this URL, tracked in external state
      if (!(await addToExternalSet(elem.href))) {
        return;
      }

      this.debug("Clicking on link: " + elem.href);
    } else {
      this.debug("Click empty link");
    }

    const origHref = self.location.href;
    const origHistoryLen = self.history.length;

    // Let the site's handlers run (including SPA routing), then suppress the
    // anchor's native navigation. Chrome does not always display beforeunload
    // dialogs for script clicks, even with the upstream unload listener.
    const preventNavigation = (event: MouseEvent) => {
      if (event.composedPath().includes(elem)) event.preventDefault();
    };
    window.addEventListener("click", preventNavigation);
    try {
      if (elem.click) elem.click();
      else if (elem.dispatchEvent) elem.dispatchEvent(new MouseEvent("click", {bubbles:true,cancelable:true}));
    } finally {
      window.removeEventListener("click", preventNavigation);
    }

    await sleep(250);

    // only attempt to go back if history stack updated (pushState, not replaceState) and location changed
    if (
      self.history.length === origHistoryLen + 1 &&
      self.location.href != origHref
    ) {
      // We want to ensure we respect scope here
      await addLink(self.location.href, true);
      await new Promise((resolve) => {
        const done = () => {
          window.removeEventListener("popstate", done);
          this.cancelHistoryWait = undefined;
          resolve(null);
        };
        this.cancelHistoryWait = done;
        window.addEventListener("popstate", done, {once: true});
        if (this.stopped) {done();return;}
        window.history.back();
      });
    }
  }

  async done() {
    return this._donePromise;
  }
}
