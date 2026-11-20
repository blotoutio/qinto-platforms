<?php
/**
 * Wires the modules together.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent;

use Blotout\Consent\Admin\AjaxController;
use Blotout\Consent\Admin\SettingsPage;
use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Broker\Heartbeat;
use Blotout\Consent\Compat\WpConsentApi;
use Blotout\Consent\Connect\ConnectFlow;
use Blotout\Consent\Connect\SiteVerifier;
use Blotout\Consent\Storefront\ConsentModeV2;
use Blotout\Consent\Storefront\QintoSnippet;

/**
 * Builds every module once, with its dependencies passed in. No module-level state.
 */
final class Plugin {

	/**
	 * Hooks the plugin into WordPress.
	 *
	 * @param string $file Main plugin file.
	 */
	public static function boot( string $file ): void {
		$options = new Options();
		$broker  = new BrokerClient( $options );

		( new WpConsentApi( $options, plugin_basename( $file ) ) )->register();
		( new ConsentModeV2( $options ) )->register();
		( new QintoSnippet( $options ) )->register();
		( new SiteVerifier( $options ) )->register();
		( new Heartbeat( $options, $broker ) )->register();

		if ( is_admin() ) {
			( new SettingsPage( $options, $broker, $file ) )->register();
			( new ConnectFlow( $options, $broker ) )->register();
			( new AjaxController( $options, $broker ) )->register();
		}

		register_activation_hook(
			$file,
			static function (): void {
				add_option( Options::SETTINGS, Options::defaults() );
			}
		);
		register_deactivation_hook(
			$file,
			static function (): void {
				wp_clear_scheduled_hook( Heartbeat::CRON_HOOK );
			}
		);
	}
}
