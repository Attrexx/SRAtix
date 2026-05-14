<?php
/**
 * Template: Sponsor-tier exhibitor card (wide variant).
 *
 * Available variables:
 * @var WP_Post $post The exhibitor post.
 *
 * Theme override: {theme}/sratix-client/exhibitor-sponsor-card.php
 *
 * @package SRAtix_Client
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Reuse all computed values from exhibitor-card.php via the same logic.
$post_id      = (int) $post->ID;
$company_name = trim( get_post_meta( $post_id, 'name', true ) ?: $post->post_title );
$booth_number = get_post_meta( $post_id, 'booth_number', true );
$description  = wp_strip_all_tags( get_post_meta( $post_id, 'description', true ) ?: $post->post_content );
$description  = mb_strlen( $description ) > 250 ? mb_substr( $description, 0, 247 ) . '…' : $description;
$logo_url     = get_post_meta( $post_id, 'logo_url', true );
$demo_desc    = get_post_meta( $post_id, 'demo_description', true );
$sratix_id    = get_post_meta( $post_id, 'sratix_event_exhibitor_id', true );

if ( empty( $logo_url ) ) {
	$logo_url = get_the_post_thumbnail_url( $post_id, 'medium' ) ?: '';
}
$has_logo = ! empty( $logo_url );
$initials = SRAtix_Client_Exhibitors_Grid::get_initials( $company_name );
$hue      = SRAtix_Client_Exhibitors_Grid::get_logo_placeholder_hue( $company_name );

$social_links = SRAtix_Client_Exhibitors_Grid::get_social_links( $post_id );
$gallery      = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'media_gallery' );
$videos       = SRAtix_Client_Exhibitors_Grid::get_json_meta( $post_id, 'video_links' );
$categories   = get_the_terms( $post_id, 'exhibitor-category' ) ?: array();
if ( is_wp_error( $categories ) ) { $categories = array(); }
?>
<article
	class="sratix-exgrid-card sratix-exgrid-card--sponsor"
	data-post-id="<?php echo esc_attr( $post_id ); ?>"
	data-event-exhibitor-id="<?php echo esc_attr( $sratix_id ); ?>"
	tabindex="0"
	role="button"
	aria-label="<?php echo esc_attr( sprintf( __( 'View sponsor details for %s', 'sratix-client' ), $company_name ) ); ?>"
>
	<div class="sratix-exgrid-card__sponsor-inner">
		<?php /* Logo */ ?>
		<div
			class="sratix-exgrid-card__logo sratix-exgrid-card__logo--sponsor"
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
					width="320"
					height="160"
				>
			<?php else : ?>
				<img
					src="<?php echo esc_url( SRATIX_CLIENT_URL . 'public/img/exhibitor-placeholder.svg' ); ?>"
					alt=""
					aria-hidden="true"
					width="320"
					height="160"
				>
			<?php endif; ?>
		</div>

		<div class="sratix-exgrid-card__body sratix-exgrid-card__body--sponsor">
			<div class="sratix-exgrid-card__sponsor-header">
				<h3 class="sratix-exgrid-card__name"><?php echo esc_html( $company_name ); ?></h3>
				<?php if ( $booth_number ) : ?>
					<span class="sratix-exgrid-card__booth"><?php echo esc_html( $booth_number ); ?></span>
				<?php endif; ?>
			</div>

			<?php if ( $description ) : ?>
				<p class="sratix-exgrid-card__desc"><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>

			<div class="sratix-exgrid-card__footer">
				<?php if ( ! empty( $social_links ) ) : ?>
					<div class="sratix-exgrid-card__links">
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
								<?php echo sratix_exgrid_social_icon( $link['type'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
							</a>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<div class="sratix-exgrid-card__chips">
					<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--sponsor-badge">
						<?php esc_html_e( 'Sponsor', 'sratix-client' ); ?>
					</span>
					<?php if ( ! empty( $demo_desc ) ) : ?>
						<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--demo">
							<?php esc_html_e( 'Demo', 'sratix-client' ); ?>
						</span>
					<?php endif; ?>
					<?php foreach ( $categories as $term ) : ?>
						<span class="sratix-exgrid-card__chip sratix-exgrid-card__chip--cat">
							<?php echo esc_html( $term->name ); ?>
						</span>
					<?php endforeach; ?>
				</div>
			</div>
		</div>
	</div>
</article>
<?php
// Ensure icon helper is available (card.php may not have been loaded first in AJAX context).
if ( ! function_exists( 'sratix_exgrid_social_icon' ) ) {
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
}
