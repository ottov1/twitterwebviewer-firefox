# Twitter Web Viewer Redirect

Automatically redirects twitter.com and x.com links to [twitterwebviewer.com](https://twitterwebviewer.com), an alternative Twitter front-end you can browse without an account.

Works like XCancel, but targets twitterwebviewer.com. Since that site uses its own URL scheme, links are rewritten, not just domain-swapped:

| Twitter/X | Redirects to |
|---|---|
| `x.com/naval` | `twitterwebviewer.com/?user=naval` |
| `x.com/naval/status/123` | `twitterwebviewer.com/?user=naval&tweet=123` |
| `x.com/search?q=foo` | `twitterwebviewer.com/twitter-search?q=foo` |
| `x.com/hashtag/foo` | `twitterwebviewer.com/twitter-search?q=%23foo` |
| anything else | `twitterwebviewer.com` |

## Privacy

- Only top-level navigations to twitter.com / x.com are intercepted.
- No data is collected, stored, or transmitted anywhere.
- No options, no background activity beyond the redirect itself.

## Permissions

- `webRequest` / `webRequestBlocking`: required to redirect before the page loads.
- Access to twitter.com and x.com: the domains being redirected.

Not affiliated with Twitter/X or twitterwebviewer.com.
