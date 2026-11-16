<?php
/**
 * Registers the plugin as a consent-management plugin with the WP Consent API.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Compat;

use Blotout\Consent\Options;

/**
 * The Qinto app calls `wp_set_consent` itself; this only declares the plugin and its consent type.
 */
final class WpConsentApi {

	/**
	 * Plugin options.
	 *
	 * @var Options
	 */
	private $options;

	/**
	 * Plugin basename.
	 *
	 * @var string
	 */
	private $basename;

	/**
	 * Takes its dependencies.
	 *
	 * @param Options $options  Plugin options.
	 * @param string  $basename Plugin basename.
	 */
	public function __construct( Options $options, string $basename ) {
		$this->options  = $options;
		$this->basename = $basename;
	}

	/** Hooks into WordPress. */
	public function register(): void {
		add_filter( 'wp_consent_api_registered_' . $this->basename, '__return_true' );
		add_filter( 'wp_get_consent_type', array( $this, 'consent_type' ) );
	}

	/** The configured type, replacing whatever the filter was given. */
	public function consent_type(): string {
		return $this->options->consent_type();
	}
}
