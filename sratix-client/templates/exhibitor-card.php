<?php
/**
 * Template: Single exhibitor card.
 *
 * Available variables (via extract in SRAtix_Client_Exhibitors_Grid::load_template):
 * @var WP_Post $post The exhibitor post.
 *
 * Theme override: place at {theme}/sratix-client/exhibitor-card.php
 *
 * @package SRAtix_Client
 */

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Icon helper — defined here so it is available both in this template and in
// exhibitor-sponsor-card.php if that loads first (which skips re-definition).
if ( ! function_exists( 'sratix_exgrid_social_icon' ) ) :
	function sratix_exgrid_social_icon( string $type ): string {
		$icons = array(
			'website'   => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
			'linkedin'  => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
			'twitter'   => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
			'youtube'   => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg>',
			'instagram' => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
			'facebook'  => '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
		);
		return $icons[ $type ] ?? $icons['website'];
	}
endif;

$post_id      = (int) $post->ID;
$company_name = trim( get_post_meta( $post_id, 'name', true ) ?: $post->post_title );
$booth_number = get_post_meta( $post_id, 'booth_number', true );
$expo_area    = get_post_meta( $post_id, 'expo_area', true );
$description  = wp_strip_all_tags( get_post_meta( $post_id, 'description', true ) ?: $post->post_content );
$description  = mb_strlen( $description ) > 155 ? mb_substr( $description, 0, 152 ) . '…' : $description;
$logo_url     = get_post_meta( $post_id, 'logo_url', true );
$demo_desc    = get_post_meta( $post_id, 'demo_description', true );
$sratix_id    = get_post_meta( $post_id, '_sratix_event_exhibitor_id', true );

// Logo fallback to featured image.
if ( empty( $logo_url ) ) {
	$logo_url = get_the_post_thumbnail_url( $post_id, 'medium' ) ?: '';
}
$has_logo    = ! empty( $logo_url );
$initials    = SRAtix_Client_Exhibitors_Grid::get_initials( $company_name );
$hue         = SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $company_name );

// Gallery + video thumbnails.
$gallery_items = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'media_gallery' );
$video_links   = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'video_links' );
$image_count   = count( $gallery_items );
$video_count   = count( $video_links );
$media_total   = $image_count + $video_count;

// Social links.
$social_links = SRAtix_Client_Exhibitors_Grid::get_social_links( $post_id );

// Taxonomy terms.
$categories = get_the_terms( $post_id, 'exhibitor-category' ) ?: array();
$types      = get_the_terms( $post_id, 'exhibitor_type' )     ?: array();
if ( is_wp_error( $categories ) ) { $categories = array(); }
if ( is_wp_error( $types ) )      { $types      = array(); }

$permalink = get_permalink( $post_id );
?>
<article
	class="sratix-exgrid-card"
	data-post-id="<?php echo esc_attr( $post_id ); ?>"
	data-event-exhibitor-id="<?php echo esc_attr( $sratix_id ); ?>"
	tabindex="0"
	role="button"
	aria-label="<?php echo esc_attr( sprintf( __( 'View details for %s', 'sratix-client' ), $company_name ) ); ?>"
