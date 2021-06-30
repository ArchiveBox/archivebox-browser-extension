import IDomainList, { DomainEntry, ListType } from "../interfaces/domainList"
import IStorage from "../interfaces/storage"
import Matcher from "wildcard-domain-matcher"

export default class DomainList implements IDomainList {
  private storage: IStorage
  private matcher: Matcher = new Matcher()

  constructor(storage: IStorage) {
    this.storage = storage
  }
  
  async urlMatchesList(url: string, list: ListType): Promise<boolean> {
    const entries = await this.getList(list)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (this.urlMatchesEntry(url, entry)) return true
    }

    return false
  }

  async getList(list: ListType): Promise<DomainEntry[]> {
    return await this.storage.get<DomainEntry[]>(this.keyFor(list), [ ])
  }

  async addEntry(entry: DomainEntry, list: ListType): Promise<void> {
    const oldList = await this.getList(list)
    oldList.push(entry)
    await this.storage.set(this.keyFor(list), oldList)
  }

  async removeEntry(entryId: string, list: ListType): Promise<void> {
    const oldList = await this.getList(list)
    const idx = oldList.findIndex(entry => entry.id === entryId)
    if (idx === -1) return

    oldList.splice(idx, 1)
    await this.storage.set(this.keyFor(list), oldList)
  }

  async clearEntries(list: ListType): Promise<void> {
    await this.storage.set(this.keyFor(list), [ ])
  }

  private urlMatchesEntry(url: string, entry: DomainEntry): boolean {
    if (entry.type === "domain") {
      const whatwgUrl = new URL(url)
      return this.matcher.test(whatwgUrl.host.toLowerCase(), entry.value.toLowerCase())
    } else {
      const regex = new RegExp(entry.value, "i")
      return regex.test(url)
    }
  }

  private keyFor(list: ListType): string {
    return `domainList_${list}`
  }
}