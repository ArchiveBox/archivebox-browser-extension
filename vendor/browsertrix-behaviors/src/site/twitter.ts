import { type AbstractBehavior, type Context } from "../lib/behavior";

const Q = {
  rootPath:
    "//h1[@role='heading' and @aria-level='1']/following-sibling::div[@aria-label]//div[@style]",
  anchor: ".//article",
  childMatchSelect:
    "string(.//article//a[starts-with(@href, '/') and @aria-label]/@href)",
  childMatch: "child::div[.//a[@href='$1']]",
  expand:
    ".//div[@role='button' and not(@aria-haspopup) and not(@data-testid)]",
  quote: ".//div[@role='blockquote' and @aria-haspopup='false']",
  image:
    ".//a[@role='link' and starts-with(@href, '/') and contains(@href, '/photo/')]",
  imageFirstNext:
    "//div[@aria-roledescription='carousel']/div[2]/div[1]//div[@role='button']",
  imageNext:
    "//div[@aria-roledescription='carousel']/div[2]/div[2]//div[@role='button']",
  imageClose: "//div[@role='presentation']/div[@role='button' and @aria-label]",
  backButton: "//div[@data-testid='titleContainer']//div[@role='button']",
  viewSensitive:
    ".//a[@href='/settings/content_you_see']/parent::div/parent::div/parent::div//div[@role='button']",
  progress: ".//*[@role='progressbar']",
  promoted: ".//div[data-testid='placementTracking']",
  profilePageRegex: /^\/[a-zA-Z0-9_]+$/,
};

type TwitterState = {
  tweets?: number;
  images?: number;
  videos?: number;
  threads?: number;
};

type TwitterOpts = {
  maxDepth: number;
};

