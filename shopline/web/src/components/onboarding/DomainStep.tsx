import type { DomainSuggestion, Status } from '../../lib/types'

type Props = {
  store: Status['store']
  suggestions: DomainSuggestion[]
  rootDomain: string
  busy: boolean
  onRootDomainChange: (value: string) => void
  onCreate: () => void
}

/**
 * Step one: which domain Qinto should serve from.
 *
 * The suggestion list is the honest realization of "show the domains we found". SHOPLINE exposes
 * exactly one domain — `merchants/shop.json` and GraphQL's `Shop` return the same single field —
 * so the rest of the list is the team's existing Qinto sites, and free text is always available.
 */
export function DomainStep({ store, suggestions, rootDomain, busy, onRootDomainChange, onCreate }: Props) {
  return (
    <div className='card'>
      <h2>Which domain should Qinto measure?</h2>
      <p className='muted'>
        Qinto serves from a subdomain of your own domain, which is what keeps visitor identity first-party. Use the domain your storefront
        is on.
      </p>

      {store.usesDefaultDomain ? (
        <div className='notice notice-warn'>
          Qinto cannot serve from a SHOPLINE-owned domain like <code>{store.primaryDomain ?? `${store.handle}.myshopline.com`}</code>, so
          enter a domain you control. Until your storefront is on that domain too, delivery falls back to Qinto's development URL and
          visitors get no persistent id.
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className='stack'>
          <span className='muted'>Domains we found</span>
          <div className='row'>
            {suggestions.map((suggestion) => (
              <button
                type='button'
                className='btn-secondary'
                key={suggestion.host}
                onClick={() => onRootDomainChange(suggestion.host)}
                disabled={suggestion.isDefault}
                title={suggestion.isDefault ? 'A SHOPLINE-owned domain cannot be used' : undefined}
              >
                {suggestion.host}
                <span className='subtle'> · {suggestion.source === 'qinto_site' ? 'an existing site' : 'your SHOPLINE storefront'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className='stack'>
        <label htmlFor='root-domain'>Domain</label>
        <input
          id='root-domain'
          type='text'
          placeholder='example.com'
          value={rootDomain}
          onChange={(event) => onRootDomainChange(event.target.value)}
        />
        <span className='subtle'>Enter it without a scheme. Qinto picks the subdomain it will serve from.</span>
      </div>

      <div className='row'>
        <button type='button' className='btn-primary' onClick={onCreate} disabled={busy}>
          {busy ? 'Creating…' : 'Create the site'}
        </button>
      </div>
    </div>
  )
}
