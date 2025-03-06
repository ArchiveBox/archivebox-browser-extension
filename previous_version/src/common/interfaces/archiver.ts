import { EventEmitter } from "events"

export default interface IArchiver extends EventEmitter {
  shouldArchive(url: string): Promise<boolean>
  queueForArchival(url: string): Promise<void>
  submitQueue(): Promise<void>
  archiveImmediately(url: string): Promise<void>
}