>
	<?php if ( $booth_number ) : ?>
		<span class="sratix-exgrid-card__booth" aria-label="<?php esc_attr_e( 'Booth', 'sratix-client' ); ?>">
			<?php echo esc_html( $booth_number ); ?>
		</span>
	<?php endif; ?>

	<?php /* Logo / Placeholder */ ?>
	<div
		class="sratix-exgrid-card__logo"
		data-fallback="<?php echo $has_logo ? 'false' : 'true'; ?>"
		data-initials="<?php echo esc_attr( $initials ); ?>"
		<?php if ( ! $has_logo ) : ?>
			style="--sxg-hue:<?php echo esc_attr( $hue ); ?>"
		<?php endif; ?>
	>
		<?php if ( $has_logo ) : ?>
			<img
				src="<?php echo esc_url( $logo_url ); ?>"
				alt="<?php echo esc_attr( $company_name ); ?>"
				loading="lazy"
				decoding="async"
				width="200"
				height="200"
			>
		<?php else : ?>
			<img
				src="<?php echo esc_url( SRATIX_CLIENT_URL . 'public/img/exhibitor-placeholder.svg' ); ?>"
				alt=""
				aria-hidden="true"
				width="200"
				height="200"
			>
		<?php endif; ?>
	</div>

	<div class="sratix-exgrid-card__body">
		<h3 class="sratix-exgrid-card__name">
			<?php echo esc_html( $company_name ); ?>
		</h3>

		<?php if ( $description ) : ?>
			<p class="sratix-exgrid-card__desc"><?php echo esc_html( $description ); ?></p>
		<?php endif; ?>

		<?php /* Social / website links */ ?>
		<?php if ( ! empty( $social_links ) ) : ?>
			<div class="sratix-exgrid-card__links" aria-label="<?php esc_attr_e( 'Links', 'sratix-client' ); ?>">
				<?php foreach ( $social_links as $link ) : ?>
					<a
						href="<?php echo esc_url( $link['url'] ); ?>"
						class="sratix-exgrid-card__link sratix-exgrid-card__link--<?php echo esc_attr( $link['type'] ); ?>"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="<?php echo esc_attr( $link['label'] . ' — ' . $company_name ); ?>"
						title="<?php echo esc_attr( $link['label'] ); ?>"
						onclick="event.stopPropagation()"
					>
						<?php echo sratix_exgrid_social_icon( $link['type'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- SVG is hardcoded ?>
					</a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>

		<?php /* Media preview row */ ?>
		<?php if ( $media_total > 0 ) : ?>
			<div class="sratix-exgrid-card__media-preview" aria-label="<?php esc_attr_e( 'Media preview', 'sratix-client' ); ?>">
				<?php
				// Build ordered list: images first, then video thumbs (up to 4 slots).
				$slots     = array();
				$shown     = 0;
				$max_slots = 4;

				foreach ( $gallery_items as $img ) {
					if ( $shown >= $max_slots ) {
						break;
					}
					if ( ! empty( $img['thumbUrl'] ) ) {
						$slots[] = array( 'type' => 'image', 'thumb' => $img['thumbUrl'], 'caption' => $img['caption'] ?? '' );
						$shown++;
					}
				}
				foreach ( $video_links as $vid ) {
					if ( $shown >= $max_slots ) {
						break;
					}
					if ( ! empty( $vid['thumbUrl'] ) ) {
						$slots[] = array( 'type' => 'video', 'thumb' => $vid['thumbUrl'], 'caption' => $vid['embedId'] ?? '' );
						$shown++;
					}
				}

				$overflow = $media_total - $shown;
				foreach ( $slots as $idx => $slot ) :
					$is_last_with_overflow = ( $idx === count( $slots ) - 1 ) && $overflow > 0;
				?>
					<div class="sratix-exgrid-card__media-thumb <?php echo 'video' === $slot['type'] ? 'sratix-exgrid-card__media-thumb--video' : ''; ?>">
						<img
							src="<?php echo esc_url( $slot['thumb'] ); ?>"
							alt="<?php echo esc_attr( $slot['caption'] ); ?>"
							loading="lazy"
							decoding="async"
							width="72"
							height="72"
						>
						<?php if ( 'video' === $slot['type'] ) : ?>
							<span class="sratix-exgrid-card__play-icon" aria-hidden="true">▶</span>
						<?php endif; ?>
						<?php if ( $is_last_with_overflow ) : ?>
							<span class="sratix-exgrid-card__media-overflow" aria-label="<?php echo esc_attr( sprintf( __( '%d more', 'sratix-client' ), $overflow ) ); ?>">
								+<?php echo esc_html( $overflow ); ?>
							</span>
						<?php endif; ?>
					</div>
				<?php endforeach; ?>

				<?php /* Media count badges */ ?>
				<div class="sratix-exgrid-card__media-counts" aria-label="<?php esc_attr_e( 'Media count', 'sratix-client' ); ?>">
					<?php if ( $image_count > 0 ) : ?>
						<span class="sratix-exgrid-card__media-count sratix-exgrid-card__media-count--image" aria-label="<?php echo esc_attr( sprintf( _n( '%d image', '%d images', $image_count, 'sratix-client' ), $image_count ) ); ?>">
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
							<?php echo esc_html( $image_count ); ?>
						</span>
					<?php endif; ?>
					<?php if ( $video_count > 0 ) : ?>
						<span class="sratix-exgrid-card__media-count sratix-exgrid-card__media-count--video" aria-label="<?php echo esc_attr( sprintf( _n( '%d video', '%d videos', $video_count, 'sratix-client' ), $video_count ) ); ?>">
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
							<?php echo esc_html( $video_count ); ?>
						</span>
					<?php endif; ?>
				</div>
			</div>
		<?php endif; ?>

		<?php /* Taxonomy chips */ ?>
		<div class="sratix-exgrid-card__chips">
			<?php foreach ( $types as $term ) : ?>
				<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--type">
					<?php echo esc_html( $term->name ); ?>
				</span>
			<?php endforeach; ?>
			<?php foreach ( $categories as $term ) : ?>
				<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--cat">
					<?php echo esc_html( $term->name ); ?>
				</span>
			<?php endforeach; ?>
			<?php if ( ! empty( $demo_desc ) ) : ?>
				<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--demo">
					<?php esc_html_e( 'Demo', 'sratix-client' ); ?>
				</span>
			<?php endif; ?>
		</div>
	</div>
</article>
