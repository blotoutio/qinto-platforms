<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Connect\ConnectFlow;
use Blotout\Consent\Connect\SiteVerifier;
use Blotout\Consent\Options;
use Blotout\Consent\Tests\Halt;
use Blotout\Consent\Tests\TestCase;
use Brain\Monkey\Filters;
use Brain\Monkey\Functions;

final class ConnectTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'wp_create_nonce' )->justReturn( 'abc123' );
	}

	private function flow(): ConnectFlow {
		$options = new Options();

		return new ConnectFlow( $options, new BrokerClient( $options ) );
	}

	public function test_verifier_answers_the_domain_separated_hmac(): void {
		$this->registered();
		$verifier = new SiteVerifier( new Options() );

		$this->assertSame( 'afd7ebcdb3c03852e4708ea0b9be313d356dc29d6dd1607d7ca9e0f2c72faf6d', $verifier->answer( '0123456789abcdef0123456789abcdef' ) );
		$this->assertNull( $verifier->answer( 'not-hex' ) );
	}

	public function test_verifier_answers_nothing_before_registration(): void {
		$this->assertNull( ( new SiteVerifier( new Options() ) )->answer( '0123456789abcdef0123456789abcdef' ) );
	}

	public function test_registers_once_then_asks_for_a_start_url(): void {
		$this->respond(
			201,
			array(
				'registrationId' => '5d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e',
				'secret'         => str_repeat( 'b', 64 ),
			)
		);
		$this->respond( 200, array( 'startUrl' => 'https://consent-wordpress.blotout.io/oauth/start?state=s' ) );

		$this->assertSame( 'https://consent-wordpress.blotout.io/oauth/start?state=s', $this->flow()->login_url() );
		$this->assertSame( 'https://consent-wordpress.blotout.io/register', $this->requests[0]['url'] );
		$this->assertSame(
			array(
				'shopId'    => 'https://shop.example.com',
				'returnUrl' => 'https://shop.example.com/wp-admin/admin-post.php?action=blotout_callback',
			),
			json_decode( $this->requests[0]['body'], true )
		);
		$this->assertArrayNotHasKey( 'X-Blotout-Sig', $this->requests[0]['headers'] );
		$this->assertSame( '{"wpNonce":"abc123"}', $this->requests[1]['body'] );
		$this->assertArrayHasKey( 'X-Blotout-Sig', $this->requests[1]['headers'] );
		$this->assertSame( 'https://shop.example.com', $this->store[ Options::REGISTRATION ]['shop_id'] );
	}

	public function test_replaces_a_registration_the_broker_forgot_once(): void {
		$this->registered();
		$this->respond( 401, array( 'error' => 'unknown_registration' ) );
		$this->respond(
			201,
			array(
				'registrationId' => '6d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e',
				'secret'         => str_repeat( 'c', 64 ),
			)
		);
		$this->respond( 200, array( 'startUrl' => 'https://consent-wordpress.blotout.io/oauth/start?state=t' ) );

		$this->assertSame( 'https://consent-wordpress.blotout.io/oauth/start?state=t', $this->flow()->login_url() );
		$this->assertSame( '6d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e', $this->store[ Options::REGISTRATION ]['id'] );
	}

	/**
	 * @dataProvider kept_refusals
	 */
	public function test_keeps_its_registration_when_refused_for_another_reason( string $reason ): void {
		$this->registered();
		$this->respond( 401, array( 'error' => $reason ) );

		$this->assertNull( $this->flow()->login_url() );
		$this->assertSame( '5d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e', $this->store[ Options::REGISTRATION ]['id'] );
		$this->assertCount( 1, $this->requests, 'no second registration' );
	}

	public function kept_refusals(): array {
		return array(
			'clock'     => array( 'clock_skew' ),
			'signature' => array( 'unauthorized' ),
			'replay'    => array( 'replay' ),
		);
	}

	public function test_start_sends_the_admin_to_the_start_page_or_back_with_the_reason(): void {
		$this->registered();
		$this->stub_redirects();
		Functions\when( 'check_admin_referer' )->justReturn( 1 );
		Functions\when( 'add_filter' )->justReturn( true );

		$this->respond( 200, array( 'startUrl' => 'https://consent-wordpress.blotout.io/oauth/start?state=t' ) );
		$this->assertSame( 'https://consent-wordpress.blotout.io/oauth/start?state=t', $this->halted( array( $this->flow(), 'start' ) )['location'] );

		$this->respond( 401, array( 'error' => 'clock_skew' ) );
		$this->assertStringContainsString( 'blotout_error=clock_skew', $this->halted( array( $this->flow(), 'start' ) )['location'] );

		$this->respond( 500 );
		$this->assertStringContainsString( 'blotout_error=connect_failed', $this->halted( array( $this->flow(), 'start' ) )['location'] );
	}

	public function test_start_needs_the_capability_and_the_form_nonce(): void {
		$this->stub_redirects();
		Functions\when( 'current_user_can' )->justReturn( false );
		$this->assertSame( 403, $this->halted( array( $this->flow(), 'start' ) )['status'] );

		Functions\when( 'current_user_can' )->justReturn( true );
		Functions\when( 'check_admin_referer' )->alias(
			static function () {
				throw new Halt( array( 'status' => 'bad_nonce' ) );
			}
		);
		$this->assertSame( 'bad_nonce', $this->halted( array( $this->flow(), 'start' ) )['status'] );
		$this->assertSame( array(), $this->requests );
	}

	public function test_receive_checks_the_capability_and_its_own_nonce(): void {
		$this->stub_redirects();
		$_GET = array(
			'nonce'  => 'n',
			'result' => 'connected',
		);

		Functions\when( 'current_user_can' )->justReturn( false );
		$this->assertSame( 403, $this->halted( array( $this->flow(), 'receive' ) )['status'] );

		Functions\when( 'current_user_can' )->justReturn( true );
		Functions\when( 'wp_verify_nonce' )->justReturn( false );
		$this->assertSame( 400, $this->halted( array( $this->flow(), 'receive' ) )['status'] );

		Functions\when( 'wp_verify_nonce' )->justReturn( 1 );
		$this->assertStringContainsString( 'blotout_result=connected', $this->halted( array( $this->flow(), 'receive' ) )['location'] );

		$_GET['result'] = 'pwned';
		$this->assertStringContainsString( 'blotout_result=failed', $this->halted( array( $this->flow(), 'receive' ) )['location'] );
		$_GET = array();
	}

	/** `wp_die` and `wp_safe_redirect` end the request; here they throw what they were given. */
	private function stub_redirects(): void {
		Functions\when( 'esc_html__' )->returnArg();
		Functions\when( 'wp_die' )->alias(
			static function ( $message, $status ) {
				throw new Halt( array( 'status' => $status ) );
			}
		);
		Functions\when( 'wp_safe_redirect' )->alias(
			static function ( $location ) {
				throw new Halt( array( 'location' => $location ) );
			}
		);
		Functions\when( 'add_query_arg' )->alias(
			static function ( $args, $url ) {
				return $url . '&' . http_build_query( $args );
			}
		);
	}

	/**
	 * Runs a handler that ends the request, and returns what it ended with.
	 *
	 * @return array<string,mixed>
	 */
	private function halted( callable $handler ): array {
		try {
			$handler();
		} catch ( Halt $halt ) {
			return $halt->payload;
		}
		$this->fail( 'handler did not end the request' );
	}

	public function test_gives_up_when_registration_or_connect_fails(): void {
		$this->respond( 429, array( 'error' => 'rate_limited' ) );
		$this->assertNull( $this->flow()->login_url() );

		$this->registered();
		$this->respond( 403, array( 'error' => 'site_verification_failed' ) );
		$this->assertNull( $this->flow()->login_url() );

		$this->respond( 200, array( 'startUrl' => 'https://evil.example.com/phish' ) );
		$this->assertNull( $this->flow()->login_url() );
	}

	public function test_the_broker_url_is_filterable(): void {
		Filters\expectApplied( 'blotout_consent_broker_url' )->andReturn( 'https://abc.ngrok-free.app/' );

		$this->assertSame( 'https://abc.ngrok-free.app', BrokerClient::base_url() );
	}

	/**
	 * @dataProvider start_urls
	 */
	public function test_accepts_only_the_brokers_start_page( string $url, bool $ok ): void {
		$this->assertSame( $ok, ConnectFlow::is_start_url( $url ) );
	}

	/** @return array<string,array{string,bool}> */
	public function start_urls(): array {
		return array(
			'https'           => array( 'https://consent-wordpress.blotout.io/oauth/start?state=x', true ),
			'loopback http'   => array( 'http://localhost:3458/oauth/start?state=x', true ),
			'public http'     => array( 'http://consent-wordpress.blotout.io/oauth/start', false ),
			'other path'      => array( 'https://consent-wordpress.blotout.io/login', false ),
			'credentials'     => array( 'https://u:p@consent-wordpress.blotout.io/oauth/start', false ),
			'javascript'      => array( 'javascript:alert(1)', false ),
		);
	}
}
