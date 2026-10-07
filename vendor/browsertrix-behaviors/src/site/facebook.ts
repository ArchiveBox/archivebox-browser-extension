import { type AbstractBehavior, type Context } from "../lib/behavior";

const Q = {
  feed: "//div[@role='feed']",
  article: ".//div[@role='article']",
  pageletPostList:
    "//div[@data-pagelet='page']/div[@role='main']//div[@role='main']/div",
  pageletProfilePostList:
    "//div[@data-pagelet='page']//div[@data-pagelet='ProfileTimeline']",
  articleToPostList: "//div[@role='article']/../../../../div",
  // In the feed view, comments also have @role='article' but additionally
  // have an @aria-label that actual posts don't have.
  articleList: "//div[@role='article' and not(@aria-label)]",
  // The above is only true when logged out; when logged in, we need to key
  // off something else. The aria-posinset attribute is set on posts in the
  // logged in view.
  articleListLoggedIn: "//div[@aria-posinset]",
  photosOrVideos: `.//a[(contains(@href, '/photos/') or contains(@href, '/photo/?') or contains(@href, '/videos/')) and (starts-with(@href, '${window.location.origin}/') or starts-with(@href, '/'))]`,
  pagePostRootQuery: "//div[@role='dialog']",
  postQuery: ".//a[contains(@href, '/posts/')]",
  extraLabel: "//*[starts-with(text(), '+')]",
  nextSlideQuery:
    "//div[@data-name='media-viewer-nav-container']/div[@data-visualcompletion][2]//div[@role='button']",
  nextSlide:
    "//div[@aria-hidden='false']//div[@role='button' and not(@aria-hidden) and @aria-label]",
  // Specifically the comment list from posts seen in a timeline,
  // distinct from comment lists located elsewhere
  commentList: ".//ul[(../h3) or (../h4)]",
  // Single page post from an organization page
  singlePostCommentList: ".//div[2]//div[4]/div/div/div[2]/div[2]",
  // Single page post from a group page
  groupPostCommentList: "./div//div[2]/div/div/div[4]/div/div/div[2]/div[2]",
  commentMoreReplies: ".//div[2][@role='button']",
  commentMoreComments: "./div/div[2]/div[2]/div[last()]//div[@role='button']",
  viewComments: ".//h4/..//div[@role='button']",
  photoCommentList: "//div[@role='complementary']/div/div/div/div/div[3]/div",
  // Checking for the existence of the span here helps distinguish this from
  // other divs that also have role=button and aria-haspopup=menu
  commentFilterDropdown:
    ".//div[@aria-haspopup='menu' and @role='button']/span/parent::div",
  commentFilterAllComments:
    "//div[@role='menu']//div[@role='menuitem'][last()]",
  firstPhotoThumbnail:
    "//div[@role='main']//div[4]/div/div/div/div//div[3]/div[1]/div[1]//a[@role='link']",
  firstVideoThumbnail:
    "//div[@role='main']//div[contains(@style, 'z-index')]/following-sibling::div/div/div/div[last()]//a[contains(@href, '/videos/') and @aria-hidden!='true']",
  firstVideoSimple:
    "//div[@role='main']//a[contains(@href, '/videos/') and @aria-hidden!='true']",
  firstReelThumbnail:
    "//div[@role='main']//div[contains(@style, 'z-index')]/following-sibling::div/div/div/div[last()]//a[contains(@href, '/reel/')]",
  firstReelSimple: "//div[@role='main']//a[contains(@href, '/reel/')]",
  // Horizontal layout
  nextReelCard: "//div[@role='main']/div[2]/div[2]/div[@role='button']",
  // Vertical layout
  nextReelCardAlt: "//div[@role='main']/div/div/div/div[3][@role='button']",
  mainVideo:
    "//div[@data-pagelet='root']//div[@role='dialog']//div[@role='main']//video",
  nextVideo:
    "following::a[contains(@href, '/videos/') and @aria-hidden!='true']",
  isPhotoVideoPage: /^.*facebook\.com\/[^/]+\/(photos|videos)\/.+/,
  isPhotosPage: /^.*facebook\.com\/[^/]+\/photos\/?($|\?)/,
  isSinglePhoto: /^.*facebook\.com\/photo.php\/?($|\?)/,
  isVideosPage: /^.*facebook\.com\/[^/]+\/videos\/?($|\?)/,
  isReelsPage: /^.*facebook\.com\/[^/]+\/reels\/?($|\?)/,
  isSingleReel: /^.*facebook\.com\/reel\/\d+\/?($|\?)/,
  // Post from an organization/etc. page
  isSinglePost: /^.*facebook\.com\/\w+\/posts\/[^/]+\/?($|\?)/,
  // Post from a group
  isSingleGroupPost: /^.*facebook\.com\/groups\/[^/]+\/posts\/[^/]+\/?($|\?)/,
  isGroupPage: /^.*facebook\.com\/groups\/[^/]+\/?($|\?)/,
  isGroupFeed: /^.*facebook\.com\/groups\/feed\/?($|\?)/,
  isOrganizationOrPersonPage: /^.*facebook\.com\/([a-zA-Z0-9.]+)/,
  isNonHandledPageType:
    /^.*facebook\.com\/(business|friends|gaming|help|marketplace|notifications|policies|privacy|stories|groups\/feed|login\.php|instagram\/login_sync)(\/|\?)/,
  pageLoadWaitUntil: "//div[@role='main']",
  // Limit query to only modals with the login_popup_cta_form form child in order
  // to avoid grabbing unrelated modals, like pop-up posts
  loginModal:
    "//div[@role='dialog'][.//form[@id='login_popup_cta_form']]//div[@role='button']",
};

