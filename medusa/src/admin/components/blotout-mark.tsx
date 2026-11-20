import type { SVGProps } from "react"

/**
 * The Blotout "b" mark, from the same SVG the WordPress plugin ships
 * (qinto-platforms/wordpress/plugin/assets/blotout-logo.svg), used as the page icon and the
 * sidebar icon.
 *
 * Painted with `currentColor` rather than the file's fixed near-black, so it follows Medusa
 * Admin's light and dark themes through the surrounding text colour.
 */

const MARK = "M17.7559 12V30H0V18H5.91895V24H11.8369V18H5.91895V12H17.7559ZM5.91895 12H0V6H5.91895V12Z"

/** Defaults to Medusa's 15px icon size; pass width/height for larger uses. */
export const BlotoutMark = (props: SVGProps<SVGSVGElement>) => (
  <svg width={15} height={15} viewBox="-3 6 24 24" fill="none" aria-hidden="true" {...props}>
    <path d={MARK} fill="currentColor" />
  </svg>
)
