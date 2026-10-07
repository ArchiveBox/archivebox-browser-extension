import { type AbstractBehavior, type Context } from "../lib/behavior";
import { getState } from "../lib/utils";

type YoutubeState = {
  videos: number;
  videoTab: number;
  shorts: number;
  shortTab: number;
  playlistTab: number;
  playlists: number;
  fullPlaylists: number;
  playlistVideos: number;
};

const Q = {
  playlistLink:
    "//a[contains(@class, 'ytAttributedStringLink' and starts-with(@href, '/playlist'))]",
  playlistVideoLink:
    "//div[@id='contents']//a[starts-with(@href, '/watch') and not(@aria-hidden='true')]",
  videoLink:
    "//a[contains(@class, 'ytLockupMetadataViewModelTitle') and starts-with(@href, '/watch')]",
  shortLink:
    "//a[contains(@class, 'reel-item-endpoint') and starts-with(@href, '/shorts')]",
};

export class YoutubeBehavior implements AbstractBehavior<YoutubeState> {
  static id = "Youtube" as const;

  static runInIframe = true;

  static init() {
    return {
      state: {},
    };
  }

  static isMatch() {
    return !!window.location.href.match(
      /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//,
    );
  }

  isChannel() {
    return (
      window.location.pathname.startsWith("/channel") ||
      window.location.pathname.startsWith("/@")
    );
  }

  isChannelRoot() {
    const channelId = this.channelId();
    const channelUsername = this.channelUsername();
    if (channelId) {
      return window.location.pathname.endsWith(channelId);
    }
    if (channelUsername) {
      return window.location.pathname.endsWith(channelUsername);
    }

    return false;
  }

  // If this is a channel URL, returns the channel ID.
  channelId() {
    if (this.isChannel()) {
      const match = window.location.pathname.match(/\/channel\/([^/]+)/);
      if (match) {
        return match[1];
      }
    }
  }

  channelUsername() {
    if (this.isChannel()) {
      const match = window.location.pathname.match(/\/(@[^/]+)/);
      if (match) {
        return match[1];
      }
    }
  }

  isVideosTab() {
    return this.isChannel() && window.location.pathname.endsWith("/videos");
  }

  isShortsTab() {
    return this.isChannel() && window.location.pathname.endsWith("/shorts");
  }

  isPlaylistsTab() {
    return this.isChannel() && window.location.pathname.endsWith("/playlists");
  }

  isSinglePlaylistView() {
    return window.location.pathname.startsWith("/playlist");
  }

  // YouTube has two channel URL formats, which are used interchangeably.
  // This returns the appropriate channel URL for the version the user is
  // already on based on what the current URL is.
  channelUrl() {
    if (this.isChannel()) {
      if (this.channelUsername()) {
        return `https://${window.location.hostname}/${this.channelUsername()}`;
      } else {
        return `https://${window.location.hostname}/channel/${this.channelId()}`;
      }
    }
  }

  static onPageInit() {
    // Attempt to induce YouTube into serving up older video formats
    Object.defineProperty(MediaSource, "isTypeSupported", {
      value: () => false,
      configurable: false,
      writable: false,
    });
  }

  async *iterTab(
    ctx: Context<YoutubeState>,
    query: string,
  ): AsyncGenerator<[string, HTMLAnchorElement | undefined]> {
    const { addLink, scrollIntoView, sleep, waitUnit, xpathNodes } = ctx.Lib;

    const seenUrls = new Set();
    let moreVideos = true;

    while (moreVideos) {
      yield ["iterTab", undefined];

      const videos = Array.from(xpathNodes(query)) as HTMLAnchorElement[];
      const unaddedVideos = videos.filter((video) => !seenUrls.has(video.href));

      // We've reached the bottom; no more videos to add
      if (unaddedVideos.length == 0) {
        moreVideos = false;
      }

      for (const video of unaddedVideos) {
        // Scroll down so that we'll trigger the load to get more videos
        // underneath us for the next iteration.
        scrollIntoView(video);
        await sleep(waitUnit);

        yield ["iterVideo", video];
        await addLink(video.href);
        seenUrls.add(video.href);
      }
    }
  }

