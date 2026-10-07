import { type BehaviorManager } from "..";
import { type Context } from "./behavior";

export type LogData = string | { msg: string; [k: string]: unknown };

let _logFunc: ((...data: unknown[]) => void) | null = console.log;
let _behaviorMgrClass: typeof BehaviorManager | null = null;

const ONE_MEGABYTE = 1048576;

const scrollOpts: ScrollIntoViewOptions = {
  behavior: "smooth",
  block: "center",
  inline: "center",
};

export async function scrollAndClick(
  node: HTMLElement,
  interval = 500,
  opts: ScrollIntoViewOptions = scrollOpts,
) {
  node.scrollIntoView(opts);
  await sleep(interval);
  node.click();
}

export const waitUnit = 200;

// Returns a random number between 150 and 250.
// Useful for performing a wait with a less predictable timer than
// using the fixed waitUnit.
export function fuzzyWaitUnit(): number {
  return Math.floor(Math.random() * (250 - 150) + 150);
}

let behaviorSignal: AbortSignal | undefined;
export function setBehaviorSignal(signal: AbortSignal) { behaviorSignal = signal; }
export async function sleep(timeout: number) {
  const signal = behaviorSignal;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(undefined); }, timeout);
    signal?.addEventListener('abort', abort, {once: true});
  });
}

export async function waitUntil(pred: () => boolean, interval = waitUnit) {
  while (!pred()) {
    await sleep(interval);
  }
}

export async function waitUntilNode(
  path: string,
  root: Node = document,
  old: Node | null = null,
  timeout = 1000,
  interval = waitUnit,
): Promise<Node | null> {
  let node: Node | null = null;
  let stop = false;
  const waitP = waitUntil(() => {
    node = xpathNode(path, root);
    return stop || (node !== old && node !== null);
  }, interval);
  const timeoutP = new Promise((r) =>
    setTimeout(() => {
      stop = true;
      r("TIMEOUT");
    }, timeout),
  );
  await Promise.race([waitP, timeoutP]);
  return node;
}

