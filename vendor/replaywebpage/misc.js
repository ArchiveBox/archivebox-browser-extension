// ReplayWeb.page 2.5.3 src/misc.ts CSS helper. See NOTICE.md and LICENSE.
import { unsafeCSS } from "lit";
import allCssRaw from "./main.css?raw";

const allCss = unsafeCSS(allCssRaw);
function wrapCss(custom) {
  return [allCss, custom];
}

export { wrapCss };
