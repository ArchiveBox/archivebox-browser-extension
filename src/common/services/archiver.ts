import IArchiver from "../interfaces/archiver"
import IDomainList, { ListType } from "../interfaces/domainList"
import IConfig, { GlobalConfigKey } from "../interfaces/config"

export const enum ConfigKey {
  ArchiveBoxUrl = "archiveBoxUrl",
  ArchiveBoxKey = "archiveBoxKey"
}

export default class ArchiveBoxArchiver implements IArchiver {
  private domainList: IDomainList
  private config: IConfig

  private urlQueue: string[] = [ ]

  constructor(domainList: IDomainList, config: IConfig) {
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

    console.log(url)
  }

  async submitQueue(): Promise<void> {
    console.warn("Queue submittal not actually implemented yet!")
    this.urlQueue = [ ]
  }

  async archiveImmediately(url: string): Promise<void> {
    console.log("Archiving url immediately:", url)
  }
}