<?php
/**
 * The site wizard's AJAX endpoints: checked proxies to the broker.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Admin;

use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Options;

/**
 * Each handler checks the nonce and capability, validates input, then calls the broker server side.
 */
final class AjaxController {

	const NONCE = 'blotout_admin';

	const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

	/** Each one is `wp_ajax_blotout_<name>`, handled by the method of the same name. */
	const ACTIONS = array( 'sites', 'create_site', 'dns', 'dns_check', 'dns_share', 'select_site', 'destination', 'disconnect' );

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
		foreach ( self::ACTIONS as $action ) {
			add_action( 'wp_ajax_blotout_' . $action, array( $this, $action ) );
		}
	}

	/** Teams and the sites of one team. */
	public function sites(): void {
		$this->guard();
		$team  = $this->uuid( 'teamId', false );
		$query = null === $team ? array() : array( 'teamId' => $team );
		$this->relay( $this->broker->get( '/sites', $query ) );
	}

	/** Creates a managed site. */
	public function create_site(): void {
		$this->guard();
		$root = strtolower( $this->text( 'rootDomain' ) );
		if ( ! Options::is_host( $root ) ) {
			$this->fail( 'bad_domain', 400 );
		}

		$body = array(
			'teamId'     => $this->uuid( 'teamId' ),
			'rootDomain' => $root,
		);
		$name = $this->text( 'name' );
		if ( '' !== $name ) {
			$body['name'] = $name;
		}
		$this->relay( $this->broker->write( 'POST', '/sites', $body ) );
	}

	/** The DNS records for a site. */
	public function dns(): void {
		$this->guard();
		$this->relay( $this->broker->get( '/dns', $this->site_ref() ) );
	}

	/** Asks Qinto to check DNS again. */
	public function dns_check(): void {
		$this->guard();
		$this->relay( $this->broker->write( 'POST', '/dns/check', $this->site_ref() ) );
	}

	/** Emails the DNS records. */
	public function dns_share(): void {
		$this->guard();
		$emails = array_values( array_filter( array_map( 'sanitize_email', explode( ',', $this->text( 'emails' ) ) ) ) );
		if ( array() === $emails || count( $emails ) > 10 ) {
			$this->fail( 'bad_emails', 400 );
		}

		$body = array_merge(
			$this->site_ref(),
			array(
				'emails'       => $emails,
				// Made once per send by the script, so a retry is not a second email.
				'submissionId' => (string) $this->uuid( 'submissionId' ),
			)
		);
		$this->relay( $this->broker->write( 'POST', '/dns/share', $body ) );
	}

	/** Picks the site. A site that was never deployed is deployed first, then picked again. */
	public function select_site(): void {
		$this->guard();
		$ref      = $this->site_ref();
		$response = $this->broker->write( 'POST', '/select-site', $ref );
		if ( 502 === $response['status'] && 'not_deployed' === ( $response['body']['code'] ?? '' ) ) {
			$deployed = $this->broker->write( 'POST', '/deploy', $ref );
			if ( 200 !== $deployed['status'] ) {
				$this->relay( $deployed );
			}
			$response = $this->broker->write( 'POST', '/select-site', $ref );
		}

		if ( 200 === $response['status'] && Options::is_host( $response['body']['host'] ?? null ) ) {
			$site = is_array( $response['body']['site'] ?? null ) ? $response['body']['site'] : array();
			$this->options->update(
				array(
					'qinto_host'    => $response['body']['host'],
					'use_qinto_url' => empty( $response['body']['usingDevelopmentUrl'] ) ? 0 : 1,
					'site_name'     => sanitize_text_field( (string) ( $site['name'] ?? '' ) ),
					'domain_id'     => $ref['domainId'],
				)
			);
		}
		$this->relay( $response );
	}

	/** The "Use Qinto URL" switch. */
	public function destination(): void {
		$this->guard();
		$target   = 'development_url' === $this->text( 'target' ) ? 'development_url' : 'domain';
		$response = $this->broker->write( 'PUT', '/destination', array( 'target' => $target ) );
		if ( 200 === $response['status'] && Options::is_host( $response['body']['host'] ?? null ) ) {
			$this->options->update(
				array(
					'qinto_host'    => $response['body']['host'],
					'use_qinto_url' => 'development_url' === $target ? 1 : 0,
				)
			);
		}
		$this->relay( $response );
	}

	/**
	 * Revokes the grant, then forgets the install. Unconfirmed by the broker, the registration is
	 * kept so the admin can retry; dropping it would orphan a live grant.
	 */
	public function disconnect(): void {
		$this->guard();
		$response = $this->broker->write( 'POST', '/disconnect' );
		if ( ! BrokerClient::succeeded( $response ) && ! BrokerClient::forgot_install( $response ) ) {
			$this->relay( $response );
		}

		$this->options->forget_registration();
		$this->options->clear_site();
		wp_send_json_success( array( 'brokerStatus' => $response['status'] ) );
	}

	/** Checks the nonce and capability, or ends the request. */
	private function guard(): void {
		check_ajax_referer( self::NONCE, 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			$this->fail( 'forbidden', 403 );
		}
	}

	/**
	 * Passes the broker's answer through as JSON. A broker 5xx goes out as 200, because proxies
	 * such as Cloudflare replace a 5xx body and the error slug would be lost.
	 *
	 * @param array{status:int,body:array<string,mixed>} $response Broker response.
	 */
	private function relay( array $response ): void {
		if ( BrokerClient::succeeded( $response ) ) {
			wp_send_json_success( $response['body'] );
		}

		$status = $response['status'];
		wp_send_json_error(
			array(
				'error'  => (string) ( $response['body']['error'] ?? 'unknown' ),
				'code'   => (string) ( $response['body']['code'] ?? '' ),
				'status' => $status,
			),
			$status >= 400 && $status < 500 ? $status : 200
		);
	}

	/**
	 * Ends the request with an error slug.
	 *
	 * @param string $error  Slug the script maps to copy.
	 * @param int    $status HTTP status.
	 */
	private function fail( string $error, int $status ): void {
		wp_send_json_error( array( 'error' => $error ), $status );
	}

	/**
	 * A posted text field.
	 *
	 * @param string $key Field name.
	 */
	private function text( string $key ): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked in guard().
		return isset( $_POST[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) ) : '';
	}

	/**
	 * A posted Qinto id.
	 *
	 * @param string $key      Field name.
	 * @param bool   $required Whether a missing id is an error.
	 */
	private function uuid( string $key, bool $required = true ): ?string {
		$value = strtolower( $this->text( $key ) );
		if ( 1 === preg_match( self::UUID_PATTERN, $value ) ) {
			return $value;
		}

		if ( $required || '' !== $value ) {
			$this->fail( 'bad_id', 400 );
		}

		return null;
	}

	/**
	 * The posted team and site ids.
	 *
	 * @return array{teamId:string,domainId:string}
	 */
	private function site_ref(): array {
		return array(
			'teamId'   => (string) $this->uuid( 'teamId' ),
			'domainId' => (string) $this->uuid( 'domainId' ),
		);
	}
}
