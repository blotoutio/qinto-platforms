<?php
/**
 * Server-to-server calls to the Blotout broker.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Broker;

use Blotout\Consent\Options;

/**
 * Every call but `register` is signed with this install's secret.
 */
final class BrokerClient {

	/** Overridable with the `blotout_consent_broker_url` filter, e.g. for the sandbox broker. */
	const DEFAULT_URL = 'https://consent-wordpress.blotout.io';

	const TIMEOUT = 20;

	/**
	 * Plugin options.
	 *
	 * @var Options
	 */
	private $options;

	/**
	 * Takes its dependencies.
	 *
	 * @param Options $options Plugin options.
	 */
	public function __construct( Options $options ) {
		$this->options = $options;
	}

	/** The broker origin, no trailing slash. */
	public static function base_url(): string {
		return untrailingslashit( (string) apply_filters( 'blotout_consent_broker_url', self::DEFAULT_URL ) );
	}

	/**
	 * Registers this install once and keeps the secret. Idempotent.
	 *
	 * @return bool True when a registration is stored.
	 */
	public function ensure_registered(): bool {
		if ( null !== $this->options->registration() ) {
			return true;
		}

		$shop_id  = untrailingslashit( home_url() );
		$response = $this->send(
			'POST',
			'/register',
			array(
				'shopId'    => $shop_id,
				'returnUrl' => admin_url( 'admin-post.php?action=blotout_callback' ),
			),
			false
		);

		$body = $response['body'];
		if ( 201 !== $response['status'] || ! is_string( $body['registrationId'] ?? null ) || ! is_string( $body['secret'] ?? null ) ) {
			return false;
		}

		$this->options->save_registration(
			array(
				'id'      => $body['registrationId'],
				'secret'  => $body['secret'],
				'shop_id' => $shop_id,
			)
		);

		return true;
	}

	/**
	 * A signed GET.
	 *
	 * @param string               $path  Path on the broker.
	 * @param array<string,string> $query Query parameters.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public function get( string $path, array $query = array() ): array {
		$suffix = array() === $query ? '' : '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );

		return $this->send( 'GET', $path . $suffix, null, true );
	}

	/**
	 * A signed write.
	 *
	 * @param string              $method POST or PUT.
	 * @param string              $path   Path on the broker.
	 * @param array<string,mixed> $body   JSON body.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	public function write( string $method, string $path, array $body = array() ): array {
		return $this->send( $method, $path, $body, true );
	}

	/**
	 * True for a 2xx answer.
	 *
	 * @param array{status:int,body:array<string,mixed>} $response Broker response.
	 */
	public static function succeeded( array $response ): bool {
		return $response['status'] >= 200 && $response['status'] < 300;
	}

	/**
	 * True when the broker no longer knows this install. Any other 401 keeps the registration.
	 *
	 * @param array{status:int,body:array<string,mixed>} $response Broker response.
	 */
	public static function forgot_install( array $response ): bool {
		return 401 === $response['status'] && 'unknown_registration' === ( $response['body']['error'] ?? '' );
	}

	/**
	 * True when the broker refused the request because this server's clock is off.
	 *
	 * @param array{status:int,body:array<string,mixed>} $response Broker response.
	 */
	public static function clock_skewed( array $response ): bool {
		return 401 === $response['status'] && 'clock_skew' === ( $response['body']['error'] ?? '' );
	}

	/**
	 * Sends one request. Status 0 means the broker could not be reached.
	 *
	 * @param string                   $method         HTTP method.
	 * @param string                   $path_and_query Path with query.
	 * @param array<string,mixed>|null $body           JSON body, or null.
	 * @param bool                     $signed         Whether to sign.
	 * @return array{status:int,body:array<string,mixed>}
	 */
	private function send( string $method, string $path_and_query, ?array $body, bool $signed ): array {
		$raw     = null === $body ? '' : (string) wp_json_encode( $body );
		$headers = null === $body ? array() : array( 'Content-Type' => 'application/json' );
		if ( $signed ) {
			$registration = $this->options->registration();
			if ( null === $registration ) {
				return array(
					'status' => 401,
					'body'   => array( 'error' => 'not_registered' ),
				);
			}

			$url_path = (string) wp_parse_url( self::base_url(), PHP_URL_PATH );
			$headers  = array_merge( $headers, RequestSigner::headers( $registration, $method, $url_path . $path_and_query, $raw ) );
		}

		$response = wp_remote_request(
			self::base_url() . $path_and_query,
			array(
				'method'      => $method,
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => $headers,
				'body'        => '' === $raw ? null : $raw,
			)
		);
		if ( is_wp_error( $response ) ) {
			return array(
				'status' => 0,
				'body'   => array( 'error' => 'unreachable' ),
			);
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		return array(
			'status' => (int) wp_remote_retrieve_response_code( $response ),
			'body'   => is_array( $decoded ) ? $decoded : array(),
		);
	}
}
