/* Blotout Consent admin page: the site picker, the "Use the Qinto URL" switch and disconnect. */
;(() => {
  const config = window.BlotoutConsent
  if (!config) {
    return
  }
  const strings = config.i18n

  // ---------- talking to WordPress ----------

  // Calls one of the plugin's admin-ajax actions. Resolves with its data, or throws an Error whose
  // message is the error slug (for example "bad_domain").
  const post = async (action, data = {}) => {
    const body = new FormData()
    body.append('action', `blotout_${action}`)
    body.append('nonce', config.nonce)
    for (const [key, value] of Object.entries(data)) {
      body.append(key, value)
    }

    const response = await fetch(config.ajaxUrl, { method: 'POST', credentials: 'same-origin', body })
    const json = await response.json().catch(() => null)
    if (json?.success) {
      return json.data
    }
    const error = new Error(json?.data?.code || json?.data?.error || 'unknown')
    error.deployUrl = json?.data?.deployUrl || ''
    throw error
  }

  const errorMessage = (error) => strings[`err_${error.message}`] || `${strings.err_unknown} (${error.message})`

  // crypto.randomUUID needs https; wp-admin may run on plain http.
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // ---------- small building blocks ----------

  // Creates an element. `text` sets its text, `onclick` adds a click handler, anything else is an
  // attribute. Children can be elements or strings; empty ones (null, false, "") are skipped.
  const el = (tag, attributes = {}, children = []) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') {
        node.textContent = value
      } else if (key === 'onclick') {
        node.addEventListener('click', value)
      } else {
        node.setAttribute(key, value)
      }
    }
    node.append(...children.filter(Boolean))

    return node
  }

  const ICONS = {
    success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    warning:
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>'
  }

  // A Lucide icon from ICONS above (fixed markup, never user data).
  const icon = (name, className = 'bo-icon') => {
    const wrapper = document.createElement('span')
    wrapper.innerHTML = `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`

    return wrapper.firstChild
  }

  const button = (label, variant, onclick) => el('button', { type: 'button', class: `bo-button ${variant}`, onclick }, [label])

  const badge = (kind, label) => el('span', { class: `bo-badge is-${kind}`, text: label })

  const alert = (kind, message, title = '') =>
    el('div', { class: `bo-alert is-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [
      icon(kind),
      el('div', {}, [title && el('p', { class: 'bo-alert-title', text: title }), el('p', { text: message })])
    ])

  const spinner = () => el('span', { class: 'bo-spinner', 'aria-hidden': 'true' })

  const loadingText = (label) => el('p', { class: 'bo-row bo-muted', role: 'status' }, [spinner(), label])

  // An expandable section, e.g. "Create a new Qinto site instead".
  const disclosure = (summary, children, open = false) => {
    const details = el('details', {}, [
      el('summary', {}, [icon('chevron', 'bo-icon bo-chevron'), summary]),
      el('div', { class: 'bo-disclosure' }, children)
    ])
    details.open = open

    return details
  }

  // A labelled input with optional help text and a place for an error under it.
  const field = (id, label, input, help = '') => {
    const error = el('p', { class: 'bo-field-error', id: `${id}-error`, hidden: '' })
    input.id = id
    input.setAttribute('aria-describedby', help ? `${id}-help ${id}-error` : `${id}-error`)
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid')
      error.hidden = true
    })

    const element = el('div', { class: 'bo-field' }, [
      el('label', { for: id, text: label }),
      input,
      help && el('p', { class: 'bo-field-description', id: `${id}-help`, text: help }),
      error
    ])
    const showError = (message) => {
      input.setAttribute('aria-invalid', 'true')
      error.textContent = message
      error.hidden = false
      input.focus()
    }

    return { element, showError }
  }

  // Shows a spinner and "Working…" in the button until the task finishes.
  const withSpinner = async (btn, task) => {
    const original = Array.from(btn.childNodes)
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    btn.replaceChildren(spinner(), strings.working)
    try {
      return await task()
    } finally {
      btn.disabled = false
      btn.removeAttribute('aria-busy')
      btn.replaceChildren(...original)
    }
  }

  const copyButton = (value) => {
    if (!navigator.clipboard) {
      return null
    }
    const btn = button(strings.copy, 'is-ghost is-xs', async () => {
      await navigator.clipboard.writeText(value)
      btn.replaceChildren(icon('check'), strings.copied)
      setTimeout(() => btn.replaceChildren(icon('copy'), strings.copy), 2000)
    })
    btn.prepend(icon('copy'))
    btn.setAttribute('aria-label', `${strings.copy}: ${value}`)

    return btn
  }

  // ---------- the site picker (one card, redrawn for each step) ----------

  // This WordPress site's host without "www.", e.g. shop.example.com.
  const thisHost = String(config.siteHost || '')
    .toLowerCase()
    .replace(/^www\./, '')

  const matchesThisSite = (site) => {
    const rootDomain = String(site.rootDomain || '').toLowerCase()

    return rootDomain !== '' && (thisHost === rootDomain || thisHost.endsWith(`.${rootDomain}`))
  }

  const drawCard = (card, { title, badges = [], description = '', content, footer = [] }) => {
    card.replaceChildren(
      ...[
        el('header', { class: 'bo-card-header' }, [
          el('div', { class: 'bo-row' }, [el('h2', { class: 'bo-card-title', text: title }), ...badges]),
          description && el('p', { class: 'bo-card-description', text: description })
        ]),
        el('div', { class: 'bo-card-content' }, content),
        footer.length > 0 && el('footer', { class: 'bo-card-footer is-split' }, footer)
      ].filter(Boolean)
    )
  }

  // Reloads without a one-off message (e.g. "Connected to Qinto.") left in the URL.
  const reloadPage = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('blotout_result')
    url.searchParams.delete('blotout_error')
    window.location.replace(url)
  }

  // Picks the site at the broker, then reloads to show the configuration screen.
  const selectSite = async (site, btn, messages) => {
    messages.replaceChildren()
    try {
      await withSpinner(btn, () => post('select_site', site))
      messages.replaceChildren(alert('success', strings.saved))
      reloadPage()
    } catch (error) {
      // Deploying is Qinto's: a never-deployed site gets a link to its deploy page there.
      const deploy =
        error.deployUrl &&
        el('a', { class: 'button', href: error.deployUrl, target: '_blank', rel: 'noopener', text: strings.deployInQinto })
      messages.replaceChildren(alert('error', errorMessage(error), strings.useFailed), deploy)
    }
  }

  const dnsRow = (record) =>
    el('tr', {}, [
      el('td', { text: record.type }),
      el('td', {}, [el('div', { class: 'bo-copy' }, [el('code', { text: record.name }), copyButton(record.name)])]),
      el('td', {}, [el('div', { class: 'bo-copy' }, [el('code', { text: record.value }), copyButton(record.value)])])
    ])

  // "Email these records to someone else". One id per send, so a retry after a timeout does not
  // send the email twice; changing the addresses starts a new send.
  const emailRecordsForm = (site) => {
    const emails = el('input', { type: 'text', autocomplete: 'email' })
    const emailsField = field('blotout-dns-emails', strings.emailsLabel, emails, strings.emailsHelp)
    const result = el('div', { role: 'status' })
    let submissionId = uuid()
    emails.addEventListener('input', () => {
      submissionId = uuid()
    })

    const send = button(strings.share, 'is-outline', async () => {
      result.replaceChildren()
      try {
        await withSpinner(send, () => post('dns_share', { ...site, emails: emails.value, submissionId }))
        result.replaceChildren(alert('success', strings.shared))
        submissionId = uuid()
      } catch (error) {
        if (error.message === 'bad_emails') {
          emailsField.showError(errorMessage(error))
        } else {
          result.replaceChildren(alert('error', errorMessage(error)))
        }
      }
    })

    return disclosure(strings.emailToggle, [emailsField.element, el('div', {}, [send]), result])
  }

  // Shown after creating a site: the DNS records to add, then "Continue with the Qinto URL".
  const showDnsStep = async (card, site, siteName) => {
    const records = el('tbody', {}, [el('tr', {}, [el('td', { colspan: '3' }, [loadingText(strings.loadingDns)])])])
    const dnsStatus = el('span', { role: 'status' })
    const messages = el('div')

    const showRecords = (dns) => {
      records.replaceChildren(...dns.records.map(dnsRow))
      dnsStatus.replaceChildren(dns.valid ? badge('success', strings.dnsValid) : badge('warning', strings.dnsPending))
    }

    const check = button(strings.dnsCheck, 'is-outline', async () => {
      try {
        showRecords(await withSpinner(check, () => post('dns_check', site)))
      } catch (error) {
        dnsStatus.replaceChildren(alert('error', errorMessage(error)))
      }
    })
    const back = button(strings.back, 'is-ghost', () => loadSites(card, site.teamId))
    back.prepend(icon('back'))
    const useIt = button(strings.continueQinto, 'is-primary is-lg', () => selectSite(site, useIt, messages))

    drawCard(card, {
      title: strings.dnsHeading.replace('%s', siteName),
      badges: [badge('warning', strings.pending)],
      description: strings.dnsHint,
      content: [
        el('table', { class: 'bo-table' }, [
          el('thead', {}, [
            el('tr', {}, [el('th', { text: strings.colType }), el('th', { text: strings.colName }), el('th', { text: strings.colValue })])
          ]),
          records
        ]),
        el('div', { class: 'bo-row' }, [check, dnsStatus]),
        emailRecordsForm(site),
        messages
      ],
      footer: [back, useIt]
    })

    try {
      showRecords(await post('dns', site))
    } catch (error) {
      records.replaceChildren()
      messages.replaceChildren(alert('error', errorMessage(error)))
    }
  }

  // "example.com" from whatever was typed, e.g. "https://www.Example.com/".
  const domainOf = (typed) =>
    typed
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')

  // "Create a new Qinto site instead", prefilled with this site's domain and name. Qinto allows
  // several sites per domain, so a domain the team already has is refused here instead.
  const createSiteForm = (card, teamId, existingSites, open) => {
    const domain = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', value: thisHost })
    const name = el('input', { type: 'text', autocomplete: 'off', value: config.siteName || '' })
    const domainField = field('blotout-new-domain', strings.domainLabel, domain, strings.domainHelp)
    const nameField = field('blotout-new-name', strings.siteNameLabel, name)
    const messages = el('div')

    const create = button(strings.create, 'is-outline', async () => {
      messages.replaceChildren()
      if (existingSites.some((site) => String(site.rootDomain || '').toLowerCase() === domainOf(domain.value))) {
        domainField.showError(strings.err_already_exists)
        return
      }
      try {
        const data = await withSpinner(create, () =>
          post('create_site', { teamId, rootDomain: domain.value.trim(), name: name.value.trim() })
        )
        showDnsStep(card, { teamId, domainId: data.site.domainId }, data.site.domain || data.site.name)
      } catch (error) {
        if (error.message === 'bad_domain' || error.message === 'already_exists') {
          domainField.showError(errorMessage(error))
        } else {
          messages.replaceChildren(alert('error', errorMessage(error)))
        }
      }
    })

    return disclosure(strings.createTitle, [domainField.element, nameField.element, el('div', {}, [create]), messages], open)
  }

  const siteOption = (site, checked, onPick) => {
    const radio = el('input', { type: 'radio', name: 'blotout-site', value: site.domainId })
    radio.checked = checked
    radio.addEventListener('change', () => onPick(site))

    return el('label', { class: 'bo-radio-card' }, [
      radio,
      el('span', { class: 'bo-radio-text' }, [
        el('span', { class: 'bo-site-name' }, [
          site.name || site.domain,
          matchesThisSite(site) && badge('rest', strings.matchesSite),
          site.status !== 'active' && badge('warning', strings.notDeployed)
        ]),
        el('span', { class: 'bo-muted bo-break', text: site.domain })
      ])
    ])
  }

  // Only shown when the grant covers more than one team.
  const teamPicker = (card, teams, currentTeamId) => {
    if (teams.length < 2) {
      return null
    }
    const select = el(
      'select',
      {},
      teams.map((team) => el('option', { value: team.teamId, text: team.name || team.teamId }))
    )
    select.value = currentTeamId
    select.addEventListener('change', () => loadSites(card, select.value))

    return field('blotout-team', strings.team, select).element
  }

  const showSitePicker = (card, { teams, teamId, sites }) => {
    const team = teams.find((t) => t.teamId === teamId)
    const messages = el('div')

    // The site matching this WordPress domain goes first and starts selected.
    const ordered = [...sites].sort((a, b) => Number(matchesThisSite(b)) - Number(matchesThisSite(a)))
    let picked = ordered[0]

    const useIt = button('', 'is-primary is-lg', () => selectSite({ teamId, domainId: picked.domainId }, useIt, messages))
    const updateButton = () => useIt.replaceChildren(strings.useNamed.replace('%s', picked.name || picked.domain))
    const pick = (site) => {
      picked = site
      updateButton()
      messages.replaceChildren()
    }

    const hasSites = ordered.length > 0
    if (hasSites) {
      updateButton()
    }
    const siteList = hasSites
      ? el(
          'div',
          { class: 'bo-radio-group', role: 'radiogroup', 'aria-label': strings.sitesLabel },
          ordered.map((site) => siteOption(site, site === picked, pick))
        )
      : alert('info', strings.noSites)

    drawCard(card, {
      title: strings.chooseTitle,
      description: strings.signedIn.replace('%1$s', card.dataset.email || '').replace('%2$s', team ? team.name || team.teamId : ''),
      content: [teamPicker(card, teams, teamId), siteList, messages, teamId && createSiteForm(card, teamId, sites, !hasSites)],
      footer: hasSites ? [useIt] : []
    })
  }

  const loadSites = async (card, teamId) => {
    drawCard(card, { title: strings.chooseTitle, content: [loadingText(strings.loading)] })
    try {
      showSitePicker(card, await post('sites', teamId ? { teamId } : {}))
    } catch (error) {
      drawCard(card, { title: strings.chooseTitle, content: [alert('error', errorMessage(error))] })
    }
  }

  // ---------- the configuration screen ----------

  // "Use the Qinto URL while DNS is pending".
  const setUpQintoUrlSwitch = (toggle) => {
    const result = el('div', { role: 'status' })
    toggle.closest('label').after(result)

    toggle.addEventListener('change', async () => {
      toggle.disabled = true
      result.replaceChildren(loadingText(strings.working))
      try {
        const data = await post('destination', { target: toggle.checked ? 'development_url' : 'domain' })
        document.getElementById('blotout-host').textContent = data.host
        document.getElementById('blotout-qinto-url-badge').hidden = !data.usingDevelopmentUrl
        result.replaceChildren(alert('success', strings.destinationSaved))
      } catch (error) {
        toggle.checked = !toggle.checked
        result.replaceChildren(alert('error', errorMessage(error)))
      } finally {
        toggle.disabled = false
      }
    })
  }

  // Two clicks instead of a confirm() dialog: the first asks, the second disconnects.
  const setUpDisconnect = (disconnect) => {
    const hint = disconnect.parentNode.querySelector('.bo-disconnect-hint')
    const idleClass = disconnect.className
    let asking = false

    const cancel = button(strings.cancel, 'is-ghost', () => {
      asking = false
      disconnect.className = idleClass
      disconnect.textContent = strings.disconnect
      hint.textContent = ''
      cancel.remove()
    })

    disconnect.addEventListener('click', async () => {
      if (!asking) {
        asking = true
        disconnect.className = 'bo-button is-destructive'
        disconnect.textContent = strings.confirmDisconnect
        disconnect.after(cancel)
        hint.textContent = strings.confirmLeave
        return
      }
      try {
        await withSpinner(disconnect, () => post('disconnect'))
        reloadPage()
      } catch (error) {
        hint.textContent = errorMessage(error)
      }
    })
  }

  // ---------- start ----------

  const wizard = document.getElementById('blotout-wizard')
  if (wizard) {
    loadSites(wizard)
  }
  const qintoUrlSwitch = document.getElementById('blotout-use-qinto-url')
  if (qintoUrlSwitch) {
    setUpQintoUrlSwitch(qintoUrlSwitch)
  }
  const disconnect = document.getElementById('blotout-disconnect')
  if (disconnect) {
    setUpDisconnect(disconnect)
  }
})()
