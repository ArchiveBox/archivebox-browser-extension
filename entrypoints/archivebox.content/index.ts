import type { RuntimeMessage } from '@/src/lib/types';

type PageMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  originalX: number;
  originalY: number;
};

type ScrollResult = PageMetrics & {
  scrollX: number;
  scrollY: number;
  userCanceled?: boolean;
};

const screenshotCaptureStyleId = 'archivebox-screenshot-capture-style';
const userScrollCancelWindowMs = 1200;
const userScrollCancelDelta = 900;
const userScrollCancelEvents = 4;
const userKeyCancelWindowMs = 1200;
const userKeyCancelEvents = 2;

let captureListenersActive = false;
let userCancelRequested = false;
let userScrollStartedAt = 0;
let userScrollDelta = 0;
let userScrollEvents = 0;
let userKeyStartedAt = 0;
let userKeyEvents = 0;

function eventTargetIsEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function resetUserCancelTracking(): void {
  userCancelRequested = false;
  userScrollStartedAt = 0;
  userScrollDelta = 0;
  userScrollEvents = 0;
  userKeyStartedAt = 0;
  userKeyEvents = 0;
}

function recordUserScroll(delta: number): void {
  const now = Date.now();
  if (!userScrollStartedAt || now - userScrollStartedAt > userScrollCancelWindowMs) {
    userScrollStartedAt = now;
    userScrollDelta = 0;
    userScrollEvents = 0;
  }
  userScrollDelta += Math.abs(delta);
  userScrollEvents += 1;
  if (userScrollDelta >= userScrollCancelDelta || userScrollEvents >= userScrollCancelEvents) {
    userCancelRequested = true;
  }
}

function handleUserWheel(event: WheelEvent): void {
  recordUserScroll(Math.abs(event.deltaY) + Math.abs(event.deltaX));
}

function handleUserTouchMove(): void {
  recordUserScroll(300);
}

function handleUserKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' || eventTargetIsEditable(event.target)) {
    userCancelRequested = true;
    return;
  }

  const now = Date.now();
  if (!userKeyStartedAt || now - userKeyStartedAt > userKeyCancelWindowMs) {
    userKeyStartedAt = now;
    userKeyEvents = 0;
  }
  userKeyEvents += 1;
  if (userKeyEvents >= userKeyCancelEvents) {
    userCancelRequested = true;
  }
}

function startCaptureInputListeners(): void {
  if (captureListenersActive) return;
  captureListenersActive = true;
  window.addEventListener('wheel', handleUserWheel, { capture: true, passive: true });
  window.addEventListener('touchmove', handleUserTouchMove, { capture: true, passive: true });
  window.addEventListener('keydown', handleUserKey, { capture: true });
}

function stopCaptureInputListeners(): void {
  if (!captureListenersActive) return;
  captureListenersActive = false;
  window.removeEventListener('wheel', handleUserWheel, { capture: true });
  window.removeEventListener('touchmove', handleUserTouchMove, { capture: true });
  window.removeEventListener('keydown', handleUserKey, { capture: true });
}

function hideScrollbarsForScreenshot(): void {
  if (document.getElementById(screenshotCaptureStyleId)) {
    startCaptureInputListeners();
    return;
  }
  resetUserCancelTracking();
  startCaptureInputListeners();
  const style = document.createElement('style');
  style.id = screenshotCaptureStyleId;
  style.textContent = `
    html, body {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    *, *::before, *::after {
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement).append(style);
}

function restoreScrollbarsAfterScreenshot(): void {
  stopCaptureInputListeners();
  resetUserCancelTracking();
  document.getElementById(screenshotCaptureStyleId)?.remove();
}

function pageMetrics(): PageMetrics {
  const documentElement = document.documentElement;
  const body = document.body;
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollWidth: Math.max(
      documentElement.scrollWidth,
      body?.scrollWidth || 0,
      documentElement.clientWidth,
    ),
    scrollHeight: Math.max(
      documentElement.scrollHeight,
      body?.scrollHeight || 0,
      documentElement.clientHeight,
    ),
    originalX: window.scrollX,
    originalY: window.scrollY,
  };
}

async function waitForScrollSettle(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function scrollForScreenshot(x: number, y: number): Promise<ScrollResult> {
  hideScrollbarsForScreenshot();
  window.scrollTo(x, y);
  await waitForScrollSettle();
  return {
    ...pageMetrics(),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    userCanceled: userCancelRequested,
  };
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      switch (message.type) {
        case 'screenshot_get_metrics':
          return Promise.resolve(pageMetrics());

        case 'screenshot_scroll':
          return scrollForScreenshot(message.x, message.y);

        case 'screenshot_restore_scroll':
          return scrollForScreenshot(message.x, message.y).then(() => {
            restoreScrollbarsAfterScreenshot();
            return { ok: true };
          });

        default:
          break;
      }
    });
  },
});
