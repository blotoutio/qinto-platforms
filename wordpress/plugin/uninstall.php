<?php
/**
 * Removes everything the plugin stored, and tells the broker to revoke this install's grant.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once __DIR__ . '/src/autoload.php';

$blotout_consent_options = new \Blotout\Consent\Options();
if ( null !== $blotout_consent_options->registration() ) {
	// Best effort: the local cleanup below runs whatever the broker answers.
	( new \Blotout\Consent\Broker\BrokerClient( $blotout_consent_options ) )->write( 'POST', '/disconnect' );
}

delete_option( \Blotout\Consent\Options::SETTINGS );
delete_option( \Blotout\Consent\Options::REGISTRATION );
wp_clear_scheduled_hook( \Blotout\Consent\Broker\Heartbeat::CRON_HOOK );
