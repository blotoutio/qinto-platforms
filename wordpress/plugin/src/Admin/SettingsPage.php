<?php
/**
 * The Blotout Consent admin page: connect, pick a site, and the live view.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Admin;

use Blotout\Consent\Broker\BrokerClient;
use Blotout\Consent\Options;

/**
 * The broker's `/status` picks the screen, and local options are synced to it on each visit.
 */
final class SettingsPage {

	const SLUG = 'blotout-consent';

	/** The Blotout mark as the menu icon; WordPress recolours it to match the admin theme. */
	const MENU_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9Ii0zIDYgMjQgMjQiPjxwYXRoIGZpbGw9ImJsYWNrIiBkPSJNMTcuNzU1OSAxMlYzMEgwVjE4SDUuOTE4OTVWMjRIMTEuODM2OVYxOEg1LjkxODk1VjEySDE3Ljc1NTlaTTUuOTE4OTUgMTJIMFY2SDUuOTE4OTVWMTJaIi8+PC9zdmc+';

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
	 * Main plugin file.
	 *
	 * @var string
	 */
	private $plugin_file;

	/**
	 * Takes its dependencies.
	 *
	 * @param Options      $options     Plugin options.
	 * @param BrokerClient $broker      Broker client.
	 * @param string       $plugin_file Main plugin file.
	 */
	public function __construct( Options $options, BrokerClient $broker, string $plugin_file ) {
		$this->options     = $options;
		$this->broker      = $broker;
		$this->plugin_file = $plugin_file;
	}

	/** The settings page URL. */
	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	/** Hooks into WordPress. */
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'add_menu' ) );
		add_action( 'admin_post_blotout_save_consent', array( $this, 'save_consent' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( $this->plugin_file ), array( $this, 'action_links' ) );
	}

	/** Adds the top-level menu entry. */
	public function add_menu(): void {
		add_menu_page(
			__( 'Blotout Consent', 'blotout-consent' ),
			__( 'Blotout Consent', 'blotout-consent' ),
			'manage_options',
			self::SLUG,
			array( $this, 'render' ),
			self::MENU_ICON,
			80
		);
	}

	/**
	 * Adds "Settings" on the Plugins screen.
	 *
	 * @param array<int|string,string> $links Existing links.
	 * @return array<int|string,string>
	 */
	public function action_links( array $links ): array {
		array_unshift( $links, sprintf( '<a href="%s">%s</a>', esc_url( self::url() ), esc_html__( 'Settings', 'blotout-consent' ) ) );

		return $links;
	}

	/**
	 * Saves the consent form. Not `register_setting`: its sanitize callback would run on every
	 * `update_option` of the shared option, including the wizard's, and drop keys.
	 */
	public function save_consent(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'blotout-consent' ), 403 );
		}
		check_admin_referer( 'blotout_save_consent' );

		$type = isset( $_POST['consent_type'] ) ? sanitize_key( wp_unslash( $_POST['consent_type'] ) ) : 'optin';
		$this->options->update(
			array(
				'consent_mode' => empty( $_POST['consent_mode'] ) ? 0 : 1,
				'consent_type' => 'optout' === $type ? 'optout' : 'optin',
			)
		);
		wp_safe_redirect( add_query_arg( 'blotout_result', 'saved', self::url() ) );
		exit;
	}

	/**
	 * Admin assets, on this page only.
	 *
	 * @param string $hook Page hook suffix.
	 */
	public function enqueue( string $hook ): void {
		if ( 'toplevel_page_' . self::SLUG !== $hook ) {
			return;
		}

		wp_enqueue_style( 'blotout-consent-admin', BLOTOUT_CONSENT_URL . 'assets/admin.css', array(), $this->asset_version( 'admin.css' ) );
		wp_enqueue_script( 'blotout-consent-admin', BLOTOUT_CONSENT_URL . 'assets/admin.js', array(), $this->asset_version( 'admin.js' ), true );
		wp_localize_script(
			'blotout-consent-admin',
			'BlotoutConsent',
			array(
				'ajaxUrl'  => admin_url( 'admin-ajax.php' ),
				'nonce'    => wp_create_nonce( AjaxController::NONCE ),
				'siteHost' => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
				'siteName' => get_bloginfo( 'name' ),
				'i18n'     => I18n::strings(),
			)
		);
	}

	/**
	 * Plugin version plus the file's modified time, so a changed file gets a new URL past any cache.
	 *
	 * @param string $file File name in `assets/`.
	 */
	private function asset_version( string $file ): string {
		$path = dirname( $this->plugin_file ) . '/assets/' . $file;

		return file_exists( $path ) ? BLOTOUT_CONSENT_VERSION . '.' . filemtime( $path ) : BLOTOUT_CONSENT_VERSION;
	}

	/** Prints the admin page. */
	public function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$status   = $this->status();
		$settings = $this->options->all();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display-only notices.
		$result = isset( $_GET['blotout_result'] ) ? sanitize_key( wp_unslash( $_GET['blotout_result'] ) ) : '';
		$error  = isset( $_GET['blotout_error'] ) ? sanitize_key( wp_unslash( $_GET['blotout_error'] ) ) : '';
		// phpcs:enable
		$screen = $this->screen( $status );

		require __DIR__ . '/views/page.php';
	}

	/**
	 * `/status`, with local options brought in line with it. Null when the broker cannot answer.
	 *
	 * @return array<string,mixed>|null
	 */
	private function status(): ?array {
		if ( null === $this->options->registration() ) {
			return array( 'connection' => array( 'state' => 'none' ) );
		}

		$response = $this->broker->get( '/status' );
		if ( BrokerClient::forgot_install( $response ) ) {
			$this->options->forget_registration();

			return array( 'connection' => array( 'state' => 'none' ) );
		}
		if ( BrokerClient::clock_skewed( $response ) ) {
			return array( 'connection' => array( 'state' => 'clock_skew' ) );
		}
		if ( 200 !== $response['status'] ) {
			return null;
		}

		$this->sync( $response['body'] );

		return $response['body'];
	}

	/**
	 * Mirrors the broker's selection into the options the front end reads.
	 *
	 * @param array<string,mixed> $status `/status` body.
	 */
	private function sync( array $status ): void {
		if ( 'connected' !== ( $status['connection']['state'] ?? '' ) ) {
			return;
		}

		$selection = $status['selection'] ?? null;
		if ( ! is_array( $selection ) ) {
			if ( '' !== (string) $this->options->all()['domain_id'] ) {
				$this->options->clear_site();
			}

			return;
		}

		if ( Options::is_host( $selection['host'] ?? null ) ) {
			$this->options->update(
				array(
					'qinto_host'    => $selection['host'],
					'use_qinto_url' => empty( $selection['usingDevelopmentUrl'] ) ? 0 : 1,
					'site_name'     => sanitize_text_field( (string) ( $selection['siteName'] ?? '' ) ),
					'domain_id'     => (string) $selection['domainId'],
				)
			);
		}
	}

	/**
	 * Which screen to show.
	 *
	 * @param array<string,mixed>|null $status `/status`, or null when unreachable.
	 */
	private function screen( ?array $status ): string {
		if ( null === $status ) {
			return 'unreachable';
		}

		$state = (string) ( $status['connection']['state'] ?? 'none' );
		if ( 'connected' === $state ) {
			return is_array( $status['selection'] ?? null ) ? 'live' : 'wizard';
		}
		if ( 'clock_skew' === $state ) {
			return 'clock';
		}

		return 'revoked' === $state ? 'revoked' : 'connect';
	}
}
