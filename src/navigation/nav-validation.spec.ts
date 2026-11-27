import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  type NavValidationCode,
  isSafeNavHref,
  normalizeNavSettings,
} from './nav-validation.js';

interface ValidationError {
  code: NavValidationCode;
  message: string;
  details: { field: string; message: string }[];
}

function errorFrom(value: unknown): ValidationError {
  try {
    normalizeNavSettings(value);
  } catch (error) {
    const response = (error as BadRequestException).getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return response as ValidationError;
    }
  }
  throw new Error('expected a validation error');
}

const group = (overrides: Record<string, unknown> = {}) => ({
  title: 'Women',
  items: [{ label: 'Dresses', href: '/shop/women/dresses' }],
  ...overrides,
});

const bodyWithGroups = (groups: unknown[]) => ({
  shared: {
    links: {
      items: [
        {
          kind: 'custom',
          label: 'Shop',
          href: '/shop',
          groups,
        },
      ],
    },
  },
});

describe('navigation group normalization (cms-014)', () => {
  it('keeps two groups, columns, badges and a promo verbatim', () => {
    const body = bodyWithGroups([
      group({
        columns: 2,
        items: [
          {
            label: 'Dresses',
            href: '/shop/women/dresses',
            description: 'New season',
            badge: { text: 'New' },
          },
          { label: 'Tops', href: 'https://example.com/tops' },
        ],
      }),
      group({
        title: 'Men',
        promo: {
          title: 'Summer edit',
          href: '/promo/summer',
          description: 'Up to 50% off',
          imageUrl: 'media/summer.webp',
          badge: { text: 'Sale' },
        },
      }),
    ]);

    const result = normalizeNavSettings(body);
    expect(result).toEqual(body);
    // Absence stays absence — no null/default written for the optional columns.
    const groups = result.shared?.links?.items?.[0]?.groups;
    expect(groups).toHaveLength(2);
    expect(groups?.[1]?.columns).toBeUndefined();
    expect(groups?.[1]?.promo?.title).toBe('Summer edit');
  });

  it('accepts groups on a category link as well as a custom link', () => {
    const body = {
      shared: {
        links: {
          items: [
            {
              kind: 'category',
              label: 'Shop',
              href: '/category/shop',
              categoryId: 'cat_shop',
              groups: [group()],
            },
          ],
        },
      },
    };

    expect(normalizeNavSettings(body)).toEqual(body);
  });

  it('accepts legacy bodies with no groups', () => {
    const legacy = { shared: { bar: { height: 64 } } };
    expect(normalizeNavSettings(legacy)).toEqual(legacy);
    expect(normalizeNavSettings({})).toEqual({});

    const relativeCustomLink = {
      shared: {
        links: {
          items: [{ kind: 'custom', label: 'About', href: 'about' }],
        },
      },
    };
    expect(normalizeNavSettings(relativeCustomLink)).toEqual(relativeCustomLink);
  });

  it.each([
    ['empty items', group({ items: [] }), 'items'],
    [
      'thirteen items',
      group({
        items: Array.from({ length: 13 }, (_, index) => ({
          label: `Item ${index}`,
          href: `/shop/item-${index}`,
        })),
      }),
      'items',
    ],
    ['columns below range', group({ columns: 0 }), 'columns'],
    ['columns above range', group({ columns: 5 }), 'columns'],
  ])('rejects malformed group: %s', (_label, invalidGroup, field) => {
    const error = errorFrom(bodyWithGroups([invalidGroup]));
    expect(error.code).toBe('NAV_INVALID_GROUPS');
    expect(error.details[0]?.field).toContain('groups');
    expect(error.details[0]?.field).toContain(field);
  });

  it('rejects a seventh group and accepts exactly six', () => {
    const seven = errorFrom(bodyWithGroups(Array.from({ length: 7 }, () => group())));
    expect(seven.code).toBe('NAV_INVALID_GROUPS');
    expect(seven.details[0]?.field).toMatch(/groups$/);

    const six = bodyWithGroups(Array.from({ length: 6 }, () => group()));
    expect(normalizeNavSettings(six)).toEqual(six);
  });

  it('accepts the exact item and column upper bounds', () => {
    const body = bodyWithGroups([
      group({
        columns: 4,
        items: Array.from({ length: 12 }, (_, index) => ({
          label: `Item ${index}`,
          href: `/shop/item-${index}`,
        })),
      }),
    ]);

    expect(normalizeNavSettings(body)).toEqual(body);
  });

  it.each([
    ['/\\evil.example', false],
    ['//evil.example', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['mailto:admin@example.com', false],
    ['javascript&colon;alert(1)', false],
    ['/shop/women', true],
    ['https://example.com/shop', true],
    ['http://example.com/shop', true],
    ['about', true],
    ['about?ref=a:b', true],
  ])('href %s safe=%s', (href, safe) => {
    expect(isSafeNavHref(href)).toBe(safe);
  });

  it.each(['/\\evil.example', '//evil.example', 'javascript:alert(1)'])(
    'rejects an unsafe group item href (%s)',
    (href) => {
      const error = errorFrom(
        bodyWithGroups([
          group({ items: [{ label: 'Trap', href }] }),
        ]),
      );
      expect(error.code).toBe('NAV_INVALID_HREF');
      expect(error.details[0]?.field).toContain('.items.0.href');
    },
  );

  it('rejects an unsafe promo href', () => {
    const error = errorFrom(
      bodyWithGroups([
        group({ promo: { title: 'Trap', href: 'data:text/html,x' } }),
      ]),
    );
    expect(error.code).toBe('NAV_INVALID_HREF');
    expect(error.details[0]?.field).toContain('.promo.href');
  });

  it('rejects unsafe top-level custom hrefs the contract otherwise allows', () => {
    for (const href of ['javascript:alert(1)', 'mailto:admin@example.com']) {
      const error = errorFrom({
        shared: {
          links: {
            items: [{ kind: 'custom', label: 'Trap', href }],
          },
        },
      });
      expect(error.code).toBe('NAV_INVALID_HREF');
      expect(error.details[0]?.field).toBe('shared.links.items.0.href');
    }
  });

  it('rejects null for an optional field instead of storing an inherit sentinel', () => {
    const error = errorFrom(bodyWithGroups([group({ promo: null })]));
    expect(error.code).toBe('NAV_INVALID_GROUPS');
    expect(error.details[0]?.field).toContain('.promo');
  });
});
