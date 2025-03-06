<script>
  export let options = [ ]
  export let onAdded
  export let onRemoved
  export let onCleared
  export let id

  let isRegex
  let domainInput = ""
  let selectedEntries
  let verifyClear = false

  function addDomain() {
    if (domainInput.trim() === "") return
    onAdded(domainInput, isRegex)
    domainInput = ""
  }

  function removeDomain() {
    onRemoved(selectedEntries)
  }

  function maybeClear() {
    if (verifyClear) {
      onCleared()
      verifyClear = false
    } else {
      verifyClear = true
    }
  }

  function handleKeydown(e) {
    if (e.code === "Enter") addDomain()
  }
</script>

<div class="list">
  <div class="add-remove">
    <input type="checkbox" id="isRegex_{id}" bind:checked={isRegex}> <label for="isRegex_{id}">Regex?</label>
    <input
      type="text"
      class="domain-input"
      placeholder="{isRegex ? "Regex" : "Domain"} to add"
      bind:value={domainInput}
      on:keydown={handleKeydown}>
    <button on:click={addDomain}>+</button>
    <button on:click={removeDomain}>-</button>
    <button on:click={maybeClear}>{verifyClear ? "Really?" : "Clear"}</button>
  </div>

  <select multiple bind:value={selectedEntries}>
    {#each options as { id, value, type } (id) }
      <option value="{id}" class:is-regex={type === "regex"}>{value}</option>
    {/each}
  </select>
</div>

<style>
  select {
    width: 100%;
    min-height: 150px;
  }

  @media(prefers-color-scheme: dark) {
    select {
      background: #3c3c3c;
      color: #FFF;
    }
  }

  option {
    padding: 5px;
  }

  .add-remove {
    margin-bottom: 5px;
    display: flex;
    align-items: center;
  }

  .domain-input {
    flex-grow: 1;
    margin: 0 5px;
  }

  button:not(:last-of-type) {
    margin-right: 5px;
  }

  label {
    font-weight: bold;
  }

  .is-regex {
    color: #3bcfff;
  }
</style>