export class TwitterTimelineBehavior
  implements AbstractBehavior<TwitterState, TwitterOpts>
{
  seenTweets: Set<string>;
  seenMediaTweets: Set<string>;
  username: string | undefined;

  static id = "Twitter" as const;

  static isMatch() {
    return !!window.location.href.match(/https:\/\/(www\.)?(x|twitter)\.com\//);
  }

  static init() {
    return {
      state: {
        tweets: 0,
        images: 0,
        videos: 0,
      },
      opts: {
        maxDepth: 0,
      },
    };
  }

  constructor() {
    this.seenTweets = new Set();
    this.seenMediaTweets = new Set();
    this.username = undefined;
  }

  showingProgressBar(
    ctx: Context<TwitterState, TwitterOpts>,
    root: Node | null,
  ) {
    const { xpathNode } = ctx.Lib;
    const node = xpathNode(Q.progress, root) as Element | null;
    if (!node) {
      return false;
    }
    // return false is hidden / no-height
    return node.clientHeight > 10;
  }

  async waitForNext(
    ctx: Context<TwitterState, TwitterOpts>,
    child: Element | null,
  ) {
    const { sleep, waitUnit } = ctx.Lib;
    if (!child) {
      return null;
    }

    await sleep(waitUnit * 2);

    if (!child.nextElementSibling) {
      return null;
    }

    while (this.showingProgressBar(ctx, child.nextElementSibling)) {
      await sleep(waitUnit);
    }

    return child.nextElementSibling;
  }

  async expandMore(
    ctx: Context<TwitterState, TwitterOpts>,
    child: Element | null,
  ) {
    const { sleep, waitUnit, xpathNode } = ctx.Lib;
    const expandElem = xpathNode(Q.expand, child) as HTMLElement | null;
    if (!expandElem) {
      return child;
    }

    const prev = child?.previousElementSibling;
    expandElem.click();
    await sleep(waitUnit);
    while (this.showingProgressBar(ctx, prev?.nextElementSibling ?? null)) {
      await sleep(waitUnit);
    }
    child = prev?.nextElementSibling ?? null;
    return child;
  }

  async *infScroll(ctx: Context<TwitterState, TwitterOpts>) {
    const { scrollIntoView, RestoreState, sleep, waitUnit, xpathNode } =
      ctx.Lib;
    const root = xpathNode(Q.rootPath) as Element | null;

    if (!root) {
      return;
    }

    let child = root.firstElementChild as HTMLElement | null;

    if (!child) {
      return;
    }

    while (child) {
      let anchorElem = xpathNode(Q.anchor, child) as HTMLElement | null;

      if (!anchorElem && Q.expand) {
        child = (await this.expandMore(ctx, child)) as HTMLElement | null;
        anchorElem = xpathNode(Q.anchor, child) as HTMLElement | null;
      }

      if (child?.innerText) {
        scrollIntoView(child);
      }

      if (child && anchorElem) {
        await sleep(waitUnit);

        const restorer = new RestoreState(Q.childMatchSelect, child);

        yield anchorElem;

        if (restorer.matchValue) {
          child = (await restorer.restore(
            Q.rootPath,
            Q.childMatch,
          )) as HTMLElement | null;
        }
      }

      child = (await this.waitForNext(ctx, child)) as HTMLElement | null;
    }
  }

  async *mediaPlaying(
    ctx: Context<TwitterState, TwitterOpts>,
    tweet: HTMLElement,
  ) {
    const { getState, sleep, xpathNode, xpathString } = ctx.Lib;
    const media = xpathNode(
      "(.//video | .//audio)",
      tweet,
    ) as HTMLMediaElement | null;
    if (!media || media.paused) {
      return;
    }

    let mediaTweetUrl: string | null = null;

    try {
      mediaTweetUrl = new URL(
        xpathString(Q.childMatchSelect, tweet.parentElement),
        window.location.origin,
      ).href;
    } catch (e) {
      console.warn(e);
    }

    // no need to wait for mp4s, should be loaded fully automatically
    if (media.src.startsWith("https://") && media.src.indexOf(".mp4") > 0) {
      yield getState(
        ctx,
        `Loading video for ${mediaTweetUrl || "unknown"}`,
        "videos",
      );
      return;
    }

    let msg;

    if (mediaTweetUrl) {
      if (this.seenMediaTweets.has(mediaTweetUrl)) {
        return;
      }

      msg = `Waiting for media playback for ${mediaTweetUrl} to finish`;
      this.seenMediaTweets.add(mediaTweetUrl);
    } else {
      msg = "Loading video";
    }

    yield getState(ctx, msg, "videos");

    const p = new Promise((resolve) => {
      media.addEventListener("ended", () => resolve(null));
      media.addEventListener("abort", () => resolve(null));
      media.addEventListener("error", () => resolve(null));
      media.addEventListener("pause", () => resolve(null));
    });

    await Promise.race([p, sleep(60000)]);
  }

  async *clickImages(
    ctx: Context<TwitterState, TwitterOpts>,
    tweet: HTMLElement,
  ) {
    const { getState, HistoryState, sleep, waitUnit, xpathNode } = ctx.Lib;
    const imagePopup = xpathNode(Q.image, tweet) as HTMLElement | null;

    if (imagePopup) {
      const imageState = new HistoryState(() => imagePopup.click());

      yield getState(ctx, "Loading Image: " + window.location.href, "images");

      await sleep(waitUnit * 5);

      let nextImage = xpathNode(Q.imageFirstNext) as HTMLElement | null;
      let prevLocation = window.location.href;

      while (nextImage) {
        nextImage.click();
        await sleep(waitUnit * 2);

        if (window.location.href === prevLocation) {
          await sleep(waitUnit * 5);
          break;
        }
        prevLocation = window.location.href;

        yield getState(ctx, "Loading Image: " + window.location.href, "images");
        await sleep(waitUnit * 5);

        nextImage = xpathNode(Q.imageNext) as HTMLElement | null;
      }

      await imageState.goBack(Q.imageClose);
    }
  }

  async *clickTweet(
    ctx: Context<TwitterState, TwitterOpts>,
    tweet: HTMLElement,
    depth: number,
  ): AsyncGenerator<{ state: TwitterState; msg: string }> {
    const { addLink, getState, HistoryState, sleep, waitUnit } = ctx.Lib;
    const tweetState = new HistoryState(() => tweet.click());

    await sleep(waitUnit);

    if (tweetState.changed) {
      yield getState(ctx, "Capturing Tweet: " + window.location.href, "tweets");
      const maxDepth = ctx.opts.maxDepth;
      if (depth < maxDepth && !this.seenTweets.has(window.location.href)) {
        yield* this.iterTimeline(ctx, depth + 1);
      }

      yield* this.followExternalLinks(ctx);

      this.seenTweets.add(window.location.href);

      // If this is a tweet by the profile this crawl is capturing,
      // queue the individual tweet to be captured standalone too.
      if (this.urlIsTweet() && this.username == this.currentUrlUsername()) {
        yield getState(
          ctx,
          "Queuing Individual Tweet URL: " + window.location.href,
        );
        await addLink(window.location.href);
      }

      // wait
      await sleep(waitUnit * 2);

      await tweetState.goBack(Q.backButton);

      await sleep(waitUnit);
    }
  }

  async *followExternalLinks(ctx: Context<TwitterState, TwitterOpts>) {
    const { addLink, getState, xpathNode, xpathNodes } = ctx.Lib;

    // Follow links within the tweet text, but only if it's a tweet
    // for the account being crawled
    if (this.urlIsTweet() && this.username == this.currentUrlUsername()) {
      const statusId = this.statusIdForUrl();

      let query;
      if (this.isLoggedIn()) {
        // Tweets are <article> elements, and the first <article> on
        // the page should be the primary tweet for the page.
        query = "//article";
      } else {
        // When logged out, the data-tweet-id parameter is set so that
        // we can be even more confident we're getting the right tweet.
        query = `//article[@data-tweet-id='${statusId}']`;
      }
      const tweet = xpathNode(query);

      if (tweet) {
        for (const link of Array.from(
          xpathNodes(
            // All external links have target=_blank, so this helps us
            // identify external links from within a tweet as opposed to
            // internal links from the UI.
            ".//a[@target='_blank']",
            tweet,
          ),
        ) as HTMLAnchorElement[]) {
          // Don't follow internal links, only external ones
          // When logged out, these links go directly to the linked sites;
          // when logged in, these will be t.co links.
          if (!link.href.match(/https?:\/\/x.com/)) {
            yield getState(ctx, "Following External Link: " + link.href);
            await addLink(link.href);
          }
        }
      }
    }
  }

  statusIdForUrl() {
    const match = window.location.pathname.match(
      /^\/[a-zA-Z0-9_]+\/status\/(\d+)$/,
    );
    if (match) {
      return match[1];
    }
  }

  async *iterTimeline(ctx: Context<TwitterState, TwitterOpts>, depth = 0) {
    const { getState, sleep, waitUnit, xpathNode } = ctx.Lib;
    if (this.seenTweets.has(window.location.href)) {
      return;
    }

    yield getState(ctx, "Capturing thread: " + window.location.href, "threads");

    // iterate over infinite scroll of tweets
    for await (const tweet of this.infScroll(ctx)) {
      // skip promoted tweets
      if (xpathNode(Q.promoted, tweet)) {
        continue;
      }

      await sleep(waitUnit * 2.5);

      const viewButton = xpathNode(
        Q.viewSensitive,
        tweet,
      ) as HTMLElement | null;
      if (viewButton) {
        viewButton.click();
        await sleep(waitUnit * 2.5);
      }

      // process images
      yield* this.clickImages(ctx, tweet);

      // process quoted tweet
      const quoteTweet = xpathNode(Q.quote, tweet) as HTMLElement | null;

      if (quoteTweet) {
        yield* this.clickTweet(ctx, quoteTweet, 1000);
      }

      // await any video or audio
      yield* this.mediaPlaying(ctx, tweet);

      // track location to see if click goes to new url
      yield* this.clickTweet(ctx, tweet, depth);

      // wait before continuing
      await sleep(waitUnit * 5);
    }
  }

  isLoggedIn() {
    return !document.documentElement.outerHTML.match(/Log In/i);
  }

  currentUrlUsername() {
    if (window.location.pathname.match(/^\/[a-zA-Z0-9_]+/)) {
      return window.location.pathname.split("/")[1];
    }
  }

  urlIsProfilePage() {
    return !!window.location.pathname.match(Q.profilePageRegex);
  }

  urlIsTweet() {
    return !!window.location.pathname.match(/^\/[a-zA-Z0-9_]+\/status/);
  }

  async *run(ctx: Context<TwitterState, TwitterOpts>) {
    const { addLink, getState } = ctx.Lib;

    if (this.urlIsProfilePage()) {
      this.username = this.currentUrlUsername();

      // Media tab can't be visited at all when logged out
      if (this.isLoggedIn()) {
        const mediaTabUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}/media`;
        yield getState(ctx, "Queuing Media Tab: " + mediaTabUrl);
        await addLink(mediaTabUrl);
        // The default media tab is for videos; there's also a photo
        // version, which we can visit with a separate query parameter.
        await addLink(mediaTabUrl + "?filter=photo");
      }
    }

    yield* this.iterTimeline(ctx, 0);
  }

  async awaitPageLoad(ctx: Context<TwitterState, TwitterOpts>) {
    const { sleep, assertContentValid } = ctx.Lib;
    await sleep(5);
    assertContentValid(() => this.isLoggedIn(), "not_logged_in");
  }
}
