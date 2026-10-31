import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { EventsService } from './events.service.js';

describe('EventsService', () => {
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
