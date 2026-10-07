// ReplayWeb.page 2.5.3: original src/replay.ts with documented integration patches. See NOTICE.md.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html, css } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { property, query, state } from "lit/decorators.js";
import { wrapCss } from "./misc.js";
import rwpLogo from "./replaywebpage-icon-color.svg?raw";
import { keyed } from "lit/directives/keyed.js";
/**
 * @cssPart iframe
 * @cssPart iframe-container
 * @cssPart iframe-page-not-found
 * @fires update-title
 * @fires coll-tab-nav
 * @fires update-title
 * @fires replay-favicons
 * @fires replay-loading ReplayLoadingDetail
 * @fires cancel-click-download
 * @fires update-download-res-url
 */
class Replay extends LitElement {
    constructor() {
        super(...arguments);
        this.collInfo = null;
        this.sourceUrl = null;
        // external url set from parent
        this.url = "";
        this.ts = "";
        this.waczhash = "";
        // actual replay url
        this.replayUrl = "";
        this.replayTS = "";
        this.actualTS = "";
        this.title = "";
        this.iframeUrl = null;
        this.showAuth = false;
        this.replayNotFoundError = false;
        this.authFileHandle = null;
        this.downloadResUrl = "";
        this.reauthWait = null;
        this._loadPoll = null;
        this.hiliter = null;
        this._onReplayMessage = (event) => this.onReplayMessage(event);
        this._onSWMessage = (event) => this.handleSWMessage(event);
    }
    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("message", this._onReplayMessage);
        navigator.serviceWorker.addEventListener("message", this._onSWMessage);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("message", this._onReplayMessage);
        navigator.serviceWorker.removeEventListener("message", this._onSWMessage);
        this.clearHilite(true);
        if (this._loadPoll) {
            window.clearInterval(this._loadPoll);
            this._loadPoll = null;
        }
    }
    async handleSWMessage(event) {
        if (event.data.type === "authneeded" &&
            this.collInfo &&
            event.data.coll === this.collInfo.coll) {
            if (event.data.fileHandle) {
                this.authFileHandle = event.data.fileHandle;
                try {
                    if ((await this.authFileHandle.requestPermission({ mode: "read" })) ===
                        "granted") {
                        this.showAuth = false;
                        this.reauthWait = null;
                        this.refresh();
                        return;
                    }
                }
                catch (e) {
                    console.warn(e);
                }
            }
            else {
                this.authFileHandle = null;
            }
            if (this.reauthWait) {
                await this.reauthWait;
            }
            else {
                this.showAuth = true;
            }
        }
        else if (event.data.type) {
            window.parent.postMessage(event.data);
        }
    }
    doSetIframeUrl() {
        this.iframeUrl =
            this.url && this.collInfo
                ? `${this.collInfo.replayPrefix}/${this.waczhash ? `:${this.waczhash}/` : ""}${this.ts || ""}mp_/${this.url}`
                : "";
    }
    willUpdate(changedProperties) {
        if (changedProperties.has("sourceUrl") ||
            changedProperties.has("collInfo")) {
            this.reauthWait = null;
        }
        if (this.url &&
            (this.replayUrl != this.url || this.replayTS != this.ts) &&
            (changedProperties.has("url") || changedProperties.has("ts"))) {
            this.replayUrl = this.url;
            this.replayTS = this.ts;
            this.showAuth = false;
            this.reauthWait = null;
            const prevIframe = this.iframeUrl;
            this.doSetIframeUrl();
            if (prevIframe === this.iframeUrl) {
                this.iframeUrlUpdateKey = Date.now();
            }
        }
    }
    updated(changedProperties) {
        if (this.iframeUrl && changedProperties.has("iframeUrl")) {
            this.waitForLoad();
            const detail = { title: "Archived Page", replayTitle: false };
            this.dispatchEvent(new CustomEvent("update-title", {
                bubbles: true,
                composed: true,
                detail,
            }));
        }
        if ((this.replayUrl && changedProperties.has("replayUrl")) ||
            (this.replayTS && changedProperties.has("replayTS"))) {
            const data = {
                url: this.replayUrl,
                ts: this.replayTS,
                waczhash: this.waczhash,
            };
            this.dispatchEvent(new CustomEvent("coll-tab-nav", {
                detail: {
                    replaceLoc: true,
                    data,
                    replayNotFoundError: this.replayNotFoundError,
                },
            }));
        }
        if (this.title &&
            (changedProperties.has("title") || changedProperties.has("actualTS"))) {
            const detail = {
                title: this.title,
                url: this.replayUrl,
                // send actual ts even if live
                ts: this.actualTS,
                replayTitle: true,
            };
            this.dispatchEvent(new CustomEvent("update-title", {
                bubbles: true,
                composed: true,
                detail,
            }));
        }
    }
    setDisablePointer(disable) {
        const iframe = this.renderRoot.querySelector("iframe");
        if (iframe) {
            iframe.style.pointerEvents = disable ? "none" : "all";
        }
    }
    onReplayMessage(event) {
        const iframe = this.renderRoot.querySelector("iframe");
        if (iframe && event.source === iframe.contentWindow) {
            if (event.data.wb_type === "load" ||
                event.data.wb_type === "replace-url" ||
                event.data.wb_type === "archive-not-found") {
                this.replayTS = event.data.is_live ? "" : event.data.ts;
                this.actualTS = event.data.ts;
                this.replayUrl = event.data.url;
                this.title = event.data.title || this.title;
                this.replayNotFoundError = event.data.wb_type === "archive-not-found";
                this.clearLoading(iframe);
                if (event.data.icons) {
                    const icons = event.data.icons;
                    this.dispatchEvent(new CustomEvent("replay-favicons", {
                        bubbles: true,
                        composed: true,
                        detail: { icons },
                    }));
                }
            }
            else if (event.data.wb_type === "title") {
                this.title = event.data.title;
            }
            else {
                const passEvent = { type: event.data.wb_type, ...event.data };
                delete passEvent.wb_type;
                window.parent.postMessage(passEvent);
            }
        }
    }
    // @ts-expect-error [// TODO: Fix this the next time the file is edited.] - TS7006 - Parameter 'event' implicitly has an 'any' type.
    onReAuthed(event) {
        this.reauthWait = (async () => {
            if (!this.authFileHandle) {
                // google drive reauth
                const headers = event.detail.headers;
                await fetch(`${this.collInfo.apiPrefix}/updateAuth`, {
                    method: "POST",
                    body: JSON.stringify({ headers }),
                });
            }
            else {
                if ((await this.authFileHandle.requestPermission({ mode: "read" })) !==
                    "granted") {
                    this.reauthWait = null;
                    return;
                }
                this.authFileHandle = null;
            }
            if (this.showAuth) {
                this.showAuth = false;
                this.reauthWait = null;
            }
            this.refresh();
        })();
    }
    waitForLoad() {
        this.setLoading();
        this._loadPoll = window.setInterval(() => {
            const iframe = this.renderRoot.querySelector("iframe");
            if (!iframe?.contentDocument ||
                !iframe.contentWindow ||
                (iframe.contentDocument.readyState === "complete" &&
                    !iframe.contentWindow._WBWombat)) {
                this.clearLoading(iframe);
            }
        }, 5000);
    }
    clearLoading(iframe) {
        this.dispatchEvent(new CustomEvent("replay-loading", {
            detail: {
                loading: false,
                replayNotFoundError: this.replayNotFoundError,
            },
        }));
        if (this._loadPoll) {
            window.clearInterval(this._loadPoll);
            this._loadPoll = null;
        }
        const iframeWin = iframe?.contentWindow;
        if (iframeWin) {
            try {
                iframeWin.addEventListener("beforeunload", () => {
                    this.setLoading();
                });
            }
            catch (e) {
                // ignore
            }
        }
    }
    setLoading() {
        this.clearHilite(true);
        this.dispatchEvent(new CustomEvent("replay-loading", {
            detail: {
                loading: true,
            },
        }));
    }
    refresh() {
        const iframe = this.renderRoot.querySelector("iframe");
        if (!iframe) {
            return;
        }
        const oldIframeUrl = this.iframeUrl;
        // set iframe url to expected, refresh if same url
        this.doSetIframeUrl();
        if (oldIframeUrl === this.iframeUrl || this.url === this.replayUrl) {
            this.waitForLoad();
            iframe.contentWindow?.location.reload();
        }
    }
    static get styles() {
        return wrapCss(css `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        color-scheme: light dark;
      }

      .iframe-container {
        position: relative;
        width: 100%;
        height: 100%;
        border: 0px;
      }

      .iframe-main {
        position: absolute;
        top: 0px;
        left: 0px;
        right: 0px;
        bottom: 0px;
        width: 100%;
        height: 100%;
      }

      .intro-panel .panel-heading {
        font-size: 1em;
        display: inline-block;
      }

      .iframe-main.modal-bg {
        z-index: 200;
        background-color: rgba(10, 10, 10, 0.7);
      }

      #wrlogo {
        vertical-align: middle;
      }

      .intro-panel .panel-block {
        padding: 1em;
        flex-direction: column;
        line-height: 2.5em;
      }

      div.intro-panel.panel {
        min-width: 40%;
        display: flex;
        flex-direction: column;
        margin: 3em;
        background-color: white;
      }

      .hilite-overlay {
        display: none;
        position: absolute;
        z-index: 9999;
        background-color: rgba(0, 0, 255, 0.5);
        border: solid 10px blue;
        cursor: crosshair;
      }
    `);
    }
    render() {
        const title = `Replay of ${this.title ? `${this.title}:` : ""} ${this.url}`;
        return html ` <h1 id="replay-heading" class="is-sr-only">${title}</h1>

      ${!this.iframeUrl
            ? html ` <div class="panel intro-panel">
            <p class="panel-heading">Replay Web Page</p>
            <div class="panel-block">
              <p>Enter a URL above to replay it from the web archive!</p>
              <p>
                (Or, check out <a href="#view=pages">Pages</a> or
                <a href="#view=resources">URLs</a> to explore the contents of
                this archive.)
              </p>
            </div>
          </div>`
            : html `
            <a
              href="${this.downloadResUrl}"
              @click="${this.hiliteClicked}"
              class="hilite-overlay"
              download="${ifDefined(this.downloadResUrl.startsWith("blob:")
                ? "image.svg"
                : undefined)}"
            ></a>
            <div part="iframe-container" class="iframe-container">
              ${keyed(this.iframeUrlUpdateKey, html `<iframe
                  sandbox=${location.protocol === 'chrome-extension:' ? 'allow-same-origin' : 'allow-same-origin allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-presentation'}
                  part="iframe ${this.replayNotFoundError
                ? "iframe-page-not-found"
                : ""}"
                  class="iframe-main"
                  name="___wb_replay_top_frame"
                  @message="${this.onReplayMessage}"
                  allow="autoplay 'self'; fullscreen"
                  allowfullscreen
                  src="${this.iframeUrl}"
                  title="${title}"
                ></iframe>`)}
              ${this.showAuth
                ? html `
                    <div class="iframe-main modal-bg">
                      <div class="panel intro-panel">
                        <p class="panel-heading">
                          <fa-icon
                            id="wrlogo"
                            size="1.5rem"
                            .svg=${rwpLogo}
                            aria-hidden="true"
                          ></fa-icon>
                          Authorization Needed
                        </p>
                        <div class="panel-block">
                          ${this.authFileHandle
                    ? html `
                                <p>
                                  This archive is loaded from a local file:
                                  <b>${this.authFileHandle.name}</b>
                                </p>
                                <p>
                                  The browser needs to confirm your permission
                                  to continue loading from this file.
                                </p>
                                <button
                                  class="button is-warning is-rounded"
                                  @click="${this.onReAuthed}"
                                >
                                  Show Confirmation
                                </button>
                              `
                    : html ` <wr-gdrive
                                .sourceUrl="${this.sourceUrl}"
                                state="trymanual"
                                .reauth="${true}"
                                @load-ready="${this.onReAuthed}"
                              ></wr-gdrive>`}
                        </div>
                      </div>
                    </div>
                  `
                : ""}
            </div>
          `}`;
    }
    clearHilite(removeListeners = false) {
        if (this.hiliter) {
            this.hiliter.clearHilite(removeListeners);
            this.hiliter = null;
        }
        if (removeListeners) {
            this.removeEventListener("update-download-res-url", this.onUpdateDownloadResUrl);
            this.dispatchEvent(new CustomEvent("cancel-click-download"));
        }
    }
    hiliteClicked() {
        this.clearHilite(true);
        return true;
    }
    onUpdateDownloadResUrl(e) {
        const { url } = e.detail;
        this.downloadResUrl = url;
    }
    setClickToDownload() {
        if (this.hiliter) {
            return;
        }
        this.addEventListener("update-download-res-url", this.onUpdateDownloadResUrl);
        try {
            this.hiliter = new HoverHiliter(this);
        }
        catch (e) {
            this.hiliter = null;
        }
    }
}
__decorate([
    property({ type: Object })
], Replay.prototype, "collInfo", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "sourceUrl", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "url", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "ts", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "waczhash", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "replayUrl", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "replayTS", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "actualTS", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "title", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "iframeUrl", void 0);
__decorate([
    property({ type: Boolean })
], Replay.prototype, "showAuth", void 0);
__decorate([
    property({ type: Boolean })
], Replay.prototype, "replayNotFoundError", void 0);
__decorate([
    property({ type: Object })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requestPermission() type mismatch
], Replay.prototype, "authFileHandle", void 0);
__decorate([
    property({ type: String })
], Replay.prototype, "downloadResUrl", void 0);
__decorate([
    query("iframe")
], Replay.prototype, "iframe", void 0);
__decorate([
    state()
], Replay.prototype, "iframeUrlUpdateKey", void 0);
// ===========================================================================
class HoverHiliter {
    constructor(replay) {
        this.hiliteElem = null;
        this.replay = replay;
        const iframe = this.replay.renderRoot.querySelector("iframe");
        const hiliteOverlay = this.replay.renderRoot.querySelector(".hilite-overlay");
        if (!hiliteOverlay || !iframe?.contentDocument) {
            throw new Error("missing elements");
        }
        this.iframe = iframe;
        this.hiliteOverlay = hiliteOverlay;
        this.onMove = (event) => this.hiliteOnMove(event);
        this.onRecompute = () => this.hiliteRecompute();
        const doc = iframe.contentDocument;
        this.doc = doc;
        doc.addEventListener("mousemove", this.onMove);
        doc.addEventListener("scroll", this.onRecompute);
        doc.defaultView?.addEventListener("resize", this.onRecompute);
    }
    clearHilite(removeListeners = false) {
        if (removeListeners) {
            this.doc.removeEventListener("mousemove", this.onMove);
            this.doc.removeEventListener("scroll", this.onRecompute);
            this.doc.defaultView?.removeEventListener("scroll", this.onRecompute);
        }
        this.hiliteElem = null;
        this.hiliteOverlay.style.display = "none";
    }
    hiliteRecompute() {
        if (!this.hiliteElem) {
            return;
        }
        const iframeRect = this.iframe.getBoundingClientRect();
        const elemRect = this.hiliteElem.getBoundingClientRect();
        const offset = 10;
        const leftX = iframeRect.left + window.scrollX + elemRect.left - offset;
        const topY = iframeRect.top + window.scrollY + elemRect.top - offset;
        const hilite = this.hiliteOverlay;
        hilite.style.left = leftX + "px";
        hilite.style.top = topY + "px";
        hilite.style.width = elemRect.width + offset * 2 + "px";
        hilite.style.height = elemRect.height + offset * 2 + "px";
        hilite.style.display = "block";
    }
    hiliteOnMove(event) {
        const elem = this.hiliteFindBestElement(event.clientX, event.clientY);
        if (elem && this.hiliteElem === elem) {
            return;
        }
        const getSrc = (elem) => {
            if (!elem) {
                return "";
            }
            if (elem.currentSrc) {
                return elem.currentSrc;
            }
            if (elem.tagName === "image") {
                const href = elem.getAttribute("href");
                if (href) {
                    return href;
                }
            }
            if (elem.tagName === "svg") {
                if (!elem.getAttribute("xmlns")) {
                    elem.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                }
                const buff = new TextEncoder().encode(elem.outerHTML);
                const blob = new Blob([buff], { type: "image/svg+xml" });
                return URL.createObjectURL(blob);
            }
            const src = HTMLElement.prototype.getAttribute.call(elem, "src");
            if (src) {
                return src;
            }
            if (elem.style.backgroundImage) {
                return elem.style.backgroundImage.replace(/(url\s*\(\s*[\\"']*)([^)'"]+)([\\"']*\s*\)?)/i, "$2");
            }
            return "";
        };
        const src = getSrc(elem);
        if (src) {
            const newSrc = src.replace(/([\d]*)([\w][\w]_)(\/(https:|http:)?\/)/, "$1dl_$3");
            this.replay.dispatchEvent(new CustomEvent("update-download-res-url", { detail: { url: newSrc } }));
            this.hiliteElem = elem;
            this.hiliteRecompute();
        }
        else {
            this.clearHilite();
        }
    }
    hiliteFindBestElement(x, y) {
        const elems = this.doc.elementsFromPoint(x, y);
        if (!elems.length) {
            return null;
        }
        const firstElem = elems[0];
        const containsRect = (rect) => {
            return (rect.x >= firstRect.x &&
                rect.y >= firstRect.y &&
                rect.width <= firstRect.width &&
                rect.height <= firstRect.height);
        };
        // allow other elements only if they're within same bounding rect
        // as the deepest element
        const firstRect = firstElem.getBoundingClientRect();
        let isLast = false;
        for (const elem of elems) {
            const rect = elem.getBoundingClientRect();
            if (elem === firstElem || containsRect(rect)) {
                if (elem.currentSrc ||
                    (elem.hasAttribute("src") && !(elem instanceof HTMLIFrameElement))) {
                    return elem;
                }
                if (elem.tagName === "image" && elem.hasAttribute("href")) {
                    return elem;
                }
                if (elem.tagName === "svg") {
                    return elem;
                }
            }
            else {
                isLast = true;
            }
            const subelem = elem.querySelector("[src]:not(script)") ||
                elem.querySelector(`div[style*="background-image: url("]`);
            if (subelem) {
                const subRect = subelem.getBoundingClientRect();
                if (containsRect(subRect) &&
                    x >= subRect.left &&
                    y >= subRect.top &&
                    x < subRect.right &&
                    y <= subRect.bottom) {
                    return subelem;
                }
            }
            if (isLast) {
                break;
            }
        }
        return null;
    }
}
customElements.define("wr-coll-replay", Replay);
export { Replay };
