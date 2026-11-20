<?php
/**
 * "Connect to Qinto": register, start the login, and receive the browser back.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Connect;

use Blotout\Consent\Admin\SettingsPage;
use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Options;

/**
 * The plugin never sees a Qinto token. It asks the broker, server to server, for a login URL,
 * sends the admin's browser there, and gets back only `result` plus its own nonce.
 */
final class ConnectFlow {

	const CALLBACK_NONCE = 'blotout_callback';
	const RESULTS        = array( 'connected', 'denied', 'failed' );

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
	 * Host `wp_safe_redirect` may leave for, set just before the redirect.
	 *
	 * @var string
	 */
	private $redirect_host = '';

	/**
	 * Why the last `login_url` failed, as a settings-page notice slug.
	 *
	 * @var string
	 */
	private $last_error = 'connect_failed';

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

	/** Hooks into WordPress. */
	public function register(): void {
		add_action( 'admin_post_blotout_connect', array( $this, 'start' ) );
		add_action( 'admin_post_blotout_callback', array( $this, 'receive' ) );
	}

	/** The connect button's target. */
	public function start(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'blotout-consent' ), 403 );
		}
		check_admin_referer( 'blotout_connect' );

		$start_url = $this->login_url();
		if ( null === $start_url ) {
			$this->back( array( 'blotout_error' => $this->last_error ) );
		}

		$this->redirect_host = (string) wp_parse_url( $start_url, PHP_URL_HOST );
		add_filter( 'allowed_redirect_hosts', array( $this, 'allow_redirect_host' ) );
		wp_safe_redirect( $start_url );
		exit;
	}

	/**
	 * Asks the broker for a login URL. A registration the broker no longer knows (deleted by a
	 * disconnect elsewhere) is replaced once; any other refusal keeps it.
	 */
	public function login_url(): ?string {
		$this->last_error = 'connect_failed';
		for ( $attempt = 0; $attempt < 2; $attempt++ ) {
			if ( ! $this->broker->ensure_registered() ) {
				return null;
			}

			$response = $this->broker->write( 'POST', '/connect', array( 'wpNonce' => wp_create_nonce( self::CALLBACK_NONCE ) ) );
			if ( BrokerClient::forgot_install( $response ) ) {
				$this->options->forget_registration();
				continue;
			}
			if ( BrokerClient::clock_skewed( $response ) ) {
				$this->last_error = 'clock_skew';

				return null;
			}

			$url = $response['body']['startUrl'] ?? null;

			return 200 === $response['status'] && is_string( $url ) && self::is_start_url( $url ) ? $url : null;
		}

		return null;
	}

	/**
	 * Only the broker's own start page: https, or http on loopback for local development.
	 *
	 * @param string $url Candidate from the broker.
	 */
	public static function is_start_url( string $url ): bool {
		$parts  = wp_parse_url( $url );
		$scheme = $parts['scheme'] ?? '';
		$host   = $parts['host'] ?? '';
		$secure = 'https' === $scheme || ( 'http' === $scheme && in_array( $host, array( 'localhost', '127.0.0.1' ), true ) );

		return $secure && '' !== $host && '/oauth/start' === ( $parts['path'] ?? '' ) && ! isset( $parts['user'] );
	}

	/**
	 * Adds the start page's host to the hosts `wp_safe_redirect` allows.
	 *
	 * @param array<int,string> $hosts Allowed hosts.
	 * @return array<int,string>
	 */
	public function allow_redirect_host( array $hosts ): array {
		return '' === $this->redirect_host ? $hosts : array_merge( $hosts, array( $this->redirect_host ) );
	}

	/** The broker sends the browser here with `nonce` and `result`. */
	public function receive(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'blotout-consent' ), 403 );
		}

		$nonce  = isset( $_GET['nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
		$result = isset( $_GET['result'] ) ? sanitize_key( wp_unslash( $_GET['result'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, self::CALLBACK_NONCE ) ) {
			wp_die( esc_html__( 'This link has expired. Start the connection again from the Blotout Consent page.', 'blotout-consent' ), 400 );
		}

		$this->back( array( 'blotout_result' => in_array( $result, self::RESULTS, true ) ? $result : 'failed' ) );
	}

	/**
	 * Back to the settings page with a notice.
	 *
	 * @param array<string,string> $args Query arguments.
	 */
	private function back( array $args ): void {
		wp_safe_redirect( add_query_arg( $args, SettingsPage::url() ) );
		exit;
	}
}
