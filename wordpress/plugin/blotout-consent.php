<?php
/**
 * Plugin Name:       Blotout Consent
 * Plugin URI:        https://blotout.io
 * Description:       Runs the Blotout consent banner from Qinto and bridges visitor decisions into the WP Consent API (and, optionally, Google Consent Mode v2) so other plugins react.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Blotout
 * Author URI:        https://blotout.io
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       blotout-consent
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BLOTOUT_CONSENT_VERSION', '1.0.0' );
define( 'BLOTOUT_CONSENT_FILE', __FILE__ );
define( 'BLOTOUT_CONSENT_DIR', plugin_dir_path( __FILE__ ) );
define( 'BLOTOUT_CONSENT_URL', plugin_dir_url( __FILE__ ) );

require_once BLOTOUT_CONSENT_DIR . 'src/autoload.php';

\Blotout\Consent\Plugin::boot( __FILE__ );
