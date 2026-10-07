// AutoFetcher script
// extract and fetch all urls from
// - srcsets, from images as well as audio/video
// - media query stylesheets that have not necessarily been loaded (may not work for cross-origin stylesheets)
// - any data-* attribute

import { querySelectorAllDeep } from "query-selector-shadow-dom";

import { BackgroundBehavior } from "./lib/behavior";
import { doExternalFetch, sleep, xpathNodes } from "./lib/utils";

const SRC_SET_SELECTOR =
  "img[srcset], img[data-srcset], img[data-src], noscript > img[src], img[loading='lazy'], " +
  "video[srcset], video[data-srcset], video[data-src], audio[srcset], audio[data-srcset], audio[data-src], " +
  "picture > source[srcset], picture > source[data-srcset], picture > source[data-src], " +
  "video > source[srcset], video > source[data-srcset], video > source[data-src], " +
  "audio > source[srcset], audio > source[data-srcset], audio > source[data-src]";

const SRCSET_REGEX = /\s*(\S*\s+[\d.]+[wx]),|(?:\s*,(?:\s+|(?=https?:)))/;

const STYLE_REGEX = /(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\))/gi;
const IMPORT_REGEX = /(@import\s*[\\"']*)([^)'";]+)([\\"']*\s*;?)/gi;

const MAX_CONCURRENT = 6;

// ===========================================================================
export class AutoFetcher extends BackgroundBehavior {
  urlSet = new Set<string>();
  pendingQueue: string[] = [];
  waitQueue: string[] = [];
  mutationObserver?: MutationObserver;
  numPending = 0;
  numDone = 0;
  headers: Record<string, string>;
  _donePromise: Promise<null>;
  _markDone!: (value: PromiseLike<null> | null) => void;
  active: boolean;
  running = false;

  fetchResource?: (url: string) => Promise<boolean>;

  static id = "Autofetcher" as const;

  constructor(active = false, headers: Record<string, string> | null = null) {
    super();

    this.headers = headers || {};

    this._donePromise = new Promise((resolve) => (this._markDone = resolve));

    this.active = active;
  }

  get numFetching() {
    return this.numDone + this.numPending + this.pendingQueue.length;
  }

  async start() {
    if (!this.active) {
      return;
    }

    this.initObserver();

    void this.run().catch(error => { if(error?.name !== "AbortError") this.error(String(error)); });

    void sleep(500).then(() => {
      if (!this.pendingQueue.length && !this.numPending) {
        this._markDone(null);
      }
    }).catch(() => {});
  }

  async done() {
    return this._donePromise;
  }

  async run() {
    this.running = true;

    for (const url of this.waitQueue) {
      void this.doFetch(url).catch(error => { if(error?.name !== "AbortError") this.error(String(error)); });
    }
    this.waitQueue = [];

    this.extractSrcSrcSetAll(document);
    this.extractStyleSheets();
    this.extractDataAttributes(document);
  }

  isValidUrl(url: string) {
    return url && (url.startsWith("http:") || url.startsWith("https:"));
  }

  queueUrl(url: string, immediate = false) {
    try {
      url = new URL(url, document.baseURI).href;
    } catch (_) {
      return false;
    }

    if (!this.isValidUrl(url)) {
      return false;
    }

    if (this.urlSet.has(url)) {
      return false;
    }

    this.urlSet.add(url);

    if (this.running || immediate) {
      void this.doFetch(url);
    } else {
      this.waitQueue.push(url);
    }

    return true;
  }

  // fetch with default CORS mode, read entire stream
  async doFetchStream(url: string) {
    try {
      const resp = await fetch(url, {
        credentials: "include",
        referrerPolicy: "origin-when-cross-origin",
      });
      this.debug(`Autofetch: started ${url}`);

      const reader = resp.body!.getReader();

      let res: ReadableStreamReadResult<Uint8Array> | null = null;

      do {
        res = await reader.read();
      } while (!res.done);

      this.debug(`Autofetch: finished ${url}`);

      return true;
    } catch (e) {
      this.debug({ msg: "Error fetching stream", err: e });

      return false;
    }
  }

  // start non-cors fetch, abort immediately (assumes full streaming by backend)
  async doFetchNonCors(url: string) {
    try {
      await fetch(url, {
        mode: "no-cors",
        credentials: "include",
        referrerPolicy: "origin-when-cross-origin",
        headers: this.headers,
        priority: "low",
      } as {});
      this.debug(`Autofetch: started non-cors stream for ${url}`);
      return true;
    } catch (_) {
      this.debug(`Autofetch: failed non-cors for ${url}`);
      return false;
    }
  }

  async doFetch(url: string) {
    if (!this.running) return;
    this.pendingQueue.push(url);
    if (this.numPending <= MAX_CONCURRENT) {
      while (this.running && this.pendingQueue.length > 0) {
        const url = this.pendingQueue.shift()!;

        this.numPending++;

        try {
          if (this.fetchResource) {
            await this.fetchResource(url);
          } else if (!(await this.doFetchNonCors(url))) {
            await doExternalFetch(url);
          }
          this.numDone++;
        } finally {
          this.numPending--;
          if (!this.numPending && !this.pendingQueue.length) this._markDone(null);
        }
      }
      if (!this.numPending) {
        this._markDone(null);
      }
    }
  }

  initObserver() {
    if (this.mutationObserver) {
      return;
    }
    this.mutationObserver = new MutationObserver((changes) =>
      this.observeChange(changes),
    );

    this.mutationObserver.observe(document.documentElement, {
      characterData: false,
      characterDataOldValue: false,
      attributes: true,
      attributeOldValue: true,
      subtree: true,
      childList: true,
      attributeFilter: ["srcset", "loading"],
    });
  }

  processChangedNode(target: Node) {
    switch (target.nodeType) {
      case Node.ATTRIBUTE_NODE:
        if (target.nodeName === "srcset") {
          this.extractSrcSetAttr(target.nodeValue!);
        }
        if (target.nodeName === "loading" && target.nodeValue === "lazy") {
          const elem = target.parentNode as Element | null;
          if (elem?.tagName === "IMG") {
            elem.setAttribute("loading", "eager");
          }
        }
        break;

      case Node.TEXT_NODE:
        if (
          target.parentNode &&
          (target.parentNode as Element).tagName === "STYLE"
        ) {
          this.extractStyleText(target.nodeValue!);
        }
        break;

      case Node.ELEMENT_NODE:
        if ("sheet" in target) {
          this.extractStyleSheet((target as HTMLStyleElement).sheet!);
        }
        this.extractSrcSrcSet(target as HTMLElement);
        setTimeout(() => this.extractSrcSrcSetAll(target as HTMLElement), 1000);
        setTimeout(() => this.extractDataAttributes(target), 1000);
        break;
    }
  }

  observeChange(changes: MutationRecord[]) {
    for (const change of changes) {
      this.processChangedNode(change.target);

      if (change.type === "childList") {
        for (const node of change.addedNodes) {
          this.processChangedNode(node);
        }
      }
    }
  }

  extractSrcSrcSetAll(root: Document | HTMLElement) {
    const elems = querySelectorAllDeep(SRC_SET_SELECTOR, root);

    for (const elem of elems) {
      this.extractSrcSrcSet(elem);
    }
  }

  extractSrcSrcSet(elem: HTMLElement | null) {
    if (!elem || elem.nodeType !== Node.ELEMENT_NODE) {
      console.warn("No elem to extract from");
      return;
    }

    const data_src = elem.getAttribute("data-src");

    if (data_src) {
      this.queueUrl(data_src);
    }

    // force lazy loading to eager
    if (elem.getAttribute("loading") === "lazy") {
      elem.setAttribute("loading", "eager");
    }

    const srcset = elem.getAttribute("srcset");

    if (srcset) {
      this.extractSrcSetAttr(srcset);
    }

    const data_srcset = elem.getAttribute("data-srcset");

    if (data_srcset) {
      this.extractSrcSetAttr(data_srcset);
    }

    // check regular src in case of <noscript> only to avoid duplicate loading
    const src = elem.getAttribute("src");

    if (
      src &&
      (srcset || data_srcset || elem.parentElement?.tagName === "NOSCRIPT")
    ) {
      this.queueUrl(src);
    }
  }

  extractSrcSetAttr(srcset: string) {
    for (const v of srcset.split(SRCSET_REGEX)) {
      if (v) {
        const parts = v.trim().split(" ");
        this.queueUrl(parts[0]);
      }
    }
  }

  extractStyleSheets(root?: Document | null) {
    root = root || document;

    for (const sheet of root.styleSheets) {
      this.extractStyleSheet(sheet);
    }
  }

  extractStyleSheet(sheet: CSSStyleSheet) {
    let rules;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rules = sheet.cssRules || sheet.rules;
    } catch (_) {
      this.debug("Can't access stylesheet");
      return;
    }

    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        this.extractStyleText(rule.cssText);
      }
    }
  }

  extractStyleText(text: string) {
    const urlExtractor = (_m: unknown, n1: string, n2: string, n3: string) => {
      this.queueUrl(n2);
      return n1 + n2 + n3;
    };

    text.replace(STYLE_REGEX, urlExtractor).replace(IMPORT_REGEX, urlExtractor);
  }

  extractDataAttributes(root: Node | null) {
    const QUERY =
      "//@*[starts-with(name(), 'data-') and " +
      "(starts-with(., 'http') or starts-with(., '/') or starts-with(., './') or starts-with(., '../'))]";

    for (const attr of xpathNodes(QUERY, root)) {
      // @ts-expect-error TODO not sure what type `attr` should have here
      this.queueUrl(attr.value as string);
    }
  }
}
