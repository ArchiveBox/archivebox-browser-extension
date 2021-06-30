export default interface IArchiver {
  shouldArchive(url: string): Promise<boolean>
  queueForArchival(url: string): Promise<void>
  submitQueue(): Promise<void>
  archiveImmediately(url: string): Promise<void>
}