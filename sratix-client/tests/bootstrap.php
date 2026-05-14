<?php
/**
 * Unit test bootstrap for SRAtix Client plugin.
 *
 * Uses Brain Monkey to mock WordPress functions — no WP installation needed.
 */

$autoloader = dirname( __DIR__ ) . '/vendor/autoload.php';

if ( ! file_exists( $autoloader ) ) {
	echo "\n\033[31mError: Run 'composer install' in SRAtix/sratix-client/ first.\033[0m\n\n";
	exit( 1 );
}

require_once $autoloader;

// WordPress constants guarded in production code.
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', sys_get_temp_dir() . '/wordpress/' );
}

// Plugin-specific constants used by the grid class.
if ( ! defined( 'SRATIX_CLIENT_DIR' ) ) {
	define( 'SRATIX_CLIENT_DIR', dirname( __DIR__ ) . '/' );
}
if ( ! defined( 'SRATIX_CLIENT_URL' ) ) {
	define( 'SRATIX_CLIENT_URL', 'https://example.com/wp-content/plugins/sratix-client/' );
}
if ( ! defined( 'SRATIX_CLIENT_VERSION' ) ) {
	define( 'SRATIX_CLIENT_VERSION', '0.12.0' );
}

if ( ! defined( 'HOUR_IN_SECONDS' ) ) {
	define( 'HOUR_IN_SECONDS', 3600 );
}

// ── Minimal WP class stubs needed for unit tests ─────────────────────────────

if ( ! class_exists( 'WP_Query' ) ) {
	/**
	 * Stub WP_Query — captures constructor args for assertion; returns no posts.
	 */
	class WP_Query {
		/** @var array<string,mixed> Last constructed args (accessible via static). */
		public static array $last_args = array();

		/** @var array<string,mixed> Constructor args for this instance. */
		public array $query_vars = array();

		/** @var int */
		public int $found_posts = 0;

		/** @var array<int,\WP_Post> */
		public array $posts = array();

		public function __construct( array $args = array() ) {
			self::$last_args  = $args;
			$this->query_vars = $args;
		}

		public function have_posts(): bool { return false; }
		public function the_post(): void {}
	}
}

if ( ! class_exists( 'WP_Post' ) ) {
	/** Minimal WP_Post stub. */
	class WP_Post {
		public int    $ID          = 0;
		public string $post_type   = '';
		public string $post_status = '';
		public string $post_title  = '';
		public string $post_content = '';
	}
}

if ( ! class_exists( 'WP_Error' ) ) {
	/** Minimal WP_Error stub. */
	class WP_Error {
		public function get_error_message(): string { return ''; }
	}
}
