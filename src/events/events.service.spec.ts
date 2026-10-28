import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { EventsService } from './events.service.js';

describe('EventsService', () => {
  it('publishes cms.updated event with correct envelope', async () => {
    const bus = new InMemoryEventBus();
    const service = new EventsService(bus);

    await service.publishCmsUpdated({
      scope: 'global',
      version: 5,
    });

    const events = bus.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('cms.events');
    expect(events[0].event.eventType).toBe('cms.updated');
    expect(events[0].event.producer).toBe('cms-svc');
    expect(events[0].event.payload).toEqual({
      scope: 'global',
      version: 5,
    });
  });

  it('publishes blog.updated event', async () => {
    const bus = new InMemoryEventBus();
    const service = new EventsService(bus);

    await service.publishBlogUpdated({
      blogId: 'blog_123',
      slug: 'winter-coat-guide',
      status: 'published',
    });

    const events = bus.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('blog.updated');
    expect(events[0].event.eventType).toBe('blog.updated');
  });

  it('publishes media.resize-image job payload', async () => {
    const bus = new InMemoryEventBus();
    const service = new EventsService(bus);

    await service.publishResizeImageJob({
      mediaId: 'med_01',
      sourceKey: 'media/2026/10/banner.webp',
      formats: ['webp', 'avif'],
      widths: [640, 1280],
    });

    const events = bus.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('media.tasks');
    expect(events[0].event.eventType).toBe('media.resize-image');
  });
});
