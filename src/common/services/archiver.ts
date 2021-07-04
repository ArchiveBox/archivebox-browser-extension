import IArchiver from "../interfaces/archiver"
import IDomainList, { ListType } from "../interfaces/domainList"
import IConfig, { GlobalConfigKey } from "../interfaces/config"
import { EventEmitter } from "events"

export const enum ConfigKey {
  ArchiveBoxUrl = "archiveBoxUrl",
  ArchiveBoxKey = "archiveBoxKey"
}

export default class ArchiveBoxArchiver extends EventEmitter implements IArchiver {
  private domainList: IDomainList
  private config: IConfig

  private urlQueue: string[] = [ ]
  private totalQueuedUrls = 0

  constructor(domainList: IDomainList, config: IConfig) {
    super()
    this.domainList = domainList
    this.config = config
  }
  
  async shouldArchive(url: string): Promise<boolean> {
    const mode = await this.config.get(GlobalConfigKey.ArchiveMode, "allowlist")

    if (mode === "allowlist")
      return await this.domainList.urlMatchesList(url, ListType.Allowlist)
    else if (mode === "blocklist")
      return !(await this.domainList.urlMatchesList(url, ListType.Blocklist))
  }

  async queueForArchival(url: string): Promise<void> {
    if (this.urlQueue.indexOf(url) !== -1) return
    this.urlQueue.push(url)
  }

  async submitQueue(): Promise<void> {
    if (this.urlQueue.length === 0) return
    this.sendUrls(this.urlQueue)
    this.urlQueue = [ ]
  }

  async archiveImmediately(url: string): Promise<void> {
    await this.sendUrls([ url ])
  }

  private addQueuedUrlCount(count: number) {
    this.totalQueuedUrls += count
    this.emit("queuedUrlsChanged", this.totalQueuedUrls)
  }

  private hasPermissions(permissions: chrome.permissions.Permissions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      chrome.permissions.contains(permissions, granted => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve(granted)
      })
    })
  }

  private async requestPermissionsForHost(host: string): Promise<boolean> {
    const perms: chrome.permissions.Permissions = {
      origins: [ `${host}/*` ]
    }

    const alreadyGranted = await this.hasPermissions(perms)
    if (alreadyGranted) return true

    return new Promise((resolve, reject) => {
      chrome.permissions.request(perms, granted => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError)
        resolve(granted)
      })
    })
  }

  private async sendUrls(urls: string[]): Promise<boolean> {
    this.addQueuedUrlCount(urls.length)

    const baseUrl = await this.config.get(GlobalConfigKey.ArchiveBoxBaseUrl, "")
    const tags = await this.config.get(GlobalConfigKey.Tags, "")

    if (baseUrl === "") return

    const granted = await this.requestPermissionsForHost(baseUrl)
    if (!granted) return false

    const body = new FormData()
    body.append("url", urls.join("\n"))
    body.append("tag", tags)
    body.append("depth", "0")
    body.append("parser", "url_list")

    try {
      await fetch(`${baseUrl}/add/`, {
        method: "post",
        credentials: "include",
        body
      })
    } finally {
      this.addQueuedUrlCount(-urls.length)
    }

    return true
  }
}