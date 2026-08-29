"use strict";

// Renders X content without an account, from two public sources:
//
//   tweet + replies  x.com/i/status/<id>          (logged-out SSR page;
//                                                  relay.js parses its state)
//   fallback tweet   cdn.syndication.twimg.com    (official embed API,
//                                                  single tweet, no replies)
//   profile timeline syndication.twitter.com      (official embed API)

const TWEET_PAGE = "https://x.com/i/status";
const TWEET_API = "https://cdn.syndication.twimg.com/tweet-result";
const TIMELINE_API = "https://syndication.twitter.com/srv/timeline-profile/screen-name";

const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;

const Card = { MAIN: "main", ROW: "row", QUOTE: "quote" };

const app = document.getElementById("app");
const params = new URLSearchParams(location.search);

route();

function route() {
  const tweet = params.get("tweet");
  if (tweet) return showTweet(tweet);

  const user = params.get("user");
  if (user) return showProfile(user);

  showHome();
}

/* ---------------------------------------------------------------- tweet */

async function showTweet(id) {
  document.title = "Tweet " + id;

  try {
    const conv = await fetchConv(id);
    renderConv(conv);
  } catch (err) {
    // SSR markup changed or the page was withheld: degrade to the
    // embed API, which has the tweet but not the replies.
    console.error("conversation load failed:", err);
    try {
      const focal = await fetchEmbed(id);
      renderConv({ focal, threads: [], degraded: true });
    } catch {
      showError(`Couldn't load tweet ${id}.`, err.message);
    }
  }
}

async function fetchConv(id) {
  // credentials: "omit" — host-permitted fetches would otherwise send
  // the user's x.com cookies, and a logged-in/consented session gets
  // the client-rendered shell with no embedded relay state.
  const res = await fetch(`${TWEET_PAGE}/${id}`, { credentials: "omit" });
  if (!res.ok)
    throw new Error(`x.com HTTP ${res.status}`);

  const records = parseRelayPage(await res.text());
  const results = records[`TweetResults:${id}`];
  const tweet = deref(records, results?.result);
  if (tweet?.__typename !== "Tweet")
    throw new Error("tweet record missing");

  return {
    focal: fromRelay(records, tweet),
    threads: convThreads(records, id),
  };
}

// Reply threads come as TimelineAddEntries -> conversationthread-*
// modules, each holding one chain of tweets. Page order is kept.
function convThreads(records, focalId) {
  const threads = [];

  for (const rec of Object.values(records)) {
    if (rec?.__typename !== "TimelineAddEntries")
      continue;

    for (const entry of derefList(records, rec.entries)) {
      const entryId = entry?.entry_id ?? "";
      if (!entryId.startsWith("conversationthread-"))
        continue;

      const module = deref(records, entry.content);
      const tweets = derefList(records, module?.items)
        .map((item) => itemTweet(records, deref(records, item.item)))
        .filter(Boolean)
        .filter((t) => t.id !== focalId);
      if (tweets.length)
        threads.push(tweets);
    }
  }
  return threads;
}

function itemTweet(records, timelineItem) {
  const content = deref(records, timelineItem?.content);
  if (content?.__typename !== "TimelineTweet")
    return null;

  const tweet = deref(records, deref(records, content.tweet_results)?.result);
  if (tweet?.__typename !== "Tweet")
    return null;
  return fromRelay(records, tweet);
}

async function fetchEmbed(id) {
  const res = await fetch(`${TWEET_API}?id=${id}&token=${embedToken(id)}`, {
    credentials: "omit",
  });
  if (!res.ok)
    throw new Error(`embed HTTP ${res.status}`);

  const data = await res.json();
  if (data?.__typename !== "Tweet")
    throw new Error("tweet unavailable");
  return fromSynd(data);
}

// The token check used by X's own embed widget.
function embedToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function renderConv({ focal, threads, degraded }) {
  document.title = `@${focal.screen}: ${focal.text.slice(0, 60)}`;

  const page = el("div", "conv");
  if (focal.replyToScreen)
    page.append(note(`Replying to @${focal.replyToScreen}`));
  page.append(card(focal, Card.MAIN));

  if (degraded)
    page.append(note("Replies unavailable right now."));
  if (threads.length)
    page.append(el("h2", "section", "Replies"));
  for (const thread of threads) {
    const box = el("div", "thread");
    for (const tweet of thread)
      box.append(card(tweet, Card.ROW));
    page.append(box);
  }

  app.replaceChildren(page);
}

/* -------------------------------------------------------------- profile */

