<script>
  export let onArchiveModeChanged

  import { GlobalConfigKey } from "../../common/interfaces/config"
  import SyncedConfig from "../../common/services/config"
  import ChromeSyncStorage from "../../common/services/storage"
  import ConfigField from "./ConfigField.svelte"

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
  <details>
    <summary>Config</summary>

    <p>
      <a href="https://github.com/tjhorner/archivebox-exporter/wiki/Setup" target="_blank">Need help?</a>
    </p>

    <div>
      <label for={GlobalConfigKey.ArchiveMode}>Archive Mode</label><br>
      <!-- svelte-ignore a11y-no-onchange -->
      <select id={GlobalConfigKey.ArchiveMode} bind:value={selectedArchiveMode} on:change={changeArchiveMode}>
        <option value="allowlist">Allowlist (don't archive by default)</option>
        <option value="blocklist">Blocklist (archive by default)</option>
      </select>
    </div>

    <ConfigField
      configKey={GlobalConfigKey.ArchiveBoxBaseUrl}
      friendlyName="ArchiveBox Base URL" />
  </details>
</div>

<style>
  summary {
    font-size: 1.2em;
    font-weight: bold;
    cursor: pointer;
  }

  a {
    color: lightblue;
  }

  label {
    font-weight: bold;
  }

  select {
    margin-top: 3px;
  }
  
  div {
    margin-bottom: 3px;
  }

  p {
    margin: 5px 0;
  }
</style>