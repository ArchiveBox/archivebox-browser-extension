// ArchiveWeb.page 595664ca4ae2f0073d883c3bea6011d51004e249; AGPL-3.0-or-later. See NOTICE.md.
export function setLocalOption(name, value) {
    if (globalThis.chrome?.storage) {
        return new Promise((resolve) => {
            const data = {};
            data[name] = value;
            globalThis.chrome.storage.local.set(data, () => resolve());
        });
    }
    if (globalThis.localStorage) {
        return Promise.resolve(localStorage.setItem(name, value));
    }
    return Promise.reject();
}
export function getLocalOption(name) {
    if (globalThis.chrome?.storage) {
        return new Promise((resolve) => {
            globalThis.chrome.storage.local.get(name, (res) => {
                resolve(res[name]);
            });
        });
    }
    if (globalThis.localStorage) {
        return Promise.resolve(localStorage.getItem(name));
    }
    return Promise.reject(null);
}
export function removeLocalOption(name) {
    if (globalThis.chrome?.storage) {
        return new Promise((resolve) => {
            globalThis.chrome.storage.local.remove(name, () => {
                resolve();
            });
        });
    }
    if (globalThis.localStorage) {
        return Promise.resolve(localStorage.removeItem(name));
    }
    return Promise.reject();
}