async function showProfile(name) {
  document.title = "@" + name;

  // The embed timeline has ~100 tweets but rate-limits hard (429);
  // the logged-out x.com profile page always answers but carries
  // only the most recent handful. Try rich first, degrade to SSR.
  try {
    const { tweets, owner } = await fetchTimeSynd(name);
    renderProfile(name, tweets, owner);
  } catch (err) {
    console.error("embed timeline failed:", err);
    try {
      const { tweets, owner } = await fetchTimeSSR(name);
      renderProfile(name, tweets, owner);
    } catch (err2) {
      showError(`Couldn't load @${name}.`, `${err.message}; ${err2.message}`);
    }
  }
}

async function fetchTimeSynd(name) {
  const res = await fetch(`${TIMELINE_API}/${encodeURIComponent(name)}`, {
    credentials: "omit",
  });
  if (!res.ok)
    throw new Error(`timeline HTTP ${res.status}`);

  const match = (await res.text()).match(NEXT_DATA);
  if (!match)
    throw new Error("timeline payload missing");

  const props = JSON.parse(match[1]).props.pageProps;
  const entries = props.timeline?.entries ?? [];
  const tweets = entries.map((e) => fromSynd(e.content.tweet));

  const own = tweets.find(
    (t) => !t.retweetOf && t.screen?.toLowerCase() === name.toLowerCase()
  );
  return { tweets, owner: own ?? null };
}

async function fetchTimeSSR(name) {
  const res = await fetch(`https://x.com/${encodeURIComponent(name)}`, {
    credentials: "omit",
  });
  if (!res.ok)
    throw new Error(`x.com HTTP ${res.status}`);

  const records = parseRelayPage(await res.text());

  const byId = new Map();
  for (const rec of Object.values(records)) {
    if (rec?.__typename !== "TimelineAddEntries")
      continue;
    for (const entry of derefList(records, rec.entries))
      for (const tweet of entryTweets(records, entry))
        byId.set(tweet.id, tweet);
  }

  let owner = null;
  for (const rec of Object.values(records)) {
    if (rec?.__typename !== "User")
      continue;
    const core = deref(records, rec.core);
    if (core?.screen_name?.toLowerCase() !== name.toLowerCase())
      continue;
    owner = {
      name: core.name,
      screen: core.screen_name,
      avatar: deref(records, rec.avatar)?.image_url,
      followers: deref(records, rec.relationship_counts)?.followers,
    };
    break;
  }

  if (!byId.size && !owner)
    throw new Error("profile data missing");
  return { tweets: [...byId.values()], owner };
}

// A timeline entry is either one tweet (TimelineTimelineItem) or a
// module of them (TimelineTimelineModule, e.g. a thread preview).
function entryTweets(records, entry) {
  const content = deref(records, entry?.content);

  if (content?.__typename === "TimelineTimelineItem") {
    const tweet = itemTweet(records, content);
    return tweet ? [tweet] : [];
  }
  if (content?.__typename === "TimelineTimelineModule")
    return derefList(records, content.items)
      .map((item) => itemTweet(records, deref(records, item.item)))
      .filter(Boolean);
  return [];
}

function renderProfile(name, tweets, owner) {
  // Newest first, as befits a timeline.
  tweets.sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0));

  const page = el("div", "conv");

  const head = el("div", "profile");
  if (owner) {
    head.append(avatarImg(owner.avatar, "big"));
    const who = el("div");
    who.append(el("div", "name", owner.name));
    who.append(el("div", "muted", "@" + owner.screen));
    if (owner.bio)
      who.append(el("div", "bio", owner.bio));
    if (owner.followers !== undefined && owner.followers !== null)
      who.append(el("div", "muted bio", fmtCount(owner.followers) + " followers"));
    head.append(who);
  } else {
    head.append(el("div", "name", "@" + name));
  }
  page.append(head);

  if (!tweets.length)
    page.append(note("No tweets found — the account may not exist or is protected."));
  for (const tweet of tweets)
    page.append(card(tweet, Card.ROW));

  app.replaceChildren(page);
}

/* ---------------------------------------------------------- normalizers */

