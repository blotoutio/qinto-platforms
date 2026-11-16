<?php
/**
 * Settings page template: a focused, one-step-at-a-time setup.
 *
 * @package Blotout\Consent
 *
 * @var string                   $screen   connect | revoked | wizard | live | unreachable | clock.
 * @var array<string,mixed>|null $status   Broker `/status`.
 * @var array<string,mixed>      $settings Stored settings.
 * @var string                   $result   connected | denied | failed, after a login.
 * @var string                   $error    Local error slug.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Lucide icons, drawn inline so the page loads nothing from outside WordPress.
$blotout_consent_icons = array(
	'check'    => '<path d="M20 6 9 17l-5-5"/>',
	'success'  => '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
	'warning'  => '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	'error'    => '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
	'external' => '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
);
$blotout_consent_icon  = static function ( string $name ) use ( $blotout_consent_icons ): void {
	// Static SVG from the list above.
	echo '<svg class="bo-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' . $blotout_consent_icons[ $name ] . '</svg>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
};

$blotout_consent_notices = array(
	'connected'      => array( 'success', __( 'Connected to Qinto.', 'blotout-consent' ) ),
	'saved'          => array( 'success', __( 'Settings saved.', 'blotout-consent' ) ),
	'denied'         => array( 'warning', __( 'Qinto access was not approved, so nothing changed.', 'blotout-consent' ) ),
	'failed'         => array( 'error', __( 'Connecting to Qinto failed. Try again.', 'blotout-consent' ) ),
	'connect_failed' => array( 'error', __( 'Could not start the connection. Check that this site is reachable over https and try again.', 'blotout-consent' ) ),
	'clock_skew'     => array( 'error', __( 'This server\'s clock is more than five minutes off, so Blotout refused the request. Ask your host to sync the server time, then try again.', 'blotout-consent' ) ),
);
$blotout_consent_notice  = $blotout_consent_notices[ '' !== $error ? $error : $result ] ?? null;
if ( 'unreachable' === $screen ) {
	$blotout_consent_notice = array( 'error', __( 'Could not reach Blotout. Your banner keeps showing; reload to try again.', 'blotout-consent' ) );
}
if ( 'clock' === $screen ) {
	$blotout_consent_notice = array( 'error', __( 'This server\'s clock is more than five minutes off, so Blotout refused the request. Your banner keeps showing. Ask your host to sync the server time, then reload.', 'blotout-consent' ) );
}

$blotout_consent_site    = is_array( $status['site'] ?? null ) ? $status['site'] : null;
$blotout_consent_current = array(
	'connect' => 1,
	'revoked' => 1,
	'wizard'  => 2,
)[ $screen ] ?? 0;
$blotout_consent_steps   = array(
	1 => __( 'Connect', 'blotout-consent' ),
	2 => __( 'Choose site', 'blotout-consent' ),
);
// Settings stay out of the way until setup is done.
$blotout_consent_show_settings = in_array( $screen, array( 'unreachable', 'clock' ), true );
?>
<div class="wrap blotout-consent">
	<div class="bo-wizard">
		<header class="bo-head">
			<div class="bo-brand">
				<h1>
					<img class="bo-logo" src="<?php echo esc_url( BLOTOUT_CONSENT_URL . 'assets/blotout-logo.svg' ); ?>" width="83" height="24" alt="<?php esc_attr_e( 'Blotout', 'blotout-consent' ); ?>" />
					<span class="bo-product"><?php esc_html_e( 'Consent', 'blotout-consent' ); ?></span>
				</h1>
			</div>
			<?php if ( $blotout_consent_current > 0 ) : ?>
				<ol class="bo-pill" aria-label="<?php esc_attr_e( 'Setup steps', 'blotout-consent' ); ?>">
					<?php foreach ( $blotout_consent_steps as $blotout_consent_n => $blotout_consent_label ) : ?>
						<?php $blotout_consent_state = $blotout_consent_n < $blotout_consent_current ? 'done' : ( $blotout_consent_n === $blotout_consent_current ? 'current' : 'upcoming' ); ?>
						<li class="is-<?php echo esc_attr( $blotout_consent_state ); ?>"<?php echo 'current' === $blotout_consent_state ? ' aria-current="step"' : ''; ?>>
							<?php
							if ( 'done' === $blotout_consent_state ) {
								$blotout_consent_icon( 'check' );
							}
							echo esc_html( $blotout_consent_label );
							if ( 'done' === $blotout_consent_state ) {
								echo '<span class="screen-reader-text">' . esc_html__( '(done)', 'blotout-consent' ) . '</span>';
							}
							?>
						</li>
					<?php endforeach; ?>
				</ol>
			<?php endif; ?>
		</header>
		<hr class="wp-header-end" />

		<?php if ( null !== $blotout_consent_notice ) : ?>
			<div class="bo-alert is-<?php echo esc_attr( $blotout_consent_notice[0] ); ?>" role="<?php echo 'error' === $blotout_consent_notice[0] ? 'alert' : 'status'; ?>">
				<?php $blotout_consent_icon( $blotout_consent_notice[0] ); ?>
				<p><?php echo esc_html( $blotout_consent_notice[1] ); ?></p>
			</div>
		<?php endif; ?>

		<?php if ( 1 === $blotout_consent_current ) : ?>
			<section class="bo-card">
				<div class="bo-hero">
					<h2><?php esc_html_e( 'Set up your consent banner', 'blotout-consent' ); ?></h2>
					<p class="bo-muted"><?php esc_html_e( 'Ask visitors before tracking them, and keep Google tags in line with their choice. Takes about two minutes.', 'blotout-consent' ); ?></p>
				</div>
				<div class="bo-card-content">
					<?php if ( 'revoked' === $screen ) : ?>
						<div class="bo-alert is-warning" role="status">
							<?php $blotout_consent_icon( 'warning' ); ?>
							<p><?php esc_html_e( 'Qinto access for this site ended. Connect again to keep managing the banner. It keeps showing in the meantime.', 'blotout-consent' ); ?></p>
						</div>
					<?php endif; ?>
					<ol class="bo-steps">
						<li>
							<span class="bo-step-num" aria-hidden="true">1</span>
							<div><p class="bo-strong"><?php esc_html_e( 'Connect Qinto', 'blotout-consent' ); ?></p><p class="bo-muted"><?php esc_html_e( 'Sign in, or create a free account, and approve one team.', 'blotout-consent' ); ?></p></div>
						</li>
						<li>
							<span class="bo-step-num" aria-hidden="true">2</span>
							<div><p class="bo-strong"><?php esc_html_e( 'Choose the site', 'blotout-consent' ); ?></p><p class="bo-muted"><?php esc_html_e( 'We suggest the Qinto site that matches this domain.', 'blotout-consent' ); ?></p></div>
						</li>
					</ol>
				</div>
				<form class="bo-card-footer" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="blotout_connect" />
					<?php wp_nonce_field( 'blotout_connect' ); ?>
					<button type="submit" class="bo-button is-primary is-lg"><?php esc_html_e( 'Connect to Qinto', 'blotout-consent' ); ?></button>
					<span class="bo-muted"><?php esc_html_e( 'Opens Qinto in this tab', 'blotout-consent' ); ?></span>
				</form>
			</section>
		<?php endif; ?>

		<?php if ( 'wizard' === $screen ) : ?>
			<?php /* Filled by assets/admin.js. */ ?>
			<section class="bo-card" id="blotout-wizard" aria-live="polite" data-email="<?php echo esc_attr( (string) ( $status['connection']['userEmail'] ?? '' ) ); ?>"></section>
		<?php endif; ?>

		<?php if ( 'live' === $screen ) : ?>
			<section class="bo-card">
				<div class="bo-card-content">
					<dl class="bo-details">
						<div class="bo-detail">
							<dt><?php esc_html_e( 'Qinto site', 'blotout-consent' ); ?></dt>
							<dd>
								<?php echo esc_html( (string) ( $status['selection']['siteName'] ?? $settings['site_name'] ) ); ?>
							</dd>
						</div>
						<div class="bo-detail">
							<dt><?php esc_html_e( 'Loads from', 'blotout-consent' ); ?></dt>
							<dd><code id="blotout-host"><?php echo esc_html( (string) $settings['qinto_host'] ); ?></code></dd>
						</div>
					</dl>
					<?php if ( null !== $blotout_consent_site && ! empty( $blotout_consent_site['developmentUrl'] ) ) : ?>
						<label class="bo-switch-card" for="blotout-use-qinto-url">
							<input type="checkbox" role="switch" class="bo-switch" id="blotout-use-qinto-url" aria-describedby="blotout-use-qinto-url-help" <?php checked( ! empty( $settings['use_qinto_url'] ) ); ?> />
							<span class="bo-switch-text">
								<span class="bo-strong"><?php esc_html_e( 'Use the Qinto URL while DNS is pending', 'blotout-consent' ); ?></span>
								<span class="bo-muted bo-break">
									<?php esc_html_e( 'Loads the banner from', 'blotout-consent' ); ?>
									<code><?php echo esc_html( (string) $blotout_consent_site['developmentUrl'] ); ?></code>
								</span>
								<span class="bo-muted" id="blotout-use-qinto-url-help"><?php esc_html_e( 'Some browsers do not remember visitors\' choices on this URL, so the banner may ask again. Switch back once DNS is verified.', 'blotout-consent' ); ?></span>
								<span class="bo-badge is-warning" id="blotout-qinto-url-badge"<?php echo empty( $settings['use_qinto_url'] ) ? ' hidden' : ''; ?>><?php esc_html_e( 'Using Qinto URL', 'blotout-consent' ); ?></span>
							</span>
						</label>
					<?php endif; ?>
					<hr class="bo-sep" />
					<?php require __DIR__ . '/consent-settings.php'; ?>
				</div>
				<footer class="bo-card-footer">
					<?php if ( ! empty( $status['selection']['bannerSettingsUrl'] ) ) : ?>
						<a class="bo-button is-outline" href="<?php echo esc_url( (string) $status['selection']['bannerSettingsUrl'] ); ?>" target="_blank" rel="noopener noreferrer">
							<?php esc_html_e( 'Edit banner in Qinto', 'blotout-consent' ); ?>
							<?php $blotout_consent_icon( 'external' ); ?>
							<span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'blotout-consent' ); ?></span>
						</a>
					<?php endif; ?>
					<span class="bo-disconnect-hint" role="status"></span>
					<button type="button" class="bo-button is-ghost bo-push" id="blotout-disconnect"><?php esc_html_e( 'Disconnect', 'blotout-consent' ); ?></button>
				</footer>
			</section>
		<?php elseif ( $blotout_consent_show_settings ) : ?>
			<section class="bo-card">
				<div class="bo-card-content">
					<?php require __DIR__ . '/consent-settings.php'; ?>
				</div>
			</section>
		<?php endif; ?>
	</div>
</div>
