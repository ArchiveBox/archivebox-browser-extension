# Browser Git

isomorphic-git 1.43.0 (MIT) implements the Git smart-HTTP protocol, object and
pack parsing, checkout and index. memfs 4.80.0 (Apache-2.0) provides its public
filesystem interface in transient memory. No Git protocol parser is implemented
by this integration. Every transport exchange goes through ArchiveBox's shared
original-response capture/replay API.

The real `buffer` package is installed on `globalThis.Buffer`, as required by
isomorphic-git's documented [bundler setup](https://isomorphic-git.org/docs/en/quickstart-with-bundlers).
This applies in both the capture worker and offline viewer.

Repository URL normalization follows canonical abx-plugins
`git/on_Snapshot__34_git.finite.bg.py`. The root checkout fetches all branches
at depth one. Recursion reads gitlinks through `readTree`, parses `.gitmodules`
with upstream `GitConfigManager`, fetches missing pinned commits with
`singleBranch: true`, and verifies each checked-out SHA against its gitlink.
Non-HTTP submodule transports and cycles fail explicitly. Before success, the
same checkout is reconstructed using captured responses only and all file
object IDs/modes/sizes plus recursive submodule heads must match.

The unchanged canonical Git full/card HTML is in vendor/archivebox/plugins/git.
Its inline JavaScript is compiled in src/ui/git-template.js; only file inventory,
file URL lookup and saved-page loading are adapted. The requested Download
checkout action builds a ZIP on click with fflate's supported Unix file
attributes, including executable and symlink modes. This transient export
contains the native worktree and .git; these derived representations are never
persisted alongside the original HTTP bytes in the WACZ.
