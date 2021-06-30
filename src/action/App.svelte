<script>
  import DomainLists from "./components/DomainLists.svelte"
  import Config from "./components/Config.svelte"

  let archiveMode

  function onArchiveModeChanged(newMode) {
    archiveMode = newMode
  }
</script>

<div class="main">
  <Config {onArchiveModeChanged} />
  <hr>
  <DomainLists {archiveMode} />
</div>

<style>
  * {
    box-sizing: border-box;
  }

  .main {
    width: 400px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    color: #2d2d2d;
  }

  hr {
    margin: 10px 0;
    border: none;
    border-top: 1px solid lightgray;
  }
</style>