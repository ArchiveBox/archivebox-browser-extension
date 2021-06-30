import ArchiveBoxArchiver from "../common/services/archiver"
import SyncedConfig from "../common/services/config"
import ChromeSyncStorage from "../common/services/storage"
import DomainList from "../common/services/domainList"

async function main() {
  const storage = new ChromeSyncStorage()
  const config = new SyncedConfig(storage)
  const domainList = new DomainList(storage)

  const archiver = new ArchiveBoxArchiver(domainList, config)

  chrome.history.onVisited.addListener(async historyItem => {
    const shouldArchive = await archiver.shouldArchive(historyItem.url)
    if (!shouldArchive) return

    await archiver.queueForArchival(historyItem.url)
  })

  await chrome.alarms.clearAll()

  chrome.alarms.create({
    periodInMinutes: 15
  })

  chrome.alarms.onAlarm.addListener(async () => {
    await archiver.submitQueue()
  })

  chrome.contextMenus.create({
    id: "archivePage",
    title: "Archive Current Page",
    contexts: [ "all" ],
    onclick: async (info) => {
      await archiver.archiveImmediately(info.pageUrl)
    }
  })

  chrome.contextMenus.create({
    id: "archiveLink",
    title: "Archive Link",
    contexts: [ "link" ],
    onclick: async (info) => {
      await archiver.archiveImmediately(info.linkUrl)
    }
  })
}

main()

export default main