export async function awaitLoad(iframe?: HTMLIFrameElement) {
  const doc = iframe ? iframe.contentDocument : document;
  const win = iframe ? iframe.contentWindow : window;
  return new Promise((resolve) => {
    if (doc?.readyState === "complete") {
      resolve(null);
    } else {
      win?.addEventListener("load", resolve);
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unsetToJson(obj: any) {
  if (obj.toJSON) {
    try {
      obj.__bx__toJSON = obj.toJSON;
      delete obj.toJSON;
    } catch (_) {
      // ignore
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function restoreToJson(obj: any) {
  if (obj.__bx__toJSON) {
    try {
      obj.toJSON = obj.__bx__toJSON;
      delete obj.__bx__toJSON;
    } catch (_) {
      // ignore
    }
  }
}

function unsetAllJson() {
  unsetToJson(Object);
  unsetToJson(Object.prototype);
  unsetToJson(Array);
  unsetToJson(Array.prototype);
}

function restoreAllJson() {
  restoreToJson(Object);
  restoreToJson(Object.prototype);
  restoreToJson(Array);
  restoreToJson(Array.prototype);
}

let needUnsetToJson = false;

type WithToJSON<T> = T & {
  toJSON?: () => unknown;
};

export function checkToJsonOverride() {
  needUnsetToJson =
    !!(Object as WithToJSON<typeof Object>).toJSON ||
    !!(Object.prototype as WithToJSON<typeof Object.prototype>).toJSON ||
    !!(Array as WithToJSON<typeof Array>).toJSON ||
    !!(Array.prototype as WithToJSON<typeof Array.prototype>).toJSON;
}

export async function callBinding<P, R>(
  binding: (obj: P) => R,
  obj: P,
): Promise<R> {
  try {
    if (needUnsetToJson) {
      unsetAllJson();
    }
    return binding(obj);
  } catch (_) {
    return binding(JSON.stringify(obj) as P);
  } finally {
    if (needUnsetToJson) {
      restoreAllJson();
    }
  }
}

export async function behaviorLog(data: LogData, type = "debug") {
  if (_logFunc) {
    await callBinding(_logFunc, { data, type });
  }
}

export function registerFrame() {
  if (typeof self["__bx_registerFrame"] === "function") {
    // pass location of frame
    self["__bx_registerFrame"](self.location.href);
    return true;
  }

  return false;
}

export async function addLink(
  url: string,
  alwaysObeyScope = false,
): Promise<void> {
  if (typeof self["__bx_addLink"] === "function") {
    // call directly as passing two objects
    return await self["__bx_addLink"](url, alwaysObeyScope);
  }
}

export async function addLinkBatch(
  urls: string[],
  alwaysObeyScope = false,
): Promise<void> {
  if (typeof self["__bx_addLinkBatch"] === "function") {
    // Slice up the array into subarrays of up to 1MB worth of URLs
    let slice: string[] = [];
    let currentLength = 0;
    const promises = [];

    for (const url of urls) {
      if (currentLength >= ONE_MEGABYTE) {
        // We join them into a string here to send back more quickly over
        // the debug protocol, and they'll be split back out again
        // in the crawler.
        promises.push(
          self["__bx_addLinkBatch"](slice.join("\n\n"), alwaysObeyScope),
        );

        slice = [];
        currentLength = 0;
      }

      slice.push(url);
      currentLength += url.length + 2;
    }

    if (slice.length > 0) {
      promises.push(
        self["__bx_addLinkBatch"](slice.join("\n\n"), alwaysObeyScope),
      );
    }

    await Promise.all(promises);
  }
}

export async function doExternalFetch(url: string): Promise<boolean> {
  if (typeof self["__bx_fetch"] === "function") {
    return await callBinding(self["__bx_fetch"], url);
  }

  return false;
}

export async function addToExternalSet(url: string): Promise<boolean> {
  if (typeof self["__bx_addSet"] === "function") {
    return await callBinding(self["__bx_addSet"], url);
  }

  // if set doesn't exist, just return true to avoid skipping
  return true;
}

export async function waitForNetworkIdle(idleTime = 500, concurrency = 0) {
  if (typeof self["__bx_netIdle"] === "function") {
    return await callBinding(self["__bx_netIdle"], { idleTime, concurrency });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initFlow(params: any): Promise<number> {
  if (typeof self["__bx_initFlow"] === "function") {
    return await callBinding(self["__bx_initFlow"], params);
  }

  return -1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextFlowStep(id: number): Promise<any> {
  if (typeof self["__bx_nextFlowStep"] === "function") {
    return await callBinding(self["__bx_nextFlowStep"], id);
  }

  return { done: true, msg: "" };
}

export function assertContentValid(
  assertFunc: () => boolean,
  reason = "invalid",
) {
  if (typeof self["__bx_contentCheckFailed"] === "function") {
    if (!assertFunc()) {
      void behaviorLog("Behavior content check failed: " + reason, "error");
      void callBinding(self["__bx_contentCheckFailed"], reason);
    }
  }
}

export async function openWindow(
  url: string | URL,
): Promise<WindowProxy | null> {
  if (self["__bx_open"]) {
    const p = new Promise((resolve) => (self["__bx_openResolve"] = resolve));
    await callBinding(self["__bx_open"], { url });

    let win: WindowProxy | null = null;

    try {
      win = (await p) as WindowProxy | null;
      if (win) {
        return win;
      }
    } catch (e) {
      console.warn(e);
    } finally {
      delete self["__bx_openResolve"];
    }
  }

  return window.open(url);
}

export function _setLogFunc(
  func: ((message: string, level: string) => void) | null,
) {
  _logFunc = func as (...data: unknown[]) => void;
}

export function _setBehaviorManager(cls: typeof BehaviorManager) {
  _behaviorMgrClass = cls;
}

export function installBehaviors(obj: Window | WorkerGlobalScope) {
  obj.__bx_behaviors = new _behaviorMgrClass!();
}

// ===========================================================================
export class RestoreState {
  matchValue: string;
  constructor(childMatchSelect: string, child: Node) {
    this.matchValue = xpathString(childMatchSelect, child);
  }

  async restore(rootPath: string, childMatch: string) {
    let root: Node | null = null;

    while (((root = xpathNode(rootPath)), !root)) {
      await sleep(100);
    }

    return xpathNode(childMatch.replace("$1", this.matchValue), root);
  }
}

// ===========================================================================
export class HistoryState {
  loc: string;
  constructor(op: () => void) {
    this.loc = window.location.href;
    op();
  }

  get changed() {
    return window.location.href !== this.loc;
  }

  async goBack(backButtonQuery: string) {
    if (!this.changed) {
      return Promise.resolve(true);
    }

    const backButton = xpathNode(backButtonQuery);

    return new Promise((resolve) => {
      window.addEventListener(
        "popstate",
        () => {
          resolve(null);
        },
        { once: true },
      );

      if (backButton) {
        (backButton as HTMLElement)["click"]();
      } else {
        window.history.back();
      }
    });
  }
}

// ===========================================================================
export function xpathNode(path: string, root?: Node | null) {
  root = root || document;
  return document.evaluate(
    path,
    root,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
  ).singleNodeValue;
}

export function* xpathNodes(path: string, root?: Node | null) {
  root = root || document;
  const iter = document.evaluate(
    path,
    root,
    null,
    XPathResult.ORDERED_NODE_ITERATOR_TYPE,
  );
  let result: Node | null = null;
  while ((result = iter.iterateNext()) !== null) {
    yield result;
  }
}

export function xpathString(path: string, root?: Node | null) {
  root = root || document;
  return document.evaluate(path, root, null, XPathResult.STRING_TYPE)
    .stringValue;
}

export async function* iterChildElem(
  root: Element,
  timeout: number,
  totalTimeout: number,
) {
  let child = root.firstElementChild;

  while (child) {
    yield child;

    if (!child.nextElementSibling) {
      await Promise.race([
        waitUntil(() => !!child?.nextElementSibling, timeout),
        sleep(totalTimeout),
      ]);
    }

    child = child.nextElementSibling;
  }
}

export async function* iterChildMatches(
  path: string,
  root: Node | null,
  interval = waitUnit,
  timeout = 5000,
) {
  let node = xpathNode(`.//${path}`, root);
  const getMatch = (node: Node | null) =>
    xpathNode(`./following-sibling::${path}`, node);
  while (node) {
    yield node;
    let next = getMatch(node);
    if (next) {
      node = next;
      continue;
    }
    await Promise.race([
      waitUntil(() => {
        next = getMatch(node);
        return !!next;
      }, interval),
      sleep(timeout),
    ]);
    node = next;
  }
}

// ===========================================================================
export function isInViewport(elem: Element) {
  const bounding = elem.getBoundingClientRect();
  return (
    bounding.top >= 0 &&
    bounding.left >= 0 &&
    bounding.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) &&
    bounding.right <=
      (window.innerWidth || document.documentElement.clientWidth)
  );
}

export function scrollToOffset(element: Element, offset = 0) {
  const elPosition = element.getBoundingClientRect().top;
  const topPosition = elPosition + window.pageYOffset - offset;
  window.scrollTo({ top: topPosition, behavior: "smooth" });
}

export function scrollIntoView(
  element: Element,
  opts: ScrollIntoViewOptions = {
    behavior: "smooth",
    block: "center",
    inline: "center",
  },
) {
  element.scrollIntoView(opts);
}

export type NumberKeys<T> = {
  [K in keyof T]: NonNullable<T[K]> extends number ? K : never;
}[keyof T];

export function getState<
  State extends NonNullable<unknown>,
  Opts,
  IncrKey extends NumberKeys<State>,
>(ctx: Context<State, Opts>, msg: string, incrValue?: IncrKey) {
  if (typeof ctx.state === "undefined") {
    (ctx.state as Partial<State>) = {};
  }
  if (incrValue) {
    if (ctx.state[incrValue] === undefined) {
      (ctx.state[incrValue] as number) = 1;
    } else {
      (ctx.state[incrValue] as number)++;
    }
  }

  return { state: ctx.state, msg };
}
