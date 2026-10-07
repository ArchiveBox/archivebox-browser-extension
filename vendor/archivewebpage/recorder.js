// ArchiveWeb.page 595664ca4ae2f0073d883c3bea6011d51004e249; AGPL-3.0-or-later. See NOTICE.md.
import { RequestResponseInfo } from "./requestresponseinfo";
import { getCustomRewriter, rewriteDASH, rewriteHLS, removeRangeAsQuery, DISABLE_MEDIASOURCE_SCRIPT, } from "@webrecorder/wabac";
import { Buffer } from "buffer";
import behaviors from "virtual:browsertrix-behaviors";
import extractPDF from "./extractPDF.js?raw";
import { BEHAVIOR_WAIT_LOAD, BEHAVIOR_READY_START, BEHAVIOR_RUNNING, BEHAVIOR_PAUSED, BEHAVIOR_DONE, } from "./consts";
import { getLocalOption } from "./localstorage";
const encoder = new TextEncoder();
const MAX_CONCURRENT_FETCH = 6;
const MAIN_INJECT_URL = "__awp_main_inject__";
const IFRAME_INJECT_URL = "__awp_iframe_inject__";
const BEHAVIOR_LOG_FUNC = "__bx_log";
const CAPTURE_WORLD = "archivebox-capture";
const DISABLE_PERF_NHP = `;
if (self.PerformanceResourceTiming) {
  Object.defineProperty(self.PerformanceResourceTiming.prototype, "nextHopProtocol", {value: ""});
}
`;
function sleep(time) {
    return new Promise((resolve) => setTimeout(() => resolve(), time));
}
class Recorder {
    archiveStorage = false;
    archiveCookies = false;
    archiveFlash = false;
    archiveScreenshots = false;
    archivePDF = false;
    disableMSE = false;
    disablePerf = false;
    _fetchQueue = [];
    constructor() {
        this.flatMode = false;
        this.collId = "";
        this.pendingRequests = {};
        this.numPending = 0;
        this.running = false;
        this.stopping = false;
        this.frameId = null;
        // Responses can arrive before the first document commits (notably
        // initial redirects). Give them the eventual first page's identity.
        this.pageInfo = { id: this.newPageId(), size: 0 };
        this.firstPageStarted = false;
        this.sizeNew = 0;
        this.sizeTotal = 0;
        this.numPages = 0;
        this.numUrls = 0;
        this.historyMap = {};
        this._promises = {};
        this._fetchPending = new Map();
        this._fetchUrls = new Set();
        this._bindings = {};
        this.pdfLoadURL = null;
        this.pixelRatio = 1;
        this.failureMsg = null;
        this.id = 1;
        this.sessionSet = new Set();
        this._cachePageInfo = null;
        this._cacheSessionNew = 0;
        this._cacheSessionTotal = 0;
        this.behaviorInitStr = JSON.stringify({
            autofetch: true,
            autoplay: true,
            autoscroll: true,
            siteSpecific: true,
            log: BEHAVIOR_LOG_FUNC,
        });
        this.behaviorState = BEHAVIOR_WAIT_LOAD;
        this.behaviorData = null;
        this.autorun = false;
        this.defaultFetchOpts = {
            redirect: "manual",
        };
        this.initOpts();
    }
    async initOpts() {
        this.archiveCookies = (await getLocalOption("archiveCookies")) === "1";
        this.archiveStorage = (await getLocalOption("archiveStorage")) === "1";
        this.archiveFlash = (await getLocalOption("archiveFlash")) === "1";
        this.archiveScreenshots =
            (await getLocalOption("archiveScreenshots")) === "1";
        this.archivePDF = (await getLocalOption("archivePDF")) === "1";
        this.disableMSE = (await getLocalOption("disableMSE")) === "1";
        this.disablePerf = (await getLocalOption("disablePerf")) === "1";
    }
    setAutoRunBehavior(autorun) {
        this.autorun = autorun;
    }
    addExternalInject(path) {
        return `
    (function () {
      window.addEventListener("DOMContentLoaded", () => {
        const e = document.createElement("script");
        e.src = "${this.getExternalInjectURL(path)}";
        document.head.appendChild(e);
      });
    })();
    `;
    }
    getInjectScript() {
        return (behaviors +
            `;
    self.__bx_behaviors.init(${this.behaviorInitStr});

    window.addEventListener("beforeunload", () => {});\n` +
            (this.archiveFlash ? this.getFlashInjectScript() : "") +
            (this.disableMSE ? DISABLE_MEDIASOURCE_SCRIPT : "") +
            (this.disablePerf ? DISABLE_PERF_NHP : ""));
    }
    getFlashInjectScript() {
        return (`
    (() => {
      const description = "Shockwave Flash 32.0 r0";
      const enabledPlugin = { description };
      navigator.plugins["Shockwave Flash"] = { description };
      function addPlugin(type, suffixes) {
        const mime = { enabledPlugin, description: "", type, suffixes};
        navigator.mimeTypes[type] = mime;
        navigator.mimeTypes[navigator.mimeTypes.length] = mime;
      }
      addPlugin("application/futuresplash", "sp1");
      addPlugin("application/x-shockwave-flash2-preview", "swf");
      addPlugin("application/x-shockwave-flash", "swf");
      addPlugin("application/vnd.adobe.flash-movie", "swf");
    })();
    ` + this.addExternalInject("ruffle/ruffle.js"));
    }
    async detach() {
        if (!this.running) {
            return;
        }
        this.stopping = true;
        const domSnapshot = await this.getFullText(true);
        if (this.behaviorState === BEHAVIOR_RUNNING) {
            this.toggleBehaviors();
        }
        try {
            await Promise.race([
                Promise.all(this._fetchPending.values()),
                sleep(15000),
            ]);
        }
        catch (e) {
            console.log(e);
        }
        try {
            await this._doDetach();
        }
        catch (e) {
            console.log(e);
        }
        await this._stop(domSnapshot);
    }
    async _stop(domSnapshot = null) {
        clearInterval(this._updateStatusId);
        clearInterval(this._loopId);
        clearInterval(this._bgFetchId);
        this.flushPending();
        this.running = false;
        this.pendingRequests = {};
        this.numPending = 0;
        await this.commitPage(this.pageInfo, domSnapshot, true);
        if (this._cleaningUp) {
            await this._cleanupStaleWait;
        }
        else {
            await this.doUpdateLoop();
        }
        this._doStop();
    }
    async attach() {
        if (this.running) {
            console.warn("Already Attached!");
            return;
        }
        await this._doAttach();
        this.running = true;
        this.stopping = false;
        this._cachePageInfo = null;
        this._cacheSessionNew = 0;
        this._cacheSessionTotal = 0;
        this._cleaningUp = false;
        this._cleanupStaleWait = null;
        this._updateStatusId = setInterval(() => this.updateStatus(), 1000);
        this._loopId = setInterval(() => this.updateLoop(), 10000);
        this._bgFetchId = setInterval(() => this.doBackgroundFetch(), 10000);
    }
    updateLoop() {
        if (!this._cleaningUp) {
            this._cleanupStaleWait = this.doUpdateLoop();
        }
    }
    async doUpdateLoop() {
        this._cleaningUp = true;
        try {
            for (const key of Object.keys(this.pendingRequests)) {
                const reqresp = this.pendingRequests[key];
                if (!reqresp) {
                    continue;
                }
                if (new Date() - reqresp._created > 20000) {
                    if (this.noResponseForStatus(reqresp.status)) {
                        console.log("Dropping stale: " + key);
                    }
                    else if (!reqresp.awaitingPayload) {
                        console.log(`Committing stale ${reqresp.status} ${reqresp.url}`);
                        await this.fullCommit(reqresp, []);
                    }
                    else {
                        console.log(`Waiting for payload for ${reqresp.url}`);
                        continue;
                    }
                    delete this.pendingRequests[key];
                }
            }
            if (!this.isEmptyPage(this._cachePageInfo)) {
                await this._doAddPage(this._cachePageInfo);
                this._cachePageInfo = null;
            }
            if (this._cacheSessionTotal > 0) {
                await this._doIncSizes(this._cacheSessionTotal, this._cacheSessionNew);
                this._cacheSessionTotal = 0;
                this._cacheSessionNew = 0;
            }
        }
        finally {
            this._cleaningUp = false;
        }
    }
    updateStatus() {
        const networkPending = Object.keys(this.pendingRequests).length;
        this.numPending = networkPending + this._fetchPending.size;
        if (networkPending === 0 && this._loadedDoneResolve) {
            this._loadedDoneResolve();
        }
        this.doUpdateStatus();
    }
    getStatusMsg() {
        return {
            recording: this.running,
            firstPageStarted: this.firstPageStarted,
            behaviorState: this.behaviorState,
            behaviorData: this.behaviorData,
            autorun: this.autorun,
            sizeTotal: this.sizeTotal,
            sizeNew: this.sizeNew,
            numUrls: this.numUrls,
            numPages: this.numPages,
            numPending: this.numPending,
            pageUrl: this.pageInfo.url,
            pageTs: this.pageInfo.ts,
            failureMsg: this.failureMsg,
            collId: this.collId,
            stopping: this.stopping,
            type: "status",
        };
    }
    async _doInjectTopFrame() {
        await this.exposeFunction(BEHAVIOR_LOG_FUNC, ({ data, type }) => {
            switch (type) {
                case "info":
                    this.behaviorData = data;
                    this.updateStatus();
                    break;
            }
        });
        await this.newDocEval(MAIN_INJECT_URL, this.getInjectScript());
    }
    async newDocEval(name, source, sessions = []) {
        source += "\n\n//# sourceURL=" + name;
        await this.send("Page.addScriptToEvaluateOnNewDocument", { source, worldName: CAPTURE_WORLD, runImmediately: true }, sessions);
    }
    async pageEval(name, expression, sessions = [], returnByValue = false) {
        // Resolve the current target document on every evaluation. Navigation
        // destroys execution contexts; a cached context ID can address stale JS.
        const { frameTree } = await this.send("Page.getFrameTree", {}, sessions);
        const { executionContextId } = await this.send("Page.createIsolatedWorld", {
            frameId: frameTree.frame.id, worldName: CAPTURE_WORLD,
        }, sessions);
        expression += "\n\n//# sourceURL=" + name;
        return this.send("Runtime.evaluate", {
            expression,
            contextId: executionContextId,
            returnByValue,
            userGesture: true,
            includeCommandLineAPI: true,
            allowUnsafeEvalBlockedByCSP: true,
            awaitPromise: true,
        }, sessions);
    }
    async _doInjectIframe(sessions) {
        try {
            await this.send("Page.enable", {}, sessions);
            for (const name of Object.keys(this._bindings)) {
                await this.send("Runtime.addBinding", { name, executionContextName: CAPTURE_WORLD }, sessions);
            }
            await this.newDocEval(IFRAME_INJECT_URL, this.getInjectScript(), sessions);
        }
        catch (e) {
            console.warn(e);
        }
    }
    toggleBehaviors() {
        switch (this.behaviorState) {
            case BEHAVIOR_WAIT_LOAD:
            case BEHAVIOR_DONE:
                break;
            case BEHAVIOR_READY_START:
                this.pageEval("__awp_behavior_run__", "self.__bx_behaviors.run();").then(() => (this.behaviorState = BEHAVIOR_DONE));
                this.behaviorState = BEHAVIOR_RUNNING;
                break;
            case BEHAVIOR_RUNNING:
                this.pageEval("__awp_behavior_unpause__", "self.__bx_behaviors.pause();");
                this.behaviorState = BEHAVIOR_PAUSED;
                break;
            case BEHAVIOR_PAUSED:
                this.pageEval("__awp_behavior_unpause__", "self.__bx_behaviors.unpause();");
                this.behaviorState = BEHAVIOR_RUNNING;
                break;
        }
        this.updateStatus();
    }
    async exposeFunction(name, func, sessions = []) {
        this._bindings[name] = func;
        await this.send("Runtime.addBinding", { name, executionContextName: CAPTURE_WORLD }, sessions);
    }
    loaded() {
        this._loaded = new Promise((resolve) => (this._loadedDoneResolve = resolve));
        return this._loaded;
    }
    async start() {
        this.firstPageStarted = false;
        await this.send("Page.enable");
        await this.send("DOMSnapshot.enable");
        await this.initPixRatio();
        await this._doInjectTopFrame();
        await this.sessionInit([]);
        this.failureMsg = null;
    }
    async initPixRatio() {
        const { result } = await this.pageEval("__awp_get_pix_ratio", "window.devicePixelRatio");
        if (result && result.type === "number") {
            this.pixelRatio = result.value;
        }
    }
    async sessionInit(sessions) {
        try {
            await this.send("Network.enable", null, sessions);
            try {
                await this.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] }, sessions);
            }
            catch (e) {
                console.log("No Fetch Available", e);
            }
            try {
                await this.send("Media.enable", null, sessions);
            }
            catch (e) {
                console.log("No media events available");
            }
            await this.send("Target.setAutoAttach", {
                autoAttach: true,
                waitForDebuggerOnStart: true,
                flatten: this.flatMode,
            }, sessions);
            await this.send("Network.setCacheDisabled", { cacheDisabled: true }, sessions);
            await this.send("Network.setBypassServiceWorker", { bypass: true }, sessions);
            await this.send("Network.clearBrowserCache", null, sessions);
        }
        catch (e) {
            console.warn("Session Init Error: ");
            console.log(e);
        }
    }
    async sessionClose(sessions = []) {
        await this.send("Page.disable");
        await this.send("DOMSnapshot.disable");
        await this.send("Debugger.disable");
        await this.send("Network.disable", null, sessions);
        await this.send("Fetch.disable", null, sessions);
        try {
            await this.send("Media.disable", null, sessions);
        }
        catch (e) {
        }
        await this.send("Target.setAutoAttach", {
            autoAttach: false,
            waitForDebuggerOnStart: false,
        });
        await this.send("Network.setBypassServiceWorker", { bypass: false }, sessions);
    }
    pendingReqResp(requestId, reuseOnly = false) {
        if (!this.pendingRequests[requestId]) {
            if (reuseOnly || !requestId) {
                return null;
            }
            this.pendingRequests[requestId] = new RequestResponseInfo(requestId);
        }
        else if (requestId !== this.pendingRequests[requestId].requestId) {
            console.error("Wrong Req Id!");
        }
        return this.pendingRequests[requestId];
    }
    removeReqResp(requestId) {
        const reqresp = this.pendingRequests[requestId];
        delete this.pendingRequests[requestId];
        return reqresp;
    }
    async processMessage(method, params, sessions) {
        switch (method) {
            case "Target.attachedToTarget":
                sessions.push(params.sessionId);
                try {
                    this.sessionSet.add(params.sessionId);
                    const type = params.targetInfo.type;
                    const allowAttach = type !== "service_worker";
                    if (allowAttach) {
                        await this.sessionInit(sessions);
                    }
                    if (params.waitingForDebugger) {
                        await this.send("Runtime.runIfWaitingForDebugger", null, sessions);
                    }
                    if (allowAttach) {
                        console.log("Target Attached: " +
                            type +
                            " " +
                            params.targetInfo.url +
                            " " +
                            params.sessionId);
                        if (type === "page" || type === "iframe") {
                            await this._doInjectIframe(sessions);
                        }
                    }
                    else {
                        console.log("Not allowed attach for: " +
                            type +
                            " " +
                            params.targetInfo.url +
                            " " +
                            params.sessionId);
                        const params2 = this.flatMode
                            ? { sessionId: params.sessionId }
                            : { targetId: params.targetInfo.targetId };
                        await this.send("Runtime.runIfWaitingForDebugger", params2, sessions);
                    }
                }
                catch (e) {
                    console.log(e);
                    console.warn("Error attaching target: " +
                        params.targetInfo.type +
                        " " +
                        params.targetInfo.url);
                }
                break;
            case "Target.detachedFromTarget":
                console.log("Detaching from: " + params.sessionId);
                this.sessionSet.delete(params.sessionId);
                break;
            case "Target.receivedMessageFromTarget":
                if (!this.sessionSet.has(params.sessionId)) {
                    console.warn("no such session: " + params.sessionId);
                    console.warn(params);
                    return;
                }
                sessions.push(params.sessionId);
                this.receiveMessageFromTarget(params, sessions);
                break;
            case "Network.responseReceived":
                if (params.response) {
                    const reqresp = this.pendingReqResp(params.requestId, true);
                    if (reqresp) {
                        reqresp.fillResponseReceived(params);
                    }
                }
                break;
            case "Network.loadingFinished":
                await this.handleLoadingFinished(params, sessions);
                break;
            case "Network.loadingFailed": {
                const reqresp = this.removeReqResp(params.requestId);
                if (reqresp && reqresp.status !== 206) {
                    if (params.type === "Document" &&
                        params.errorText === "net::ERR_ABORTED" &&
                        reqresp.isValidBinary()) {
                        this.fullCommit(reqresp, sessions);
                    }
                    else {
                        console.log(`Loading Failed for: ${reqresp.url} ${params.errorText}`);
                    }
                }
                break;
            }
            case "Network.requestServedFromCache":
                this.removeReqResp(params.requestId);
                break;
            case "Network.responseReceivedExtraInfo":
                {
                    const reqresp = this.pendingReqResp(params.requestId, true);
                    if (reqresp) {
                        reqresp.fillResponseReceivedExtraInfo(params);
                    }
                }
                break;
            case "Network.requestWillBeSent":
                await this.handleRequestWillBeSent(params);
                break;
            case "Network.requestWillBeSentExtraInfo":
                if (!this.shouldSkip(null, params.headers, null)) {
                    this.pendingReqResp(params.requestId).requestHeaders = params.headers;
                }
                break;
            case "Fetch.requestPaused":
                await this.handlePaused(params, sessions);
                break;
            case "Page.frameNavigated":
                this.initPage(params, sessions);
                break;
            case "Page.loadEventFired":
                await this.updatePage(sessions);
                break;
            case "Page.navigatedWithinDocument":
                await this.updateHistory(sessions);
                break;
            case "Page.windowOpen":
                this.handleWindowOpen(params.url, sessions);
                break;
            case "Page.javascriptDialogOpening":
                if (this.behaviorState === BEHAVIOR_RUNNING) {
                    await this.send("Page.handleJavaScriptDialog", { accept: false });
                }
                break;
            case "Debugger.paused":
                if (params.data && params.data.eventName === "listener:beforeunload") {
                    await this.unpauseAndFinish(params);
                }
                break;
            case "Media.playerEventsAdded":
                this.parseMediaEventsAdded(params, sessions);
                break;
            case "Runtime.bindingCalled":
                if (this._bindings[params.name]) {
                    this._bindings[params.name](JSON.parse(params.payload));
                }
                break;
            default:
                return false;
        }
        return true;
    }
    handleWindowOpen(url, sessions) {
        const headers = new Headers({ Referer: this.pageInfo.url });
        this.doAsyncFetch({ url, headers, redirectOnly: true }, sessions);
    }
    isPagePDF() {
        return this.pageInfo.mime === "application/pdf";
    }
    async extractPDFText() {
        let success = false;
        console.log("pdfLoadURL", this.pdfLoadURL);
        if (this.pdfLoadURL) {
            const res = await this.pageEval("__awp_pdf_extract__", `
      ${extractPDF};

      extractPDF("${this.pdfLoadURL}", "${this.getExternalInjectURL("")}");
      `);
            if (res.result) {
                const { type, value } = res.result;
                if (type === "string") {
                    this.pageInfo.text = value;
                    success = true;
                }
            }
        }
        return success;
    }
    async savePDF(pageInfo) {
        await this.send("Emulation.setEmulatedMedia", { type: "screen" });
        const resp = await this.send("Page.printToPDF", { printBackground: true });
        await this.send("Emulation.setEmulatedMedia", { type: "" });
        const payload = Buffer.from(resp.data, "base64");
        const mime = "application/pdf";
        const fullData = {
            url: "urn:pdf:" + pageInfo.url,
            ts: new Date().getTime(),
            status: 200,
            statusText: "OK",
            pageId: pageInfo.id,
            mime,
            respHeaders: {
                "Content-Type": mime,
                "Content-Length": payload.length + "",
            },
            reqHeaders: {},
            payload,
            extraOpts: { resource: true },
        };
        await this._doAddResource(fullData);
    }
    async saveScreenshot(pageInfo) {
        const width = 1920;
        const height = 1080;
        await this.send("Emulation.setDeviceMetricsOverride", {
            width,
            height,
            deviceScaleFactor: 0,
            mobile: false,
        });
        const resp = await this.send("Page.captureScreenshot", { format: "png" });
        const payload = Buffer.from(resp.data, "base64");
        const blob = new Blob([payload], { type: "image/png" });
        await this.send("Emulation.clearDeviceMetricsOverride");
        const mime = "image/png";
        const fullData = {
            url: "urn:view:" + pageInfo.url,
            ts: new Date().getTime(),
            status: 200,
            statusText: "OK",
            pageId: pageInfo.id,
            mime,
            respHeaders: {
                "Content-Type": mime,
                "Content-Length": payload.length + "",
            },
            reqHeaders: {},
            payload,
            extraOpts: { resource: true },
        };
        const thumbWidth = 640;
        const thumbHeight = 360;
        const bitmap = await self.createImageBitmap(blob, {
            resizeWidth: thumbWidth,
            resizeHeight: thumbHeight,
        });
        const canvas = new OffscreenCanvas(thumbWidth, thumbWidth);
        const context = canvas.getContext("bitmaprenderer");
        context.transferFromImageBitmap(bitmap);
        const resizedBlob = await canvas.convertToBlob({ type: "image/png" });
        const thumbPayload = new Uint8Array(await resizedBlob.arrayBuffer());
        const thumbData = {
            ...fullData,
            url: "urn:thumbnail:" + pageInfo.url,
            respHeaders: {
                "Content-Type": mime,
                "Content-Length": thumbPayload.length + "",
            },
            payload: thumbPayload,
        };
        await this._doAddResource(fullData);
        await this._doAddResource(thumbData);
    }
    async getFullText(finishing = false) {
        if (!this.pageInfo?.url) {
            return null;
        }
        if (this.isPagePDF() && !finishing) {
            await this.extractPDFText();
            return null;
        }
        try {
            return await Promise.race([
                this.send("DOMSnapshot.captureSnapshot", { computedStyles: [] }),
                sleep(10000),
            ]);
        }
        catch (e) {
            console.log(e);
            return null;
        }
    }
    async unpauseAndFinish(params) {
        let domSnapshot = null;
        const ourUnload = params.callFrames[0].url === MAIN_INJECT_URL;
        if (ourUnload && this.behaviorState !== BEHAVIOR_WAIT_LOAD) {
            domSnapshot = await this.getFullText(true);
        }
        const currPage = this.pageInfo;
        try {
            await this.send("Debugger.resume");
        }
        catch (e) {
            console.warn(e);
        }
        if (this.behaviorState === BEHAVIOR_RUNNING) {
            await this.toggleBehaviors();
        }
        if (ourUnload && this.behaviorState !== BEHAVIOR_WAIT_LOAD) {
            this.flushPending();
            await this.commitPage(currPage, domSnapshot, true);
        }
    }
    commitPage(currPage, domSnapshot, finished) {
        if (this.isEmptyPage(currPage)) {
            return;
        }
        if (domSnapshot) {
            currPage.text = this.parseTextFromDOMSnapshot(domSnapshot);
        }
        else if (!currPage.text) {
            console.warn("No Full Text Update");
        }
        currPage.finished = finished;
        const res = this._doAddPage(currPage);
        if (currPage === this._cachePageInfo) {
            this._cachePageInfo = null;
        }
        return res;
    }
    async commitResource(data, pageInfo) {
        const payloadSize = data.payload.length;
        pageInfo = pageInfo || this.pageInfo;
        pageInfo.size += payloadSize;
        this.sizeTotal += payloadSize;
        this.numUrls++;
        const writtenSize = await this._doAddResource(data);
        this.sizeNew += writtenSize;
        if (writtenSize) {
            this._cachePageInfo = pageInfo;
            this._cacheSessionTotal += payloadSize;
            this._cacheSessionNew += writtenSize;
        }
    }
    receiveMessageFromTarget(params, sessions) {
        const nestedParams = JSON.parse(params.message);
        if (nestedParams.id != undefined) {
            const promise = this._promises[nestedParams.id];
            if (promise) {
                if (nestedParams.error) {
                    promise.reject(nestedParams.error);
                }
                else {
                    promise.resolve(nestedParams.result);
                }
                delete this._promises[nestedParams.id];
            }
        }
        else if (nestedParams.params != undefined) {
            this.processMessage(nestedParams.method, nestedParams.params, sessions);
        }
    }
    newPageId() {
        return (Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15));
    }
    initPage(params, sessions) {
        if (params.frame.parentId) {
            return false;
        }
        if (this.frameId != params.frame.id) {
            this.historyMap = {};
        }
        this.frameId = params.frame.id;
        this.loaderId = params.frame.loaderId;
        this._initNewPage(params.frame.url, params.frame.mimeType);
        const reqresp = this.removeReqResp(this.loaderId);
        if (reqresp) {
            this.fullCommit(reqresp, sessions);
        }
        return true;
    }
    initFirstPage() {
        this.updateStatus();
        this.firstPageStarted = true;
    }
    isEmptyPage(pageInfo) {
        if (!pageInfo?.url || !pageInfo.ts || pageInfo.url === "about:blank") {
            return true;
        }
        return false;
    }
    _initNewPage(url, mime) {
        const pendingPage = this.firstPageStarted ? null : this.pageInfo;
        this.pageInfo = {
            id: pendingPage?.id || this.newPageId(),
            url,
            ts: 0,
            title: "",
            text: "",
            size: pendingPage?.size || 0,
            finished: false,
            favIconUrl: "",
            mime,
        };
        this.pdfLoadURL = null;
        this.behaviorState = BEHAVIOR_WAIT_LOAD;
        this.behaviorData = null;
        this.numPages++;
        this._fetchUrls.clear();
        if (!this.firstPageStarted) {
            this.initFirstPage();
        }
        this.behaviorState = BEHAVIOR_WAIT_LOAD;
    }
    loadFavIcon(favIconUrl, sessions) {
        if (favIconUrl && this.pageInfo && this.pageInfo.favIconUrl != favIconUrl) {
            this.pageInfo.favIconUrl = favIconUrl;
            this.doAsyncFetch({ url: favIconUrl }, sessions);
        }
    }
    async updatePage(sessions) {
        if (!this.pageInfo) {
            console.warn("no page info!");
        }
        const result = await this.send("Page.getNavigationHistory");
        const id = result.currentIndex;
        this.historyMap[id] = result.entries[id].url;
        this.pageInfo.title = result.entries[id].title || result.entries[id].url;
        const pageInfo = this.pageInfo;
        if (this.archiveScreenshots) {
            await this.saveScreenshot(pageInfo);
        }
        if (this.archivePDF) {
            await this.savePDF(pageInfo);
        }
        const [domSnapshot, favIcon] = await Promise.all([
            this.getFullText(),
            this.getFavIcon(),
        ]);
        if (favIcon) {
            this.loadFavIcon(favIcon, sessions);
        }
        await this.commitPage(this.pageInfo, domSnapshot, false);
        this.updateStatus();
        await this.loaded();
        if (pageInfo === this.pageInfo) {
            this.behaviorState = BEHAVIOR_READY_START;
            if (this.autorun) {
                await this.toggleBehaviors();
            }
        }
    }
    async updateHistory(sessions) {
        if (sessions.length) {
            return;
        }
        const result = await this.send("Page.getNavigationHistory", null, sessions);
        const id = result.currentIndex;
        if (id === result.entries.length - 1 &&
            this.historyMap[id] !== result.entries[id].url) {
            this.historyMap[id] = result.entries[id].url;
        }
    }
    shouldSkip(method, headers, resourceType) {
        if (headers && !method) {
            method = headers[":method"];
        }
        if (method === "OPTIONS" || method === "HEAD") {
            return true;
        }
        if (["EventSource", "WebSocket", "Ping"].includes(resourceType)) {
            return true;
        }
        if (resourceType === "Other" && method === "POST") {
            return true;
        }
        if (headers &&
            (headers["accept"] === "text/event-stream" ||
                headers["Accept"] === "text/event-stream")) {
            return true;
        }
        return false;
    }
    async handlePaused(params, sessions) {
        let continued = false;
        let reqresp = null;
        let skip = false;
        if (this.shouldSkip(params.request.method, params.request.headers, params.resourceType)) {
            skip = true;
        }
        else if (!params.responseStatusCode && !params.responseErrorReason) {
            skip = true;
        }
        try {
            if (!skip) {
                reqresp = await this.handleFetchResponse(params, sessions);
                try {
                    if (reqresp?.payload) {
                        continued = await this.rewriteResponse(params, reqresp, sessions);
                    }
                }
                catch (e) {
                    console.error("Fetch rewrite failed for: " + params.request.url);
                    console.error(e);
                }
            }
        }
        catch (e) {
            console.warn(e);
        }
        if (!continued) {
            try {
                await this.send("Fetch.continueResponse", { requestId: params.requestId }, sessions);
            }
            catch (e) {
                console.warn("Continue failed for: " + params.request.url, e);
            }
        }
        if (reqresp?.payload?.length &&
            params.frameId === this.frameId &&
            !isNaN(Number(reqresp.requestId))) {
            this.removeReqResp(reqresp.requestId);
            this.fullCommit(reqresp, sessions);
        }
    }
    async rewriteResponse(params, reqresp, sessions) {
        if (!reqresp?.payload) {
            return false;
        }
        const payload = reqresp.payload;
        if (!payload.length) {
            return false;
        }
        let newString = null;
        let string = null;
        const { url, extraOpts } = reqresp;
        const ct = this._getContentType(params.responseHeaders);
        switch (ct) {
            case "application/x-mpegurl":
            case "application/vnd.apple.mpegurl":
                string = payload.toString("utf-8");
                newString = rewriteHLS(string, { save: reqresp.extraOpts });
                break;
            case "application/dash+xml":
                string = payload.toString("utf-8");
                newString = rewriteDASH(string, { save: reqresp.extraOpts });
                break;
            case "text/html":
            case "application/json":
            case "text/javascript":
            case "application/javascript":
            case "application/x-javascript": {
                const rw = getCustomRewriter(url, ct === "text/html" && this.disableMSE);
                if (rw) {
                    string = payload.toString();
                    newString = rw.rewrite(string, { save: extraOpts });
                }
                if (this.disableMSE) {
                    extraOpts.disableMSE = 1;
                }
            }
        }
        if (!newString) {
            return false;
        }
        if (newString !== string) {
            reqresp.extraOpts.rewritten = 1;
            reqresp.payload = encoder.encode(newString);
            console.log("Rewritten Response for: " + params.request.url);
        }
        const base64Str = Buffer.from(newString).toString("base64");
        try {
            await this.send("Fetch.fulfillRequest", {
                requestId: params.requestId,
                responseCode: params.responseStatusCode,
                responseHeaders: params.responseHeaders,
                body: base64Str,
            }, sessions);
            return true;
        }
        catch (e) {
            console.warn("Fulfill Failed for: " + params.request.url + " " + e);
        }
        return false;
    }
    _getContentType(headers) {
        for (const header of headers) {
            if (header.name.toLowerCase() === "content-type") {
                return header.value.split(";")[0].toLowerCase();
            }
        }
        return null;
    }
    noResponseForStatus(status) {
        return !status || status === 204 || (status >= 300 && status < 400);
    }
    isValidUrl(url) {
        return url && (url.startsWith("https:") || url.startsWith("http:"));
    }
    async handleLoadingFinished(params, sessions) {
        const reqresp = this.removeReqResp(params.requestId);
        if (!reqresp?.url) {
            return;
        }
        if (!this.isValidUrl(reqresp.url)) {
            return;
        }
        let payload = reqresp.payload;
        if (!reqresp.fetch && !payload) {
            if (params.encodedDataLength) {
                payload = await this.fetchPayloads(params, reqresp, sessions, "Network.getResponseBody");
            }
            if (!payload?.length) {
                return;
            }
            reqresp.payload = payload;
        }
        await this.fullCommit(reqresp, sessions);
    }
    async fullCommit(reqresp, sessions) {
        try {
            const data = reqresp.toDBRecord(reqresp.payload, this.pageInfo, this.archiveCookies);
            if (data?.requestUrl &&
                data.requestUrl === this.pageInfo.url &&
                !sessions.length) {
                this.pageInfo.url = data.url;
            }
            if (data && !sessions.length && reqresp.url === this.pageInfo.url) {
                this.pageInfo.ts = reqresp.ts;
                if (data.mime === "application/pdf" &&
                    reqresp.payload &&
                    this.pageInfo) {
                    this.pageInfo.mime = "application/pdf";
                    this.pdfLoadURL = reqresp.url;
                }
                else {
                    if (!data.extraOpts) {
                        data.extraOpts = {};
                    }
                    data.extraOpts.pixelRatio = this.pixelRatio;
                    const storage = await this.getStorage(sessions);
                    if (storage) {
                        data.extraOpts.storage = storage;
                    }
                    await this.saveDetectedContentType(reqresp, sessions);
                }
            }
            if (data) {
                await this.commitResource(data);
            }
        }
        catch (e) {
            throw e;
        }
    }
    async saveDetectedContentType(reqresp, sessions) {
        try {
            const { result } = await this.pageEval("__awp_content_type__",
                "`${document.contentType}; charset=${document.characterSet}`", sessions, true);
            const contentType = result.value;
            if (contentType && contentType !== "text/html; charset=UTF-8") {
                reqresp.extraOpts.detectedCT = contentType;
            }
        }
        catch (e) {
            console.warn("Error getting detected content-type", e);
        }
    }
    async getStorage(sessions) {
        if (!this.archiveStorage) {
            return null;
        }
        const extractStorage = () => {
            const local = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key)
                    continue;
                const value = localStorage.getItem(key);
                if (!value)
                    continue;
                local.push([key, value]);
            }
            const session = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (!key)
                    continue;
                const value = sessionStorage.getItem(key);
                if (!value)
                    continue;
                session.push([key, value]);
            }
            return JSON.stringify({ local, session });
        };
        const { result } = await this.pageEval("__awp_extract_storage", `(${extractStorage.toString()})();`, sessions);
        if (result && result.type === "string") {
            return result.value;
        }
        else {
            return null;
        }
    }
    async handleRequestWillBeSent(params) {
        if (this.shouldSkip(params.request.method, params.request.headers, params.type)) {
            this.removeReqResp(params.requestId);
            return;
        }
        const reqresp = this.pendingReqResp(params.requestId);
        let data = null;
        if (params.redirectResponse) {
            if (reqresp.isSelfRedirect()) {
                console.warn(`Skip self redirect: ${reqresp.url}`);
                this.removeReqResp(params.requestId);
                return;
            }
            reqresp.fillResponseRedirect(params);
            data = reqresp.toDBRecord(null, this.pageInfo, this.archiveCookies);
        }
        reqresp.fillRequest(params);
        if (data) {
            await this.commitResource(data);
        }
    }
    async handleFetchResponse(params, sessions) {
        if (!params.networkId) {
        }
        if (this.pdfLoadURL && params.request.url === this.pdfLoadURL) {
            return null;
        }
        const id = params.networkId || params.requestId;
        const reqresp = this.pendingReqResp(id);
        reqresp.fillFetchRequestPaused(params);
        reqresp.payload = await this.fetchPayloads(params, reqresp, sessions, "Fetch.getResponseBody");
        if (reqresp.status === 206) {
            this.removeReqResp(id);
        }
        return reqresp;
    }
    parseMediaEventsAdded(params, sessions) {
        if (!this.pageInfo.id) {
            return;
        }
        for (const { value } of params.events) {
            if (value.indexOf('"kLoad"') > 0) {
                const { url } = JSON.parse(value);
                this.doAsyncFetch({ url, doRangeCheck: true }, sessions);
                break;
            }
        }
    }
    async attemptFetchRedirect(request, resp) {
        if (request.redirectOnly && resp.type === "opaqueredirect") {
            const abort = new AbortController();
            resp = await fetch(request.url, { signal: AbortSignal.any([abort.signal, this.defaultFetchOpts.signal].filter(Boolean)) });
            abort.abort();
            if (resp.redirected) {
                console.warn(`Adding synthetic redirect ${request.url} -> ${resp.url}`);
                return Response.redirect(resp.url, 302);
            }
        }
        console.warn(`async fetch error ${resp.status}, opaque due to redirect, retrying in browser`);
        await this.doAsyncFetchInBrowser(request, request.sessions, true);
        return null;
    }
    async doAsyncFetchInBrowser(request, sessions) {
        this._fetchUrls.add(request.url);
        const expression = `self.__bx_behaviors.doAsyncFetch("${request.url}")`;
        console.log("Start Async Load: " + request.url);
        await this.pageEval("__awp_async_fetch__", expression, sessions);
    }
    doAsyncFetch(request, sessions) {
        if (!request || !this.isValidUrl(request.url)) {
            return;
        }
        if (request.doRangeCheck) {
            const url = removeRangeAsQuery(request.url);
            if (url) {
                request.url = url;
                request.rangeRemoved = true;
            }
        }
        if (this._fetchUrls.has(request.url)) {
            console.log("Skipping, already fetching: " + request.url);
            return;
        }
        request.pageInfo = this.pageInfo;
        request.sessions = sessions;
        this._fetchQueue.push(request);
        this.doBackgroundFetch();
    }
    async doBackgroundFetch() {
        if (!this._fetchQueue.length ||
            this._fetchPending.size >= MAX_CONCURRENT_FETCH ||
            this.stopping) {
            return;
        }
        const request = this._fetchQueue.shift();
        if (!request) {
            return;
        }
        if (this._fetchUrls.has(request.url)) {
            console.log("Skipping, already fetching: " + request.url);
            return;
        }
        let doneResolve;
        const fetchId = "fetch-" + this.newPageId();
        try {
            console.log("Start Async Load: " + request.url);
            this._fetchUrls.add(request.url);
            const pending = new Promise((resolve) => {
                doneResolve = resolve;
            });
            this._fetchPending.set(fetchId, pending);
            const opts = { ...this.defaultFetchOpts };
            if (request.headers) {
                opts.headers = request.headers;
                opts.headers.delete("range");
            }
            let resp = await fetch(request.url, opts);
            if (resp.status === 0) {
                resp = await this.attemptFetchRedirect(request, resp);
                if (!resp) {
                    return;
                }
            }
            else if (resp.status >= 400) {
                console.warn(`async fetch error ${resp.status}, retrying without headers`);
                resp = await fetch(request.url, this.defaultFetchOpts);
                if (resp.status >= 400) {
                    console.warn(`async fetch returned: ${resp.status}, trying in-browser fetch`);
                    await this.doAsyncFetchInBrowser(request, request.sessions, true);
                    return;
                }
            }
            const payload = await resp.arrayBuffer();
            const reqresp = new RequestResponseInfo(fetchId);
            reqresp.status = resp.status;
            reqresp.statusText = resp.statusText;
            reqresp.responseHeaders = Object.fromEntries(resp.headers);
            reqresp.method = "GET";
            reqresp.url = request.url;
            reqresp.payload = new Uint8Array(payload);
            const data = reqresp.toDBRecord(reqresp.payload, request.pageInfo, this.archiveCookies);
            if (data) {
                await this.commitResource(data, request.pageInfo);
                console.log(`Done Async Load (${resp.status}) ${request.url}`);
                if (this.pageInfo !== request.pageInfo) {
                    await this.commitPage(request.pageInfo);
                }
            }
            else {
                console.warn("No Data Committed for: " + request.url + " Status: " + resp.status);
            }
        }
        catch (e) {
            this.reportError?.(`Supplemental fetch failed for ${request.url}: ${e}`);
            console.log(e);
            this._fetchUrls.delete(request.url);
        }
        finally {
            doneResolve();
            this._fetchPending.delete(fetchId);
        }
    }
    async fetchPayloads(params, reqresp, sessions, method) {
        let payload;
        if (reqresp.status === 206) {
            sleep(500).then(() => this.doAsyncFetch({
                url: reqresp.url,
                headers: reqresp.getRequestHeadersDict().headers,
            }, sessions));
            reqresp.payload = null;
            return null;
        }
        else {
            const changedUrl = removeRangeAsQuery(reqresp.url);
            if (changedUrl) {
                reqresp.url = changedUrl;
                this.removeReqResp(reqresp.requestId);
                sleep(500).then(() => this.doAsyncFetch({
                    url: changedUrl,
                    headers: reqresp.getRequestHeadersDict().headers,
                    rangeRemoved: true,
                }, sessions));
                reqresp.payload = null;
                return null;
            }
        }
        if (!this.noResponseForStatus(reqresp.status)) {
            try {
                reqresp.awaitingPayload = true;
                payload = await this.send(method, { requestId: params.requestId }, sessions);
                if (payload.base64Encoded) {
                    payload = Buffer.from(payload.body, "base64");
                }
                else {
                    payload = Buffer.from(payload.body, "utf-8");
                }
            }
            catch (e) {
                console.warn("no buffer for: " +
                    reqresp.url +
                    " " +
                    reqresp.status +
                    " " +
                    reqresp.requestId +
                    " " +
                    method);
                console.warn(e);
                return null;
            }
            finally {
                reqresp.awaitingPayload = false;
            }
        }
        else {
            payload = Buffer.from([]);
        }
        if (reqresp.hasPostData && !reqresp.postData) {
            try {
                const postRes = await this.send("Network.getRequestPostData", { requestId: reqresp.requestId }, sessions);
                reqresp.postData = Buffer.from(postRes.postData, "utf-8");
            }
            catch (e) {
                console.warn("Error getting POST data: " + e);
            }
        }
        reqresp.payload = payload;
        return payload;
    }
    flushPending() {
        const oldPendingReqs = this.pendingRequests;
        const pageInfo = this.pageInfo;
        this.pendingRequests = {};
        if (!oldPendingReqs) {
            return;
        }
        for (const [id, reqresp] of Object.entries(oldPendingReqs)) {
            if (reqresp.payload) {
                console.log(`Committing Finished ${id} - ${reqresp.url}`);
                const data = reqresp.toDBRecord(reqresp.payload, pageInfo, this.archiveCookies);
                if (data) {
                    this.commitResource(data);
                }
                if (data && reqresp.url === pageInfo.url) {
                    pageInfo.ts = reqresp.ts;
                }
            }
            else {
                console.log(`Discarding Payload-less ${reqresp.url}`);
            }
        }
    }
    send(method, params = null, sessions = []) {
        let promise = null;
        if (this.flatMode && sessions.length) {
            return this._doSendCommandFlat(method, params, sessions[sessions.length - 1]);
        }
        for (let i = sessions.length - 1; i >= 0; i--) {
            const id = this.id++;
            const p = new Promise((resolve, reject) => {
                this._promises[id] = { resolve, reject, method };
            });
            if (!promise) {
                promise = p;
            }
            const message = JSON.stringify({ id, method, params });
            const sessionId = sessions[i];
            params = { sessionId, message };
            method = "Target.sendMessageToTarget";
        }
        return this._doSendCommand(method, params, promise);
    }
    parseTextFromDOMSnapshot(result) {
        const TEXT_NODE = 3;
        const ELEMENT_NODE = 1;
        const SKIPPED_NODES = [
            "SCRIPT",
            "STYLE",
            "HEADER",
            "FOOTER",
            "BANNER-DIV",
            "NOSCRIPT",
        ];
        const { strings, documents } = result;
        const accum = [];
        for (const doc of documents) {
            const nodeValues = doc.nodes.nodeValue;
            const nodeNames = doc.nodes.nodeName;
            const nodeTypes = doc.nodes.nodeType;
            const parentIndex = doc.nodes.parentIndex;
            for (let i = 0; i < nodeValues.length; i++) {
                if (nodeValues[i] === -1) {
                    continue;
                }
                if (nodeTypes[i] === TEXT_NODE) {
                    const pi = parentIndex[i];
                    if (pi >= 0 && nodeTypes[pi] === ELEMENT_NODE) {
                        const name = strings[nodeNames[pi]];
                        if (!SKIPPED_NODES.includes(name)) {
                            const value = strings[nodeValues[i]].trim();
                            if (value) {
                                accum.push(value);
                            }
                        }
                    }
                }
            }
            return accum.join("\n");
        }
    }
}
export { Recorder };
