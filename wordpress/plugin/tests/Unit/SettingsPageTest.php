<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Admin\SettingsPage;
use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Options;
use Blotout\Consent\Tests\TestCase;

final class SettingsPageTest extends TestCase {

	/**
	 * Calls one of the page's private steps.
	 *
	 * @param string $method Method name.
	 * @param mixed  ...$args Arguments.
	 * @return mixed
	 */
	private function page( string $method, ...$args ) {
		$options = new Options();
		$page    = new SettingsPage( $options, new BrokerClient( $options ), '/p/blotout-consent.php' );
		$step    = new \ReflectionMethod( SettingsPage::class, $method );
		$step->setAccessible( true );

		return $step->invoke( $page, ...$args );
	}

	public function test_forgets_the_registration_only_when_the_broker_no_longer_knows_it(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'unknown_registration' ) );

		$this->assertSame( array( 'connection' => array( 'state' => 'none' ) ), $this->page( 'status' ) );
		$this->assertArrayNotHasKey( Options::REGISTRATION, $this->store );
	}

	public function test_a_wrong_clock_keeps_the_registration_and_says_so(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'clock_skew' ) );

		$status = $this->page( 'status' );

		$this->assertSame( 'clock', $this->page( 'screen', $status ) );
		$this->assertArrayHasKey( Options::REGISTRATION, $this->store );
	}

	public function test_any_other_failure_keeps_the_registration_and_shows_unreachable(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'unauthorized' ) );

		$this->assertNull( $this->page( 'status' ) );
		$this->assertSame( 'unreachable', $this->page( 'screen', null ) );
		$this->assertArrayHasKey( Options::REGISTRATION, $this->store );
	}

	public function test_mirrors_the_brokers_selection_into_the_front_end_options(): void {
		$this->registered();
		$this->respond(
			200,
			array(
				'connection' => array( 'state' => 'connected' ),
				'selection'  => array(
					'teamId'              => 't',
					'domainId'            => 'd',
					'siteName'            => 'Shop',
					'host'                => 'q.shop.example.com',
					'usingDevelopmentUrl' => true,
				),
			)
		);

		$status = $this->page( 'status' );

		$options = new Options();
		$this->assertSame( 'q.shop.example.com', $options->qinto_host() );
		$this->assertSame( 1, $options->all()['use_qinto_url'] );
		$this->assertSame( 'live', $this->page( 'screen', $status ) );
	}

	public function test_a_site_dropped_at_the_broker_is_dropped_here(): void {
		$this->registered();
		$this->store[ Options::SETTINGS ] = array(
			'qinto_host' => 'q.shop.example.com',
			'domain_id'  => 'd',
		);
		$this->respond( 200, array( 'connection' => array( 'state' => 'connected' ) ) );

		$status = $this->page( 'status' );

		$this->assertNull( ( new Options() )->qinto_host() );
		$this->assertSame( 'wizard', $this->page( 'screen', $status ) );
	}

	public function test_screens_for_each_connection_state(): void {
		$this->assertSame( 'connect', $this->page( 'screen', $this->page( 'status' ) ) );
		$this->assertSame( 'revoked', $this->page( 'screen', array( 'connection' => array( 'state' => 'revoked' ) ) ) );
	}

	public function test_asset_version_changes_with_the_file(): void {
		$plugin  = dirname( __DIR__, 2 );
		$options = new Options();
		$page    = new SettingsPage( $options, new BrokerClient( $options ), $plugin . '/blotout-consent.php' );
		$version = new \ReflectionMethod( SettingsPage::class, 'asset_version' );
		$version->setAccessible( true );

		$this->assertSame( '1.0.0.' . filemtime( $plugin . '/assets/admin.css' ), $version->invoke( $page, 'admin.css' ) );
		$this->assertSame( '1.0.0', $version->invoke( $page, 'missing.js' ) );
	}
}
