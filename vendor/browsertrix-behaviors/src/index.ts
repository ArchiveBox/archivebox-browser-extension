import { AutoFetcher } from "./autofetcher";
import { Autoplay } from "./autoplay";
import { AutoScroll } from "./autoscroll";
import { AutoClick } from "./autoclick";
import {
  awaitLoad,
  sleep,
  behaviorLog,
  _setLogFunc,
  _setBehaviorManager,
  installBehaviors,
  addLinkBatch,
  checkToJsonOverride,
  registerFrame,
  setBehaviorSignal,
} from "./lib/utils";
import { type AbstractBehavior, BehaviorRunner } from "./lib/behavior";
import * as Lib from "./lib/utils";

import siteBehaviors from "./site";

// ===========================================================================
// ====                  Behavior Manager                        ====
// ===========================================================================
//

interface BehaviorManagerOpts {
  autofetch?: boolean;
  fetchResource?: (url: string) => Promise<boolean>;
  autoplay?: boolean;
  autoscroll?: boolean;
  autoclick?: boolean;
  log?: ((...message: string[]) => void) | keyof typeof self | false;
  siteSpecific?: boolean | Record<string, unknown>;
  timeout?: number;
  fetchHeaders?: Record<string, string> | null;
  clickSelector?: string;
}

type LinkOpts = {
  selector: string;
  extractName: string;
  attrOnly?: boolean;
};

const DEFAULT_OPTS: BehaviorManagerOpts = {
  autofetch: true,
  autoplay: true,
  autoscroll: true,
  // autoclick off by default
  autoclick: false,
  siteSpecific: true,
};

const DEFAULT_CLICK_SELECTOR = "a";

const DEFAULT_LINK_SELECTOR = "a[href]";
const DEFAULT_LINK_EXTRACT = "href";

type BehaviorClass =
  | (typeof siteBehaviors)[number]
  | typeof AutoClick
  | typeof AutoScroll
  | typeof Autoplay
  | typeof AutoFetcher
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | typeof BehaviorRunner<any, any>;

type BehaviorInstance = InstanceType<BehaviorClass>;

export class BehaviorManager {
  autofetch?: AutoFetcher;
  behaviors: BehaviorInstance[] = [];
  loadedBehaviors: Record<string, BehaviorClass>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainBehavior: BehaviorInstance | BehaviorRunner<any, any> | null = null;
  mainBehaviorClass: BehaviorClass | null = null;
  inited = false;
  started = false;
  controller?: AbortController;
  stopped = false;
  timedOut = false;
  stop() { this.stopped = true; this.controller?.abort(); this.pause(); for(const behavior of this.behaviors) { if(behavior instanceof Autoplay) behavior.cleanup(); if(behavior instanceof AutoClick) behavior.cleanup(); } if(this.autofetch) {this.autofetch.running = false; this.autofetch.mutationObserver?.disconnect(); this.autofetch.pendingQueue.length = 0;this.autofetch._markDone(null); } }
  timeout?: number;
  opts?: BehaviorManagerOpts;
  linkOpts: LinkOpts;

  constructor() {
    this.loadedBehaviors = siteBehaviors.reduce<Record<string, BehaviorClass>>(
      (behaviors, next) => {
        behaviors[next.id] = next;
        return behaviors;
      },
      {},
    );
    this.linkOpts = {
      selector: DEFAULT_LINK_SELECTOR,
      extractName: DEFAULT_LINK_EXTRACT,
    };
    void behaviorLog("Loaded behaviors for: " + self.location.href);
    registerFrame();
  }

  init(
    opts: BehaviorManagerOpts = DEFAULT_OPTS,
    restart = false,
    customBehaviors: BehaviorClass[] | null = null,
  ) {
    if (this.inited && !restart) {
      return;
    }

    this.inited = true;
    this.opts = opts;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!self.window) {
      return;
    }

    this.timeout = opts.timeout;

    // default if omitted is 'console.log'
    if (opts.log !== undefined) {
      let logger = opts.log;
      // if string, look up as global
      if (typeof logger === "string") {
        logger = self[logger];
      }
      // if function, set to it
      if (typeof logger === "function") {
        _setLogFunc(logger);
        // if false, disable logging
      } else if (logger === false) {
        _setLogFunc(null);
      }
    }

