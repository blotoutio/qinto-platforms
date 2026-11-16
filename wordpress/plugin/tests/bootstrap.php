<?php
/**
 * PHPUnit bootstrap: Composer autoload, WordPress constants, no WordPress.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

require_once dirname( __DIR__ ) . '/vendor/autoload.php';

define( 'ABSPATH', '/tmp/wordpress/' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'BLOTOUT_CONSENT_VERSION', '1.0.0' );
define( 'BLOTOUT_CONSENT_URL', 'https://wp.example.com/wp-content/plugins/blotout-consent/' );

if ( ! class_exists( 'WP_Error' ) ) {
	/** The one WordPress class the plugin checks for. */
	class WP_Error {} // phpcs:ignore
}
