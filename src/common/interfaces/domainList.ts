export interface DomainEntry {
  id: string
  type: "domain" | "regex"
  value: string
}

export enum ListType {
  Allowlist = "allowlist",
  Blocklist = "blocklist"
}

export default interface IDomainList {
  urlMatchesList(url: string, list: ListType): Promise<boolean>
  getList(list: ListType): Promise<DomainEntry[]>
  addEntry(entry: DomainEntry, list: ListType): Promise<void>
  removeEntry(entryId: string, list: ListType): Promise<void>
  clearEntries(list: ListType): Promise<void>
}