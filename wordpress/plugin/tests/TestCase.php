<?php
/**
 * Brain Monkey base case with an in-memory wp_options and the WordPress helpers the plugin uses.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Tests;

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase as Base;

abstract class TestCase extends Base {

	/** @var array<string,mixed> */
	protected $store = array();

	/** @var array<int,array<string,mixed>> Requests the code sent with wp_remote_request. */
	protected $requests = array();

	/** @var array<int,array{status:int,body:string}|\WP_Error> Responses to hand back, in order. */
	protected $responses = array();

	protected function setUp(): void {
		parent::setUp();
		Monkey\setUp();
		$this->store     = array();
		$this->requests  = array();
		$this->responses = array();

		Functions\when( 'get_option' )->alias(
			function ( $key, $fallback = false ) {
				return array_key_exists( $key, $this->store ) ? $this->store[ $key ] : $fallback;
			}
		);
		Functions\when( 'update_option' )->alias(
			function ( $key, $value ) {
				$this->store[ $key ] = $value;

				return true;
			}
		);
		Functions\when( 'add_option' )->alias(
			function ( $key, $value ) {
				if ( array_key_exists( $key, $this->store ) ) {
					return false;
				}
				$this->store[ $key ] = $value;

				return true;
			}
		);
		Functions\when( 'delete_option' )->alias(
			function ( $key ) {
				unset( $this->store[ $key ] );

				return true;
			}
		);
		Functions\when( 'wp_parse_args' )->alias(
			static function ( $args, $defaults ) {
				return array_merge( $defaults, $args );
			}
		);
		Functions\when( 'untrailingslashit' )->alias(
			static function ( $value ) {
				return rtrim( (string) $value, '/\\' );
			}
		);
		Functions\when( 'wp_parse_url' )->alias(
			static function ( $url, $component = -1 ) {
				return parse_url( $url, $component ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url
			}
		);
		Functions\when( 'wp_json_encode' )->alias(
			static function ( $value, $flags = 0 ) {
				return json_encode( $value, $flags ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
			}
		);
		Functions\when( 'is_wp_error' )->alias(
			static function ( $value ) {
				return $value instanceof \WP_Error;
			}
		);
		Functions\when( 'wp_remote_request' )->alias(
			function ( $url, $args ) {
				$this->requests[] = array_merge( array( 'url' => $url ), $args );

				return array_shift( $this->responses ) ?? array(
					'status' => 500,
					'body'   => '',
				);
			}
		);
		Functions\when( 'wp_remote_retrieve_body' )->alias(
			static function ( $response ) {
				return $response['body'];
			}
		);
		Functions\when( 'wp_remote_retrieve_response_code' )->alias(
			static function ( $response ) {
				return $response['status'];
			}
		);
		Functions\when( 'sanitize_text_field' )->returnArg();
		Functions\when( 'sanitize_key' )->alias(
			static function ( $value ) {
				return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
			}
		);
		Functions\when( 'wp_unslash' )->returnArg();
		Functions\when( 'esc_url_raw' )->returnArg();
		Functions\when( 'home_url' )->justReturn( 'https://shop.example.com' );
		Functions\when( 'admin_url' )->alias(
			static function ( $path = '' ) {
				return 'https://shop.example.com/wp-admin/' . $path;
			}
		);
		Functions\when( '__' )->returnArg();
		Functions\when( 'esc_html__' )->returnArg();
		Functions\when( 'current_user_can' )->justReturn( true );
		Functions\when( 'wp_send_json_success' )->alias(
			static function ( $data = null ) {
				throw new Halt(
					array(
						'success' => true,
						'data'    => $data,
					)
				);
			}
		);
		Functions\when( 'wp_send_json_error' )->alias(
			static function ( $data = null, $status = null ) {
				throw new Halt(
					array(
						'success' => false,
						'data'    => $data,
						'status'  => $status,
					)
				);
			}
		);
	}

	protected function tearDown(): void {
		Monkey\tearDown();
		parent::tearDown();
	}

	/**
	 * Queues one broker answer.
	 *
	 * @param int                 $status HTTP status.
	 * @param array<string,mixed> $body   JSON body.
	 */
	protected function respond( int $status, array $body = array() ): void {
		$this->responses[] = array(
			'status' => $status,
			'body'   => (string) json_encode( $body ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
		);
	}

	protected function registered(): void {
		$this->store['blotout_consent_qinto_registration'] = array(
			'id'      => '5d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e',
			'secret'  => 's3cret-' . str_repeat( 'a', 57 ),
			'shop_id' => 'https://shop.example.com',
		);
	}
}
