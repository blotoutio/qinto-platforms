/**
 * Stands in for App Bridge in the local preview.
 *
 * The real module requires the SHOPLINE Admin iframe. The preview exists to look at the actual
 * components with the actual stylesheet, so this replaces only the host, and host actions become
 * `alert`-free console lines.
 */
export const isEmbedded = (): boolean => true
export const bridge = (): unknown => ({})
export const storeHandle = (): string | null => 'srini-test'

export const toast = {
  success: (message: string): void => console.info('[toast success]', message),
  error: (message: string): void => console.info('[toast error]', message),
  info: (message: string): void => console.info('[toast info]', message)
}

export const confirmDanger = (input: { title: string; content: string; onOk: () => Promise<void> | void }): void => {
  console.info('[confirm]', input.title)
  void input.onOk()
}

export const openTopLevel = (url: string): void => {
  console.info('[top-level redirect]', url)
}
