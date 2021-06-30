import IConfig from "../interfaces/config"
import IStorage from "../interfaces/storage"

export default class SyncedConfig implements IConfig {
  private storage: IStorage

  constructor(storage: IStorage) {
    this.storage = storage
  }

  get<T>(key: string, defaultValue: T): Promise<T> {
    return this.storage.get<T>(this.keyFor(key), defaultValue)
  }

  set<T>(key: string, value: T): Promise<void> {
    return this.storage.set(this.keyFor(key), value)
  }

  private keyFor(key: string): string {
    return `config_${key}`
  }
}