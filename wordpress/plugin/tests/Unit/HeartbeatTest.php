<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Broker\Heartbeat;
use Blotout\Consent\Options;
use Blotout\Consent\Tests\TestCase;
use Brain\Monkey\Functions;

final class HeartbeatTest extends TestCase {

	/** @var array<int,string> */
	private $scheduled = array();

	/** @var int */
	private $cleared = 0;

	protected function setUp(): void {
		parent::setUp();
		$this->scheduled = array();
		$this->cleared   = 0;
		Functions\when( 'wp_next_scheduled' )->justReturn( false );
		Functions\when( 'wp_schedule_event' )->alias(
			function ( $time, $recurrence, $hook ) {
				$this->scheduled[] = "$recurrence:$hook";
			}
		);
		Functions\when( 'wp_clear_scheduled_hook' )->alias(
			function () {
				++$this->cleared;
			}
		);
	}

	private function heartbeat(): Heartbeat {
		$options = new Options();

		return new Heartbeat( $options, new BrokerClient( $options ) );
	}

	public function test_schedules_a_daily_check_in_only_once_registered(): void {
		$this->heartbeat()->schedule();
		$this->assertSame( array(), $this->scheduled );

		$this->registered();
		$this->heartbeat()->schedule();
		$this->assertSame( array( 'daily:' . Heartbeat::CRON_HOOK ), $this->scheduled );
	}

	public function test_checks_in_with_a_signed_call(): void {
		$this->registered();
		$this->respond( 204 );

		$this->heartbeat()->beat();

		$this->assertSame( 'https://consent-wordpress.blotout.io/heartbeat', $this->requests[0]['url'] );
		$this->assertSame( 'POST', $this->requests[0]['method'] );
		$this->assertArrayHasKey( 'X-Blotout-Sig', $this->requests[0]['headers'] );
		$this->assertSame( 0, $this->cleared );
	}

	public function test_stops_once_the_broker_forgot_the_install(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'unknown_registration' ) );

		$this->heartbeat()->beat();

		$this->assertArrayNotHasKey( Options::REGISTRATION, $this->store );
		$this->assertSame( 1, $this->cleared );
	}

	public function test_a_failed_check_in_changes_nothing(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'clock_skew' ) );

		$this->heartbeat()->beat();

		$this->assertArrayHasKey( Options::REGISTRATION, $this->store );
		$this->assertSame( 0, $this->cleared );
	}

	public function test_stops_when_there_is_no_registration(): void {
		$this->heartbeat()->beat();

		$this->assertSame( array(), $this->requests );
		$this->assertSame( 1, $this->cleared );
	}
}
