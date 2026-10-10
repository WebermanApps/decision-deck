# Weekly Decision Deck
Swipe deck. Loads /decisions-YYYY-WW.json from the BriefApp Dropbox app folder and writes /decision-taps-YYYY-WW.json. Set DROPBOX_APP_KEY in config.js (same app as Brief App) and add this page URL as a redirect URI. Demo Mode uses demo/decisions-demo.json (fake). Test: python3 tests/test_deck.py
