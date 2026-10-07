import { type AbstractBehavior, type Context } from "../lib/behavior";

const Q = {
  telegramContainer:
    "//main//section[@class='tgme_channel_history js-message_history']",
  postId: "string(./div[@data-post]/@data-post)",
  linkExternal:
    "string(.//a[@class='tgme_widget_message_link_preview' and @href]/@href)",
};

type TelegramState = {
  messages?: number;
};

export class TelegramBehavior implements AbstractBehavior<TelegramState> {
  static id = "Telegram" as const;

  static isMatch() {
    return !!window.location.href.match(/https:\/\/t.me\/s\/\w[\w]+/);
  }

  static init() {
    return {
      state: { messages: 0 },
    };
  }

  async waitForPrev(ctx: Context<TelegramState>, child: Element | null) {
    if (!child) {
      return null;
    }

    await ctx.Lib.sleep(ctx.Lib.waitUnit * 5);

    if (!child.previousElementSibling) {
      return null;
    }

    return child.previousElementSibling;
  }

  async *run(ctx: Context<TelegramState>) {
    const {
      getState,
      scrollIntoView,
      sleep,
      waitUnit,
      xpathNode,
      xpathString,
    } = ctx.Lib;
    const root = xpathNode(Q.telegramContainer) as Element | null;

    if (!root) {
      return;
    }

    let child = root.lastElementChild;

    while (child) {
      scrollIntoView(child);

      const postId = xpathString(Q.postId, child) || "unknown";

      const linkUrl = xpathString(Q.linkExternal, child);

      if (linkUrl.endsWith(".jpg") || linkUrl.endsWith(".png")) {
        yield getState(ctx, "Loading External Image: " + linkUrl);
        const image = new Image();
        image.src = linkUrl;
        document.body.appendChild(image);
        await sleep(waitUnit * 2.5);
        document.body.removeChild(image);
      }

      yield getState(ctx, "Loading Message: " + postId, "messages");

      child = await this.waitForPrev(ctx, child);
    }
  }
}
