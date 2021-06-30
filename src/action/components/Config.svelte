<script>
  export let onArchiveModeChanged

  import { GlobalConfigKey } from "../../common/interfaces/config"
  import SyncedConfig from "../../common/services/config"
  import ChromeSyncStorage from "../../common/services/storage"

  const config = new SyncedConfig(new ChromeSyncStorage())

  let selectedArchiveMode

  async function changeArchiveMode() {
    await config.set(GlobalConfigKey.ArchiveMode, selectedArchiveMode)
    onArchiveModeChanged(selectedArchiveMode)
  }

  async function load() {
    selectedArchiveMode = await config.get(GlobalConfigKey.ArchiveMode, "allowlist")
    onArchiveModeChanged(selectedArchiveMode)
  }

  load()
</script>

<div class="config">
  <h2>Config</h2>

  <div>
    <label for={GlobalConfigKey.ArchiveMode}>Archive Mode</label><br>
    <!-- svelte-ignore a11y-no-onchange -->
    <select id={GlobalConfigKey.ArchiveMode} bind:value={selectedArchiveMode} on:change={changeArchiveMode}>
      <option value="allowlist">Allowlist (don't archive by default)</option>
      <option value="blocklist">Blocklist (archive by default)</option>
    </select>
  </div>
</div>

<style>
  h2 {
    margin-top: 0;
    margin-bottom: 10px;
  }

  label {
    font-weight: bold;
  }

  select {
    margin-top: 3px;
  }
</style>