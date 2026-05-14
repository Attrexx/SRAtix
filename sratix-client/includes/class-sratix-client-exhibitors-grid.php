<?php
/**
 * Public Exhibitors Grid — shortcode renderer, query builder, AJAX handlers.
 *
 * Provides [sratix_exhibitors_grid] — a self-contained, AJAX-filterable card
 * grid backed by the WP `exhibitor` CPT (synced from SRAtix Server via the
 * sratix-control webhook).  Coexists with the legacy [exhibitor_filters]
 * mu-plugin which targets Elementor Loop Grid pages.
 *
 * @package SRAtix_Client
 * @since   0.12.0
 */

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SRAtix_Client_Exhibitors_Grid {

	/*──────────────────────────────────────────────────────────────
	 * Constants
	 *────────────────────────────────────────────────────────────*/

	/** Nonce action shared between PHP and JS. */
	const NONCE_ACTION = 'sratix_exgrid_nonce';

	/** Transient key for cached expo-area list. */
	const EXPO_AREAS_TRANSIENT = 'srd_unique_expo_areas';

	/*──────────────────────────────────────────────────────────────
	 * Bootstrap
	 *────────────────────────────────────────────────────────────*/

	public function __construct() {
		// Shortcode.
		add_shortcode( 'sratix_exhibitors_grid', array( $this, 'render_shortcode' ) );

		// AJAX — filter/search/paginate the card grid.
		add_action( 'wp_ajax_sratix_exgrid_filter',        array( $this, 'ajax_filter' ) );
		add_action( 'wp_ajax_nopriv_sratix_exgrid_filter', array( $this, 'ajax_filter' ) );

		// AJAX — modal detail view.
		add_action( 'wp_ajax_sratix_exgrid_detail',        array( $this, 'ajax_detail' ) );
		add_action( 'wp_ajax_nopriv_sratix_exgrid_detail', array( $this, 'ajax_detail' ) );

		// Invalidate expo-areas transient when exhibitor CPT posts change.
		add_action( 'save_post', array( $this, 'maybe_clear_expo_areas_cache' ), 20, 2 );
	}

	/*──────────────────────────────────────────────────────────────
	 * Shortcode
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Render the exhibitors grid shortcode.
	 *
	 * @param array<string, string>|string $atts Raw shortcode attributes.
	 * @return string HTML output.
	 */
	public function render_shortcode( $atts ): string {
		$atts = shortcode_atts(
			array(
				'event'        => 'current',
				'per_page'     => 24,
				'default_sort' => 'booth',
				'show_filters' => 'true',
				'columns'      => 'auto',
				'featured_top' => 'true',
			),
			$atts,
			'sratix_exhibitors_grid'
		);

		// Sanitize every attribute individually.
		$per_page     = max( 1, min( 96, (int) $atts['per_page'] ) );
		$default_sort = in_array( $atts['default_sort'], array( 'booth', 'name' ), true ) ? $atts['default_sort'] : 'booth';
		$show_filters = filter_var( $atts['show_filters'], FILTER_VALIDATE_BOOLEAN );
		$featured_top = filter_var( $atts['featured_top'], FILTER_VALIDATE_BOOLEAN );
		$columns      = in_array( $atts['columns'], array( 'auto', '2', '3', '4' ), true ) ? $atts['columns'] : 'auto';
		$event    = sanitize_text_field( $atts['event'] ); // kept for data-event attribute
		$event_id = sanitize_text_field( get_option( 'sratix_client_event_id', '' ) );

		// Read initial filter state from URL params (GET-submit / no-JS fallback).
		$initial_search   = isset( $_GET['exhibitor_search'] )    ? sanitize_text_field( wp_unslash( $_GET['exhibitor_search'] ) )    : '';
		$initial_sort     = isset( $_GET['exhibitor_sort'] )      ? sanitize_text_field( wp_unslash( $_GET['exhibitor_sort'] ) )      : $default_sort;
		$initial_sort     = in_array( $initial_sort, array( 'booth', 'name' ), true ) ? $initial_sort : $default_sort;
		$initial_area     = isset( $_GET['exhibitor_expo_area'] ) ? sanitize_text_field( wp_unslash( $_GET['exhibitor_expo_area'] ) ) : '';
		$initial_cat      = isset( $_GET['exhibitor_category'] )  ? (int) $_GET['exhibitor_category']  : 0;
		$initial_type     = isset( $_GET['exhibitor_type'] )      ? (int) $_GET['exhibitor_type']      : 0;
		$initial_has_demo = isset( $_GET['exhibitor_has_demo'] )  ? (bool) $_GET['exhibitor_has_demo'] : false;

		// --- Sponsor row (separate query, page 1 only).
		$sponsor_posts = array();
		if ( $featured_top ) {
			$sponsor_posts = $this->query_sponsors( $event_id, $initial_search, $initial_area, $initial_cat );
		}
		$sponsor_ids = wp_list_pluck( $sponsor_posts, 'ID' );

		// --- Main grid query (page 1 server-render).
		$query = $this->build_query(
			array(
				'event_id'     => $event_id,
				'search'       => $initial_search,
				'sort'         => $initial_sort,
				'expo_area'    => $initial_area,
				'category_id'  => $initial_cat,
				'type_id'      => $initial_type,
				'has_demo'     => $initial_has_demo,
				'per_page'     => $per_page,
				'page'         => 1,
				'exclude_ids'  => $sponsor_ids,
			)
		);

		$total    = (int) $query->found_posts;
		$has_more = $total > $per_page;

		// --- Taxonomy options for filter dropdowns.
		$expo_areas = $this->get_unique_expo_areas();
		$categories = get_terms( array( 'taxonomy' => 'exhibitor-category', 'hide_empty' => true ) );
		$types      = get_terms( array( 'taxonomy' => 'exhibitor_type',     'hide_empty' => true ) );
		$categories = ! is_wp_error( $categories ) ? $categories : array();
		$types      = ! is_wp_error( $types )      ? $types      : array();

		ob_start();
		?>
		<div
			class="sratix-exgrid-root"
			data-columns="<?php echo esc_attr( $columns ); ?>"
			data-per-page="<?php echo esc_attr( $per_page ); ?>"
			data-default-sort="<?php echo esc_attr( $default_sort ); ?>"
			data-event="<?php echo esc_attr( $event ); ?>"
			data-edition="<?php echo esc_attr( $event_id ); ?>"
		>
			<?php if ( $show_filters ) : ?>
				<?php $this->load_template( 'exhibitor-filters', compact( 'expo_areas', 'categories', 'types', 'initial_search', 'initial_sort', 'initial_area', 'initial_cat', 'initial_type', 'initial_has_demo' ) ); ?>
			<?php endif; ?>

			<div class="sratix-exgrid-loading" aria-hidden="true" aria-live="polite">
				<span class="sratix-exgrid-spinner"></span>
				<span class="sratix-exgrid-loading__text"><?php esc_html_e( 'Loading…', 'sratix-client' ); ?></span>
			</div>

			<?php if ( $featured_top && ! empty( $sponsor_posts ) ) : ?>
				<section class="sratix-exgrid-sponsors" aria-label="<?php esc_attr_e( 'Sponsors', 'sratix-client' ); ?>">
					<h2 class="sratix-exgrid-section-title"><?php esc_html_e( 'Sponsors', 'sratix-client' ); ?></h2>
					<div class="sratix-exgrid-cards sratix-exgrid-cards--sponsors">
						<?php foreach ( $sponsor_posts as $post ) : setup_postdata( $post ); ?>
							<?php $this->load_template( 'exhibitor-sponsor-card', array( 'post' => $post ) ); ?>
						<?php endforeach; wp_reset_postdata(); ?>
					</div>
				</section>
			<?php endif; ?>

			<div
				class="sratix-exgrid-cards-wrap"
				role="region"
				aria-label="<?php esc_attr_e( 'Exhibitors', 'sratix-client' ); ?>"
				aria-live="polite"
				aria-atomic="false"
			>
				<div class="sratix-exgrid-cards">
					<?php if ( $query->have_posts() ) : ?>
						<?php while ( $query->have_posts() ) : $query->the_post(); ?>
							<?php $this->load_template( 'exhibitor-card', array( 'post' => $GLOBALS['post'] ) ); ?>
						<?php endwhile; wp_reset_postdata(); ?>
					<?php else : ?>
						<p class="sratix-exgrid-empty"><?php esc_html_e( 'No exhibitors found.', 'sratix-client' ); ?></p>
					<?php endif; ?>
				</div>

				<?php if ( $has_more ) : ?>
					<div class="sratix-exgrid-pagination">
						<button
							type="button"
							class="sratix-exgrid-load-more"
							data-page="2"
							data-total="<?php echo esc_attr( $total ); ?>"
						>
							<?php esc_html_e( 'Load more', 'sratix-client' ); ?>
						</button>
						<p class="sratix-exgrid-count">
							<?php
							printf(
								/* translators: 1: visible count, 2: total count */
								esc_html__( 'Showing %1$d of %2$d exhibitors', 'sratix-client' ),
								min( $per_page, $total ),
								$total
							);
							?>
						</p>
					</div>
				<?php endif; ?>
			</div>

			<?php /* Modal container — populated via AJAX on card click */ ?>
			<dialog
				class="sratix-exgrid-modal"
				aria-modal="true"
				aria-labelledby="sratix-exgrid-modal-title"
			>
				<div class="sratix-exgrid-modal__inner">
					<button type="button" class="sratix-exgrid-modal__close" aria-label="<?php esc_attr_e( 'Close', 'sratix-client' ); ?>">
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
					<div class="sratix-exgrid-modal__body"></div>
				</div>
			</dialog>

			<?php /* Lightbox container — activated when gallery thumbnail clicked */ ?>
			<div class="sratix-exgrid-lightbox" role="dialog" aria-modal="true" aria-label="<?php esc_attr_e( 'Image viewer', 'sratix-client' ); ?>" hidden>
				<button type="button" class="sratix-exgrid-lightbox__close" aria-label="<?php esc_attr_e( 'Close', 'sratix-client' ); ?>">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
				<button type="button" class="sratix-exgrid-lightbox__prev" aria-label="<?php esc_attr_e( 'Previous image', 'sratix-client' ); ?>">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
				</button>
				<div class="sratix-exgrid-lightbox__stage">
					<img src="" alt="" class="sratix-exgrid-lightbox__img" loading="lazy" decoding="async">
				</div>
				<button type="button" class="sratix-exgrid-lightbox__next" aria-label="<?php esc_attr_e( 'Next image', 'sratix-client' ); ?>">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
				</button>
				<div class="sratix-exgrid-lightbox__caption"></div>
				<div class="sratix-exgrid-lightbox__counter"></div>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/*──────────────────────────────────────────────────────────────
	 * AJAX: Filter / Search / Paginate
	 *────────────────────────────────────────────────────────────*/

	public function ajax_filter(): void {
		if ( ! check_ajax_referer( self::NONCE_ACTION, 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => __( 'Invalid nonce.', 'sratix-client' ) ), 403 );
		}

		$search       = isset( $_POST['exhibitor_search'] )    ? sanitize_text_field( wp_unslash( $_POST['exhibitor_search'] ) )    : '';
		$sort         = isset( $_POST['exhibitor_sort'] )      ? sanitize_text_field( wp_unslash( $_POST['exhibitor_sort'] ) )      : 'booth';
		$sort         = in_array( $sort, array( 'booth', 'name' ), true ) ? $sort : 'booth';
		$expo_area    = isset( $_POST['exhibitor_expo_area'] ) ? sanitize_text_field( wp_unslash( $_POST['exhibitor_expo_area'] ) ) : '';
		$category_id  = isset( $_POST['exhibitor_category'] )  ? (int) $_POST['exhibitor_category']  : 0;
		$type_id      = isset( $_POST['exhibitor_type'] )       ? (int) $_POST['exhibitor_type']       : 0;
		$has_demo     = isset( $_POST['exhibitor_has_demo'] )  && '1' === $_POST['exhibitor_has_demo'];
		$page         = max( 1, (int) ( $_POST['exhibitor_page'] ?? 1 ) );
		$per_page     = max( 1, min( 96, (int) ( $_POST['per_page'] ?? 24 ) ) );

		$event_id = sanitize_text_field( get_option( 'sratix_client_event_id', '' ) );

		$query = $this->build_query(
			array(
				'event_id'     => $event_id,
				'search'       => $search,
				'sort'         => $sort,
				'expo_area'    => $expo_area,
				'category_id'  => $category_id,
				'type_id'      => $type_id,
				'has_demo'     => $has_demo,
				'per_page'     => $per_page,
				'page'         => $page,
				'exclude_ids'  => array(), // sponsors excluded only on initial page-render
			)
		);

		$total    = (int) $query->found_posts;
		$has_more = ( $page * $per_page ) < $total;

		ob_start();
		if ( $query->have_posts() ) {
			while ( $query->have_posts() ) {
				$query->the_post();
				$this->load_template( 'exhibitor-card', array( 'post' => $GLOBALS['post'] ) );
			}
			wp_reset_postdata();
		} else {
			echo '<p class="sratix-exgrid-empty">' . esc_html__( 'No exhibitors found.', 'sratix-client' ) . '</p>';
		}
		$html = ob_get_clean();

		wp_send_json_success(
			array(
				'html'     => $html,
				'total'    => $total,
				'page'     => $page,
				'per_page' => $per_page,
				'has_more' => $has_more,
			)
		);
	}

	/*──────────────────────────────────────────────────────────────
	 * AJAX: Modal Detail
	 *────────────────────────────────────────────────────────────*/

	public function ajax_detail(): void {
		if ( ! check_ajax_referer( self::NONCE_ACTION, 'nonce', false ) ) {
			wp_send_json_error( array( 'message' => __( 'Invalid nonce.', 'sratix-client' ) ), 403 );
		}

		$post_id = (int) ( $_POST['post_id'] ?? 0 );

		if (
			$post_id <= 0
			|| get_post_type( $post_id ) !== 'exhibitor'
			|| get_post_status( $post_id ) !== 'publish'
		) {
			wp_send_json_error( array( 'message' => __( 'Not found.', 'sratix-client' ) ), 404 );
		}

		$post = get_post( $post_id );

		ob_start();
		$this->load_template( 'exhibitor-modal', array( 'post' => $post ) );
		$html = ob_get_clean();

		wp_send_json_success( array( 'html' => $html ) );
	}

	/*──────────────────────────────────────────────────────────────
	 * Query builder
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Build and execute a WP_Query for the exhibitor grid.
	 *
	 * @param array<string, mixed> $params {
	 *   edition_slug, search, sort, expo_area, category_id, type_id,
	 *   has_demo, per_page, page, exclude_ids
	 * }
	 * @return WP_Query
	 */
	public function build_query( array $params ): WP_Query {
		$args = array(
			'post_type'      => 'exhibitor',
			'post_status'    => 'publish',
			'posts_per_page' => $params['per_page'],
			'paged'          => $params['page'],
			'no_found_rows'  => false,
		);

		// --- Exclude IDs (used to hide sponsors from main grid on first render).
		if ( ! empty( $params['exclude_ids'] ) ) {
			$args['post__not_in'] = array_map( 'intval', $params['exclude_ids'] );
		}

		// --- Sorting.
		if ( 'name' === $params['sort'] ) {
			$args['orderby'] = 'title';
			$args['order']   = 'ASC';
		}
		// 'booth' sort is applied via posts_clauses filter below.

		// --- Meta query (collect ALL entries before assigning to args).
		$meta_query = array();

		// Event isolation — must match the current event ID stored by webhook.
		if ( ! empty( $params['event_id'] ) ) {
			$meta_query[] = array(
				'key'     => '_sratix_event_id',
				'value'   => $params['event_id'],
				'compare' => '=',
			);
		}

		if ( ! empty( $params['expo_area'] ) ) {
			$meta_query[] = array(
				'key'     => 'expo_area',
				'value'   => $params['expo_area'],
				'compare' => '=',
			);
		}

		if ( ! empty( $params['has_demo'] ) ) {
			$meta_query[] = array(
				'key'     => 'demo_description',
				'value'   => '',
				'compare' => '!=',
			);
		}

		if ( count( $meta_query ) > 1 ) {
			$meta_query['relation'] = 'AND';
		}
		if ( ! empty( $meta_query ) ) {
			$args['meta_query'] = $meta_query;
		}

		// --- Taxonomy query.
		$tax_query = array();

		if ( $params['category_id'] > 0 ) {
			$tax_query[] = array(
				'taxonomy' => 'exhibitor-category',
				'field'    => 'term_id',
				'terms'    => $params['category_id'],
			);
		}

		if ( $params['type_id'] > 0 ) {
			$tax_query[] = array(
				'taxonomy' => 'exhibitor_type', // note: underscore, not hyphen
				'field'    => 'term_id',
				'terms'    => $params['type_id'],
			);
		}

		if ( count( $tax_query ) > 1 ) {
			$tax_query['relation'] = 'AND';
		}
		if ( ! empty( $tax_query ) ) {
			$args['tax_query'] = $tax_query;
		}

		// --- Search (extends to ACF meta fields via one-shot filter).
		if ( ! empty( $params['search'] ) ) {
			$args['s'] = $params['search'];
			$search_filter = $this->make_search_filter( $params['search'] );
			add_filter( 'posts_search', $search_filter, 10, 2 );
		}

		// --- Booth sort (one-shot posts_clauses filter).
		if ( 'booth' === ( $params['sort'] ?? 'booth' ) ) {
			$booth_filter = null;
			$booth_filter = function( $clauses ) use ( &$booth_filter ) {
				global $wpdb;
				// Join the booth_number meta row.
				$clauses['join'] .= " LEFT JOIN {$wpdb->postmeta} sxg_booth"
					. " ON ({$wpdb->posts}.ID = sxg_booth.post_id"
					. " AND sxg_booth.meta_key = 'booth_number') ";
				// Numeric values first, then alphanumeric; purely numeric sort by cast value.
				$clauses['orderby'] = "
					CASE WHEN sxg_booth.meta_value REGEXP '^[0-9]+$' THEN 0 ELSE 1 END ASC,
					CAST(sxg_booth.meta_value AS UNSIGNED) ASC,
					sxg_booth.meta_value ASC
				";
				remove_filter( 'posts_clauses', $booth_filter, 10 );
				return $clauses;
			};
			add_filter( 'posts_clauses', $booth_filter, 10, 1 );
		}

		return new WP_Query( $args );
	}

	/*──────────────────────────────────────────────────────────────
	 * Sponsor query
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Fetch sponsor-tier exhibitors (always page 1, up to 12).
	 *
	 * @param string $edition_slug
	 * @param string $search
	 * @param string $expo_area
	 * @param int    $category_id
	 * @return WP_Post[]
	 */
	public function query_sponsors( string $event_id, string $search = '', string $expo_area = '', int $category_id = 0 ): array {
		$query = $this->build_query(
			array(
				'event_id'    => $event_id,
				'search'       => $search,
				'sort'         => 'name',
				'expo_area'    => $expo_area,
				'category_id'  => $category_id,
				'type_id'      => 0,
				'has_demo'     => false,
				'per_page'     => 12,
				'page'         => 1,
				'exclude_ids'  => array(),
				// Override: force sponsor type.
				'_force_sponsor' => true,
			)
		);

		return $query->posts ?: array();
	}

	/*──────────────────────────────────────────────────────────────
	 * One-shot search filter factory
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Return a self-removing posts_search filter that extends WP search to ACF fields.
	 *
	 * @param string $search_term Raw (pre-sanitized) search string.
	 * @return callable
	 */
	private function make_search_filter( string $search_term ): callable {
		$filter = null;
		$filter = function( $search, $wp_query ) use ( $search_term, &$filter ) {
			global $wpdb;

			if ( empty( $search ) || empty( $wp_query->query_vars['search_terms'] ) ) {
				remove_filter( 'posts_search', $filter, 10 );
				return $search;
			}

			$terms = $wp_query->query_vars['search_terms'];
			$additions = '';

			foreach ( $terms as $term ) {
				$escaped   = $wpdb->esc_like( $term );
				// Search across key ACF / synced meta fields.
				$additions .= $wpdb->prepare(
					" OR ( {$wpdb->postmeta}.meta_key IN ('name','booth_number','expo_area','description','demo_description')"
					. " AND {$wpdb->postmeta}.meta_value LIKE %s )",
					'%' . $escaped . '%'
				);
			}

			if ( ! empty( $additions ) ) {
				// Append to the existing search clause (before the closing paren).
				$search = preg_replace( '/\)$/', $additions . ')', $search );
			}

			remove_filter( 'posts_search', $filter, 10 );
			return $search;
		};

		return $filter;
	}

	/*──────────────────────────────────────────────────────────────
	 * Edition slug resolution
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Resolve 'current' to the most-recent edition taxonomy slug.
	 * Returns an empty string if no edition terms exist (no filter applied).
	 *
	 * @param string $value Shortcode event attribute value.
	 * @return string Edition slug or ''.
	 */
	public function resolve_edition_slug( string $value ): string {
		if ( 'current' !== $value ) {
			return $value; // Treat as literal slug (e.g. "2026").
		}

		$terms = get_terms(
			array(
				'taxonomy'   => 'edition',
				'orderby'    => 'name',
				'order'      => 'DESC',
				'number'     => 1,
				'hide_empty' => false,
			)
		);

		if ( is_wp_error( $terms ) || empty( $terms ) ) {
			return ''; // Graceful fallback: show all editions.
		}

		return (string) $terms[0]->slug;
	}

	/*──────────────────────────────────────────────────────────────
	 * Expo-areas transient
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Return all unique expo_area values from the exhibitor CPT.
	 * Cached in a transient shared with the srd_exhibitor_filters mu-plugin.
	 *
	 * @return string[]
	 */
	public function get_unique_expo_areas(): array {
		$cached = get_transient( self::EXPO_AREAS_TRANSIENT );
		if ( false !== $cached ) {
			return (array) $cached;
		}

		global $wpdb;
		$results = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT meta_value FROM {$wpdb->postmeta}
				 WHERE meta_key = %s AND meta_value != ''
				 ORDER BY meta_value ASC",
				'expo_area'
			)
		);

		$areas = array_values( array_filter( $results ) );
		set_transient( self::EXPO_AREAS_TRANSIENT, $areas, HOUR_IN_SECONDS );
		return $areas;
	}

	/**
	 * Clear expo-areas transient when an exhibitor post is updated.
	 *
	 * @param int      $post_id
	 * @param \WP_Post $post
	 */
	public function maybe_clear_expo_areas_cache( int $post_id, $post ): void {
		if ( isset( $post->post_type ) && 'exhibitor' === $post->post_type ) {
			delete_transient( self::EXPO_AREAS_TRANSIENT );
		}
	}

	/*──────────────────────────────────────────────────────────────
	 * Template loader (theme-overridable)
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Load a template file, allowing themes to override via
	 * {theme}/sratix-client/{template-name}.php.
	 *
	 * @param string               $name Template name without extension.
	 * @param array<string, mixed> $data Variables to extract into template scope.
	 */
	public function load_template( string $name, array $data = [] ): void {
		// Theme override path.
		$theme_file  = locate_template( "sratix-client/{$name}.php" );
		$plugin_file = SRATIX_CLIENT_DIR . "templates/{$name}.php";

		$template = $theme_file ?: $plugin_file;

		if ( ! file_exists( $template ) ) {
			return;
		}

		// phpcs:ignore WordPress.PHP.DontExtract.extract_extract
		extract( $data, EXTR_SKIP );
		include $template;
	}

	/*──────────────────────────────────────────────────────────────
	 * Static data helpers (used by templates)
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Safely decode a JSON meta value that may already be an array.
	 *
	 * @param int    $post_id
	 * @param string $meta_key
	 * @return array<int, mixed>
	 */
	public static function get_json_meta( int $post_id, string $meta_key ): array {
		$raw = get_post_meta( $post_id, $meta_key, true );

		if ( is_array( $raw ) ) {
			return $raw;
		}
		if ( is_string( $raw ) && '' !== $raw ) {
			$decoded = json_decode( $raw, true );
			return is_array( $decoded ) ? $decoded : array();
		}
		return array();
	}

	/**
	 * Get deterministic hue (0–359) from a company name for the placeholder logo.
	 *
	 * @param string $name Company name.
	 * @return int
	 */
	public static function get_logo_placeholder_hue( string $name ): int {
		return abs( crc32( $name ) ) % 360;
	}

	/**
	 * Get 2-letter initials from a company name.
	 *
	 * @param string $name Company name.
	 * @return string 1–2 uppercase characters.
	 */
	public static function get_initials( string $name ): string {
		$name  = trim( $name );
		$words = preg_split( '/\s+/', $name );
		if ( count( $words ) >= 2 ) {
			return mb_strtoupper( mb_substr( $words[0], 0, 1 ) . mb_substr( $words[1], 0, 1 ) );
		}
		return mb_strtoupper( mb_substr( $name, 0, 2 ) );
	}

	/**
	 * Build social-links icon map.
	 * Returns array of [ 'type' => string, 'url' => string, 'label' => string ].
	 *
	 * @param int $post_id
	 * @return array<int, array<string, string>>
	 */
	public static function get_social_links( int $post_id ): array {
		$links = self::get_json_meta( $post_id, 'social_links' );
		if ( empty( $links ) ) {
			// Fallback: read website from meta directly.
			$website = get_post_meta( $post_id, 'website', true );
			if ( $website ) {
				$links[] = array( 'type' => 'website', 'url' => $website );
			}
		}
		$allowed_types = array( 'website', 'linkedin', 'twitter', 'youtube', 'instagram', 'facebook' );
		$output = array();
		foreach ( $links as $link ) {
			if ( empty( $link['url'] ) ) {
				continue;
			}
			$type    = in_array( $link['type'] ?? 'website', $allowed_types, true ) ? $link['type'] : 'website';
			$output[] = array(
				'type'  => $type,
				'url'   => esc_url_raw( $link['url'] ),
				'label' => self::social_type_label( $type ),
			);
		}
		return $output;
	}

	/**
	 * Human-readable label for a social link type.
	 *
	 * @param string $type
	 * @return string
	 */
	private static function social_type_label( string $type ): string {
		$labels = array(
			'website'   => __( 'Website', 'sratix-client' ),
			'linkedin'  => 'LinkedIn',
			'twitter'   => 'X / Twitter',
			'youtube'   => 'YouTube',
			'instagram' => 'Instagram',
			'facebook'  => 'Facebook',
		);
		return $labels[ $type ] ?? ucfirst( $type );
	}
}
