import { IsIn, IsString, Matches } from 'class-validator';

/**
 * Funnel step names fired by the public embed as a visitor moves through the
 * registration flow. `left` is an (optional) explicit departure signal — the
 * server also expires sessions by TTL, so a dropped `left` is harmless.
 *
 * The current embed only fires `landing` + `begin_checkout` (+ heartbeats);
 * the rest are pre-declared so the full funnel can be instrumented later
 * without touching this contract.
 */
export const FUNNEL_STEPS = [
  'landing',
  'begin_checkout',
  'recipients',
  'attendee_form',
  'billing',
  'checkout_submitted',
  'left',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * Body of `POST /api/public/funnel/:eventId`.
 *
 * `sessionId` is an anonymous, ephemeral, client-generated id (no cookie, no
 * PII) used only to de-duplicate concurrent presence — never persisted.
 */
export class FunnelPingDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{6,64}$/, {
    message: 'sessionId must be 6–64 url-safe characters',
  })
  sessionId!: string;

  @IsIn(FUNNEL_STEPS as unknown as string[])
  step!: FunnelStep;
}
