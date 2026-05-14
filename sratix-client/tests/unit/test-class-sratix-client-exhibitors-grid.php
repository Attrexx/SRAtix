<?php
/**
 * Unit tests for SRAtix_Client_Exhibitors_Grid.
 *
 * Uses Brain Monkey to mock WordPress functions.
 * No WordPress installation required.
 *
 * @package SRAtix_Client
 */

use PHPUnit\Framework\TestCase;
use Brain\Monkey;
use Brain\Monkey\Functions;

/**
 * Sentinel exception thrown when wp_send_json_error / wp_send_json_success
 * is called during AJAX handler tests, so we can assert on the arguments
 * without the test dying.
 */
class SXG_Json_Sent extends \RuntimeException {
	public array $data;
	public int   $status;
	public bool  $is_error;

	public function __construct( bool $is_error, array $data, int $status ) {
		parent::__construct( 'wp_send_json called' );
		$this->is_error = $is_error;
		$this->data     = $data;
		$this->status   = $status;
	}
}

class Test_SRAtix_Client_Exhibitors_Grid extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Monkey\setUp();

		// Default stubs for WP functions called in every constructor.
		Functions\when( 'add_shortcode' )->justReturn( true );
		Functions\when( 'add_action' )->justReturn( true );
		Functions\when( 'add_filter' )->justReturn( true );
		Functions\when( 'remove_filter' )->justReturn( true );
		Functions\when( 'is_wp_error' )->justReturn( false );
	}

	protected function tearDown(): void {
		Monkey\tearDown();
		parent::tearDown();
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Helper
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Instantiate the grid class with all constructor hooks mocked.
	 */
	private function make_grid(): SRAtix_Client_Exhibitors_Grid {
		return new SRAtix_Client_Exhibitors_Grid();
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 1. Constructor registers shortcode + AJAX + save_post hooks
	// ──────────────────────────────────────────────────────────────────────────

	public function test_constructor_registers_shortcode(): void {
		$registered_shortcodes = array();

		Functions\when( 'add_shortcode' )->alias(
			function ( string $tag, $callback ) use ( &$registered_shortcodes ) {
				$registered_shortcodes[] = $tag;
			}
		);

		$this->make_grid();

		$this->assertContains( 'sratix_exhibitors_grid', $registered_shortcodes );
	}

	public function test_constructor_registers_all_ajax_hooks(): void {
		$registered_actions = array();

		Functions\when( 'add_action' )->alias(
			function ( string $hook, $callback ) use ( &$registered_actions ) {
				$registered_actions[] = $hook;
			}
		);

		$this->make_grid();

		$this->assertContains( 'wp_ajax_sratix_exgrid_filter',        $registered_actions );
		$this->assertContains( 'wp_ajax_nopriv_sratix_exgrid_filter',  $registered_actions );
		$this->assertContains( 'wp_ajax_sratix_exgrid_detail',         $registered_actions );
		$this->assertContains( 'wp_ajax_nopriv_sratix_exgrid_detail',  $registered_actions );
		$this->assertContains( 'save_post',                            $registered_actions );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 2. Static helper: get_initials
	// ──────────────────────────────────────────────────────────────────────────

	public function test_get_initials_two_word_name(): void {
		$result = SRAtix_Client_Exhibitors_Grid::get_initials( 'Swiss Robotics' );
		$this->assertSame( 'SR', $result );
	}

	public function test_get_initials_single_word_returns_two_chars(): void {
		$result = SRAtix_Client_Exhibitors_Grid::get_initials( 'ABB' );
		$this->assertSame( 'AB', $result );
	}

	public function test_get_initials_single_char_name(): void {
		$result = SRAtix_Client_Exhibitors_Grid::get_initials( 'A' );
		$this->assertSame( 'A', $result );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 3. Static helper: get_logo_placeholder_hue — range 0–359
	// ──────────────────────────────────────────────────────────────────────────

	public function test_get_logo_placeholder_hue_within_range(): void {
		foreach ( array( 'ABB', 'KUKA', 'Universal Robots', 'Swiss Robotics Association', 'X' ) as $name ) {
			$hue = SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $name );
			$this->assertGreaterThanOrEqual( 0, $hue, "Hue for '$name' should be >= 0" );
			$this->assertLessThan( 360, $hue, "Hue for '$name' should be < 360" );
		}
	}

	public function test_get_logo_placeholder_hue_is_deterministic(): void {
		$name = 'Acme Robotics';
		$this->assertSame(
			SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $name ),
			SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $name )
		);
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 4. Static helper: get_json_meta — handles both string and array
	// ──────────────────────────────────────────────────────────────────────────

	public function test_get_json_meta_handles_json_string(): void {
		Functions\when( 'get_post_meta' )->justReturn( '{"foo":"bar","items":[1,2,3]}' );

		$result = SRAtix_Client_Exhibitors_Grid::get_json_meta( 1, 'media_gallery' );

		// Result is an array (decoded from JSON).
		$this->assertIsArray( $result );
		$this->assertSame( 'bar', $result['foo'] );
	}

	public function test_get_json_meta_handles_native_array(): void {
		$expected = array( array( 'url' => 'https://example.com/img.jpg' ) );
		Functions\when( 'get_post_meta' )->justReturn( $expected );

		$result = SRAtix_Client_Exhibitors_Grid::get_json_meta( 1, 'media_gallery' );

		$this->assertSame( $expected, $result );
	}

	public function test_get_json_meta_returns_empty_array_for_invalid_json(): void {
		Functions\when( 'get_post_meta' )->justReturn( 'not_valid_json{{' );

		$result = SRAtix_Client_Exhibitors_Grid::get_json_meta( 1, 'media_gallery' );

		$this->assertSame( array(), $result );
	}

	public function test_get_json_meta_returns_empty_array_for_empty_string(): void {
		Functions\when( 'get_post_meta' )->justReturn( '' );

		$result = SRAtix_Client_Exhibitors_Grid::get_json_meta( 1, 'media_gallery' );

		$this->assertSame( array(), $result );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 5. resolve_edition_slug: 'current' resolves to latest edition term slug
	// ──────────────────────────────────────────────────────────────────────────

	public function test_resolve_edition_current_returns_latest_slug(): void {
		$term       = new \stdClass();
		$term->slug = '2026';

		Functions\when( 'get_terms' )->justReturn( array( $term ) );

		$grid   = $this->make_grid();
		$result = $grid->resolve_edition_slug( 'current' );

		$this->assertSame( '2026', $result );
	}

	public function test_resolve_edition_current_returns_empty_when_no_terms(): void {
		Functions\when( 'get_terms' )->justReturn( array() );

		$grid   = $this->make_grid();
		$result = $grid->resolve_edition_slug( 'current' );

		$this->assertSame( '', $result );
	}

	public function test_resolve_edition_literal_slug_is_returned_as_is(): void {
		$grid   = $this->make_grid();
		$result = $grid->resolve_edition_slug( '2025' );

		$this->assertSame( '2025', $result );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 6. build_query: has_demo adds correct meta_query entry
	// ──────────────────────────────────────────────────────────────────────────

	public function test_build_query_has_demo_adds_meta_query(): void {
		$grid = $this->make_grid();

		$grid->build_query(
			array(
				'edition_slug' => '',
				'search'       => '',
				'sort'         => 'name',
				'expo_area'    => '',
				'category_id'  => 0,
				'type_id'      => 0,
				'has_demo'     => true,
				'per_page'     => 24,
				'page'         => 1,
				'exclude_ids'  => array(),
			)
		);

		$args = WP_Query::$last_args;

		$this->assertArrayHasKey( 'meta_query', $args );
		$found = false;
		foreach ( $args['meta_query'] as $clause ) {
			if ( is_array( $clause ) && isset( $clause['key'] ) && 'demo_description' === $clause['key'] ) {
				$found = true;
				$this->assertSame( '!=', $clause['compare'] );
				break;
			}
		}
		$this->assertTrue( $found, 'meta_query should include demo_description != "" when has_demo is true' );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 7. build_query: booth sort uses add_filter with posts_clauses
	// ──────────────────────────────────────────────────────────────────────────

	public function test_build_query_booth_sort_registers_posts_clauses_filter(): void {
		$registered_filters = array();

		Functions\when( 'add_filter' )->alias(
			function ( string $hook, $callback ) use ( &$registered_filters ) {
				$registered_filters[] = $hook;
			}
		);

		$grid = $this->make_grid();
		$grid->build_query(
			array(
				'edition_slug' => '',
				'search'       => '',
				'sort'         => 'booth',
				'expo_area'    => '',
				'category_id'  => 0,
				'type_id'      => 0,
				'has_demo'     => false,
				'per_page'     => 24,
				'page'         => 1,
				'exclude_ids'  => array(),
			)
		);

		$this->assertContains( 'posts_clauses', $registered_filters );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 8. AJAX filter: rejects invalid nonce with 403
	// ──────────────────────────────────────────────────────────────────────────

	public function test_ajax_filter_rejects_invalid_nonce(): void {
		Functions\when( 'check_ajax_referer' )->justReturn( false );
		Functions\when( '__' )->returnArg( 1 );

		Functions\when( 'wp_send_json_error' )->alias(
			function ( $data, int $status = 200 ) {
				throw new SXG_Json_Sent( true, (array) $data, $status );
			}
		);

		$grid = $this->make_grid();

		$sent = null;
		try {
			$grid->ajax_filter();
		} catch ( SXG_Json_Sent $e ) {
			$sent = $e;
		}

		$this->assertNotNull( $sent, 'wp_send_json_error should have been called' );
		$this->assertTrue( $sent->is_error );
		$this->assertSame( 403, $sent->status );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 9. AJAX detail: rejects wrong post type with 404
	// ──────────────────────────────────────────────────────────────────────────

	public function test_ajax_detail_rejects_wrong_post_type(): void {
		Functions\when( 'check_ajax_referer' )->justReturn( true );
		Functions\when( 'get_post_type' )->justReturn( 'page' ); // not 'exhibitor'
		Functions\when( 'get_post_status' )->justReturn( 'publish' );
		Functions\when( '__' )->returnArg( 1 );

		Functions\when( 'wp_send_json_error' )->alias(
			function ( $data, int $status = 200 ) {
				throw new SXG_Json_Sent( true, (array) $data, $status );
			}
		);

		$_POST['post_id'] = '42';

		$grid = $this->make_grid();

		$sent = null;
		try {
			$grid->ajax_detail();
		} catch ( SXG_Json_Sent $e ) {
			$sent = $e;
		}

		unset( $_POST['post_id'] );

		$this->assertNotNull( $sent, 'wp_send_json_error should have been called' );
		$this->assertSame( 404, $sent->status );
	}

	// ──────────────────────────────────────────────────────────────────────────
	// 10. maybe_clear_expo_areas_cache: only deletes transient for exhibitor CPT
	// ──────────────────────────────────────────────────────────────────────────

	public function test_maybe_clear_expo_areas_cache_deletes_on_exhibitor_post(): void {
		$deleted_keys = array();

		Functions\when( 'delete_transient' )->alias(
			function ( string $key ) use ( &$deleted_keys ) {
				$deleted_keys[] = $key;
			}
		);

		$post              = new WP_Post();
		$post->post_type   = 'exhibitor';

		$grid = $this->make_grid();
		$grid->maybe_clear_expo_areas_cache( 1, $post );

		$this->assertContains( SRAtix_Client_Exhibitors_Grid::EXPO_AREAS_TRANSIENT, $deleted_keys );
	}

	public function test_maybe_clear_expo_areas_cache_ignores_other_post_types(): void {
		$deleted_keys = array();

		Functions\when( 'delete_transient' )->alias(
			function ( string $key ) use ( &$deleted_keys ) {
				$deleted_keys[] = $key;
			}
		);

		$post            = new WP_Post();
		$post->post_type = 'page';

		$grid = $this->make_grid();
		$grid->maybe_clear_expo_areas_cache( 1, $post );

		$this->assertNotContains( SRAtix_Client_Exhibitors_Grid::EXPO_AREAS_TRANSIENT, $deleted_keys );
	}
}