class HaltIteration extends Error {}

type FacebookState = Partial<{
  photos: number;
  reels: number;
  videos: number;
  comments: number;
  posts: number;
}>;

export class FacebookTimelineBehavior
  implements AbstractBehavior<FacebookState>
{
  extraWindow: WindowProxy | null;
  allowNewWindow: boolean;
  seenIds: Set<string>;

  static id = "Facebook" as const;

  static isMatch() {
    // Attempts to restrict the behaviour to the classes of pages
    // we're set up to be able to iterate over.
    return (
      // We want anything in these categories
      (!!window.location.href.match(Q.isPhotoVideoPage) ||
        !!window.location.href.match(Q.isPhotosPage) ||
        !!window.location.href.match(Q.isSinglePhoto) ||
        !!window.location.href.match(Q.isVideosPage) ||
        !!window.location.href.match(Q.isReelsPage) ||
        !!window.location.href.match(Q.isSingleReel) ||
        !!window.location.href.match(Q.isSinglePost) ||
        !!window.location.href.match(Q.isSingleGroupPost) ||
        !!window.location.href.match(Q.isGroupPage) ||
        !!window.location.href.match(Q.isOrganizationOrPersonPage)) &&
      // And *avoid* anything in these categories
      !window.location.href.match(Q.isNonHandledPageType)
    );
  }

  static init() {
    return {
      state: {},
    };
  }

  constructor() {
    this.extraWindow = null;
    //todo: make option
    this.allowNewWindow = false;
    this.seenIds = new Set();
  }

  async *iterPostFeeds(ctx: Context<FacebookState>) {
    const {
      iterChildElem,
      getState,
      scrollIntoView,
      sleep,
      waitUnit,
      xpathNode,
      xpathNodes,
    } = ctx.Lib;

    let articleQuery;
    if (this.isLoggedIn()) {
      articleQuery = Q.articleListLoggedIn;
    } else {
      articleQuery = Q.articleList;
    }

    let feeds = Array.from(xpathNodes(Q.feed)) as Element[];
    if (feeds.length) {
      for (const feed of feeds) {
        for await (const post of iterChildElem(feed, waitUnit, waitUnit * 10)) {
          yield* this.viewPost(
            ctx,
            xpathNode(Q.article, post) as Element | null,
            Q.commentList,
          );
        }
      }
    } else if (
      (feeds = Array.from(xpathNodes(articleQuery)) as Element[]).length
    ) {
      for (const post of feeds) {
        yield getState(ctx, "Viewing post from feed");
        scrollIntoView(post);
        try {
          yield* this.viewPost(ctx, post, Q.commentList);
        } catch (e) {
          if (e instanceof HaltIteration) {
            yield getState(
              ctx,
              "Halting iteration after looping back over old posts",
            );
            return;
          } else {
            throw e;
          }
        }
        await sleep(waitUnit * 20);
      }

      // Keep looping until we run out of posts in the timeline
      // or hit a limit
      let lastSeen = feeds.at(-1);
      for (let i = 0; i < 50; i++) {
        feeds = Array.from(xpathNodes(articleQuery)) as Element[];
        if (feeds[0] == lastSeen) {
          break;
        }

        for (const post of feeds) {
          yield getState(ctx, "Viewing post from feed");
          scrollIntoView(post);
          try {
            yield* this.viewPost(ctx, post, Q.commentList);
          } catch (e) {
            if (e instanceof HaltIteration) {
              yield getState(
                ctx,
                "Halting iteration after looping back over old posts",
              );
              return;
            } else {
              throw e;
            }
          }
          await sleep(waitUnit * 20);
        }
        lastSeen = feeds.at(-1);
      }
    } else {
      const feed = (xpathNode(Q.pageletPostList) ||
        xpathNode(Q.pageletProfilePostList) ||
        xpathNode(Q.articleToPostList)) as Element | null;

      if (!feed) {
        return;
      }

      for await (const post of iterChildElem(feed, waitUnit, waitUnit * 10)) {
        try {
          yield* this.viewPost(
            ctx,
            xpathNode(Q.article, post) as Element,
            Q.commentList,
          );
        } catch (e) {
          if (e instanceof HaltIteration) {
            yield getState(
              ctx,
              "Halting iteration after looping back over old posts",
            );
            return;
          } else {
            throw e;
          }
        }
      }
    }

    if (this.extraWindow) {
      this.extraWindow.close();
    }
  }

  async *handleGroupPost(ctx: Context<FacebookState>) {
    const { xpathNode } = ctx.Lib;

    const feed = xpathNode(Q.feed) as Element;
    const post = xpathNode(
      "./div[@role='presentation']",
      feed,
    ) as Element | null;

    yield* this.viewPost(ctx, post, Q.groupPostCommentList, 1000);
  }

  async *handleSinglePost(ctx: Context<FacebookState>) {
    const { xpathNode } = ctx.Lib;

    const post = xpathNode(Q.pagePostRootQuery) as Element | null;

    yield* this.viewPost(ctx, post, Q.singlePostCommentList, 1000);
  }

  async *viewPost(
    ctx: Context<FacebookState>,
    post: Element | null,
    commentQuery: string,
    maxExpands = 2,
  ) {
    const { addLink, getState, scrollIntoView, sleep, waitUnit, xpathNode } =
      ctx.Lib;
    if (!post) {
      return;
    }

    const postLink = xpathNode(Q.postQuery, post) as HTMLAnchorElement | null;

    let url: URL | null = null;

    if (postLink) {
      url = new URL(postLink.href, window.location.href);
      url.search = "";

      // URL format: /username/posts/pfbid0blahblahblah
      let match = window.location.href.match(/\/[^/]+\/posts\/(.+)/);
      if (!match) {
        // URL format: /groups/123456789/posts/123456789/
        match = window.location.href.match(/\/groups\/[^/]+\/posts\/([^/]+)/);
      }

      if (match) {
        const postId = match[1] as string | null;

        if (postId) {
          if (this.seenIds.has(postId)) {
            throw new HaltIteration(
              `Iteration has looped around to previously-seen post ${postId}`,
            );
          }

          this.seenIds.add(postId);
        }
      }
    }

    yield getState(ctx, "Viewing post " + (url || ""), "posts");
    // If appropriate, queue up the single post view as well
    if (url) {
      const urlString = url.toString();
      if (
        Q.isSinglePost.test(urlString) ||
        Q.isSingleGroupPost.test(urlString)
      ) {
        yield getState(ctx, "Queuing single page post " + urlString);
        await addLink(urlString);
      }
    }

    scrollIntoView(post);

    await sleep(waitUnit * 2);

    if (xpathNode(".//video", post)) {
      yield getState(ctx, "Playing inline video", "videos");
      await sleep(waitUnit * 2);
    }

    //yield* this.viewPhotosOrVideos(ctx, post);

    let commentRoot = xpathNode(commentQuery, post) as HTMLElement | null;
    if (!commentRoot) {
      const viewCommentsButton = xpathNode(
        Q.viewComments,
        post,
      ) as HTMLElement | null;
      if (viewCommentsButton) {
        viewCommentsButton.click();
        await sleep(waitUnit * 2);
      }
      commentRoot = xpathNode(commentQuery, post) as HTMLElement | null;
    }
    yield* this.iterInfiniteScrollComments(ctx, post, commentRoot, maxExpands);

    await sleep(waitUnit * 5);
  }

  async *viewPhotosOrVideos(ctx: Context<FacebookState>, post: Element | null) {
    const { getState, sleep, waitUnit, xpathNode, xpathNodes } = ctx.Lib;
    const objects = Array.from(
      xpathNodes(Q.photosOrVideos, post),
    ) as HTMLAnchorElement[];

    const objHrefs = new Set();
    let count = 0;

    for (const obj of objects) {
      const url = new URL(obj.href, window.location.href);
      if (obj.href.indexOf("?fbid") === -1) {
        url.search = "";
      }

      if (objHrefs.has(url.href)) {
        continue;
      }

      const type = obj.href.indexOf("/video") >= 0 ? "videos" : "photos";

      ++count;

      objHrefs.add(url.href);

      yield getState(ctx, `Viewing ${type} ${url.href}`, type);

      obj.scrollIntoView();

      await sleep(waitUnit * 5);

      obj.click();

      await sleep(waitUnit * 10);
      //await sleep(10000);

      if (this.allowNewWindow) {
        await this.openNewWindow(ctx, url.href);
      }

      if (count === objects.length) {
        yield* this.viewExtraObjects(ctx, obj, type, this.allowNewWindow);
      }

      const close = xpathNode(Q.nextSlide) as HTMLElement | null;

      if (close) {
        close.click();
        await sleep(waitUnit * 2);
      }
    }
  }

  async *viewExtraObjects(
    ctx: Context<FacebookState>,
    obj: Node | null,
    type: string,
    openNew: boolean,
  ) {
    const { getState, sleep, waitUnit, waitUntil, xpathNode } = ctx.Lib;
    const extraLabel = xpathNode(Q.extraLabel, obj) as HTMLElement | null;

    if (!extraLabel) {
      return;
    }

    const num = Number(extraLabel.innerText.slice(1));
    if (isNaN(num)) {
      return;
    }

    let lastHref: string | undefined;

    for (let i = 0; i < num; i++) {
      const nextSlideButton = xpathNode(Q.nextSlideQuery) as HTMLElement | null;

      if (!nextSlideButton) {
        continue;
      }

      lastHref = window.location.href;

      nextSlideButton.click();
      await sleep(waitUnit * 5);

      await waitUntil(() => window.location.href !== lastHref, waitUnit * 2);

      yield getState(ctx, `Viewing extra ${type} ${window.location.href}`);

      if (openNew) {
        await this.openNewWindow(ctx, window.location.href);
      }
    }
  }

  async openNewWindow(ctx: Context<FacebookState>, url: string) {
    if (!this.extraWindow) {
      this.extraWindow = await ctx.Lib.openWindow(url);
    } else {
      this.extraWindow.location.href = url;
    }
  }

  // Used on some logged-in pages and all logged-out pages;
  // additional comments are loaded by clicking a button.
  async *iterPaginatedComments(
    ctx: Context<FacebookState>,
    post: Element | HTMLElement | null,
    commentRoot: HTMLElement | null,
    maxExpands = 2,
  ) {
    const { getState, scrollIntoView, sleep, waitUnit, xpathNode } = ctx.Lib;
    if (!commentRoot) {
      await sleep(waitUnit * 5);
      return;
    }

    // If there's a comment filter, try to set it to "All Comments"
    const filterDropdown = xpathNode(
      Q.commentFilterDropdown,
      post,
    ) as HTMLElement | null;
    if (filterDropdown) {
      yield getState(ctx, "Switching to 'All comments'");
      filterDropdown.click();
      await sleep(waitUnit * 20);

      const allComments = xpathNode(
        Q.commentFilterAllComments,
      ) as HTMLElement | null;
      // Clicking this will automatically close the dropdown so we don't
      // have to worry about manually closing it
      if (allComments) {
        yield getState(ctx, "Clicking 'All comments' button");
        allComments.click();
        await sleep(waitUnit * 20);
      }
    }

    let commentBlock = xpathNode(
      "div[2]/div[1]",
      commentRoot,
    ) as HTMLElement | null;
    let lastBlock: Element | null = null;

    let count = 0;

    while (commentBlock && count < maxExpands) {
      while (commentBlock && count < maxExpands) {
        yield getState(ctx, "Loading comments", "comments");
        scrollIntoView(commentBlock);
        await sleep(waitUnit * 2);

        let moreReplies = xpathNode(
          Q.commentMoreReplies,
          commentBlock,
        ) as HTMLElement | null;
        while (moreReplies) {
          scrollIntoView(moreReplies);
          // TODO: apply maxExpands per-comment or per-click?
          moreReplies.click();
          await sleep(waitUnit * 5);
          // There can be additional "more replies" buttons
          // within nested comment chains, so keep searching
          // for them until we've fully exhausted them.
          moreReplies = xpathNode(
            Q.commentMoreReplies,
            commentBlock,
          ) as HTMLElement | null;
        }

        lastBlock = commentBlock;
        commentBlock = lastBlock.nextElementSibling as HTMLElement | null;
        count++;
      }

      if (count === maxExpands) {
        break;
      }

      const moreButton = xpathNode(
        Q.commentMoreComments,
        commentRoot,
      ) as HTMLElement | null;
      if (moreButton) {
        scrollIntoView(moreButton);
        moreButton.click();
        await sleep(waitUnit * 5);
        if (lastBlock) {
          commentBlock = lastBlock.nextElementSibling as HTMLElement | null;
          await sleep(waitUnit * 5);
        }
      }
    }

    await sleep(waitUnit * 2);
  }

  // Used by certain logged-in pages; there's no way to explicitly
  // expand comments, they just load in as you scroll.
  async *iterInfiniteScrollComments(
    ctx: Context<FacebookState>,
    post: Element | HTMLElement | null,
    commentRoot: HTMLElement | null,
    maxExpands = 2,
  ) {
    const { getState, scrollIntoView, sleep, waitUnit } = ctx.Lib;

    if (!commentRoot) {
      yield getState(ctx, "Comment root is null; returning");
      return;
    }

    let lastFinalComment =
      commentRoot.children[commentRoot.children.length - 1];

    for (let i = 0; i < maxExpands; i++) {
      yield getState(
        ctx,
        "Scrolling to bottom of comments to load more",
        "comments",
      );
      scrollIntoView(lastFinalComment);
      await sleep(waitUnit * 20);

      // Looks like we've run out of comments, so stop iterating
      if (
        commentRoot.children[commentRoot.children.length - 1] ===
        lastFinalComment
      ) {
        break;
      }

      lastFinalComment = commentRoot.children[commentRoot.children.length - 1];
    }
  }

  async *iterPhotoSlideShow(ctx: Context<FacebookState>) {
    const { getState, scrollIntoView, sleep, waitUnit, waitUntil, xpathNode } =
      ctx.Lib;
    const firstPhoto = xpathNode(Q.firstPhotoThumbnail) as HTMLElement | null;

    if (!firstPhoto) {
      return;
    }

    let lastHref = window.location.href;

    scrollIntoView(firstPhoto);

    firstPhoto.click();
    await sleep(waitUnit * 20);
    await waitUntil(() => window.location.href !== lastHref, waitUnit * 2);

    let nextSlideButton: HTMLElement | null = null;

    while (
      (nextSlideButton = xpathNode(Q.nextSlideQuery) as HTMLElement | null)
    ) {
      lastHref = window.location.href;

      await sleep(waitUnit);
      nextSlideButton.click();
      await sleep(waitUnit * 5);

      await Promise.race([
        waitUntil(() => window.location.href !== lastHref, waitUnit * 2),
        sleep(3000),
      ]);

      if (window.location.href === lastHref) {
        break;
      }

      yield getState(ctx, `Viewing photo ${window.location.href}`, "photos");

      const root = xpathNode(Q.photoCommentList) as HTMLElement | null;
      // Photo pages seen in the slideshow always use paginated comments,
      // both when signed in and when not.
      yield* this.iterPaginatedComments(ctx, root, root, 2);

      await sleep(waitUnit * 5);
    }
  }

  async *iterAllVideos(ctx: Context<FacebookState>) {
    const {
      getState,
      scrollIntoView,
      sleep,
      waitUnit,
      waitUntil,
      xpathNode,
      xpathNodes,
    } = ctx.Lib;
    const firstInlineVideo = xpathNode("//video") as HTMLElement | null;
    if (firstInlineVideo) {
      scrollIntoView(firstInlineVideo);
      await sleep(waitUnit * 5);
    }

    let videoLink = (xpathNode(Q.firstVideoThumbnail) ||
      xpathNode(Q.firstVideoSimple)) as HTMLElement | null;

    if (!videoLink) {
      return;
    }

    while (videoLink) {
      scrollIntoView(videoLink);

      let lastHref = window.location.href;
      videoLink.click();
      await waitUntil(() => window.location.href !== lastHref, waitUnit * 2);

      yield getState(ctx, "Viewing video: " + window.location.href, "videos");

      await sleep(waitUnit * 10);

      // wait for video to play, or 20s
      await Promise.race([
        waitUntil(() => {
          for (const video of xpathNodes(
            "//video",
          ) as Generator<HTMLVideoElement>) {
            if (video.readyState >= 3) {
              return true;
            }
          }
          return false;
        }, waitUnit * 2),
        sleep(20000),
      ]);

      await sleep(waitUnit * 10);

      const close = xpathNode(Q.nextSlide) as HTMLElement | null;

      if (!close) {
        break;
      }

      lastHref = window.location.href;
      close.click();
      await waitUntil(() => window.location.href !== lastHref, waitUnit * 2);

      videoLink = xpathNode(Q.nextVideo, videoLink) as HTMLElement | null;
    }
  }

  async *iterAllReels(ctx: Context<FacebookState>) {
    const {
      addLink,
      fuzzyWaitUnit,
      getState,
      scrollIntoView,
      sleep,
      waitUnit,
      waitUntil,
      xpathNode,
      xpathNodes,
    } = ctx.Lib;

    const videoLink = (xpathNode(Q.firstReelThumbnail) ||
      xpathNode(Q.firstReelSimple)) as HTMLElement | null;

    if (!videoLink) {
      return;
    }

    scrollIntoView(videoLink);

    let lastHref = window.location.href;
    videoLink.click();
    await waitUntil(() => window.location.href !== lastHref, waitUnit * 2);

    await sleep(fuzzyWaitUnit() * 10);

    let nextButton = (xpathNode(Q.nextReelCard) ||
      xpathNode(Q.nextReelCardAlt)) as HTMLElement | null;

    while (nextButton) {
      yield getState(ctx, "Viewing reel: " + window.location.href, "reels");

      // The first reel viewed won't have a permanent URL in the URL bar,
      // and will just be at the path www.facebook.com/reel
      // Subsequent reels we visit will have a permanent URL accessible to
      // us from the URL bar, so we'll want to addLink those for
      // individual crawling.
      if (window.location.pathname != "/reel/") {
        yield getState(
          ctx,
          `Adding link to individual reel: ${window.location.href}`,
        );
        await addLink(window.location.href);
      }

      // wait for video to play, or ~20s
      await Promise.race([
        waitUntil(() => {
          for (const video of xpathNodes(
            "//video",
          ) as Generator<HTMLVideoElement>) {
            if (video.readyState >= 3) {
              return true;
            }
          }
          return false;
        }, fuzzyWaitUnit() * 2),
        sleep(fuzzyWaitUnit() * 100),
      ]);

      // Continue waiting for the video to finish playing out
      await sleep(fuzzyWaitUnit() * 100);

      nextButton = (xpathNode(Q.nextReelCard) ||
        xpathNode(Q.nextReelCardAlt)) as HTMLElement | null;

      if (nextButton) {
        nextButton.click();
        lastHref = window.location.href;
        await waitUntil(
          () => window.location.href !== lastHref,
          fuzzyWaitUnit() * 5,
        );
      }
    }
  }

  async *run(ctx: Context<FacebookState>) {
    const { addLink, getState, sleep, xpathNode } = ctx.Lib;
    yield getState(ctx, "Starting...");

    await sleep(2000);

    // If we're logged out, make sure to click the close button
    // before trying to interact with the page in any other way.
    const loginModal = xpathNode(Q.loginModal) as HTMLElement | null;
    if (loginModal) {
      yield getState(ctx, "Closing login modal");
      loginModal.click();
    }

    if (window.location.pathname == "/") {
      yield getState(ctx, "Not browsing the home timeline");
      return;
    }

    if (Q.isGroupFeed.exec(window.location.href)) {
      yield getState(ctx, "Not browsing the group feed");
      return;
    }

    if (Q.isPhotosPage.exec(window.location.href)) {
      ctx.state = { photos: 0, comments: 0 };
      yield getState(ctx, "Iterating photos");
      yield* this.iterPhotoSlideShow(ctx);
      return;
    }

    if (Q.isVideosPage.exec(window.location.href)) {
      ctx.state = { videos: 0, comments: 0 };
      yield getState(ctx, "Iterating videos");
      yield* this.iterAllVideos(ctx);
      return;
    }

    if (Q.isReelsPage.exec(window.location.href)) {
      ctx.state = { reels: 0, comments: 0 };
      yield getState(ctx, "Iterating reels");
      yield* this.iterAllReels(ctx);
      return;
    }

    if (Q.isSingleGroupPost.exec(window.location.href)) {
      ctx.state = { comments: 0 };
      yield getState(ctx, "Viewing single group post");
      yield* this.handleGroupPost(ctx);
      return;
    }

    if (Q.isSinglePost.exec(window.location.href)) {
      ctx.state = { comments: 0 };
      yield getState(ctx, "Viewing single post");
      yield* this.handleSinglePost(ctx);
      return;
    }

    if (Q.isPhotoVideoPage.exec(window.location.href)) {
      ctx.state = { comments: 0 };
      const root = xpathNode(Q.photoCommentList) as HTMLElement | null;
      // Single photo pages use the infinite scroll comment widget
      // when logged in, but the paginated comment widget when
      // logged out.
      if (this.isLoggedIn()) {
        yield* this.iterInfiniteScrollComments(ctx, root, root, 1000);
      } else {
        yield* this.iterPaginatedComments(ctx, root, root, 1000);
      }
      return;
    }

    // Try to ensure we grab reels/photos pages
    const match = window.location.href.match(Q.isOrganizationOrPersonPage);
    if (match) {
      const account = match[1];
      if (account && account != "groups" && account != "reel") {
        const photosPage = `https://www.facebook.com/${account}/photos`;
        yield getState(ctx, `Adding link to photos page: ${photosPage}`);
        await addLink(photosPage);

        const reelsPage = `https://www.facebook.com/${account}/reels`;
        yield getState(ctx, `Adding link to reels page: ${reelsPage}`);
        await addLink(reelsPage);
      }
    }

    ctx.state = { posts: 0, comments: 0, videos: 0 };
    yield* this.iterPostFeeds(ctx);
  }

  isLoggedIn() {
    // Login form only appears for logged-out users
    return !document.querySelector("form[id='login_form']");
  }

  async awaitPageLoad(ctx: Context<FacebookState>) {
    const { Lib, log } = ctx;
    const { assertContentValid, waitUntilNode } = Lib;

    void log("Waiting for Facebook to fully load", "info");

    await waitUntilNode(Q.pageLoadWaitUntil, document, null, 10000);

    assertContentValid(() => this.isLoggedIn(), "not_logged_in");
  }
}
