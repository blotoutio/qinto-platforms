<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Broker\Heartbeat;
use Blotout\Consent\Options;
use Blotout\Consent\Tests\TestCase;
use Brain\Monkey\Functions;

final class UninstallTest extends TestCase {

	public function test_tells_the_broker_then_removes_everything_it_stored(): void {
		$cleared = array();
		Functions\when( 'wp_clear_scheduled_hook' )->alias(
			static function ( $hook ) use ( &$cleared ) {
				$cleared[] = $hook;
			}
		);
		$this->registered();
		$this->store[ Options::SETTINGS ] = array( 'qinto_host' => 'q.shop.example.com' );
		$this->respond( 200, array( 'disconnected' => true ) );

		if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
			define( 'WP_UNINSTALL_PLUGIN', 'blotout-consent/blotout-consent.php' );
		}
		require dirname( __DIR__, 2 ) . '/uninstall.php';

		$this->assertSame( 'https://consent-wordpress.blotout.io/disconnect', $this->requests[0]['url'] );
		$this->assertSame( array(), $this->store );
		$this->assertSame( array( Heartbeat::CRON_HOOK ), $cleared );
	}
}
