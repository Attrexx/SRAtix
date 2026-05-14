<?php
/**
 * Template: Exhibitor filter bar.
 *
 * Available variables (via extract):
 * @var string[] $expo_areas     Unique expo area strings.
 * @var WP_Term[] $categories    Exhibitor category terms.
 * @var WP_Term[] $types         Exhibitor type terms.
 * @var string    $initial_search
 * @var string    $initial_sort
 * @var string    $initial_area
 * @var int       $initial_cat
 * @var int       $initial_type
 * @var bool      $initial_has_demo
 *
 * Theme override: {theme}/sratix-client/exhibitor-filters.php
 *
 * @package SRAtix_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<form
	class="sratix-exgrid-filters"
	id="sratix-exgrid-filters"
	method="get"
	role="search"
	aria-label="<?php esc_attr_e( 'Filter exhibitors', 'sratix-client' ); ?>"
	novalidate
>
	<div class="sratix-exgrid-filters__inner">

		<?php /* Search */ ?>
		<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--search">
			<label for="sratix-exgrid-search" class="sratix-exgrid-filters__label">
				<?php esc_html_e( 'Search', 'sratix-client' ); ?>
			</label>
			<div class="sratix-exgrid-filters__input-wrap">
				<svg class="sratix-exgrid-filters__search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
				<input
					type="search"
					id="sratix-exgrid-search"
					name="exhibitor_search"
					class="sratix-exgrid-filters__search"
					placeholder="<?php esc_attr_e( 'Search exhibitors…', 'sratix-client' ); ?>"
					value="<?php echo esc_attr( $initial_search ); ?>"
					autocomplete="off"
				>
			</div>
		</div>

		<?php /* Sort */ ?>
		<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--sort">
			<label for="sratix-exgrid-sort" class="sratix-exgrid-filters__label">
				<?php esc_html_e( 'Sort by', 'sratix-client' ); ?>
			</label>
			<select
				id="sratix-exgrid-sort"
				name="exhibitor_sort"
				class="sratix-exgrid-filters__select"
			>
				<option value="booth" <?php selected( $initial_sort, 'booth' ); ?>>
					<?php esc_html_e( 'Booth Number', 'sratix-client' ); ?>
				</option>
				<option value="name" <?php selected( $initial_sort, 'name' ); ?>>
					<?php esc_html_e( 'Company Name', 'sratix-client' ); ?>
				</option>
			</select>
		</div>

		<?php /* Expo area */ ?>
		<?php if ( ! empty( $expo_areas ) ) : ?>
			<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--area">
				<label for="sratix-exgrid-area" class="sratix-exgrid-filters__label">
					<?php esc_html_e( 'Expo Area', 'sratix-client' ); ?>
				</label>
				<select
					id="sratix-exgrid-area"
					name="exhibitor_expo_area"
					class="sratix-exgrid-filters__select"
				>
					<option value=""><?php esc_html_e( 'All Areas', 'sratix-client' ); ?></option>
					<?php foreach ( $expo_areas as $area ) : ?>
						<option value="<?php echo esc_attr( $area ); ?>" <?php selected( $initial_area, $area ); ?>>
							<?php echo esc_html( $area ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
		<?php endif; ?>

		<?php /* Category */ ?>
		<?php if ( ! empty( $categories ) ) : ?>
			<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--category">
				<label for="sratix-exgrid-category" class="sratix-exgrid-filters__label">
					<?php esc_html_e( 'Category', 'sratix-client' ); ?>
				</label>
				<select
					id="sratix-exgrid-category"
					name="exhibitor_category"
					class="sratix-exgrid-filters__select"
				>
					<option value="0"><?php esc_html_e( 'All Categories', 'sratix-client' ); ?></option>
					<?php foreach ( $categories as $cat ) : ?>
						<option value="<?php echo esc_attr( $cat->term_id ); ?>" <?php selected( $initial_cat, $cat->term_id ); ?>>
							<?php echo esc_html( $cat->name ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
		<?php endif; ?>

		<?php /* Type */ ?>
		<?php if ( ! empty( $types ) ) : ?>
			<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--type">
				<label for="sratix-exgrid-type" class="sratix-exgrid-filters__label">
					<?php esc_html_e( 'Type', 'sratix-client' ); ?>
				</label>
				<select
					id="sratix-exgrid-type"
					name="exhibitor_type"
					class="sratix-exgrid-filters__select"
				>
					<option value="0"><?php esc_html_e( 'All Types', 'sratix-client' ); ?></option>
					<?php foreach ( $types as $type ) : ?>
						<option value="<?php echo esc_attr( $type->term_id ); ?>" <?php selected( $initial_type, $type->term_id ); ?>>
							<?php echo esc_html( $type->name ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</div>
		<?php endif; ?>

		<?php /* Has Demo toggle */ ?>
		<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--has-demo">
			<label class="sratix-exgrid-filters__toggle-label">
				<input
					type="checkbox"
					name="exhibitor_has_demo"
					value="1"
					class="sratix-exgrid-filters__toggle"
					<?php checked( $initial_has_demo, true ); ?>
				>
				<span class="sratix-exgrid-filters__toggle-text">
					<?php esc_html_e( 'Has Demo', 'sratix-client' ); ?>
				</span>
			</label>
		</div>

		<?php /* Reset */ ?>
		<div class="sratix-exgrid-filters__field sratix-exgrid-filters__field--reset">
			<button
				type="button"
				class="sratix-exgrid-filters__reset"
				aria-label="<?php esc_attr_e( 'Reset all filters', 'sratix-client' ); ?>"
			>
				<?php esc_html_e( 'Reset', 'sratix-client' ); ?>
			</button>
		</div>

	</div>

	<?php /* Hidden submit for no-JS GET fallback */ ?>
	<noscript>
		<button type="submit" class="sratix-exgrid-filters__submit">
			<?php esc_html_e( 'Apply filters', 'sratix-client' ); ?>
		</button>
	</noscript>
</form>
