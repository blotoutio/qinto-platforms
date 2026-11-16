<?php
/**
 * The public endpoint the broker calls to prove this site holds its registration secret.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Connect;

use Blotout\Consent\Options;

/**
 * Answers `HMAC(secret, "blotout-verify|" . challenge)`. The prefix keeps it apart from request
 * signing (which starts `v1\n`), so this endpoint can never be used to forge a signed call.
 */
final class SiteVerifier {

	const CHALLENGE_PATTERN = '/^[0-9a-f]{32}$/';

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

	/** Hooks into WordPress. */
	public function register(): void {
		add_action( 'admin_post_nopriv_blotout_verify', array( $this, 'handle' ) );
		add_action( 'admin_post_blotout_verify', array( $this, 'handle' ) );
	}

	/**
	 * The answer for a challenge, or null when there is nothing to prove.
	 *
	 * @param string $challenge 32 hex characters from the broker.
	 */
	public function answer( string $challenge ): ?string {
		$registration = $this->options->registration();
		if ( null === $registration || 1 !== preg_match( self::CHALLENGE_PATTERN, $challenge ) ) {
			return null;
		}

		return hash_hmac( 'sha256', 'blotout-verify|' . $challenge, $registration['secret'] );
	}

	/** Answers the broker's challenge, or 404. */
	public function handle(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- server-to-server; the HMAC is the proof.
		$challenge = isset( $_GET['challenge'] ) ? sanitize_text_field( wp_unslash( $_GET['challenge'] ) ) : '';
		$answer    = $this->answer( $challenge );
		nocache_headers();
		header( 'Content-Type: text/plain; charset=utf-8' );
		if ( null === $answer ) {
			status_header( 404 );
			exit;
		}

		// A hex digest: [0-9a-f] only.
		echo $answer; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}
}
