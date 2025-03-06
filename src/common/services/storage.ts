import IStorage from "../interfaces/storage"

export default class ChromeSyncStorage implements IStorage {
  async get<T>(key: string, defaultValue: T): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, items => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve(items[key] || defaultValue)
      })
    })
  }

  async set<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({
        [key]: value
      }, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve()
      })
    })
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve()
      })
    })
  }
}
