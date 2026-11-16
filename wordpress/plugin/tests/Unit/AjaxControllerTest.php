<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Admin\AjaxController;
use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Options;
use Blotout\Consent\Tests\Halt;
use Blotout\Consent\Tests\TestCase;
use Brain\Monkey\Functions;

final class AjaxControllerTest extends TestCase {

	const TEAM = 'e04dfb0b-dfb1-4e83-bca0-0d74dfc3a52d';
	const SITE = 'badf8d72-0b3a-4ac6-8b98-48ec4fa9aff6';

	protected function setUp(): void {
		parent::setUp();
		$this->registered();
		Functions\when( 'check_ajax_referer' )->justReturn( true );
		Functions\when( 'wp_clear_scheduled_hook' )->justReturn( 0 );
		Functions\when( 'sanitize_email' )->alias(
			static function ( $email ) {
				return filter_var( trim( $email ), FILTER_VALIDATE_EMAIL ) ? trim( $email ) : '';
			}
		);
		$_POST = array();
	}

	/**
	 * Runs one handler and returns what it sent.
	 *
	 * @param string              $method Handler.
	 * @param array<string,mixed> $post   $_POST.
	 * @return array<string,mixed>
	 */
	private function call( string $method, array $post = array() ): array {
		$_POST   = $post;
		$options = new Options();
		try {
			( new AjaxController( $options, new BrokerClient( $options ) ) )->$method();
		} catch ( Halt $halt ) {
			return $halt->payload;
		}
		$this->fail( 'handler did not respond' );
	}

	public function test_select_site_stores_only_the_returned_host(): void {
		$this->respond(
			200,
			array(
				'site'                => array(
					'name'   => 'Shop',
					'domain' => 'q.shop.example.com',
				),
				'host'                => 'q.shop.example.com',
				'usingDevelopmentUrl' => false,
				'app'                 => 'installed',
			)
		);

		$sent = $this->call(
			'select_site',
			array(
				'teamId'   => self::TEAM,
				'domainId' => self::SITE,
			)
		);

		$this->assertTrue( $sent['success'] );
		$settings = ( new Options() )->all();
		$this->assertSame( 'q.shop.example.com', $settings['qinto_host'] );
		$this->assertSame( 'Shop', $settings['site_name'] );
	}

	public function test_select_site_deploys_a_never_deployed_site_first(): void {
		$this->respond(
			502,
			array(
				'error' => 'qinto_api',
				'code'  => 'not_deployed',
			)
		);
		$this->respond( 200, array( 'deploymentId' => 'd' ) );
		$this->respond(
			200,
			array(
				'host'                => 'dev-1.qinto.tech',
				'usingDevelopmentUrl' => true,
			)
		);

		$this->call(
			'select_site',
			array(
				'teamId'   => self::TEAM,
				'domainId' => self::SITE,
			)
		);

		$this->assertSame( array( '/select-site', '/deploy', '/select-site' ), array_map( static fn ( $r ) => parse_url( $r['url'], PHP_URL_PATH ), $this->requests ) ); // phpcs:ignore
		$this->assertSame( 1, ( new Options() )->all()['use_qinto_url'] );
	}

	public function test_errors_keep_the_brokers_slug_and_store_nothing(): void {
		$this->respond(
			409,
			array( 'error' => 'site_locked' )
		);

		$sent = $this->call(
			'select_site',
			array(
				'teamId'   => self::TEAM,
				'domainId' => self::SITE,
			)
		);

		$this->assertFalse( $sent['success'] );
		$this->assertSame( 'site_locked', $sent['data']['error'] );
		$this->assertSame( 409, $sent['status'] );
		$this->assertSame( '', ( new Options() )->all()['qinto_host'] );
	}

	public function test_broker_server_errors_go_out_as_200_so_proxies_keep_the_slug(): void {
		$this->respond(
			502,
			array(
				'error' => 'qinto_api',
				'code'  => 'no_payment_method',
			)
		);

		$sent = $this->call(
			'select_site',
			array(
				'teamId'   => self::TEAM,
				'domainId' => self::SITE,
			)
		);

		$this->assertFalse( $sent['success'] );
		$this->assertSame( 'no_payment_method', $sent['data']['code'] );
		$this->assertSame( 502, $sent['data']['status'] );
		$this->assertSame( 200, $sent['status'] );
	}

	public function test_ids_and_domains_are_validated_before_any_broker_call(): void {
		$this->assertSame( 'bad_id', $this->call( 'select_site', array( 'teamId' => '1 OR 1=1' ) )['data']['error'] );
		$this->assertSame(
			'bad_domain',
			$this->call(
				'create_site',
				array(
					'teamId'     => self::TEAM,
					'rootDomain' => 'https://x.com/a',
				)
			)['data']['error']
		);
		$this->assertSame( array(), $this->requests );
	}

