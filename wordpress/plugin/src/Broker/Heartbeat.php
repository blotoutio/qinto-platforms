<?php
/**
 * The daily check-in that tells the broker this install still exists.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Broker;

use Blotout\Consent\Options;

/**
 * The broker keeps a grant alive only while its install checks in. A plugin deleted over FTP, or
 * deactivated, stops checking in, and the broker revokes the grant after 60 silent days.
 */
final class Heartbeat {

	const CRON_HOOK = 'blotout_consent_heartbeat';

	/**
	 * Plugin options.
	 *
	 * @var Options
	 */
	private $options;

	/**
	 * Broker client.
	 *
	 * @var BrokerClient
	 */
	private $broker;

	/**
	 * Takes its dependencies.
	 *
	 * @param Options      $options Plugin options.
	 * @param BrokerClient $broker  Broker client.
	 */
	public function __construct( Options $options, BrokerClient $broker ) {
		$this->options = $options;
		$this->broker  = $broker;
	}

	/** Hooks into WordPress. Scheduling runs in wp-admin only, where the install registers. */
	public function register(): void {
		add_action( self::CRON_HOOK, array( $this, 'beat' ) );
		add_action( 'admin_init', array( $this, 'schedule' ) );
	}

	/** Daily while the install is registered. */
	public function schedule(): void {
		if ( null !== $this->options->registration() && ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', self::CRON_HOOK );
		}
	}

	/** Checks in; stops once there is nothing to check in for. */
	public function beat(): void {
		if ( null === $this->options->registration() ) {
			wp_clear_scheduled_hook( self::CRON_HOOK );

			return;
		}

		if ( BrokerClient::forgot_install( $this->broker->write( 'POST', '/heartbeat' ) ) ) {
			$this->options->forget_registration();
			wp_clear_scheduled_hook( self::CRON_HOOK );
		}
	}
}
