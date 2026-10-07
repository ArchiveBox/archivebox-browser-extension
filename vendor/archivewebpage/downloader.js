// ArchiveWeb.page 595664ca4ae2f0073d883c3bea6011d51004e249; AGPL-3.0-or-later. See NOTICE.md.
import { makeZip } from "client-zip";
import { Deflate } from "pako";
import { v5 as uuidv5 } from "uuid";
import { createSHA256 } from "hash-wasm";
import { getSurt, WARCRecord, WARCSerializer } from "warcio";
import { getTSMillis, getStatusText, digestMessage, } from "@webrecorder/wabac/swlib";
const WACZ_VERSION = "1.1.1";
const SPLIT_REQUEST_Q_RX = /(.*?)[?&](?:__wb_method=|__wb_post=)[^&]+&(.*)/;
const LINES_PER_BLOCK = 1024;
const RESOURCE_BATCH_SIZE = LINES_PER_BLOCK * 8;
const DEFAULT_UUID_NAMESPACE = "f9ec3936-7f66-4461-bec4-34f4495ea242";
const DATAPACKAGE_FILENAME = "datapackage.json";
const DIGEST_FILENAME = "datapackage-digest.json";
const encoder = new TextEncoder();
const EMPTY = new Uint8Array([]);
async function* getPayload(payload) {
    yield payload;
}
async function* hashingGen(gen, stats, hasher, sizeCallback, zipMarker) {
    stats.size = 0;
    hasher.init();
    if (zipMarker) {
        yield zipMarker;
    }
    for await (let chunk of gen) {
        if (typeof chunk === "string") {
            chunk = encoder.encode(chunk);
        }
        yield chunk;
        stats.size += chunk.byteLength;
        if (sizeCallback) {
            sizeCallback(chunk.byteLength);
        }
        hasher.update(chunk);
    }
    if (zipMarker) {
        yield zipMarker;
    }
    stats.hash = hasher.digest("hex");
}
class Downloader {
    db;
    pageList;
    collId;
    metadata;
    gzip;
    markers;
    warcName;
    alreadyDecoded;
    softwareString;
    uuidNamespace;
    createdDateDt;
    createdDate;
    modifiedDate;
    format;
    warcVersion;
    digestOpts;
    filename;
    signer;
    offset = 0;
    firstResources = [];
    textResources = [];
    cdxjLines = [];
    indexLines = [];
    digestsVisted = {};
    fileHasher = null;
    recordHasher = null;
    datapackageDigest = "";
    fileStats = [];
    hashType = "";
    lastUrl;
    lastPageId;
    constructor({ coll, format = "wacz", filename, pageList, signer, softwareString, gzip = true, uuidNamespace, markers, }) {
        this.db = coll.store;
        this.pageList = pageList || null;
        this.collId = coll.name;
        this.metadata = coll.config.metadata || {};
        this.gzip = gzip;
        this.markers = markers || {};
        this.warcName = this.gzip ? "data.warc.gz" : "data.warc";
        this.alreadyDecoded = !coll.config["decode"] && !coll.config["loadUrl"];
        this.softwareString = softwareString || "ArchiveWeb.page";
        this.uuidNamespace = uuidNamespace || DEFAULT_UUID_NAMESPACE;
        this.createdDateDt = new Date(coll.config.ctime);
        this.createdDate = this.createdDateDt.toISOString();
        this.modifiedDate = coll.config.metadata.mtime
            ? new Date(coll.config.metadata.mtime).toISOString()
            : null;
        this.format = format;
        this.warcVersion = format === "warc1.0" ? "WARC/1.0" : "WARC/1.1";
        if (format === "warc1.0") {
            this.digestOpts = { algo: "sha-1", prefix: "sha1:", base32: true };
        }
        else {
            this.digestOpts = { algo: "sha-256", prefix: "sha256:" };
        }
        if (!filename && coll.config.metadata.title) {
            filename = encodeURIComponent(coll.config.metadata.title.toLowerCase().replace(/\s/g, "-"));
        }
        if (!filename) {
            filename = "webarchive";
        }
        this.filename = filename;
        this.signer = signer || null;
    }
    async download(sizeCallback = null) {
        switch (this.format) {
            case "wacz":
                return this.downloadWACZ(this.filename, sizeCallback);
            case "warc":
            case "warc1.0":
                return this.downloadWARC(this.filename, sizeCallback);
            default:
                return { error: "invalid 'format': must be wacz or warc" };
        }
    }
    downloadWARC(filename, sizeCallback = null) {
        filename = (filename || "webarchive").split(".")[0] + ".warc";
        const dl = this;
        const rs = new ReadableStream({
            async start(controller) {
                await dl.queueWARC(controller, filename, sizeCallback);
            },
        });
        const headers = {
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Type": "application/octet-stream",
        };
        const resp = new Response(rs, { headers });
        resp.filename = filename;
        return resp;
    }
    async loadResourcesBlock(start = []) {
        return await this.db.db.getAll("resources", IDBKeyRange.lowerBound(start, true), RESOURCE_BATCH_SIZE);
    }
    async *iterResources(resources) {
        let start = [];
        while (resources.length) {
            const last = resources[resources.length - 1];
            if (this.pageList) {
                resources = resources.filter((res) => this.pageList.includes(res.pageId || ""));
            }
            yield* resources;
            start = [last.url, last.ts];
            resources = await this.loadResourcesBlock(start);
        }
    }
    async queueWARC(controller, filename, sizeCallback) {
        this.firstResources = await this.loadResourcesBlock();
        for await (const chunk of this.generateWARC(filename)) {
            controller.enqueue(chunk);
            if (sizeCallback) {
                sizeCallback(chunk.length);
            }
        }
        for await (const chunk of this.generateTextWARC(filename)) {
            controller.enqueue(chunk);
            if (sizeCallback) {
                sizeCallback(chunk.length);
            }
        }
        controller.close();
    }
    addFile(zip, filename, generator, sizeCallback) {
        const stats = { filename, size: 0 };
        if (filename !== DATAPACKAGE_FILENAME && filename !== DIGEST_FILENAME) {
            this.fileStats.push(stats);
        }
        zip.push({
            name: filename,
            lastModified: this.createdDateDt,
            input: hashingGen(generator, stats, this.fileHasher, sizeCallback, this.markers.ZIP),
        });
    }
    // Host-owned original evidence may live outside WARC. Keep ZIP hashing and
    // final manifest generation in the upstream stream.
    async addExtraFiles(_zip, _sizeCallback) {}
    shouldExportWARCResource(_resource) { return true; }
    recordDigest(data) {
        this.recordHasher.init();
        this.recordHasher.update(data);
        return this.hashType + ":" + this.recordHasher.digest("hex");
    }
    getWARCRecordUUID(name) {
        return `<urn:uuid:${uuidv5(name, this.uuidNamespace)}>`;
    }
    async downloadWACZ(filename, sizeCallback) {
        filename = (filename || "webarchive").split(".")[0] + ".wacz";
        this.fileHasher = await createSHA256();
        this.recordHasher = await createSHA256();
        this.hashType = "sha256";
        const zip = [];
        this.firstResources = await this.loadResourcesBlock();
        await this.addExtraFiles(zip, sizeCallback);
        this.addFile(zip, "pages/pages.jsonl", this.generatePages(), sizeCallback);
        this.addFile(zip, `archive/${this.warcName}`, this.generateWARC(filename + `#/archive/${this.warcName}`, true), sizeCallback);
        if (this.firstResources.length < 2 * LINES_PER_BLOCK) {
            this.addFile(zip, "indexes/index.cdx", this.generateCDX(), sizeCallback);
        }
        else {
            this.addFile(zip, "indexes/index.cdx.gz", this.generateCompressedCDX("index.cdx.gz"), sizeCallback);
            this.addFile(zip, "indexes/index.idx", this.generateIDX(), sizeCallback);
        }
        this.addFile(zip, DATAPACKAGE_FILENAME, this.generateDataPackage(), sizeCallback);
        this.addFile(zip, DIGEST_FILENAME, this.generateDataManifest(), sizeCallback);
        const headers = {
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Type": "application/zip",
        };
        const rs = makeZip(zip);
        const response = new Response(rs, { headers });
        response.filename = filename;
        return response;
    }
    async *generateWARC(filename, digestRecordAndCDX = false) {
        try {
            let offset = 0;
            if (filename) {
                const warcinfo = await this.createWARCInfo(filename);
                yield warcinfo;
                offset += warcinfo.length;
            }
            if (this.markers.WARC_GROUP) {
                yield this.markers.WARC_GROUP;
            }
            for await (const res of this.iterResources(this.firstResources)) {
                if (!this.shouldExportWARCResource(res)) continue;
                const resource = res;
                resource.offset = offset;
                const records = await this.createWARCRecord(resource);
                if (!records) {
                    resource.skipped = true;
                    continue;
                }
                const responseData = { length: 0 };
                yield* this.emitRecord(records[0], digestRecordAndCDX, responseData);
                offset += responseData.length;
                resource.length = responseData.length;
                if (digestRecordAndCDX && !resource.recordDigest) {
                    resource.recordDigest = responseData.digest;
                }
                if (records.length > 1) {
                    const requestData = { length: 0 };
                    yield* this.emitRecord(records[1], false, requestData);
                    offset += requestData.length;
                }
                if (digestRecordAndCDX) {
                    this.cdxjLines.push(this.getCDXJ(resource, this.warcName));
                }
                if (this.markers.WARC_GROUP) {
                    yield this.markers.WARC_GROUP;
                }
            }
        }
        catch (e) {
            throw e;
        }
    }
    async *emitRecord(record, doDigest, output) {
        const opts = { gzip: this.gzip, digest: this.digestOpts };
        const s = new WARCSerializer(record, opts);
        const chunks = [];
        if (doDigest) {
            this.recordHasher.init();
        }
        for await (const chunk of s) {
            if (doDigest) {
                this.recordHasher.update(chunk);
            }
            chunks.push(chunk);
            output.length += chunk.length;
        }
        if (doDigest) {
            output.digest = this.hashType + ":" + this.recordHasher.digest("hex");
        }
        if (!this.gzip &&
            this.markers.WARC_PAYLOAD &&
            record.warcType !== "request" &&
            (chunks.length === 5 || chunks.length === 4)) {
            if (chunks.length === 5) {
                yield chunks[0];
                yield chunks[1];
                yield chunks[2];
                yield this.markers.WARC_PAYLOAD;
                if (chunks[3].length) {
                    yield chunks[3];
                    yield this.markers.WARC_PAYLOAD;
                }
                yield chunks[4];
            }
            else {
                yield chunks[0];
                yield chunks[1];
                yield this.markers.WARC_PAYLOAD;
                if (chunks[2].length) {
                    yield chunks[2];
                    yield this.markers.WARC_PAYLOAD;
                }
                yield chunks[3];
            }
        }
        else {
            for (const chunk of chunks) {
                yield chunk;
            }
        }
    }
    async *generateTextWARC(filename) {
        try {
            let offset = 0;
            if (filename) {
                const warcinfo = await this.createWARCInfo(filename);
                yield warcinfo;
                offset += warcinfo.length;
            }
            for (const resource of this.textResources) {
                resource.offset = offset;
                const chunk = await this.createTextWARCRecord(resource);
                yield chunk;
                offset += chunk.length;
                resource.length = chunk.length;
            }
        }
        catch (e) {
            throw e;
        }
    }
    getCDXJ(resource, filename) {
        const data = {
            url: resource.url,
            digest: resource.digest,
            mime: resource.mime,
            offset: resource.offset,
            length: resource.length,
            recordDigest: resource.recordDigest,
            status: resource.status,
        };
        if (filename) {
            data.filename = filename;
        }
        if (resource.method && resource.method !== "GET") {
            const m = resource.url.match(SPLIT_REQUEST_Q_RX);
            if (m) {
                data.url = m[1];
                data.requestBody = m[2];
            }
            data.method = resource.method;
        }
        return `${getSurt(resource.url)} ${resource.timestamp} ${JSON.stringify(data)}\n`;
    }
    *generateCDX() {
        this.cdxjLines.sort();
        yield* this.cdxjLines;
    }
    *generateCompressedCDX(filename) {
        let offset = 0;
        let chunkDeflater = null;
        let count = 0;
        let key = "";
        const dl = this;
        const finishChunk = () => {
            const data = chunkDeflater.result;
            const length = data.length;
            const digest = dl.recordDigest(data);
            const idx = key + " " + JSON.stringify({ offset, length, digest, filename });
            dl.indexLines.push(idx);
            offset += length;
            chunkDeflater = null;
            count = 0;
            key = "";
            return data;
        };
        for (const cdx of this.generateCDX()) {
            if (!chunkDeflater) {
                chunkDeflater = new Deflate({ gzip: true });
            }
            if (!key) {
                key = cdx.split(" {", 1)[0] || "";
            }
            if (++count === LINES_PER_BLOCK) {
                chunkDeflater.push(cdx, true);
                yield finishChunk();
            }
            else {
                chunkDeflater.push(cdx);
            }
        }
        if (chunkDeflater) {
            chunkDeflater.push(EMPTY, true);
            yield finishChunk();
        }
    }
    async *generateDataManifest() {
        const hash = this.datapackageDigest;
        const path = DATAPACKAGE_FILENAME;
        const data = {
            path,
            hash,
        };
        if (this.signer) {
            try {
                data.signedData = await this.signer.sign(hash, this.createdDate);
                this.signer.close();
                this.signer = null;
            }
            catch (e) {
                console.log(e);
            }
        }
        const res = JSON.stringify(data, null, 2);
        yield res;
    }
    // Host extension seam: additive metadata is serialized and hashed with the
    // standard package, never appended after the manifest digest is generated.
    getDataPackageMetadata() {
        return {};
    }
    async *generateDataPackage() {
        const root = {
            profile: "data-package",
            resources: this.fileStats.map((stats) => {
                const path = stats.filename;
                return {
                    // WACZ members are files, not Frictionless metadata documents
                    // inferred from JSON keys such as "steps" or "resources".
                    type: "file",
                    name: path.slice(path.lastIndexOf("/") + 1),
                    path,
                    hash: this.hashType + ":" + stats.hash,
                    bytes: stats.size,
                };
            }),
            wacz_version: WACZ_VERSION,
            software: this.softwareString,
            created: this.createdDate,
        };
        if (this.metadata.title) {
            root.title = this.metadata.title;
        }
        if (this.metadata.desc) {
            root.description = this.metadata.desc;
        }
        if (this.modifiedDate) {
            root.modified = this.modifiedDate;
        }
        for (const [key, value] of Object.entries(this.getDataPackageMetadata())) {
            if (key in root) {
                throw new Error(`Custom datapackage metadata conflicts with standard field: ${key}`);
            }
            root[key] = value;
        }
        const datapackageText = JSON.stringify(root, null, 2);
        this.datapackageDigest = this.recordDigest(datapackageText);
        yield datapackageText;
    }
    async *generatePages() {
        const pageIter = (this.pageList
            ? await this.db.getPages(this.pageList)
            : await this.db.getAllPages());
        yield JSON.stringify({
            format: "json-pages-1.0",
            id: "pages",
            title: "All Pages",
            hasText: true,
        });
        for (const page of pageIter) {
            const ts = new Date(page.ts).toISOString();
            const pageData = {
                title: page.title,
                url: page.url,
                id: page.id,
                size: page.size,
                ts,
            };
            if (page.favIconUrl) {
                pageData.favIconUrl = page.favIconUrl;
            }
            if (page.text) {
                pageData.text = page.text;
            }
            yield "\n" + JSON.stringify(pageData);
            if (page.text) {
                this.textResources.push({
                    url: page.url,
                    ts: page.ts,
                    text: page.text,
                    pageId: page.id,
                    digest: "",
                });
            }
        }
    }
    async *generateIDX() {
        yield this.indexLines.join("\n");
    }
    async createWARCInfo(filename) {
        const warcVersion = this.warcVersion;
        const type = "warcinfo";
        const info = {
            software: this.softwareString,
            format: warcVersion === "WARC/1.0"
                ? "WARC File Format 1.0"
                : "WARC File Format 1.1",
            isPartOf: this.metadata["title"] || this.collId,
        };
        const warcHeaders = {
            "WARC-Record-ID": this.getWARCRecordUUID(JSON.stringify(info)),
        };
        const date = this.createdDate;
        const record = WARCRecord.createWARCInfo({ filename, type, date, warcHeaders, warcVersion }, info);
        const buffer = await WARCSerializer.serialize(record, {
            gzip: this.gzip,
            digest: this.digestOpts,
        });
        return buffer;
    }
    fixupHttpHeaders(headersMap, length, method = "GET", isRevisit = false) {
        const numHeaders = this.alreadyDecoded ? 3 : 1;
        let count = 0;
        for (const [name] of Object.entries(headersMap)) {
            const lowerName = name.toLowerCase();
            switch (lowerName) {
                case "content-encoding":
                case "transfer-encoding":
                    if (this.alreadyDecoded && method !== "HEAD") {
                        headersMap["x-orig-" + name] = headersMap[name];
                        delete headersMap[name];
                        ++count;
                    }
                    break;
                case "content-length":
                    // A captured HEAD advertises the GET entity length while
                    // carrying no body; preserve its observed HTTP semantics.
                    if (method !== "HEAD" && !isRevisit) headersMap[name] = "" + length;
                    ++count;
                    break;
            }
            if (count === numHeaders) {
                break;
            }
        }
    }
    async createWARCRecord(resource) {
        let url = resource.url;
        const date = new Date(resource.ts).toISOString();
        resource.timestamp = getTSMillis(date);
        const httpHeaders = resource.respHeaders || {};
        const warcVersion = this.warcVersion;
        const pageId = resource.pageId;
        let payload = resource.payload;
        let type;
        let refersToUrl, refersToDate;
        let refersToDigest;
        let storeDigest = null;
        let method = "GET";
        let requestBody;
        if (resource.method &&
            resource.method !== "GET" &&
            resource.requestBody &&
            resource.requestUrl) {
            requestBody =
                typeof resource.requestBody === "string"
                    ? encoder.encode(resource.requestBody)
                    : resource.requestBody;
            method = resource.method;
            url = resource.requestUrl;
        }
        else {
            requestBody = new Uint8Array([]);
        }
        const extraOpts = resource.extraOpts;
        const isResource = extraOpts?.resource;
        if (!resource.digest && resource.payload) {
            resource.digest = await digestMessage(resource.payload, "sha-256");
        }
        const digestOriginal = this.digestsVisted[resource.digest];
        if (isResource) delete extraOpts?.resource;
        if (resource.digest && digestOriginal) {
            type = "revisit";
            resource.mime = "warc/revisit";
            payload = EMPTY;
            refersToUrl = digestOriginal.url;
            refersToDate = digestOriginal.date;
            refersToDigest = digestOriginal.payloadDigest || resource.digest;
        }
        else if (resource.origURL && resource.origTS && !isResource) {
            if (!resource.digest || !digestOriginal) {
                return null;
            }
            type = "revisit";
            resource.mime = "warc/revisit";
            payload = EMPTY;
            refersToUrl = resource.origURL;
            refersToDate = new Date(resource.origTS).toISOString();
            refersToDigest = digestOriginal.payloadDigest || resource.digest;
        }
        else {
            type = isResource ? "resource" : "response";
            if (!payload) {
                payload = (await this.db.loadPayload(resource, {}));
            }
            if (!payload) {
                return null;
            }
            // The payload store already deduplicates all methods and evidence.
            // WARC references identify the original literal target URI. POST
            // request data belongs only in its CDX lookup key and request record.
            storeDigest = { url, date };
            this.digestsVisted[resource.digest] = storeDigest;
        }
        const status = resource.status || 200;
        const statusText = resource.statusText || getStatusText(status);
        const statusline = `HTTP/1.1 ${status} ${statusText}`;
        const responseRecordId = this.getWARCRecordUUID(type + ":" + resource.timestamp + "/" + resource.url);
        const warcHeaders = {
            "WARC-Record-ID": responseRecordId,
        };
        if (storeDigest) storeDigest.recordId = responseRecordId;
        if (digestOriginal?.recordId) warcHeaders["WARC-Refers-To"] = digestOriginal.recordId;
        if (pageId) {
            warcHeaders["WARC-Page-ID"] = pageId;
        }
        if (extraOpts && Object.keys(extraOpts).length) {
            if (extraOpts.detectedCT) {
                warcHeaders["WARC-Identified-Payload-Type"] = extraOpts.detectedCT;
                delete extraOpts.detectedCT;
            }
            warcHeaders["WARC-JSON-Metadata"] = JSON.stringify(extraOpts);
        }
        if (refersToDigest) {
            warcHeaders["WARC-Payload-Digest"] = refersToDigest;
        }
        let record;
        if (type === "resource") {
            if (resource.mime) {
                warcHeaders["Content-Type"] = resource.mime;
            }
            record = WARCRecord.create({ url, date, warcHeaders, warcVersion, type }, getPayload(payload));
        }
        else {
            this.fixupHttpHeaders(httpHeaders, payload.length, method, type === "revisit");
            record = WARCRecord.create({
                url,
                date,
                type,
                warcVersion,
                warcHeaders,
                statusline,
                httpHeaders,
                refersToUrl,
                refersToDate,
            }, getPayload(payload));
        }
        if (!resource.digest && record.warcPayloadDigest) {
            resource.digest = record.warcPayloadDigest;
        }
        if (storeDigest && record.warcPayloadDigest) {
            storeDigest.payloadDigest = record.warcPayloadDigest;
        }
        this.lastPageId = pageId;
        this.lastUrl = url;
        const records = [record];
        if (!isResource && resource.reqHeaders) {
            const type = "request";
            const reqWarcHeaders = {
                "WARC-Record-ID": this.getWARCRecordUUID(type + ":" + resource.timestamp + "/" + resource.url),
                "WARC-Concurrent-To": responseRecordId,
            };
            if (pageId) {
                reqWarcHeaders["WARC-Page-ID"] = pageId;
            }
            const urlParsed = new URL(url);
            const statusline = `${method} ${url.slice(urlParsed.origin.length)} HTTP/1.1`;
            const reqRecord = WARCRecord.create({
                url,
                date,
                warcVersion,
                type,
                warcHeaders: reqWarcHeaders,
                httpHeaders: resource.reqHeaders,
                statusline,
            }, getPayload(requestBody));
            records.push(reqRecord);
        }
        return records;
    }
    async createTextWARCRecord(resource) {
        const date = new Date(resource.ts).toISOString();
        const timestamp = getTSMillis(date);
        resource.timestamp = timestamp;
        const url = `urn:text:${timestamp}/${resource.url}`;
        resource.url = url;
        const type = "resource";
        const warcHeaders = { "Content-Type": 'text/plain; charset="UTF-8"' };
        const warcVersion = this.warcVersion;
        const payload = getPayload(encoder.encode(resource.text));
        const record = WARCRecord.create({ url, date, warcHeaders, warcVersion, type }, payload);
        const buffer = await WARCSerializer.serialize(record, {
            gzip: this.gzip,
            digest: this.digestOpts,
        });
        if (!resource.digest && record.warcPayloadDigest) {
            resource.digest = record.warcPayloadDigest;
        }
        return buffer;
    }
}
export { Downloader };
