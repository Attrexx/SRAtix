<?php
/**
 * Core orchestrator — registers all hooks and loads components.
 *
 * @package SRAtix_Client
 */
class SRAtix_Client {

	/** @var SRAtix_Client_Loader */
	private $loader;

	/** @var SRAtix_Client_Admin */
	private $admin;

	/** @var SRAtix_Client_Public */
	private $public;

	/** @var SRAtix_Client_Webhook */
	private $webhook;

	public function __construct() {
		$this->loader  = new SRAtix_Client_Loader();
		$this->admin   = new SRAtix_Client_Admin();
		$this->public  = new SRAtix_Client_Public();
		$this->webhook = new SRAtix_Client_Webhook();
	}

	public function run() {
		$this->define_admin_hooks();
		$this->define_public_hooks();
		$this->define_webhook_hooks();
		$this->loader->run();
	}

	private function define_admin_hooks() {
		$this->loader->add_action( 'admin_menu',  $this->admin, 'add_menu_page' );
		$this->loader->add_action( 'admin_init',  $this->admin, 'register_settings' );
	}

	private function define_public_hooks() {
		// Shortcodes
		$this->loader->add_action( 'init', $this->public, 'register_shortcodes' );

		// Enqueue frontend assets only on pages with our shortcodes
		$this->loader->add_action( 'wp_enqueue_scripts', $this->public, 'enqueue_assets' );
	}

	private function define_webhook_hooks() {
		$this->loader->add_action( 'rest_api_init', $this->webhook, 'register_routes' );
	}
}