// Relay Tweet record -> view model. Fields live behind refs:
// core -> user, details -> text, counts -> stats, *_entities -> marks.
function fromRelay(records, t) {
  const details = deref(records, t.details) ?? {};
  const counts = deref(records, t.counts) ?? {};
  const user = deref(records, deref(records, deref(records, t.core)?.user_results)?.result);
  const uCore = deref(records, user?.core) ?? {};
  const avatar = deref(records, user?.avatar) ?? {};
  const replyToUser = deref(records, deref(records, t.reply_to_user_results)?.result);
  const quoted = deref(records, deref(records, t.quoted_tweet_results)?.result);
  const legacy = deref(records, t.legacy);
  const retweeted = deref(records, deref(records, legacy?.retweeted_status_results)?.result);

  // Long tweets: the untruncated text lives in a NoteTweet record
  // (note_tweet -> note_tweet_results -> result) with its own entities.
  const noteData = deref(records, t.note_tweet);
  const note = deref(records, deref(records, noteData?.note_tweet_results)?.result);
  const noteEnt = note?.text ? deref(records, note.entity_set) ?? {} : null;

  const media = derefList(records, t.media_entities2).map((m) => ({
    type: m.type,
    thumb: m.media_url_https,
    alt: m.ext_alt_text,
    indices: m.indices,
    variants: derefList(records, deref(records, m.video_info)?.variants)
      .map((v) => ({ src: v.url, mime: v.content_type, bitrate: v.bitrate ?? 0 })),
  }));

  return {
    id: t.rest_id,
    name: uCore.name,
    screen: uCore.screen_name,
    avatar: avatar.image_url,
    text: noteEnt ? note.text : details.full_text ?? "",
    range: noteEnt ? null : details.display_text_range ?? null,
    createdMs: details.created_at_ms,
    counts: {
      replies: counts.reply_count,
      reposts: counts.retweet_count,
      likes: counts.favorite_count,
    },
    urls: derefList(records, noteEnt ? noteEnt.urls : t.url_entities),
    mentions: derefList(records, noteEnt ? noteEnt.user_mentions : t.mention_entities),
    hashtags: derefList(records, noteEnt ? noteEnt.hashtags : details.hashtag_entities),
    media,
    quoted: quoted?.__typename === "Tweet" ? fromRelay(records, quoted) : null,
    retweetOf: retweeted?.__typename === "Tweet" ? fromRelay(records, retweeted) : null,
    replyToScreen: deref(records, replyToUser?.core)?.screen_name ?? null,
  };
}

// Syndication JSON (embed API and profile timeline) -> view model.
function fromSynd(t) {
  // The embed API sometimes ships note_tweet as a bare id, no text.
  const note = t.note_tweet?.text ? t.note_tweet : null;
  const entities = t.entities ?? {};
  const rawMedia = t.mediaDetails ?? entities.media ?? [];

  const media = rawMedia.map((m) => ({
    type: m.type,
    thumb: m.media_url_https,
    alt: m.ext_alt_text,
    indices: m.indices,
    variants: (m.video_info?.variants ?? [])
      .map((v) => ({ src: v.url, mime: v.content_type, bitrate: v.bitrate ?? 0 })),
  }));

  return {
    id: t.id_str,
    name: t.user?.name,
    screen: t.user?.screen_name,
    avatar: t.user?.profile_image_url_https,
    bio: t.user?.description,
    text: note?.text ?? t.full_text ?? t.text ?? "",
    range: note ? null : t.display_text_range ?? null,
    createdMs: Date.parse(t.created_at),
    counts: {
      replies: t.reply_count ?? t.conversation_count,
      reposts: t.retweet_count,
      likes: t.favorite_count,
    },
    urls: (note?.entity_set ?? entities).urls ?? [],
    mentions: (note?.entity_set ?? entities).user_mentions ?? [],
    hashtags: (note?.entity_set ?? entities).hashtags ?? [],
    media,
    quoted: t.quoted_tweet ? fromSynd(t.quoted_tweet) : null,
    retweetOf: t.retweeted_status ? fromSynd(t.retweeted_status) : null,
    replyToScreen: t.in_reply_to_screen_name ?? null,
  };
}

/* ------------------------------------------------------------ rendering */

function card(view, kind) {
  if (view.retweetOf) {
    const wrap = el("div", "repost");
    wrap.append(note(`${view.name} reposted`));
    wrap.append(card(view.retweetOf, kind));
    return wrap;
  }

  const box = el("article", `card ${kind}`);

  const head = el("div", "head");
  head.append(avatarImg(view.avatar, kind === Card.MAIN ? "big" : ""));
  const who = el("div", "who");
  who.append(el("span", "name", view.name ?? ""));
  const screen = el("a", "muted", "@" + (view.screen ?? "?"));
  screen.href = "?user=" + encodeURIComponent(view.screen ?? "");
  who.append(screen);
  head.append(who);
  head.append(el("span", "muted date", fmtDate(view.createdMs)));
  box.append(head);

  const body = el("div", "text");
  body.append(textFrag(view));
  box.append(body);

  const gallery = mediaGallery(view);
  if (gallery)
    box.append(gallery);

  if (view.quoted && kind !== Card.QUOTE)
    box.append(card(view.quoted, Card.QUOTE));

  box.append(statsRow(view.counts));

  if (kind !== Card.MAIN)
    linkify(box, view);
  return box;
}

// Rows and quotes open the tweet when clicked anywhere neutral.
function linkify(box, view) {
  box.classList.add("open");
  box.addEventListener("click", (event) => {
    if (event.target.closest("a, video"))
      return;
    location.href = `?tweet=${view.id}&user=${encodeURIComponent(view.screen ?? "")}`;
  });
}

