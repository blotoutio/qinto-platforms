=== Blotout Consent ===
Contributors: blotout
Tags: consent, cookie-banner, privacy, cookies, consent-mode
Requires at least: 5.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html

Runs the Blotout consent banner from Qinto and bridges visitor decisions into the WP Consent API, and optionally Google Consent Mode v2.

== Description ==
Blotout Consent shows the Blotout consent banner on your site and passes each visitor's decision to the WP Consent API, so consent-aware plugins honor it. It can also send the same decision to Google Consent Mode v2 for GTM and gtag.js.

Connect to Qinto from the plugin's settings page, then pick an existing Qinto site or create one. The plugin saves only the host the banner loads from.

The WP Consent API plugin (https://wordpress.org/plugins/wp-consent-api/) must be active for other plugins to receive consent. Without it the banner still shows.

= What is Qinto? =

Qinto (https://qinto.tech) is Blotout's hosting platform. It serves the consent banner from your own domain, or from a Qinto URL until your DNS is set up, and stores the banner's design and settings. The banner is designed and switched on in Qinto, not in WordPress.

You need a Qinto account to use this plugin. You can create one for free while connecting. The plugin can create a Qinto site for you, but you deploy it in Qinto, where Qinto may ask for a payment method on your team. Qinto's pricing applies to that site; this plugin itself has no paid features.

== Installation ==

1. Install and activate Blotout Consent from Plugins > Add New.
2. Install and activate the WP Consent API plugin, so other plugins receive each visitor's choice.
3. Open Blotout Consent in the admin menu and click "Connect to Qinto". Sign in to Qinto, or create an account, and approve access for one team.
4. Pick the Qinto site that matches this domain, or create one. For a new site, add the DNS records shown, or email them to whoever manages your DNS.
5. Click "Edit banner in Qinto" to design the banner and switch it on.
6. Back in WordPress, choose the consent type and whether to send choices to Google Consent Mode v2, then save.

== Frequently Asked Questions ==

= I connected a site but no banner shows. Why? =

A new Qinto site's banner is off until you switch it on. Click "Edit banner in Qinto" on the settings page and turn it on there. Your banner's region rules in Qinto also decide where it shows, so visitors outside those regions will not see it.

= Do I need the WP Consent API plugin? =

Yes, for the choice to reach anything else. Without it the banner still shows, but other plugins will not see the visitor's choice, and this plugin's Google Consent Mode v2 option stays at "denied" because it reads the choice through the WP Consent API.

= What does the consent type setting do? =

It tells consent-aware plugins what to assume before a visitor answers the banner. "Opt-in" means no tracking until the visitor accepts. "Opt-out" means tracking is allowed until the visitor rejects. Once the visitor answers, their choice is used instead.

= What is the "Use the Qinto URL" switch? =

A new site loads the banner from a Qinto URL until the DNS records for your own domain are verified. Some browsers do not remember visitors' choices on that URL, so switch back to your domain once DNS is verified.

= Why does the plugin contact Blotout every day? =

Once you have connected, the plugin checks in with the Blotout broker once a day. The check-in carries no visitor data. It lets the broker cancel Qinto access for installs that have gone away: an install that has not checked in for 60 days is disconnected. It stops when you disconnect, deactivate or delete the plugin.

= How do I disconnect? =

Click "Disconnect" on the settings page. Deleting the plugin also disconnects it and removes everything it saved.

== Screenshots ==

1. Connect the plugin to Qinto.
2. Choose the Qinto site for this domain, or create one.
3. The settings page once a site is connected, with the consent settings.

== External services ==

This plugin uses two services. Nothing is contacted when you activate it, and nothing is contacted from your site's front end until you have picked a Qinto site.

**Blotout broker - consent-wordpress.blotout.io**

The broker signs you in to Qinto so this plugin never holds a Qinto token or an OAuth client secret. It is called from the admin screen only, after you click "Connect to Qinto", and from a daily WordPress cron job that tells it this install is still in use.

* Registering this site (once): your site URL and this site's admin-post URL are sent. The broker returns an identifier and a secret for this install, and calls a public endpoint on this site to check it holds that secret, each time you connect.
* Signing in: your browser goes to a broker page naming your site, then to Qinto (portal.qinto.tech) to approve access, then back here. Only a WordPress nonce and the result travel back.
* Managing your site: listing teams and sites, creating a site, DNS records (checking them, or emailing them to addresses you type), picking a site, switching between your domain and the Qinto URL, and disconnecting. Each request carries the ids it acts on and a signature over your site URL, a timestamp and a one-time nonce.

Terms: https://blotout.io/terms-of-service - Privacy: https://blotout.io/privacy-policy

**Qinto - the host you picked, for example cdn.example.com/q.js**

Each page on your site loads the banner script from the host of the Qinto site you picked. Qinto receives what any script request carries (IP address, user agent, the page URL) and the visitor's consent choices.

Terms: https://blotout.io/terms-of-service - Privacy: https://blotout.io/privacy-policy

What this plugin saves on your site:

* The install identifier and secret, saved as an option that is not autoloaded.
* The picked site's host, name and ids, and your consent settings.

Deleting the plugin removes all of it and asks the broker to revoke the Qinto access.

== Changelog ==

= 1.0.0 =
* The banner runs on Qinto. Connect to Qinto and pick or create a site from the settings page.
