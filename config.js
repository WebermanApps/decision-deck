// Decision Deck config. Same Dropbox app as the Brief App (App folder /Apps/BriefApp). Add this page's URL as a redirect URI.
window.DECK_CONFIG = {
  DROPBOX_APP_KEY: "YOUR_DROPBOX_APP_KEY", // placeholder; public-safe (PKCE, no secret)
  decisionsPath: (w) => `/decisions-${w}.json`,
  tapsPath: (w) => `/decision-taps-${w}.json`,
  demoUrl: "demo/decisions-demo.json"
};
