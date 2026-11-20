<?php
/**
 * Typed access to everything the plugin keeps in wp_options.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent;

/**
 * WordPress stores the delivery host, the picked site's labels and this install's broker
 * registration. Never a Qinto token: those stay in the broker.
 */
final class Options {

	const SETTINGS     = 'blotout_consent_qinto_settings';
	const REGISTRATION = 'blotout_consent_qinto_registration';

	/** Hostname only, lower case, no port. Printed into a script URL, so checked strictly. */
	const HOST_PATTERN = '/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/';

	/**
	 * Defaults for every setting.
	 *
	 * @return array<string,mixed>
	 */
	public static function defaults(): array {
		return array(
			'qinto_host'    => '',
			'use_qinto_url' => 0,
			'site_name'     => '',
			'domain_id'     => '',
			'consent_mode'  => 1,
			'consent_type'  => 'optin',
		);
	}

	/**
	 * Stored settings over the defaults.
	 *
	 * @return array<string,mixed>
	 */
	public function all(): array {
		$saved = get_option( self::SETTINGS, array() );
		$saved = is_array( $saved ) ? $saved : array();

		return wp_parse_args( $saved, self::defaults() );
	}

	/**
	 * Merges `$changes` into the stored settings.
	 *
	 * @param array<string,mixed> $changes Keys to replace.
	 */
	public function update( array $changes ): void {
		update_option( self::SETTINGS, array_merge( $this->all(), $changes ) );
	}

	/** The host the banner loads from, or null when no site is picked. */
	public function qinto_host(): ?string {
		$host = (string) $this->all()['qinto_host'];

		return self::is_host( $host ) ? $host : null;
	}

	/** The consent type: optin or optout. */
	public function consent_type(): string {
		return 'optout' === $this->all()['consent_type'] ? 'optout' : 'optin';
	}

	/** Whether Google Consent Mode v2 is on. */
	public function consent_mode_enabled(): bool {
		return ! empty( $this->all()['consent_mode'] );
	}

	/**
	 * Whether a value is a plain public hostname.
	 *
	 * @param mixed $value Candidate.
	 */
	public static function is_host( $value ): bool {
		return is_string( $value ) && 1 === preg_match( self::HOST_PATTERN, $value );
	}

	/**
	 * This install's broker registration. Requests are signed with its stored shop id, so a later
	 * change to the site URL cannot break the signature.
	 *
	 * @return array{id:string,secret:string,shop_id:string}|null
	 */
	public function registration(): ?array {
		$value = get_option( self::REGISTRATION );
		if ( ! is_array( $value ) || empty( $value['id'] ) || empty( $value['secret'] ) || empty( $value['shop_id'] ) ) {
			return null;
		}

		return array(
			'id'      => (string) $value['id'],
			'secret'  => (string) $value['secret'],
			'shop_id' => (string) $value['shop_id'],
		);
	}

	/**
	 * Stores the registration with autoload off: the secret is read only for broker calls.
	 *
	 * @param array{id:string,secret:string,shop_id:string} $registration From `POST /register`.
	 */
	public function save_registration( array $registration ): void {
		delete_option( self::REGISTRATION );
		add_option( self::REGISTRATION, $registration, '', false );
	}

	/** Drops this install's registration. */
	public function forget_registration(): void {
		delete_option( self::REGISTRATION );
	}

	/** Drops the picked site; the banner stops printing. */
	public function clear_site(): void {
		$this->update(
			array(
				'qinto_host'    => '',
				'use_qinto_url' => 0,
				'site_name'     => '',
				'domain_id'     => '',
			)
		);
	}
}
