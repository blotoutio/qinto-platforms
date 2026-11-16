<?php
/**
 * Stands in for `exit` in tests.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Tests;

/**
 * Thrown in place of `exit` by the JSON and redirect helpers, so a test can read what was sent.
 */
final class Halt extends \RuntimeException {

	/** @var array<string,mixed> */
	public $payload;

	/**
	 * @param array<string,mixed> $payload What the handler sent.
	 */
	public function __construct( array $payload ) {
		parent::__construct( 'halt' );
		$this->payload = $payload;
	}
}
