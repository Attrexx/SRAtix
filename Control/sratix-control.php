<?php
/**
 * Plugin Name:       SRAtix Control
 * Plugin URI:        https://swiss-robotics.org
 * Description:       SRAtix admin dashboard connector — links Swiss Robotics Association WordPress to the SRAtix ticketing server.
 * Version:           0.1.0
 * Author:            TAROS Web Services
 * Author URI:        https://taros.ch
 * License:           Proprietary
 * Text Domain:       sratix-control
 * Domain Path:       /languages
 *
 * Requires PHP: 8.0
 * Requires at least: 6.0
 *
 * @package SRAtix_Control
 */

// Abort if called directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/*──────────────────────────────────────────────────────────────
 * Constants
 *────────────────────────────────────────────────────────────*/
define( 'SRATIX_CONTROL_VERSION', '0.1.0' );
define( 'SRATIX_CONTROL_FILE',    __FILE__ );
define( 'SRATIX_CONTROL_DIR',     plugin_dir_path( __FILE__ ) );
define( 'SRATIX_CONTROL_URL',     plugin_dir_url( __FILE__ ) );

/*──────────────────────────────────────────────────────────────
 * Autoload includes
 *────────────────────────────────────────────────────────────*/
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control-loader.php';
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control.php';
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control-admin.php';
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control-api.php';
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control-sync.php';
require_once SRATIX_CONTROL_DIR . 'includes/class-sratix-control-webhook.php';

/*──────────────────────────────────────────────────────────────
 * Bootstrap
 *────────────────────────────────────────────────────────────*/
function sratix_control_init() {
	$plugin = new SRAtix_Control();
	$plugin->run();
}
add_action( 'plugins_loaded', 'sratix_control_init', 20 );

/*──────────────────────────────────────────────────────────────
 * Activation / Deactivation
 *────────────────────────────────────────────────────────────*/
register_activation_hook( __FILE__, function () {
	// Create mapping table on activation
	global $wpdb;
	$table   = $wpdb->prefix . 'sratix_mappings';
	$charset = $wpdb->get_charset_collate();

	$sql = "CREATE TABLE IF NOT EXISTS {$table} (
		id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
		wp_entity_type  VARCHAR(50)  NOT NULL,
		wp_entity_id    BIGINT       NOT NULL,
		sratix_entity_type VARCHAR(50) NOT NULL,
		sratix_entity_id   CHAR(36)    NOT NULL,
		org_id          CHAR(36)     DEFAULT NULL,
		meta            LONGTEXT     DEFAULT NULL,
		created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
		UNIQUE KEY uq_wp  (wp_entity_type, wp_entity_id),
		UNIQUE KEY uq_tix (sratix_entity_type, sratix_entity_id)
	) {$charset};";

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( $sql );

	// Default options
	add_option( 'sratix_api_url', 'https://tix.swiss-robotics.org/api' );
	add_option( 'sratix_api_secret', '' );
	add_option( 'sratix_webhook_secret', '' );
});

register_deactivation_hook( __FILE__, function () {
	// Clean up scheduled events
	wp_clear_scheduled_hook( 'sratix_control_sync_cron' );
});
