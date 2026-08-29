# X Tweet Viewer

Firefox addon that lets you browse X/Twitter without an account. Redirects twitter.com and x.com links to a built-in viewer page — no external front-end service (they keep getting shut down; RIP Nitter and XCancel, August 2026).

Shows:

- single tweets, with photos and playable video
- the replies under a tweet
- profiles with their recent tweets, newest first

## How it works

```
x.com/naval/status/123 ──redirect──> viewer.html?tweet=123
                                        │
                                        ├─ fetch x.com/i/status/123 (logged-out SSR page)
                                        │  parse embedded Relay state ─> tweet + replies
                                        │
                                        └─ fallback: cdn.syndication.twimg.com/tweet-result
                                           (official embed API; tweet only, no replies)

x.com/naval ──redirect──> viewer.html?user=naval
                             ├─ syndication.twitter.com timeline (official embed API, ~100 tweets)
                             └─ fallback: x.com/naval SSR page (recent handful; the embed
                                timeline rate-limits aggressively with HTTP 429)
```

- `background.js` — intercepts top-level navigations, maps them to the viewer.
- `relay.js` — parser for the serialized Relay store in x.com's server-rendered HTML.
- `viewer.js` / `viewer.html` — fetches, normalizes and renders tweets.

Search and hashtags land on the viewer home page: X has no public search endpoint.

The Relay-state parsing depends on x.com's current markup; if X changes it, tweets degrade to the embed API (no replies) until the parser is updated.

## Privacy

- Only top-level navigations to twitter.com / x.com are intercepted.
- Content is fetched directly from X's public endpoints; no third party involved.
- No data is collected, stored, or transmitted anywhere else.

## Permissions

- `webRequest` / `webRequestBlocking`: redirect before the page loads.
- twitter.com / x.com: the domains being redirected, and the tweet-page fetch.
- `cdn.syndication.twimg.com` / `syndication.twitter.com`: X's public embed APIs, used for timelines and as tweet fallback.

Not affiliated with X.
