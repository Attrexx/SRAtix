<?php
/**
 * Template: Exhibitor detail modal body.
 *
 * Loaded by ajax_detail() → JSON-encoded and injected into the modal <dialog>.
 *
 * Available variables:
 * @var WP_Post $post The exhibitor post.
 *
 * Theme override: {theme}/sratix-client/exhibitor-modal.php
 *
 * @package SRAtix_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$post_id      = (int) $post->ID;
$company_name = trim( get_post_meta( $post_id, 'name', true ) ?: $post->post_title );
$booth_number = get_post_meta( $post_id, 'booth_number', true );
$expo_area    = get_post_meta( $post_id, 'expo_area', true );
$description  = get_post_meta( $post_id, 'description', true ) ?: $post->post_content;
$logo_url     = get_post_meta( $post_id, 'logo_url', true );
$demo_title   = get_post_meta( $post_id, 'demo_title', true );
$demo_desc    = get_post_meta( $post_id, 'demo_description', true );
$sratix_id    = get_post_meta( $post_id, 'sratix_event_exhibitor_id', true );

if ( empty( $logo_url ) ) {
	$logo_url = get_the_post_thumbnail_url( $post_id, 'large' ) ?: '';
}
$has_logo = ! empty( $logo_url );
$initials = SRAtix_Client_Exhibitors_Grid::get_initials( $company_name );
$hue      = SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $company_name );

$gallery      = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'media_gallery' );
$video_links  = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'video_links' );
$social_links = SRAtix_Client_Exhibitors_Grid::get_social_links( $post_id );
$categories   = get_the_terms( $post_id, 'exhibitor-category' ) ?: array();
$types        = get_the_terms( $post_id, 'exhibitor_type' )     ?: array();
if ( is_wp_error( $categories ) ) { $categories = array(); }
if ( is_wp_error( $types ) )      { $types      = array(); }

// Staff list — only name + role, no PII (email/phone are excluded).
$staff_raw  = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'staff' );
$staff_safe = array_map(
	static function ( $member ) {
		return array(
			'name' => isset( $member['name'] )  ? sanitize_text_field( $member['name'] )  : '',
			'role' => isset( $member['role'] )  ? sanitize_text_field( $member['role'] )  : '',
		);
	},
	$staff_raw
);
$staff_safe = array_filter( $staff_safe, static fn( $m ) => ! empty( $m['name'] ) );

$permalink = get_permalink( $post_id );
?>
<div class="sratix-exgrid-modal-body" data-post-id="<?php echo esc_attr( $post_id ); ?>" data-event-exhibitor-id="<?php echo esc_attr( $sratix_id ); ?>">

	<?php /* Header */ ?>
	<div class="sratix-exgrid-modal__header">
		<?php if ( $has_logo ) : ?>
			<div class="sratix-exgrid-modal__logo">
				<img
					src="<?php echo esc_url( $logo_url ); ?>"
					alt="<?php echo esc_attr( $company_name ); ?>"
					loading="lazy"
					decoding="async"
					width="160"
					height="100"
				>
			</div>
		<?php else : ?>
			<div
				class="sratix-exgrid-modal__logo sratix-exgrid-modal__logo--placeholder"
				data-initials="<?php echo esc_attr( $initials ); ?>"
				style="--sxg-hue:<?php echo esc_attr( $hue ); ?>"
				aria-hidden="true"
			></div>
		<?php endif; ?>

		<div class="sratix-exgrid-modal__meta">
			<h2 class="sratix-exgrid-modal__title" id="sratix-exgrid-modal-title">
				<?php echo esc_html( $company_name ); ?>
			</h2>

			<div class="sratix-exgrid-modal__badges">
				<?php if ( $booth_number ) : ?>
					<span class="sratix-exgrid-modal__badge sratix-exgrid-modal__badge--booth">
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
						<?php echo esc_html( sprintf( __( 'Booth %s', 'sratix-client' ), $booth_number ) ); ?>
					</span>
				<?php endif; ?>
				<?php if ( $expo_area ) : ?>
					<span class="sratix-exgrid-modal__badge sratix-exgrid-modal__badge--area">
						<?php echo esc_html( $expo_area ); ?>
					</span>
				<?php endif; ?>
				<?php foreach ( $types as $term ) : ?>
					<span class="sratix-exgrid-modal__badge sratix-exgrid-modal__badge--type">
						<?php echo esc_html( $term->name ); ?>
					</span>
				<?php endforeach; ?>
				<?php foreach ( $categories as $term ) : ?>
					<span class="sratix-exgrid-modal__badge sratix-exgrid-modal__badge--cat">
						<?php echo esc_html( $term->name ); ?>
					</span>
				<?php endforeach; ?>
			</div>

			<?php if ( ! empty( $social_links ) ) : ?>
				<div class="sratix-exgrid-modal__links">
					<?php foreach ( $social_links as $link ) : ?>
						<a
							href="<?php echo esc_url( $link['url'] ); ?>"
							class="sratix-exgrid-modal__link sratix-exgrid-modal__link--<?php echo esc_attr( $link['type'] ); ?>"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="<?php echo esc_attr( $link['label'] . ' — ' . $company_name ); ?>"
						>
							<?php
							if ( 'website' === $link['type'] ) {
								echo esc_html( preg_replace( '#^https?://(www\.)?#i', '', $link['url'] ) );
							} else {
								echo sratix_exgrid_modal_social_icon( $link['type'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
							}
							?>
						</a>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>
		</div>
	</div>

	<?php /* Description */ ?>
	<?php if ( $description ) : ?>
		<div class="sratix-exgrid-modal__description">
			<?php echo wp_kses_post( $description ); ?>
		</div>
	<?php endif; ?>

	<?php /* Demo section */ ?>
	<?php if ( ! empty( $demo_title ) || ! empty( $demo_desc ) ) : ?>
		<section class="sratix-exgrid-modal__demo" aria-label="<?php esc_attr_e( 'Live demonstration', 'sratix-client' ); ?>">
			<h3 class="sratix-exgrid-modal__section-title">
				<span aria-hidden="true">🤖 </span>
				<?php echo esc_html( $demo_title ?: __( 'Live Demo', 'sratix-client' ) ); ?>
			</h3>
			<?php if ( $demo_desc ) : ?>
				<div class="sratix-exgrid-modal__demo-desc">
					<?php echo wp_kses_post( $demo_desc ); ?>
				</div>
			<?php endif; ?>
		</section>
	<?php endif; ?>

	<?php /* Media gallery */ ?>
	<?php if ( ! empty( $gallery ) ) : ?>
		<section class="sratix-exgrid-modal__gallery" aria-label="<?php esc_attr_e( 'Photo gallery', 'sratix-client' ); ?>">
			<h3 class="sratix-exgrid-modal__section-title"><?php esc_html_e( 'Gallery', 'sratix-client' ); ?></h3>
			<div class="sratix-exgrid-modal__gallery-grid" role="list">
				<?php foreach ( $gallery as $idx => $img ) : if ( empty( $img['url'] ) ) continue; ?>
					<button
						type="button"
						class="sratix-exgrid-modal__gallery-item"
						data-gallery="modal-gallery-<?php echo esc_attr( $post_id ); ?>"
						data-index="<?php echo esc_attr( $idx ); ?>"
						data-src="<?php echo esc_url( $img['url'] ); ?>"
						aria-label="<?php echo esc_attr( sprintf( __( 'Open image %d of %d', 'sratix-client' ), $idx + 1, count( $gallery ) ) ); ?>"
						role="listitem"
					>
						<img
							src="<?php echo esc_url( $img['thumbUrl'] ?? $img['url'] ); ?>"
							alt="<?php echo esc_attr( $img['caption'] ?? $company_name ); ?>"
							loading="lazy"
							decoding="async"
							width="180"
							height="120"
						>
					</button>
				<?php endforeach; ?>
			</div>
		</section>
	<?php endif; ?>

	<?php /* Video embeds */ ?>
	<?php if ( ! empty( $video_links ) ) : ?>
		<section class="sratix-exgrid-modal__videos" aria-label="<?php esc_attr_e( 'Videos', 'sratix-client' ); ?>">
			<h3 class="sratix-exgrid-modal__section-title"><?php esc_html_e( 'Videos', 'sratix-client' ); ?></h3>
			<div class="sratix-exgrid-modal__video-list">
				<?php foreach ( $video_links as $vid ) :
					if ( empty( $vid['embedId'] ) || empty( $vid['platform'] ) ) continue;
					if ( 'youtube' === $vid['platform'] ) :
						$embed_url = 'https://www.youtube-nocookie.com/embed/' . urlencode( $vid['embedId'] ) . '?rel=0';
					elseif ( 'vimeo' === $vid['platform'] ) :
						$embed_url = 'https://player.vimeo.com/video/' . urlencode( $vid['embedId'] );
					else :
						continue;
					endif;
				?>
					<div class="sratix-exgrid-modal__video-wrap">
						<iframe
							src="<?php echo esc_url( $embed_url ); ?>"
							title="<?php echo esc_attr( $vid['caption'] ?? $company_name ); ?>"
							loading="lazy"
							allow="fullscreen"
							frameborder="0"
							allowfullscreen
						></iframe>
					</div>
				<?php endforeach; ?>
			</div>
		</section>
	<?php endif; ?>

	<?php /* Staff list (name + role only — no PII) */ ?>
	<?php if ( ! empty( $staff_safe ) ) : ?>
		<section class="sratix-exgrid-modal__staff" aria-label="<?php esc_attr_e( 'Team', 'sratix-client' ); ?>">
			<h3 class="sratix-exgrid-modal__section-title"><?php esc_html_e( 'Meet the Team', 'sratix-client' ); ?></h3>
			<ul class="sratix-exgrid-modal__staff-list">
				<?php foreach ( $staff_safe as $member ) : ?>
					<li class="sratix-exgrid-modal__staff-member">
						<span class="sratix-exgrid-modal__staff-name"><?php echo esc_html( $member['name'] ); ?></span>
						<?php if ( $member['role'] ) : ?>
							<span class="sratix-exgrid-modal__staff-role"><?php echo esc_html( $member['role'] ); ?></span>
						<?php endif; ?>
					</li>
				<?php endforeach; ?>
			</ul>
		</section>
	<?php endif; ?>

	<?php /* Footer: "View full page" link */ ?>
	<div class="sratix-exgrid-modal__footer">
		<a
			href="<?php echo esc_url( $permalink ); ?>"
			class="sratix-exgrid-modal__cta"
			target="_blank"
			rel="noopener noreferrer"
		>
			<?php echo esc_html( sprintf( __( 'View full page for %s', 'sratix-client' ), $company_name ) ); ?>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
		</a>
	</div>

</div>
<?php
/**
 * Social icon helper (modal context — inline text variant).
 *
 * @param string $type
 * @return string Safe SVG markup.
 */
function sratix_exgrid_modal_social_icon( string $type ): string {
	$icons = array(
		'linkedin'  => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
		'twitter'   => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
		'youtube'   => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg>',
		'instagram' => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
		'facebook'  => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
	);
	return $icons[ $type ] ?? '';
}
