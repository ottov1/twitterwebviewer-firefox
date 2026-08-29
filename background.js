"use strict";

// v2: no external service. Tweet and profile links open the bundled
// viewer page, which renders them from X's public embed endpoints
// (the same ones official embedded tweets use):
//
//   x.com/naval            -> viewer.html?user=naval
//   x.com/naval/status/123 -> viewer.html?tweet=123&user=naval
//   anything else          -> viewer.html (search has no public endpoint)

const VIEWER_PAGE = browser.runtime.getURL("viewer.html");

// Twitter paths whose first segment is a feature, not a username.
const RESERVED_SEGMENTS = new Set([
  "home", "explore", "notifications", "messages", "i", "search",
  "hashtag", "settings", "login", "logout", "signup", "intent",
  "share", "tos", "privacy", "about", "jobs", "account", "compose",
]);

const TWEET_PATH = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/;
const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights))?\/?$/;

function viewerUrl(twitterUrl) {
  const path = new URL(twitterUrl).pathname;

  const tweet = path.match(TWEET_PATH);
  if (tweet)
    return `${VIEWER_PAGE}?tweet=${tweet[2]}&user=${tweet[1]}`;

  const profile = path.match(PROFILE_PATH);
  if (profile && !RESERVED_SEGMENTS.has(profile[1].toLowerCase()))
    return `${VIEWER_PAGE}?user=${profile[1]}`;

  return VIEWER_PAGE;
}

function redirect(details) {
  return { redirectUrl: viewerUrl(details.url) };
}

// Top-level navigations only; leave API/media subrequests alone.
browser.webRequest.onBeforeRequest.addListener(
  redirect,
  {
    urls: [
      "*://twitter.com/*",
      "*://www.twitter.com/*",
      "*://mobile.twitter.com/*",
      "*://x.com/*",
      "*://www.x.com/*",
      "*://mobile.x.com/*",
    ],
    types: ["main_frame"],
  },
  ["blocking"]
);
