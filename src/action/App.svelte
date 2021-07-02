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
  :global(*) {
    box-sizing: border-box;
  }

  :global(html), :global(body) {
    margin: 0;
  }

  .main {
    width: 400px;
    padding: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  }

  :global(a) {
    color: #3bcfff;
  }

  hr {
    margin: 10px 0;
    border: none;
    border-top: 1px solid lightgray;
  }

  @media(prefers-color-scheme: dark) {
    .main {
      background: #2d2d2d;
      color: #FFF;
    }

    hr {
      border-color: #444444;
    }
  }
</style>