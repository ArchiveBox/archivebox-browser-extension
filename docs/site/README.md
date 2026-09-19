# README website

The landing page is rendered directly from the repository's `README.md`. Edit that file to change its content; this directory contains only presentation, navigation, and screenshot gallery generation.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm screenshots
pnpm site:build
pnpm site:verify
```

The capture command uses the real extension and browser store pages and writes `screenshots/manifest.json` and PNG images. The build requires all expected views at desktop, tablet, and mobile sizes, and includes the capture version, revision, timestamp, and source links. It fails if any required view or image is absent. Both the captures and `_site/` are generated, ignored files; GitHub Pages publishes `_site/` as a build artifact.

For a server mounted at `/`, omit `--baseurl`. Repository-only relative links point to their source revision on GitHub; relative images are copied from the repository. Links under the canonical Pages URL are rewritten to the chosen base URL for local previews.
