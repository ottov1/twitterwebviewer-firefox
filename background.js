"use strict";

// twitterwebviewer.com is a query-param app, not a path mirror:
//
//   x.com/naval                  -> twitterwebviewer.com/?user=naval
//   x.com/naval/status/123       -> twitterwebviewer.com/?user=naval&tweet=123
//   x.com/search?q=foo           -> twitterwebviewer.com/twitter-search?q=foo
//   x.com/hashtag/foo            -> twitterwebviewer.com/twitter-search?q=%23foo
//   anything else (home, /i/...) -> twitterwebviewer.com/

const VIEWER_ORIGIN = "https://twitterwebviewer.com";
const SEARCH_PATH = "/twitter-search";

// Twitter paths whose first segment is a feature, not a username.
const RESERVED_SEGMENTS = new Set([
  "home", "explore", "notifications", "messages", "i", "search",
  "hashtag", "settings", "login", "logout", "signup", "intent",
  "share", "tos", "privacy", "about", "jobs", "account", "compose",
]);

const TWEET_PATH = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/;
const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights))?\/?$/;

function viewerUrl(twitterUrl) {
  const url = new URL(twitterUrl);
  const path = url.pathname;

  const tweet = path.match(TWEET_PATH);
  if (tweet)
    return `${VIEWER_ORIGIN}/?user=${tweet[1]}&tweet=${tweet[2]}`;

  if (path === "/search" || path === "/search/") {
    const query = url.searchParams.get("q");
    if (query)
      return `${VIEWER_ORIGIN}${SEARCH_PATH}?q=${encodeURIComponent(query)}`;
  }

  const hashtag = path.match(/^\/hashtag\/([^/]+)/);
  if (hashtag)
    return `${VIEWER_ORIGIN}${SEARCH_PATH}?q=${encodeURIComponent("#" + hashtag[1])}`;

  const profile = path.match(PROFILE_PATH);
  if (profile && !RESERVED_SEGMENTS.has(profile[1].toLowerCase()))
    return `${VIEWER_ORIGIN}/?user=${profile[1]}`;

  return `${VIEWER_ORIGIN}/`;
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
