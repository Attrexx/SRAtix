<?php
/**
 * Unit test bootstrap for SRAtix Control.
 */

$autoloader = dirname( __DIR__ ) . '/vendor/autoload.php';

if ( ! file_exists( $autoloader ) ) {
	echo "\n\033[31mError: Run 'composer install' in sratix-control/ first.\033[0m\n\n";
	exit( 1 );
}

require_once $autoloader;

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', sys_get_temp_dir() . '/wordpress/' );
}

if ( ! defined( 'SRATIX_CONTROL_DIR' ) ) {
	define( 'SRATIX_CONTROL_DIR', dirname( __DIR__ ) . '/' );
}