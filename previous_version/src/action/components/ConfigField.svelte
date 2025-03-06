<script>
  export let friendlyName
  export let configKey
  export let placeholder = ""

  import SyncedConfig from "../../common/services/config"
  import ChromeSyncStorage from "../../common/services/storage"

  const config = new SyncedConfig(new ChromeSyncStorage())

  let value

  async function updateValue() {
    await config.set(configKey, value)
  }

  async function load() {
    const initialValue = await config.get(configKey)
    value = initialValue
  }

  load()
</script>

<div>
  <label for="config_{configKey}">{friendlyName}</label><br>
  <input id="config_{configKey}" bind:value={value} on:blur={updateValue} {placeholder}>
</div>

<style>
  div {
    margin-bottom: 3px;
  }

  label {
    font-weight: bold;
  }

  input {
    margin-top: 3px;
    width: 100%;
  }
</style>