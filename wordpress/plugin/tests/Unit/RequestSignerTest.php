<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Broker\RequestSigner;
use Blotout\Consent\Tests\TestCase;

/**
 * Golden vectors computed with Node's crypto over the broker's `canonicalMessage` layout, so the
 * PHP and TypeScript sides cannot drift apart unnoticed.
 */
final class RequestSignerTest extends TestCase {

	const REGISTRATION = array(
		'id'      => '5d0e7b8e-1f2a-4c3b-9d4e-5f6a7b8c9d0e',
		'secret'  => 's3cret-' . 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		'shop_id' => 'https://shop.example.com',
	);

	public function test_signs_a_post_like_the_broker_expects(): void {
		$body    = '{"teamId":"11111111-1111-4111-8111-111111111111","domainId":"22222222-2222-4222-8222-222222222222"}';
		$headers = RequestSigner::headers( self::REGISTRATION, 'post', '/select-site', $body, 1700000000, '00112233445566778899aabbccddeeff' );

		$this->assertSame(
			array(
				'X-Blotout-Registration' => self::REGISTRATION['id'],
				'X-Blotout-Ts'           => '1700000000',
				'X-Blotout-Nonce'        => '00112233445566778899aabbccddeeff',
				'X-Blotout-Sig'          => '54f5cc9260106f6304d925e323f15ef35a3411b6ebc0751e028b554fbc25c888',
			),
			$headers
		);
	}

	public function test_signs_the_query_and_an_empty_body(): void {
		$headers = RequestSigner::headers( self::REGISTRATION, 'GET', '/sites?teamId=x', '', 1700000000, '00112233445566778899aabbccddeeff' );

		$this->assertSame( '7dc51b2a8fb7e9a0977fa16a8a741c370ae01643050964855da99e203af95b51', $headers['X-Blotout-Sig'] );
	}

	public function test_uses_a_fresh_nonce_and_the_clock_by_default(): void {
		$first  = RequestSigner::headers( self::REGISTRATION, 'GET', '/status', '' );
		$second = RequestSigner::headers( self::REGISTRATION, 'GET', '/status', '' );

		$this->assertMatchesRegularExpression( '/^[0-9a-f]{32}$/', $first['X-Blotout-Nonce'] );
		$this->assertNotSame( $first['X-Blotout-Nonce'], $second['X-Blotout-Nonce'] );
		$this->assertEqualsWithDelta( time(), (int) $first['X-Blotout-Ts'], 2 );
	}
}
