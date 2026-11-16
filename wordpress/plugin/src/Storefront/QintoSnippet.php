<?php
/**
 * Prints the Qinto loader: a queueing stub plus `https://<host>/q.js`.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

namespace Blotout\Consent\Storefront;

use Blotout\Consent\Options;

/**
 * Mirrors Qinto's `snippetTag(host)` (`portal/services/src/domains/snippet.ts`) with the default
 * `qinto` global; `tests/fixtures/qinto-snippet.html` pins it. Only the stored host is printed.
 */
final class QintoSnippet {

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

	/** After Consent Mode (1), before other plugins' tags. */
	public function register(): void {
		add_action( 'wp_head', array( $this, 'render' ), 2 );
	}

	/** Prints the snippet when a Qinto host is set. */
	public function render(): void {
		$host = $this->options->qinto_host();
		if ( null === $host ) {
			return;
		}

		// Every dynamic part is a JSON-encoded string built from a hostname checked against Options::HOST_PATTERN.
		echo self::markup( $host ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * The `<script>` block for a host.
	 *
	 * @param string $host Delivery host, already validated.
	 */
	public static function markup( string $host ): string {
		$flags = JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP;
		$stub  = implode(
			"\n",
			array(
				'new Proxy(t,{get:function(o,n){',
				'if(typeof n!="string"||n=="then"||n=="ready"||n=="config"||n in o)return o[n];',
				'return o[n]=function(){var a=arguments;var p=new Promise(function(res,rej){o.q.push([n,a,res,rej])});p.catch(function(){});return p}}})',
			)
		);
		$lines = array(
			'<script>',
			'(function(w,d,u,g){if(g in w){var o=w[g];',
			'if(!(o&&o._q))console.error("window."+g+" is already in use");return}',
			'var t={_q:1,q:[]};',
			'Object.defineProperty(w,g,{value:' . $stub . ',writable:true,enumerable:true,configurable:true});',
			'var s=d.createElement("script");s.async=true;s.src=u;s.dataset.qintoGlobal=g;',
			'd.head.appendChild(s)})(window,document,' . wp_json_encode( 'https://' . $host . '/q.js', $flags ) . ',' . wp_json_encode( 'qinto', $flags ) . ');',
			'</script>',
		);

		return implode( "\n", $lines ) . "\n";
	}
}
