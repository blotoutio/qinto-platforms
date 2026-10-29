/**
 * Drops an event SHOPLINE republished without anything having changed.
 *
 * The storefront republishes `product_viewed` on every change to the product form — clicking the
 * quantity stepper republishes it with the identical variant — and republishes `page_viewed` when
 * the theme rewrites the URL. Forwarding those verbatim reports a view the shopper never made.
 *
 * Only the immediately preceding identity is remembered: a shopper who looks at S, then M, then S
 * again has genuinely viewed S twice.
 */
export const distinctBy = <T>(identity: (value: T) => string): ((value: T) => boolean) => {
  let previous: string | null = null

  return (value: T) => {
    const current = identity(value)
    if (current === previous) {
      return false
    }

    previous = current

    return true
  }
}
