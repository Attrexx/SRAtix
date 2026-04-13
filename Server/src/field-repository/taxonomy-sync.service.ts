import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WordPress taxonomy → SRAtix field options sync.
 *
 * Fetches `robotics_field` taxonomy terms (with parent-child hierarchy) from the
 * SRA WordPress REST API and writes them as options on the `industry_sector`
 * field definition.  Runs once on startup and daily at 04:00.
 */

interface WpTerm {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

interface HierarchicalOption {
  value: string;
  label: Record<string, string>;
  children?: HierarchicalOption[];
}

@Injectable()
export class TaxonomySyncService implements OnModuleInit {
  private readonly logger = new Logger(TaxonomySyncService.name);
  private readonly wpUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.wpUrl = (
      this.config.get<string>('SRA_WP_URL') || 'https://swiss-robotics.org'
    ).replace(/\/+$/, '');
  }

  /* ── Lifecycle ── */

  async onModuleInit() {
    // Non-blocking initial sync — failure is logged, cron retries later
    this.syncRoboticsFieldTaxonomy().catch((err) =>
      this.logger.warn(
        'Initial robotics_field taxonomy sync failed — will retry on cron',
        err.message,
      ),
    );
  }

  /* ── Cron ── */

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron() {
    this.logger.log('Running daily robotics_field taxonomy sync');
    await this.syncRoboticsFieldTaxonomy();
  }

  /* ── Core sync logic ── */

  async syncRoboticsFieldTaxonomy(): Promise<void> {
    const terms = await this.fetchAllTerms();

    if (!terms.length) {
      this.logger.warn(
        'No robotics_field terms returned from WordPress — skipping sync',
      );
      return;
    }

    const options = this.buildHierarchicalOptions(terms);

    const updated = await this.prisma.fieldDefinition.updateMany({
      where: { slug: 'industry_sector' },
      data: { options: options as any },
    });

    if (updated.count === 0) {
      this.logger.warn(
        'industry_sector field not found in DB — sync had no effect',
      );
      return;
    }

    this.logger.log(
      `Synced ${terms.length} robotics_field terms → industry_sector options (${options.length} top-level)`,
    );
  }

  /* ── WP REST helpers ── */

  /**
   * Paginate through the WP REST API to retrieve ALL terms
   * (default per_page cap is 100).
   */
  private async fetchAllTerms(): Promise<WpTerm[]> {
    const allTerms: WpTerm[] = [];
    let page = 1;
    const perPage = 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const url =
        `${this.wpUrl}/wp-json/wp/v2/robotics_field` +
        `?per_page=${perPage}&page=${page}&orderby=name&order=asc`;

      const res = await fetch(url);

      if (res.status === 400) {
        // WP returns 400 when page > total pages
        break;
      }
      if (!res.ok) {
        throw new Error(`WP REST API ${res.status}: ${res.statusText}`);
      }

      const batch: WpTerm[] = await res.json();
      if (!batch.length) break;

      allTerms.push(...batch);

      const totalPages = parseInt(
        res.headers.get('x-wp-totalpages') || '1',
        10,
      );
      if (page >= totalPages) break;
      page++;
    }

    return allTerms;
  }

  /**
   * Convert a flat list of WP taxonomy terms (with `parent` IDs) into a
   * hierarchical options array that the client widget can render as a
   * grouped checkbox dropdown.
   */
  private buildHierarchicalOptions(terms: WpTerm[]): HierarchicalOption[] {
    const parents = terms
      .filter((t) => t.parent === 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const childMap = new Map<number, WpTerm[]>();
    for (const t of terms.filter((t) => t.parent !== 0)) {
      const arr = childMap.get(t.parent) || [];
      arr.push(t);
      childMap.set(t.parent, arr);
    }

    return parents.map((p) => {
      const children = (childMap.get(p.id) || []).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      const opt: HierarchicalOption = {
        value: p.slug,
        label: this.termLabel(p.name),
      };

      if (children.length) {
        opt.children = children.map((c) => ({
          value: c.slug,
          label: this.termLabel(c.name),
        }));
      }

      return opt;
    });
  }

  /**
   * Create a multilingual label object from a single-language term name.
   * WordPress taxonomy terms are stored in the site language; we mirror the
   * name across all five SRAtix UI languages as a sensible fallback.
   * If translation is needed later, a WP translation plugin (WPML/Polylang)
   * can provide translated term names via REST API and we adapt the fetch.
   */
  private termLabel(name: string): Record<string, string> {
    return { en: name, de: name, fr: name, it: name, 'zh-TW': name };
  }
}
