<?php
/**
 * Plugin Name:       SRAtix Client
 * Plugin URI:        https://swissroboticsday.ch
 * Description:       SRAtix public ticket purchase — embeds registration forms and attendee self-service from the SRAtix ticketing server.
 * Version:           0.1.0
 * Author:            TAROS Web Services
 * Author URI:        https://taros.ch
 * License:           Proprietary
 * Text Domain:       sratix-client
 * Domain Path:       /languages
 *
 * Requires PHP: 8.0
 * Requires at least: 6.0
 *
 * @package SRAtix_Client
 */

// Abort if called directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/*──────────────────────────────────────────────────────────────
 * Constants
 *────────────────────────────────────────────────────────────*/
define( 'SRATIX_CLIENT_VERSION', '0.1.0' );
define( 'SRATIX_CLIENT_FILE',    __FILE__ );
define( 'SRATIX_CLIENT_DIR',     plugin_dir_path( __FILE__ ) );
define( 'SRATIX_CLIENT_URL',     plugin_dir_url( __FILE__ ) );

/*──────────────────────────────────────────────────────────────
 * Autoload includes
 *────────────────────────────────────────────────────────────*/
require_once SRATIX_CLIENT_DIR . 'includes/class-sratix-client-loader.php';
require_once SRATIX_CLIENT_DIR . 'includes/class-sratix-client.php';
require_once SRATIX_CLIENT_DIR . 'includes/class-sratix-client-admin.php';
require_once SRATIX_CLIENT_DIR . 'includes/class-sratix-client-public.php';
require_once SRATIX_CLIENT_DIR . 'includes/class-sratix-client-webhook.php';

/*──────────────────────────────────────────────────────────────
 * Bootstrap
 *────────────────────────────────────────────────────────────*/
function sratix_client_init() {
	$plugin = new SRAtix_Client();
	$plugin->run();
}
add_action( 'plugins_loaded', 'sratix_client_init', 20 );

/*──────────────────────────────────────────────────────────────
 * Activation / Deactivation
 *────────────────────────────────────────────────────────────*/
register_activation_hook( __FILE__, function () {
	// Default options
	add_option( 'sratix_client_api_url', 'https://tix.swiss-robotics.org/api' );
	add_option( 'sratix_client_api_secret', '' );
	add_option( 'sratix_client_webhook_secret', '' );
	add_option( 'sratix_client_event_id', '' );
	add_option( 'sratix_client_embed_config', wp_json_encode( array(
		'theme'       => 'light',
		'primaryColor' => '#0073aa',
		'showSchedule' => true,
	) ) );
});

register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( 'sratix_client_cache_clear' );
});
