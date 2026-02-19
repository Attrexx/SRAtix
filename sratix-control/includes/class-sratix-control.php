<?php
/**
 * Core orchestrator — registers all hooks and loads components.
 *
 * @package SRAtix_Control
 */
class SRAtix_Control {

	/** @var SRAtix_Control_Loader */
	private $loader;

	/** @var SRAtix_Control_Admin */
	private $admin;

	/** @var SRAtix_Control_API */
	private $api;

	/** @var SRAtix_Control_Sync */
	private $sync;

	/** @var SRAtix_Control_Webhook */
	private $webhook;

	public function __construct() {
		$this->loader  = new SRAtix_Control_Loader();
		$this->admin   = new SRAtix_Control_Admin();
		$this->api     = new SRAtix_Control_API();
		$this->sync    = new SRAtix_Control_Sync( $this->api );
		$this->webhook = new SRAtix_Control_Webhook();
	}

	/**
	 * Register all hooks and run.
	 */
	public function run() {
		$this->define_admin_hooks();
		$this->define_sync_hooks();
		$this->define_webhook_hooks();
		$this->loader->run();
	}

	/*──────────────────────────────────────────────────────────
	 * Hook registration
	 *────────────────────────────────────────────────────────*/

	private function define_admin_hooks() {
		// Admin menu
		$this->loader->add_action( 'admin_menu',           $this->admin, 'add_menu_page' );
		$this->loader->add_action( 'admin_init',           $this->admin, 'register_settings' );
		$this->loader->add_action( 'admin_enqueue_scripts', $this->admin, 'enqueue_assets' );

		// Dashboard launch — exchanges WP credentials for JWT, redirects with token
		$this->loader->add_action( 'admin_post_sratix_launch_dashboard', $this->admin, 'handle_launch_dashboard' );
	}

	private function define_sync_hooks() {
		// Push WP profile changes to Server
		$this->loader->add_action( 'profile_update',       $this->sync, 'on_profile_update', 10, 2 );
		$this->loader->add_action( 'set_user_role',        $this->sync, 'on_role_change', 10, 3 );

		// ProfileGrid group changes
		$this->loader->add_action( 'pm_after_join_group',  $this->sync, 'on_group_join', 10, 2 );
		$this->loader->add_action( 'pm_after_leave_group', $this->sync, 'on_group_leave', 10, 2 );

		// WooCommerce membership purchase → org linking
		$this->loader->add_action( 'woocommerce_order_status_completed', $this->sync, 'on_order_complete', 20, 1 );
	}

	private function define_webhook_hooks() {
		// Register REST route for incoming webhooks from Server
		$this->loader->add_action( 'rest_api_init', $this->webhook, 'register_routes' );
	}
}