    this.autofetch = new AutoFetcher(!!opts.autofetch, opts.fetchHeaders);
    this.autofetch.fetchResource = opts.fetchResource;

    if (opts.autofetch) {
      void behaviorLog("Using AutoFetcher");
      this.behaviors.push(this.autofetch);
    }

    if (opts.autoplay) {
      void behaviorLog("Using Autoplay");
      this.behaviors.push(new Autoplay(this.autofetch));
    }

    if (opts.autoclick) {
      void behaviorLog("Using AutoClick");
      this.behaviors.push(
        new AutoClick(opts.clickSelector || DEFAULT_CLICK_SELECTOR),
      );
    }

    if (customBehaviors) {
      for (const behaviorClass of customBehaviors) {
        try {
          this.load(behaviorClass);
        } catch (e) {
          void behaviorLog(
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `Failed to load custom behavior: ${e} ${behaviorClass}`,
          );
        }
      }
    }
  }

  selectMainBehavior() {
    if (this.mainBehavior) {
      return;
    }
    const opts = this.opts;
    let siteMatch = false;

    if (opts?.siteSpecific) {
      for (const name in this.loadedBehaviors) {
        const siteBehaviorClass = this.loadedBehaviors[name];
        if ("isMatch" in siteBehaviorClass && siteBehaviorClass.isMatch()) {
          void behaviorLog("Using Site-Specific Behavior: " + name);

          if ("onPageInit" in siteBehaviorClass) {
            void behaviorLog(
              "Calling onPageInit for Site-Specific Behavior " + name,
            );
            siteBehaviorClass.onPageInit();
          }

          this.mainBehaviorClass = siteBehaviorClass;
          const siteSpecificOpts =
            typeof opts.siteSpecific === "object"
              ? opts.siteSpecific[name] || {}
              : {};
          try {
            this.mainBehavior = new BehaviorRunner(
              // @ts-expect-error TODO figure out types here
              siteBehaviorClass,
              siteSpecificOpts,
            );
          } catch (e) {
            void behaviorLog(
              { msg: (e as Error).toString(), siteSpecific: true },
              "error",
            );
          }
          siteMatch = true;

          break;
        }
      }
    }

    if (!siteMatch && opts?.autoscroll) {
      void behaviorLog("Using Autoscroll");
      this.mainBehaviorClass = AutoScroll;
      this.mainBehavior = new BehaviorRunner(
        AutoScroll,
        {
          autoFetcher: this.autofetch!,
        },
        false,
      );
    }

    if (this.mainBehavior) {
      this.behaviors.push(this.mainBehavior);

      if (this.mainBehavior instanceof BehaviorRunner) {
        return this.mainBehavior.behaviorProps.id;
      }
    }

    return "";
  }

  load(behaviorClass: unknown) {
    if (typeof behaviorClass !== "function") {
      void behaviorLog(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Must pass a class object, got ${behaviorClass}`,
        "error",
      );
      return;
    }
    if (!("id" in behaviorClass) || typeof behaviorClass.id !== "string") {
      void behaviorLog(
        'Behavior class must have a string string "id" property',
        "error",
      );
      return;
    }

    const name = behaviorClass.id;

    if (
      !("isMatch" in behaviorClass) ||
      typeof behaviorClass.isMatch !== "function" ||
      !("init" in behaviorClass) ||
      typeof behaviorClass.init !== "function"
    ) {
      void behaviorLog(
        "Behavior class must have an is `isMatch()` and `init()` static methods",
        "error",
      );
      return;
    }

    if (!this.isInTopFrame()) {
      if (!("runInIframe" in behaviorClass) || !behaviorClass.runInIframe) {
        void behaviorLog(
          `Behavior class ${name}: not running in iframes (.runInIframe not set)`,
          "debug",
        );
        return;
      }
    }

    void behaviorLog(`Behavior class ${name}: loaded`, "debug");
    this.loadedBehaviors[name] = behaviorClass as BehaviorClass;
  }

  async resolve(target: string) {
    const imported = await import(`${target}`); // avoid Webpack warning
    if (Array.isArray(imported)) {
      for (const behavior of imported) {
        this.load(behavior);
      }
    } else {
      this.load(imported);
    }
  }

  async awaitPageLoad() {
    this.selectMainBehavior();
    if (
      this.mainBehavior &&
      "awaitPageLoad" in this.mainBehavior &&
      (this.mainBehavior as AbstractBehavior<unknown, unknown>).awaitPageLoad
    ) {
      void behaviorLog("Waiting for custom page load via behavior");
      // @ts-expect-error TODO why isn't `log` passed in here? It seems like functions expect it to be
      await this.mainBehavior.awaitPageLoad({ Lib });
    } else {
      void behaviorLog("No custom wait behavior");
    }
  }

  async run(opts: BehaviorManagerOpts = DEFAULT_OPTS, restart = false) {
    if (restart) {
      this.started = false;
    }

    if (this.started) {
      this.unpause();
      return;
    }

    this.controller = new AbortController();
    this.stopped = false;
    setBehaviorSignal(this.controller.signal);
    this.init(opts, restart);
    this.selectMainBehavior();

    await awaitLoad();

    const starts = this.behaviors.map(async behavior => { if ('start' in behavior) await behavior.start(); });
    // Keep rejected starts observed while the main runner is still active.
    const started = Promise.allSettled(starts);
    this.started = true;
    const done = Promise.allSettled(this.behaviors.map(async behavior => 'done' in behavior && behavior.done()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<void>(resolve => this.controller!.signal.addEventListener('abort', () => resolve(), {once:true}));
    try {
      if(this.timeout) timer = setTimeout(() => { this.timedOut = true; this.stop(); }, this.timeout);
      await Promise.race([done, stopped]);
    } finally {
      clearTimeout(timer);
      this.stop();
      this.unpause();
      await started;
      await Promise.allSettled(this.behaviors.filter(behavior => behavior instanceof Autoplay).map(behavior => behavior.pollPromise));
      if (this.mainBehavior && 'cleanup' in this.mainBehavior) this.mainBehavior.cleanup();
    }
  }

  async runOne(name: string, behaviorOpts = {}) {
    const siteBehaviorClass = siteBehaviors.find((b) => b.name === name);
    if (typeof siteBehaviorClass === "undefined") {
      console.error(`No behavior of name ${name} found`);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const behavior = new BehaviorRunner<any, any>(
      siteBehaviorClass,
      behaviorOpts,
    );
    behavior.start();
    console.log(`Running behavior: ${name}`);
    await behavior.done();
    console.log(`Behavior ${name} completed`);
  }

  pause() {
    void behaviorLog(`Pausing Main Behavior ${this.mainBehaviorClass?.name}`);
    this.behaviors.forEach((x) => "pause" in x && x.pause());
  }

  unpause() {
    void behaviorLog(
      `Unpausing Main Behavior: ${this.mainBehaviorClass?.name}`,
    );
    this.behaviors.forEach((x) => "unpause" in x && x.unpause());
  }

  doAsyncFetch(url: string) {
    void behaviorLog("Queueing Async Fetch Url: " + url);
    return this.autofetch!.queueUrl(url, true);
  }

  isInTopFrame() {
    return (
      self.window.top === self.window ||
      window["__WB_replay_top"] === self.window
    );
  }

  async extractLinks(
    selector = DEFAULT_LINK_SELECTOR,
    extractName = "href",
    attrOnly = false,
  ) {
    this.linkOpts = { selector, extractName, attrOnly };
    checkToJsonOverride();
    return await this.extractLinksActual();
  }

  async extractLinksActual() {
    const {
      selector = DEFAULT_LINK_SELECTOR,
      extractName = DEFAULT_LINK_EXTRACT,
      attrOnly = false,
    } = this.linkOpts;

    const urls = new Set<string>();

    document.querySelectorAll(selector).forEach((elem) => {
      // first, try property, unless attrOnly is set
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let value = !attrOnly ? (elem as any)[extractName] : null;
      if (!value) {
        value = elem.getAttribute(extractName);
      }
      // set if got a string
      if (typeof value === "string") {
        urls.add(value);
      }
    });

    const promises: Promise<void>[] = [];
    // add link for each matched URL, but only if in scope
    // this is called from main link extraction in the crawler
    // pass true to always follow scope, even if allowed to ignore
    promises.push(addLinkBatch(Array.from(urls), true));

    await Promise.allSettled(promises);
  }
}

_setBehaviorManager(BehaviorManager);

installBehaviors(self);
