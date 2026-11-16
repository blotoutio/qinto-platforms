<?php
/**
 * Google Consent Mode v2 default plus the WP Consent API to gtag bridge.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Storefront;

use Blotout\Consent\Options;

/**
 * The script is pinned byte for byte by `tests/fixtures/consent-mode.html`.
 */
final class ConsentModeV2 {

	/**
	 * Sends a choice stored on an earlier page. `wp_set_consent` fires no change event when the value
	 * is unchanged, so without this a returning visitor's tags stay at the denied default.
	 */
	const RESTORE = "<script id=\"blotout-consent-mode-restore\">\n"
		. "document.addEventListener('DOMContentLoaded', function(){ if (typeof window.wp_has_consent === 'function') { gtag('consent', 'update', blotoutToGtagConsent()); } });\n"
		. "</script>\n";

	/**
	 * Plugin options.
	 *
	 * @var Options
	 */
	private $options;

	/**
	 * Takes its dependencies.
	 *
	 * @param Options $options Plugin options.
	 */
	public function __construct( Options $options ) {
		$this->options = $options;
	}

	/** Priority 1 on wp_head: it has to beat any GTM or gtag snippet another plugin prints. */
	public function register(): void {
		add_action( 'wp_head', array( $this, 'render' ), 1 );
	}

	/** Prints the scripts while the banner prints and Consent Mode is on. */
	public function render(): void {
		if ( null === $this->options->qinto_host() || ! $this->options->consent_mode_enabled() ) {
			return;
		}
		// Static JS; the fence keeps phpcbf from re-indenting it.
		// phpcs:disable Generic.WhiteSpace.DisallowSpaceIndent, Generic.WhiteSpace.ScopeIndent, Universal.WhiteSpace.PrecisionAlignment
		?>
<script id="blotout-consent-mode-bootstrap">
/* Blotout Consent — Google Consent Mode v2 bootstrap. Loaded before GTM/gtag. */
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 2000
});
function blotoutToGtagConsent(){
  var has = (typeof window.wp_has_consent === 'function') ? window.wp_has_consent : function(){ return false; };
  var marketing = has('marketing');
  var statistics = has('statistics');
  return {
    ad_storage: marketing ? 'granted' : 'denied',
    ad_user_data: marketing ? 'granted' : 'denied',
    ad_personalization: marketing ? 'granted' : 'denied',
    analytics_storage: statistics ? 'granted' : 'denied'
  };
}
/* WP Consent API dispatches `wp_listen_for_consent_change` on each wp_set_consent. */
document.addEventListener('wp_listen_for_consent_change', function(){ gtag('consent', 'update', blotoutToGtagConsent()); });
document.addEventListener('wp_consent_type_defined', function(){ gtag('consent', 'update', blotoutToGtagConsent()); });
</script>
		<?php
		// phpcs:enable
		echo self::RESTORE; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup.
	}
}
