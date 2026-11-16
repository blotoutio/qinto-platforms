/** The site's settings page in Qinto, whose Deployment card deploys it; this app never deploys. */
export const qintoDeployUrl = (portalUrl: string, teamId: string, domainId: string): string =>
  `${portalUrl}/team/${encodeURIComponent(teamId)}/domain/${encodeURIComponent(domainId)}/settings/general`

/** A new tab: Qinto refuses to load in the admin iframe, and the merchant comes back here after. */
export const openInQinto = (url: string): void => {
  window.open(url, '_blank', 'noopener')
}
