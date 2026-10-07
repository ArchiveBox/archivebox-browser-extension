import { BlueskyBehavior } from "./bsky";
import { FacebookTimelineBehavior } from "./facebook";
import { InstagramPostsBehavior } from "./instagram";
import { TelegramBehavior } from "./telegram";
import { TwitterTimelineBehavior } from "./twitter";
import { TikTokVideoBehavior, TikTokProfileBehavior } from "./tiktok";
import { YoutubeBehavior } from "./youtube";

const siteBehaviors = [
  BlueskyBehavior,
  InstagramPostsBehavior,
  TwitterTimelineBehavior,
  FacebookTimelineBehavior,
  TelegramBehavior,
  TikTokVideoBehavior,
  TikTokProfileBehavior,
  YoutubeBehavior,
] as const;

export default siteBehaviors;
