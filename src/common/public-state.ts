import type {
  FooterResponse,
  NavResponse,
  PageSettingsResponse,
  SectionListResponse,
  ThemeResponse,
} from '@ecom/contracts';

/**
 * cms-012: additive public response metadata.
 *
 * `@ecom/contracts` is a pinned tarball owned by another repo, so the extended
 * wire shapes are declared here rather than changing the dependency. Every
 * pre-existing field keeps its name and type; a 1.x reader that ignores unknown
 * keys sees exactly the old body.
 */
export type ConfiguredResponse<T> = T & { configured: boolean };
export type PublicThemeResponse = ConfiguredResponse<ThemeResponse>;
export type PublicPageSettingsResponse = ConfiguredResponse<PageSettingsResponse>;
export type PublicNavResponse = ConfiguredResponse<NavResponse>;
export type PublicFooterResponse = ConfiguredResponse<FooterResponse>;

export type SectionState = 'missing' | 'empty' | 'published';
export type PublicSectionsResponse = SectionListResponse & {
  state: SectionState;
};

/**
 * `missing` and `empty` are deliberately different: the first is a page nobody
 * ever authored, the second is a page whose sections were authored and then
 * switched off (or cleared). A storefront can render a setup hint for one and
 * a "nothing published yet" message for the other.
 */
export function resolveSectionState(
  total: number,
  active: number,
): SectionState {
  if (total === 0) {
    return 'missing';
  }
  return active > 0 ? 'published' : 'empty';
}