// Rebuilds tweet text around its entities. Indices count code points,
// so the text is walked as an array of them.
function textFrag(view) {
  const chars = Array.from(view.text);
  const from = view.range?.[0] ?? 0;
  const to = view.range?.[1] ?? chars.length;

  const marks = [];
  for (const u of view.urls)
    marks.push({ at: u.indices, node: extLink(u.expanded_url, u.display_url) });
  for (const m of view.mentions) {
    const link = el("a", "tag", "@" + m.screen_name);
    link.href = "?user=" + encodeURIComponent(m.screen_name);
    marks.push({ at: m.indices, node: link });
  }
  for (const h of view.hashtags)
    marks.push({ at: h.indices, node: el("span", "tag", "#" + h.text) });
  for (const m of view.media)
    if (m.indices)
      marks.push({ at: m.indices, node: null }); // rendered as real media below
  marks.sort((a, b) => a.at[0] - b.at[0]);

  const frag = document.createDocumentFragment();
  let cursor = from;
  for (const mark of marks) {
    const [start, end] = mark.at;
    if (start < cursor || start >= to)
      continue;
    if (start > cursor)
      frag.append(chars.slice(cursor, start).join(""));
    if (mark.node)
      frag.append(mark.node);
    cursor = end;
  }
  if (cursor < to)
    frag.append(chars.slice(cursor, to).join(""));
  return frag;
}

function mediaGallery(view) {
  if (!view.media.length)
    return null;

  const box = el("div", "media");
  for (const m of view.media) {
    const mp4s = m.variants.filter((v) => v.mime === "video/mp4");

    if (mp4s.length) {
      const best = mp4s.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "none";
      if (safeUrl(m.thumb)) video.poster = m.thumb;
      if (safeUrl(best.src)) video.src = best.src;
      if (m.type === "animated_gif") { video.loop = true; video.muted = true; }
      box.append(video);
      continue;
    }

    if (!safeUrl(m.thumb))
      continue;
    const img = document.createElement("img");
    img.src = m.thumb;
    img.loading = "lazy";
    img.alt = m.alt ?? "";
    if (m.type !== "photo") {
      // Timeline payloads carry only a thumbnail: link it to the tweet,
      // where the playable video is available.
      const link = el("a", "vidthumb");
      link.href = `?tweet=${view.id}&user=${encodeURIComponent(view.screen ?? "")}`;
      link.append(img, el("span", "play", "▶"));
      box.append(link);
    } else {
      box.append(img);
    }
  }
  return box;
}

function statsRow(counts) {
  const row = el("div", "stats");
  const stats = [
    [counts.replies, "replies"],
    [counts.reposts, "reposts"],
    [counts.likes, "likes"],
  ];
  for (const [n, label] of stats)
    if (n !== undefined && n !== null)
      row.append(el("span", "", `${fmtCount(n)} ${label}`));
  return row;
}

/* ----------------------------------------------------------- home page */

function showHome() {
  document.title = "Tweet Viewer";

  const page = el("div", "conv home");
  page.append(el("h1", "", "Tweet Viewer"));
  page.append(el("p", "muted",
    "Browse X without an account. Paste a tweet link or a username. " +
    "Search isn't available — X has no public search endpoint."));

  const form = el("form", "lookup");
  const input = document.createElement("input");
  input.placeholder = "@username or x.com/user/status/…";
  input.autofocus = true;
  const go = el("button", "", "View");
  form.append(input, go);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const dest = lookupUrl(input.value.trim());
    if (dest)
      location.href = dest;
  });

  page.append(form);
  app.replaceChildren(page);
}

function lookupUrl(query) {
  if (!query)
    return null;

  const status = query.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/);
  if (status)
    return `?tweet=${status[2]}&user=${status[1]}`;

  const name = query.match(/^@?([A-Za-z0-9_]{1,15})$/) ??
    query.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/);
  if (name)
    return "?user=" + name[1];
  return null;
}

/* -------------------------------------------------------------- helpers */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function note(text) {
  return el("div", "muted note", text);
}

function avatarImg(url, extra) {
  if (!safeUrl(url))
    return el("span", "avatar " + extra);
  const img = document.createElement("img");
  img.className = "avatar " + extra;
  img.src = url;
  return img;
}

function extLink(href, label) {
  const link = el("a", "link", label ?? href ?? "");
  if (safeUrl(href)) {
    link.href = href;
    link.rel = "noreferrer noopener";
  }
  return link;
}

function safeUrl(url) {
  return typeof url === "string" && url.startsWith("https://");
}

function fmtDate(ms) {
  if (!ms)
    return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function showError(title, detail) {
  const page = el("div", "conv");
  page.append(el("h1", "", title));
  if (detail)
    page.append(el("p", "muted", detail));
  page.append(el("p", "muted", "X may have changed its markup, or the content is gone."));
  app.replaceChildren(page);
}
