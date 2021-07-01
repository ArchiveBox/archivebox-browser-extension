<script>
  export let archiveMode

  import { v4 } from "uuid"
  import DomainList from "./DomainList.svelte"
  import DomainListStorage from "../../common/services/domainList"
  import { ListType } from "../../common/interfaces/domainList"
  import ChromeSyncStorage from "../../common/services/storage"

  const storage = new DomainListStorage(new ChromeSyncStorage())

  let allowlist = [ ]
  let blocklist = [ ]

  async function load() {
    allowlist = await storage.getList(ListType.Allowlist)
    blocklist = await storage.getList(ListType.Blocklist)
  }

  function onAdded(listType) {
    return async function(domain, isRegex) {
      await storage.addEntry({
        id: v4(),
        type: isRegex ? "regex" : "domain",
        value: domain
      }, listType)

      await load()
    }
  }

  function onRemoved(listType) {
    return async function(ids) {
      for (let i = 0; i < ids.length; i++) {
        await storage.removeEntry(ids[i], listType)
      }

      await load()
    }
  }

  function onCleared(listType) {
    return async function() {
      await storage.clearEntries(listType)
      await load()
    }
  }

  load()
</script>

<div class="lists">
  <div class="list" class:hidden={archiveMode !== 'allowlist'}>
    <h2>Archived Domains</h2>
    <p>
      Pages you visit on these domains will be sent to your ArchiveBox.
      Wildcard subdomains are allowed, e.g. <code>*.google.com</code>
    </p>

    <DomainList
      id="allowlist"
      options={allowlist}
      onAdded={onAdded(ListType.Allowlist)}
      onRemoved={onRemoved(ListType.Allowlist)}
      onCleared={onCleared(ListType.Allowlist)} />
  </div>

  <div class="list" class:hidden={archiveMode !== 'blocklist'}>
    <h2>Ignored Domains</h2>
    <p>
      Every page you visit <strong>except on these domains</strong> will be sent to your ArchiveBox.
      Wildcard subdomains are allowed, e.g. <code>*.google.com</code>
    </p>

    <DomainList
      id="blocklist"
      options={blocklist}
      onAdded={onAdded(ListType.Blocklist)}
      onRemoved={onRemoved(ListType.Blocklist)}
      onCleared={onCleared(ListType.Blocklist)} />
  </div>
</div>

<style>
  h2 {
    margin: 0;
  }

  p {
    margin-top: 5px;
  }

  .hidden {
    display: none;
  }
</style>