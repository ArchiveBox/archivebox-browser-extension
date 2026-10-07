// Canonical modalcloser selector corpus. Page-global framework calls are
// expressed through their existing DOM dismiss controls in the isolated world.
export function closeModals() {
  if(document.documentElement.dataset.abxDownloadActive==='true')return [];
  const actions=[];
  const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const hide=el=>{el.style.display='none';el.style.visibility='hidden';el.style.opacity='0';el.style.pointerEvents='none';};
  const dismiss=(selector,controls,escape=false)=>{
    for(const el of document.querySelectorAll(selector)){
      if(!visible(el))continue;
      const button=controls?el.querySelector(controls):null;
      let method='hide';
      if(button&&!button.disabled){button.click();method='click';}
      else if(el.tagName==='DIALOG'&&el.open){el.close();method='close';}
      else if(escape){el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));method='escape';}
      // Frameworks without exposed dismiss controls remain suppressible without
      // calling their page-world JS objects or touching isolated-world globals.
      if(visible(el))hide(el);
      actions.push({selector,label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,120),method});
    }
  };
  dismiss('.modal.show, .modal.in','[data-bs-dismiss="modal"], [data-dismiss="modal"]');
  dismiss('[data-radix-dialog-overlay], [data-state="open"][role="dialog"]', '[aria-label="Close"], [aria-label="close"]',true);
  for(const el of document.querySelectorAll('.cdk-overlay-backdrop'))if(visible(el)){el.click();if(visible(el))hide(el);actions.push({selector:'.cdk-overlay-backdrop',label:'',method:'click'});}
  dismiss('[role="dialog"][aria-modal="true"]','[aria-label="Close"], [aria-label="close"]',true);
  dismiss('.ui-dialog','.ui-dialog-titlebar-close');
  dismiss('.swal2-container','.swal2-close, .swal2-cancel');
  dismiss('.sweet-alert, .swal-overlay','.swal-button--cancel, button.cancel');
  dismiss('dialog[open]','[aria-label="Close"], [aria-label="close"]',true);
    const genericSelectors = [
      // CookieYes (cky)
      ".cky-consent-container",
      ".cky-popup-center",
      ".cky-overlay",
      ".cky-modal",
      "#ckyPreferenceCenter",
      // OneTrust
      "#onetrust-consent-sdk",
      "#onetrust-banner-sdk",
      ".onetrust-pc-dark-filter",
      "#onetrust-pc-sdk",
      // CookieBot
      "#CybotCookiebotDialog",
      "#CybotCookiebotDialogBodyUnderlay",
      "#CookiebotWidget",
      // Quantcast / CMP
      ".qc-cmp-ui-container",
      "#qc-cmp2-container",
      ".qc-cmp2-summary-buttons",
      // TrustArc / TrustE
      "#truste-consent-track",
      ".truste-banner",
      "#truste-consent-content",
      // Osano
      ".osano-cm-window",
      ".osano-cm-dialog",
      // Klaro
      ".klaro .cookie-modal",
      ".klaro .cookie-notice",
      // Tarteaucitron
      "#tarteaucitronRoot",
      "#tarteaucitronAlertBig",
      // Complianz (WordPress)
      ".cmplz-cookiebanner",
      "#cmplz-cookiebanner-container",
      // GDPR Cookie Consent (WordPress)
      "#gdpr-cookie-consent-bar",
      ".gdpr-cookie-consent-popup",
      // Cookie Notice (WordPress)
      "#cookie-notice",
      ".cookie-notice-container",
      // EU Cookie Law
      ".eupopup",
      "#eu-cookie-law",
      // Didomi
      "#didomi-popup",
      "#didomi-host",
      ".didomi-popup-container",
      // Usercentrics
      "#usercentrics-root",
      ".uc-banner",
      // Axeptio
      "#axeptio_overlay",
      "#axeptio_btn",
      // iubenda
      "#iubenda-cs-banner",
      ".iubenda-cs-container",
      // Termly
      ".termly-consent-banner",
      "#termly-code-snippet-support",
      // Borlabs Cookie (WordPress)
      "#BorlabsCookieBox",
      ".BorlabsCookie",
      // CookieFirst
      ".cookiefirst-root",
      "#cookiefirst-root",
      // CookieScript
      "#cookiescript_injected",
      ".cookiescript_injected_wrapper",
      // Civic Cookie Control
      "#ccc",
      "#ccc-overlay",
      // Generic patterns
      "#cookie-consent",
      ".cookie-banner",
      ".cookie-notice",
      "#cookieConsent",
      ".cookie-consent",
      ".cookies-banner",
      '[class*="cookie"][class*="banner"]',
      '[class*="cookie"][class*="notice"]',
      '[class*="cookie"][class*="popup"]',
      '[class*="cookie"][class*="modal"]',
      '[class*="consent"][class*="banner"]',
      '[class*="consent"][class*="popup"]',
      '[class*="gdpr"]',
      '[class*="privacy"][class*="banner"]',
      // Modal overlays and backdrops
      '.modal-overlay:not([style*="display: none"])',
      '.modal-backdrop:not([style*="display: none"])',
      ".overlay-visible",
      // Popup overlays
      ".popup-overlay",
      ".newsletter-popup",
      ".age-gate",
      ".subscribe-popup",
      ".subscription-modal",
      // Generic modal patterns
      '[class*="modal"][class*="open"]:not(.modal-open)',
      '[class*="modal"][class*="show"][class*="overlay"]',
      '[class*="modal"][class*="visible"]',
      '[class*="dialog"][class*="open"]',
      '[class*="overlay"][class*="visible"]',
      // Interstitials
      ".interstitial",
      ".interstitial-wrapper",
      '[class*="interstitial"]',
    ];

    genericSelectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          // Skip if already hidden
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return;

          el.style.display = "none";
          el.style.visibility = "hidden";
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          actions.push({selector,label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,120),method:'hide'});
        });
      } catch (e) {}
    });

    // Remove body scroll lock (common pattern when modals are open)
    if(actions.length)try {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.classList.remove(
        "modal-open",
        "overflow-hidden",
        "no-scroll",
        "scroll-locked"
      );
      document.documentElement.style.overflow = "";
      document.documentElement.classList.remove("overflow-hidden", "no-scroll");
    } catch (e) {}

  return actions;
}