	public function test_dns_share_sends_clean_emails_with_the_scripts_idempotency_key(): void {
		$post = array(
			'teamId'       => self::TEAM,
			'domainId'     => self::SITE,
			'emails'       => 'it@example.com, not-an-email, dns@example.com',
			'submissionId' => '9B2F6A1E-4C1D-4F7A-8F3E-2D6C5B4A3E21',
		);
		$this->respond( 502, array( 'error' => 'qinto_api' ) );
		$this->respond( 200, array( 'sent' => 2 ) );

		$this->call( 'dns_share', $post );
		$this->call( 'dns_share', $post );

		$expected = array(
			'teamId'       => self::TEAM,
			'domainId'     => self::SITE,
			'emails'       => array( 'it@example.com', 'dns@example.com' ),
			'submissionId' => '9b2f6a1e-4c1d-4f7a-8f3e-2d6c5b4a3e21',
		);
		$this->assertSame( $expected, json_decode( $this->requests[0]['body'], true ) );
		$this->assertSame( $expected, json_decode( $this->requests[1]['body'], true ), 'a retry keeps the key' );
	}

	public function test_dns_share_needs_a_key(): void {
		$sent = $this->call(
			'dns_share',
			array(
				'teamId'   => self::TEAM,
				'domainId' => self::SITE,
				'emails'   => 'it@example.com',
			)
		);

		$this->assertSame( 'bad_id', $sent['data']['error'] );
		$this->assertSame( array(), $this->requests );
	}

	public function test_destination_switch_updates_the_printed_host(): void {
		$this->store[ Options::SETTINGS ] = array( 'qinto_host' => 'q.shop.example.com' );
		$this->respond(
			200,
			array(
				'host'                => 'dev-1.qinto.tech',
				'usingDevelopmentUrl' => true,
			)
		);

		$this->call( 'destination', array( 'target' => 'development_url' ) );

		$this->assertSame( '{"target":"development_url"}', $this->requests[0]['body'] );
		$this->assertSame( 'dev-1.qinto.tech', ( new Options() )->all()['qinto_host'] );
	}

	public function test_disconnect_keeps_the_install_when_the_broker_cannot_confirm(): void {
		$this->store[ Options::SETTINGS ] = array( 'qinto_host' => 'q.shop.example.com' );
		$this->responses[]                = new \WP_Error();
		$this->respond( 401, array( 'error' => 'clock_skew' ) );

		$down   = $this->call( 'disconnect' );
		$skewed = $this->call( 'disconnect' );

		$this->assertFalse( $down['success'] );
		$this->assertSame( 'unreachable', $down['data']['error'] );
		$this->assertSame( 'clock_skew', $skewed['data']['error'] );
		$this->assertArrayHasKey( Options::REGISTRATION, $this->store );
		$this->assertSame( 'q.shop.example.com', ( new Options() )->qinto_host() );
	}

	/**
	 * @dataProvider confirmed_disconnects
	 */
	public function test_disconnect_forgets_the_install_once_the_broker_has( int $status, array $body ): void {
		$this->store[ Options::SETTINGS ] = array( 'qinto_host' => 'q.shop.example.com' );
		$this->respond( $status, $body );

		$sent = $this->call( 'disconnect' );

		$this->assertTrue( $sent['success'] );
		$this->assertArrayNotHasKey( Options::REGISTRATION, $this->store );
		$this->assertNull( ( new Options() )->qinto_host() );
	}

	public function confirmed_disconnects(): array {
		return array(
			'disconnected'    => array( 200, array( 'disconnected' => true ) ),
			'already gone'    => array( 401, array( 'error' => 'unknown_registration' ) ),
		);
	}

	public function test_refuses_a_bad_nonce_before_anything_else(): void {
		Functions\when( 'check_ajax_referer' )->alias(
			static function () {
				throw new Halt( array( 'status' => 403 ) );
			}
		);

		$this->assertSame( 403, $this->call( 'disconnect' )['status'] );
		$this->assertSame( array(), $this->requests );
		$this->assertArrayHasKey( Options::REGISTRATION, $this->store );
	}

	public function test_refuses_users_without_manage_options(): void {
		Functions\when( 'current_user_can' )->justReturn( false );

		$sent = $this->call( 'sites' );

		$this->assertSame( 403, $sent['status'] );
		$this->assertSame( array(), $this->requests );
	}
}
