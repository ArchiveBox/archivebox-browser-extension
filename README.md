# 🗃 ArchiveBox Exporter Browser Extension

This is a browser extension (works in Chrome, Firefox, and Chrome-like browsers) that lets you automatically send pages from domains you specify to your ArchiveBox instance. This has a couple of benefits:

- You have a fulltext search of your browsing history ready at your fingertips
- Prevent link rot for important information!
- Access important information even if you're offline

**Warning:** This extension is not yet complete! I am waiting for ArchiveBox to implement an API that can accept URLs to archive. But at the moment, everything else is ready! You can check the status in [this GitHub issue](https://github.com/ArchiveBox/ArchiveBox/issues/577#issuecomment-870974915).

I've forked ArchiveBox and added a temporary API endpoint for adding URLs while ArchiveBox works to officially add an API. You can see the setup instructions [here](https://github.com/tjhorner/archivebox-exporter/wiki/Setup).

## Features

- Different archive modes
  - Allowlist mode doesn't archive pages by default, and lets you specify domains or regexes to archive
  - Blocklist mode archives all visited pages by default, but lets you specify domains or regexes to not archive
- Archive any arbitrary page with the "Archive Current Page" context menu item
- Archive any link with the "Archive Link" context menu item

## License

MIT