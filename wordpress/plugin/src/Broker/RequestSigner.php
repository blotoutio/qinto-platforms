<?php
/**
 * HMAC headers for plugin-to-broker calls.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Broker;

/**
 * Must match the broker's `canonicalMessage` (`app/src/services/signature.ts`) byte for byte.
 */
final class RequestSigner {

	/**
	 * The signed message: version, registration, timestamp, nonce, stored shop id, method,
	 * path with query, and the body's SHA-256, joined by newlines.
	 *
	 * @param array{registration_id:string,timestamp:string,nonce:string,shop_id:string,method:string,path_and_query:string,body:string} $parts Request parts.
	 */
	public static function canonical_message( array $parts ): string {
		return implode(
			"\n",
			array(
				'v1',
				$parts['registration_id'],
				$parts['timestamp'],
				$parts['nonce'],
				$parts['shop_id'],
				strtoupper( $parts['method'] ),
				$parts['path_and_query'],
				hash( 'sha256', $parts['body'] ),
			)
		);
	}

	/**
	 * Headers for one request. A fresh nonce each time, so a captured request cannot be replayed.
	 *
	 * @param array{id:string,secret:string,shop_id:string} $registration   This install.
	 * @param string                                        $method         HTTP method.
	 * @param string                                        $path_and_query Path plus query, exactly as sent.
	 * @param string                                        $body           Raw body, '' for none.
	 * @param int|null                                      $now            Unix seconds, for tests.
	 * @param string|null                                   $nonce          Fixed nonce, for tests.
	 * @return array<string,string>
	 */
	public static function headers( array $registration, string $method, string $path_and_query, string $body, ?int $now = null, ?string $nonce = null ): array {
		$timestamp = (string) ( null === $now ? time() : $now );
		$nonce     = null === $nonce ? bin2hex( random_bytes( 16 ) ) : $nonce;
		$message   = self::canonical_message(
			array(
				'registration_id' => $registration['id'],
				'timestamp'       => $timestamp,
				'nonce'           => $nonce,
				'shop_id'         => $registration['shop_id'],
				'method'          => $method,
				'path_and_query'  => $path_and_query,
				'body'            => $body,
			)
		);

		return array(
			'X-Blotout-Registration' => $registration['id'],
			'X-Blotout-Ts'           => $timestamp,
			'X-Blotout-Nonce'        => $nonce,
			'X-Blotout-Sig'          => hash_hmac( 'sha256', $message, $registration['secret'] ),
		);
	}
}
