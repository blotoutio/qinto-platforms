<?php
/**
 * PSR-4 autoloader for `Blotout\Consent\*` under `src/`. No Composer at runtime.
 *
 * @package Blotout\Consent
 */

declare( strict_types=1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

spl_autoload_register(
	static function ( string $class_name ): void {
		$prefix = 'Blotout\\Consent\\';
		if ( 0 !== strpos( $class_name, $prefix ) ) {
			return;
		}

		$path = __DIR__ . '/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
		if ( is_readable( $path ) ) {
			require_once $path;
		}
	}
);
