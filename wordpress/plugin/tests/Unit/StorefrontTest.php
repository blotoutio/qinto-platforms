<?php
declare( strict_types=1 );

namespace Blotout\Consent\Tests\Unit;

use Blotout\Consent\Options;
use Blotout\Consent\Storefront\ConsentModeV2;
use Blotout\Consent\Storefront\QintoSnippet;
use Blotout\Consent\Tests\TestCase;

final class StorefrontTest extends TestCase {

	private function settings( array $values ): Options {
		$this->store[ Options::SETTINGS ] = $values;

		return new Options();
	}

	private function printed( callable $render ): string {
		ob_start();
		$render();

		return (string) ob_get_clean();
	}

	public function test_snippet_matches_qintos_own_snippet_tag(): void {
		$this->assertSame( file_get_contents( dirname( __DIR__ ) . '/fixtures/qinto-snippet.html' ), QintoSnippet::markup( 'cdn.example.com' ) );
	}

	public function test_snippet_prints_only_a_valid_host(): void {
		$snippet = new QintoSnippet( $this->settings( array( 'qinto_host' => 'cdn.example.com' ) ) );
		$this->assertStringContainsString( '"https://cdn.example.com/q.js"', $this->printed( array( $snippet, 'render' ) ) );

		$injected = new QintoSnippet( $this->settings( array( 'qinto_host' => 'x.com"});alert(1);//' ) ) );
		$this->assertSame( '', $this->printed( array( $injected, 'render' ) ) );
	}

	public function test_consent_mode_output_is_the_pinned_script_then_the_restore(): void {
		$mode = new ConsentModeV2( $this->settings( array( 'qinto_host' => 'cdn.example.com' ) ) );

		$this->assertSame(
			file_get_contents( dirname( __DIR__ ) . '/fixtures/consent-mode.html' ) . ConsentModeV2::RESTORE,
			$this->printed( array( $mode, 'render' ) )
		);
	}

	public function test_restore_sends_the_stored_choice_once_the_page_has_loaded(): void {
		$this->assertStringContainsString( "addEventListener('DOMContentLoaded'", ConsentModeV2::RESTORE );
		$this->assertStringContainsString( "typeof window.wp_has_consent === 'function'", ConsentModeV2::RESTORE );
		$this->assertStringContainsString( "gtag('consent', 'update', blotoutToGtagConsent())", ConsentModeV2::RESTORE );
	}

	public function test_consent_mode_needs_a_banner_and_the_setting(): void {
		$this->assertSame( '', $this->printed( array( new ConsentModeV2( $this->settings( array() ) ), 'render' ) ) );

		$off = new ConsentModeV2(
			$this->settings(
				array(
					'qinto_host'   => 'cdn.example.com',
					'consent_mode' => 0,
				)
			)
		);
		$this->assertSame( '', $this->printed( array( $off, 'render' ) ) );
	}
}
