type Props = {
  handle: string
}

/**
 * How to switch on the optional custom-code block.
 *
 * SHOPLINE does not activate an App Embed Block on install — "Merchants need to activate them from
 * Theme settings > App embeds in the theme editor" — and no API can do it for them, so the only
 * honest thing this app can offer is the route and the two clicks.
 *
 * The link goes to the store's theme page rather than straight into the editor: the editor's URL
 * carries a theme identifier this app has no scope to read, and a link that guesses it would land
 * the merchant nowhere.
 */
export function AppEmbedNote({ handle }: Props) {
  return (
    <div className='card'>
      <h2>Optional: your own tracking code</h2>
      <p className='muted'>
        Blotout's tracking needs none of this and is already running. This is only for a vendor snippet you would otherwise have to edit
        your theme to add — it is a separate switch, and turning it off never affects Blotout.
      </p>
      <ol className='stack muted' style={{ margin: 0, paddingLeft: '1.2rem' }}>
        <li>
          Open <a href={`https://${handle}.myshopline.com/admin/website/shopSetting`}>Online Store</a>, then <strong>Customize</strong> on
          your live theme.
        </li>
        <li>
          In the editor, open <strong>App embeds</strong> — the third icon down the left edge — and switch on <strong>Blotout</strong>.
        </li>
        <li>Paste your snippet into the field there and save. It goes into the page's head on every storefront page.</li>
      </ol>
    </div>
  )
}
