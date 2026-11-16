# qinto-platforms

One directory per platform (`shopline/`, `wordpress/`, `medusa/`). Each has its own `AGENTS.md`.

## A platform app never deploys a Qinto site

Deploying belongs to Qinto, because Qinto gates it on the team's billing. A platform app may:

- connect with OAuth and let the merchant pick a site
- create a site, run its DNS steps, and change its settings, apps and allowed origins
  (Qinto redeploys an already-deployed site on these by itself)
- put the snippet or pixel on the platform and send its events

It must never call `POST /teams/{teamId}/domains/{domainId}/deploy`, and never handle payment. A site
whose `status` is still `pending` has never been deployed: refuse to select it and deep-link the
merchant to the site's settings page in Qinto (its Deployment card has **Run deployment**), then let them come back and select it:

```
<portal origin>/team/{teamId}/domain/{domainId}/settings/general
```

The portal origin is the OAuth authorize origin (`QINTO_AUTHORIZE_ORIGIN`). A logged-out merchant is
sent through login and back to the same URL.
