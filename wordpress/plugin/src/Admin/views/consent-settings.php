<?php
/**
 * Consent settings form, always open. Shown inside the live card or as its own card.
 *
 * @package Blotout\Consent
 *
 * @var array<string,mixed> $settings Stored settings.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<form class="bo-settings" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
	<input type="hidden" name="action" value="blotout_save_consent" />
	<?php wp_nonce_field( 'blotout_save_consent' ); ?>
	<div class="bo-settings-head">
		<h3><?php esc_html_e( 'Consent settings', 'blotout-consent' ); ?></h3>
		<p class="bo-muted"><?php esc_html_e( 'How this site treats visitors before they make a choice.', 'blotout-consent' ); ?></p>
	</div>
	<div class="bo-field">
		<label for="blotout-consent-type"><?php esc_html_e( 'Consent type', 'blotout-consent' ); ?></label>
		<select id="blotout-consent-type" name="consent_type" aria-describedby="blotout-consent-type-help">
			<option value="optin" <?php selected( $settings['consent_type'], 'optin' ); ?>><?php esc_html_e( 'Opt-in: no tracking until the visitor accepts (EU, UK)', 'blotout-consent' ); ?></option>
			<option value="optout" <?php selected( $settings['consent_type'], 'optout' ); ?>><?php esc_html_e( 'Opt-out: tracking allowed until the visitor rejects (US)', 'blotout-consent' ); ?></option>
		</select>
		<p class="bo-field-description" id="blotout-consent-type-help"><?php esc_html_e( 'What WordPress plugins assume before a visitor answers the banner. Once they answer, their choice is used instead.', 'blotout-consent' ); ?></p>
	</div>
	<div class="bo-field is-inline">
		<input type="checkbox" id="blotout-consent-mode" name="consent_mode" value="1" <?php checked( ! empty( $settings['consent_mode'] ) ); ?> />
		<div>
			<label for="blotout-consent-mode"><?php esc_html_e( 'Google Consent Mode v2', 'blotout-consent' ); ?></label>
			<p class="bo-field-description"><?php esc_html_e( 'Tell Google tags what each visitor chose.', 'blotout-consent' ); ?></p>
		</div>
	</div>
	<div>
		<button type="submit" class="bo-button is-primary"><?php esc_html_e( 'Save changes', 'blotout-consent' ); ?></button>
	</div>
</form>