  async *iterVideoTab(ctx: Context<YoutubeState>) {
    const { getState } = ctx.Lib;

    for await (const [message, video] of this.iterTab(ctx, Q.videoLink)) {
      switch (message) {
        case "iterTab":
          yield getState(ctx, "Iterating videos from video tab", "videoTab");
          break;
        case "iterVideo":
          yield getState(ctx, `Adding link to video: ${video!.href}`, "videos");
          break;
      }
    }
  }

  async *iterShortsTab(ctx: Context<YoutubeState>) {
    const { getState } = ctx.Lib;

    for await (const [message, video] of this.iterTab(ctx, Q.shortLink)) {
      switch (message) {
        case "iterTab":
          yield getState(ctx, "Iterating shorts from short tab", "shortTab");
          break;
        case "iterVideo":
          yield getState(ctx, `Adding link to short: ${video!.href}`, "shorts");
          break;
      }
    }
  }

  async *iterPlaylistsTab(ctx: Context<YoutubeState>) {
    const { getState } = ctx.Lib;

    for await (const [message, playlist] of this.iterTab(ctx, Q.playlistLink)) {
      switch (message) {
        case "iterTab":
          yield getState(
            ctx,
            "Iterating playlists from playlist tab",
            "playlistTab",
          );
          break;
        case "iterVideo":
          yield getState(
            ctx,
            `Adding link to full playlist: ${playlist!.href}`,
            "playlists",
          );
          break;
      }
    }
  }

  async *iterFullPlaylist(ctx: Context<YoutubeState>) {
    const { getState } = ctx.Lib;

    // There are two playlist formats with different link structures,
    // but this query can find both
    for await (const [message, video] of this.iterTab(
      ctx,
      Q.playlistVideoLink,
    )) {
      switch (message) {
        case "iterTab":
          yield getState(
            ctx,
            "Iterating videos from playlist",
            "fullPlaylists",
          );
          break;
        case "iterVideo":
          yield getState(
            ctx,
            `Adding link to video: ${video!.href}`,
            "playlistVideos",
          );
          break;
      }
    }
  }

  async *run(ctx: Context<YoutubeState>) {
    const { addLink, waitUntilNode, waitUnit } = ctx.Lib;

    // If we're on the root URL for a channel, and not any of its tabs,
    // use this as a signal we want to add the /videos page and then
    // start iterating through videos.
    //
    // Note that we *don't* want to iterate through every playlist for
    // a channel here.
    if (this.isChannelRoot()) {
      const channelUrl = this.channelUrl();
      await addLink(channelUrl + "/videos");
      await addLink(channelUrl + "/shorts");
    }

    // If this is the videos tab, we want to identify and addLink
    // every individual video.
    if (this.isVideosTab()) {
      yield* this.iterVideoTab(ctx);
    }

    // If this is the videos tab, we want to identify and addLink
    // every individual video.
    if (this.isShortsTab()) {
      yield* this.iterShortsTab(ctx);
    }

    // If this is the playlists tab, we want to identify and addLink
    // every individual playlist.
    if (this.isPlaylistsTab()) {
      yield* this.iterPlaylistsTab(ctx);
    }

    // If this is a single playlist, iterate every video within
    // that playlist.
    if (this.isSinglePlaylistView()) {
      yield* this.iterFullPlaylist(ctx);
    }

    if (window !== top && window.location.href.indexOf("/embed/") > 0) {
      // if iframe embed, just ensure that we wait for the video also
      // since awaitPageLoad is not called for iframes
      yield getState(ctx, "Waiting for YT video element");

      await waitUntilNode("//video", document, null, 10 * waitUnit * 5);
    }
  }

  async awaitPageLoad(ctx: Context<YoutubeState>) {
    const { assertContentValid, waitUntilNode, waitUnit } = ctx.Lib;

    await waitUntilNode("//video", document, null, 10 * waitUnit * 5);

    assertContentValid(() => {
      const video = document.querySelector("video");
      const paused = video?.paused;
      if (paused) {
        return false;
      }
      return document.documentElement.outerHTML.indexOf("not a bot") === -1;
    }, "no_video_playing");
  }
}
