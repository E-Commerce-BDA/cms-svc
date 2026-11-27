import { BadRequestException } from '@nestjs/common';
import { navSettingsSchema, type NavSettings } from '@ecom/contracts';

/**
 * cms-014: the contract owns the mega-menu shape and its limits; this helper
 * owns the two boundary checks a pinned dependency cannot change here.
 *
 * `@ecom/contracts` 2.2.0 already validates `groups`, item counts and column
 * counts, but `navHrefSchema` still accepts a backslash in an internal path and
 * `custom` links allow any non-empty string. Both are unsafe in a browser (a
 * `/\host` becomes protocol-relative; `javascript:` executes), so they are
 * refused here. Valid bodies are returned unchanged: no flattening, no
 * defaults written, no `null` for absent keys — absence still means inherit.
 */

export const NAV_GROUP_LIMITS = {
  groups: 6,
  items: 12,
  columns: 4,
} as const;

export type NavValidationCode =
  | 'NAV_INVALID_GROUPS'
  | 'NAV_INVALID_HREF'
  | 'VALIDATION_FAILED';

interface ValidationDetail {
  field: string;
  message: string;
}

function fail(
  code: NavValidationCode,
  message: string,
  details: ValidationDetail[],
): never {
  throw new BadRequestException({ code, message, details });
}

function codeForIssues(details: ValidationDetail[]): NavValidationCode {
  const fields = details.map((detail) => detail.field.split('.'));
  // An unsafe scheme inside a group is an href problem first; a group count,
  // item count, column count or unknown group key is a group problem.
  if (fields.some((parts) => parts.includes('href'))) return 'NAV_INVALID_HREF';
  if (fields.some((parts) => parts.includes('groups'))) {
    return 'NAV_INVALID_GROUPS';
  }
  return 'VALIDATION_FAILED';
}

function messageForCode(code: NavValidationCode): string {
  switch (code) {
    case 'NAV_INVALID_GROUPS':
      return 'Invalid navigation groups';
    case 'NAV_INVALID_HREF':
      return 'Invalid navigation href';
    default:
      return 'Validation failed';
  }
}

function hasControlCharacter(value: string): boolean {
  // Written as a code-unit scan rather than a control-character regex so the
  // security check stays legible to the linter and to reviewers.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Internal links are root-relative paths; external links must state an http(s)
 * scheme. A scheme-less relative string stays legal because pre-2.2 admin
 * bodies used it for custom links, but it may not smuggle a colon or an HTML
 * colon entity that a browser could turn into a scheme.
 */
export function isSafeNavHref(value: string): boolean {
  const href = value.trim();
  if (href.length === 0 || href.length > 2048) return false;
  if (href.includes('\\') || hasControlCharacter(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//');
  if (/&(?:colon|#(?:x0*3a|58));/i.test(href)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme) {
    return /^https?:\/\/[^\s/?#]+/i.test(href);
  }
  // A colon after a path/query delimiter is data, not a scheme declaration.
  const delimiter = href.search(/[/?#]/);
  const colon = href.indexOf(':');
  return colon === -1 || (delimiter !== -1 && colon > delimiter);
}

function assertHref(field: string, href: string): void {
  if (!isSafeNavHref(href)) {
    fail('NAV_INVALID_HREF', messageForCode('NAV_INVALID_HREF'), [
      {
        field,
        message:
          'href must be a safe internal path (starting with /) or an http(s) URL',
      },
    ]);
  }
}

/** Parses and checks a nav document for both the write and read boundaries. */
export function normalizeNavSettings(value: unknown): NavSettings {
  const parsed = navSettingsSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    const code = codeForIssues(details);
    fail(code, messageForCode(code), details);
  }

  const links = parsed.data.shared?.links?.items ?? [];
  links.forEach((link, linkIndex) => {
    const linkField = `shared.links.items.${linkIndex}`;
    assertHref(`${linkField}.href`, link.href);
    const groups = link.groups ?? [];
    if (groups.length > NAV_GROUP_LIMITS.groups) {
      fail('NAV_INVALID_GROUPS', messageForCode('NAV_INVALID_GROUPS'), [
        {
          field: `${linkField}.groups`,
          message: `at most ${NAV_GROUP_LIMITS.groups} groups per link`,
        },
      ]);
    }
    groups.forEach((group, groupIndex) => {
      const groupField = `${linkField}.groups.${groupIndex}`;
      if (
        group.items.length < 1 ||
        group.items.length > NAV_GROUP_LIMITS.items
      ) {
        fail('NAV_INVALID_GROUPS', messageForCode('NAV_INVALID_GROUPS'), [
          {
            field: `${groupField}.items`,
            message: `between 1 and ${NAV_GROUP_LIMITS.items} items per group`,
          },
        ]);
      }
      if (
        group.columns !== undefined &&
        (group.columns < 1 || group.columns > NAV_GROUP_LIMITS.columns)
      ) {
        fail('NAV_INVALID_GROUPS', messageForCode('NAV_INVALID_GROUPS'), [
          {
            field: `${groupField}.columns`,
            message: `columns must be between 1 and ${NAV_GROUP_LIMITS.columns}`,
          },
        ]);
      }
      group.items.forEach((item, itemIndex) => {
        assertHref(
          `${groupField}.items.${itemIndex}.href`,
          item.href,
        );
      });
      if (group.promo) {
        assertHref(`${groupField}.promo.href`, group.promo.href);
      }
    });
  });

  return parsed.data;
}
