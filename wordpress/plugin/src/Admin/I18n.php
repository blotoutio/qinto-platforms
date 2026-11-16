<?php
/**
 * Strings the wizard script shows.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Admin;

/**
 * Error slugs from the broker map to plain copy here, so the script never shows a raw slug.
 */
final class I18n {

	/**
	 * Every string `assets/admin.js` uses.
	 *
	 * @return array<string,string>
	 */
	public static function strings(): array {
		return array(
			'loading'                 => __( 'Loading your Qinto sites…', 'blotout-consent' ),
			'team'                    => __( 'Qinto team', 'blotout-consent' ),
			'chooseTitle'             => __( 'Which Qinto site runs this banner?', 'blotout-consent' ),
			/* translators: 1: Qinto account email, 2: Qinto team name. */
			'signedIn'                => __( 'Signed in as %1$s · %2$s', 'blotout-consent' ),
			'sitesLabel'              => __( 'Qinto sites', 'blotout-consent' ),
			/* translators: %s: Qinto site name. */
			'useNamed'                => __( 'Use %s', 'blotout-consent' ),
			'useFailed'               => __( 'Qinto could not use this site', 'blotout-consent' ),
			'createTitle'             => __( 'Create a new Qinto site instead', 'blotout-consent' ),
			'continueQinto'           => __( 'Continue with the Qinto URL', 'blotout-consent' ),
			'dnsHint'                 => __( 'Add these records where your domain is managed. You can carry on now; the banner uses the Qinto URL until DNS is verified, and that URL does not remember visitors\' choices in every browser.', 'blotout-consent' ),
			'matchesSite'             => __( 'Matches this site', 'blotout-consent' ),
			'noSites'                 => __( 'No sites in this team yet. Create one below.', 'blotout-consent' ),
			'working'                 => __( 'Working…', 'blotout-consent' ),
			'domainLabel'             => __( 'Domain', 'blotout-consent' ),
			'domainHelp'              => __( 'The domain visitors use, without https://, e.g. example.com.', 'blotout-consent' ),
			'siteNameLabel'           => __( 'Site name (optional)', 'blotout-consent' ),
			'create'                  => __( 'Create site', 'blotout-consent' ),
			'back'                    => __( 'Back to sites', 'blotout-consent' ),
			/* translators: %s: the site's domain. */
			'dnsHeading'              => __( 'Point %s at Qinto', 'blotout-consent' ),
			'colType'                 => __( 'Type', 'blotout-consent' ),
			'colName'                 => __( 'Name', 'blotout-consent' ),
			'colValue'                => __( 'Value', 'blotout-consent' ),
			'copy'                    => __( 'Copy', 'blotout-consent' ),
			'copied'                  => __( 'Copied', 'blotout-consent' ),
			'loadingDns'              => __( 'Loading DNS records…', 'blotout-consent' ),
			'dnsCheck'                => __( 'Check DNS', 'blotout-consent' ),
			'dnsValid'                => __( 'DNS verified', 'blotout-consent' ),
			'dnsPending'              => __( 'Not verified yet. DNS can take a while to update.', 'blotout-consent' ),
			'emailToggle'             => __( 'Email these records to someone else', 'blotout-consent' ),
			'emailsLabel'             => __( 'Email addresses', 'blotout-consent' ),
			'emailsHelp'              => __( 'Separate several addresses with commas.', 'blotout-consent' ),
			'share'                   => __( 'Send records', 'blotout-consent' ),
			'shared'                  => __( 'Sent.', 'blotout-consent' ),
			'pending'                 => __( 'DNS pending', 'blotout-consent' ),
			'saved'                   => __( 'Saved. Reloading…', 'blotout-consent' ),
			'destinationSaved'        => __( 'Saved. Visitors get the banner from the new address on their next page view.', 'blotout-consent' ),
			'disconnect'              => __( 'Disconnect', 'blotout-consent' ),
			'confirmDisconnect'       => __( 'Yes, disconnect', 'blotout-consent' ),
			'cancel'                  => __( 'Cancel', 'blotout-consent' ),
			'confirmLeave'            => __( 'The banner stops showing on your site until you connect again.', 'blotout-consent' ),
			'err_unknown'             => __( 'Something went wrong. Try again.', 'blotout-consent' ),
			'err_site_locked'         => __( 'This site is already linked to another Qinto site. Disconnect first to change it.', 'blotout-consent' ),
			'err_qinto_not_connected' => __( 'Qinto is not connected. Connect again.', 'blotout-consent' ),
			'err_qinto_grant_revoked' => __( 'Qinto access was revoked. Connect again.', 'blotout-consent' ),
			'err_busy'                => __( 'Qinto is busy. Try again in a moment.', 'blotout-consent' ),
			'err_qinto_unavailable'   => __( 'Qinto is not answering right now. Try again in a few minutes.', 'blotout-consent' ),
			'err_clock_skew'          => __( 'This server\'s clock is more than five minutes off. Ask your host to sync the server time.', 'blotout-consent' ),
			'err_no_payment_method'   => __( 'Qinto needs a payment method on this team before it can publish the site. Add one in Qinto, then try again.', 'blotout-consent' ),
			'err_rate_limited'        => __( 'Too many emails sent. Wait a minute and try again.', 'blotout-consent' ),
			'err_bad_domain'          => __( 'Enter a domain like example.com.', 'blotout-consent' ),
			'err_bad_emails'          => __( 'Enter between one and ten email addresses.', 'blotout-consent' ),
			'err_no_qinto_url'        => __( 'This site has no Qinto URL.', 'blotout-consent' ),
			'err_unreachable'         => __( 'Could not reach Blotout. Try again.', 'blotout-consent' ),
			'err_forbidden'           => __( 'Qinto refused this. Check you approved this team when connecting.', 'blotout-consent' ),
			'err_already_exists'      => __( 'A Qinto site for this domain already exists. Pick it from the list.', 'blotout-consent' ),
		);
	}
}
