import { type AbstractBehavior, type Context } from "../lib/behavior";

const Q = {
  commentButton: "button[aria-label^='Read or add comments']",
  commentList: "//div[contains(@class, 'CommentListContainer')]",
  commentItem: "div[contains(@class, 'CommentItemContainer')]",
  viewMoreReplies: ".//p[contains(@class, 'ReplyActionText')]",
  viewMoreThread:
    ".//p[starts-with(@data-e2e, 'view-more') and string-length(text()) > 0]",
  profileVideoList: "//div[starts-with(@data-e2e, 'user-post-item-list')]",
  profileVideoItem: "div[contains(@class, 'DivItemContainerV2')]",
  backButton: "button[contains(@class, 'StyledCloseIconContainer')]",
  pageLoadWaitUntil: "//*[@role='dialog']",
};

export const BREADTH_ALL = Symbol("BREADTH_ALL");

type TikTokState = {
  comments: number;
  videos: number;
};
type TikTokOpts = {
  breadth: number | typeof BREADTH_ALL;
};

export class TikTokSharedBehavior {
  async awaitPageLoad(ctx: Context<TikTokState, TikTokOpts>) {
    const { assertContentValid, waitUntilNode } = ctx.Lib;
    await waitUntilNode(Q.pageLoadWaitUntil, document, null, 20000);

    assertContentValid(
      () => !!document.querySelector("*[aria-label='Messages']"),
      "not_logged_in",
    );
  }
}

export class TikTokVideoBehavior
  extends TikTokSharedBehavior
  implements AbstractBehavior<TikTokState, TikTokOpts>
{
  static id = "TikTokVideo" as const;

  static init() {
    return {
      state: { comments: 0 },
      opts: { breadth: BREADTH_ALL },
    };
  }

  static isMatch() {
    const pathRegex = /https:\/\/(www\.)?tiktok\.com\/@.+\/video\/\d+\/?.*/;
    return !!window.location.href.match(pathRegex);
  }

  breadthComplete(
    { opts: { breadth } }: { opts: { breadth: number | typeof BREADTH_ALL } },
    iter: number,
  ) {
    return breadth !== BREADTH_ALL && breadth <= iter;
  }

  async *crawlThread(
    ctx: Context<TikTokState, TikTokOpts>,
    parentNode: Node | null = null,
    prev: Node | null = null,
    iter = 0,
  ): AsyncGenerator<{ state: TikTokState; msg: string }> {
    const { waitUntilNode, scrollAndClick, getState } = ctx.Lib;
    const next = (await waitUntilNode(
      Q.viewMoreThread,
      parentNode ?? undefined,
      prev,
    )) as HTMLElement | null;
    if (!next || this.breadthComplete(ctx, iter)) return;
    await scrollAndClick(next, 500);
    yield getState(ctx, "View more replies", "comments");
    yield* this.crawlThread(ctx, parentNode, next, iter + 1);
  }

  async *expandThread(
    ctx: Context<TikTokState, TikTokOpts>,
    item: Node | null,
  ) {
    const { xpathNode, scrollAndClick, getState } = ctx.Lib;
    const viewMore = xpathNode(Q.viewMoreReplies, item) as HTMLElement | null;
    if (!viewMore) return;
    await scrollAndClick(viewMore, 500);
    yield getState(ctx, "View comment", "comments");
    yield* this.crawlThread(ctx, item, null, 1);
  }

  async *run(ctx: Context<TikTokState, TikTokOpts>) {
    const {
      xpathNode,
      iterChildMatches,
      scrollIntoView,
      getState,
      assertContentValid,
      sleep,
    } = ctx.Lib;

    const showComments = document.querySelector(Q.commentButton);
    if (showComments) {
      (showComments as HTMLButtonElement).click();
      await sleep(10000);
    }

    // assert no captcha every 0.5 seconds
    void (async () => {
      // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
      while (true) {
        if (document.querySelector("div[class*=captcha]")) {
          assertContentValid(() => false, "not_logged_in");
          break;
        }
        await sleep(500);
      }
    })();

    const commentList = xpathNode(Q.commentList);
    const commentItems = iterChildMatches(Q.commentItem, commentList);
    for await (const item of commentItems) {
      scrollIntoView(item as Element);
      yield getState(ctx, "View comment", "comments");
      if (this.breadthComplete(ctx, 0)) continue;
      yield* this.expandThread(ctx, item);
    }

    yield getState(ctx, "TikTok Video Behavior Complete");
  }
}

export class TikTokProfileBehavior
  extends TikTokSharedBehavior
  implements AbstractBehavior<TikTokState, TikTokOpts>
{
  static id = "TikTokProfile" as const;

  static isMatch() {
    const pathRegex =
      /https:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9]+(\/?$|\/\?.*)/;
    return !!window.location.href.match(pathRegex);
  }

  static init() {
    return {
      state: { videos: 0, comments: 0 },
      opts: { breadth: BREADTH_ALL },
    };
  }

  async *openVideo(ctx: Context<TikTokState, TikTokOpts>, item: Node | null) {
    const { HistoryState, xpathNode, sleep } = ctx.Lib;
    const link = xpathNode(".//a", item) as HTMLElement | null;
    if (!link) return;
    const viewState = new HistoryState(() => link.click());
    await sleep(500);
    if (viewState.changed) {
      const videoBehavior = new TikTokVideoBehavior();
      yield* videoBehavior.run(ctx);
      await sleep(500);
      await viewState.goBack(Q.backButton);
    }
  }

  async *run(ctx: Context<TikTokState, TikTokOpts>) {
    const { xpathNode, iterChildMatches, scrollIntoView, getState, sleep } =
      ctx.Lib;
    const profileVideoList = xpathNode(Q.profileVideoList);
    const profileVideos = iterChildMatches(
      Q.profileVideoItem,
      profileVideoList,
    );
    for await (const item of profileVideos) {
      scrollIntoView(item as HTMLElement);
      yield getState(ctx, "View video", "videos");
      yield* this.openVideo(ctx, item);
      await sleep(500);
    }
    yield getState(ctx, "TikTok Profile Behavior Complete");
  }
}
