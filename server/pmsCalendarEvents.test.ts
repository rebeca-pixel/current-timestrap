import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarEventMetadata, serializeCalendarEventDbValues } from './Pmscalendarevents';

test('serializes the extra modal fields into a db-safe payload', () => {
  const payload = serializeCalendarEventDbValues({
    title: 'Standup',
    description: 'Discuss blockers',
    location: 'Room 2',
    videoLink: 'https://meet.example.com/room',
    allDay: true,
    calendarType: 'deadline',
    repeat: 'weekly',
    reminders: [5, 10],
    visibility: 'private',
    busy: false,
  });

  assert.equal(payload.description, 'Discuss blockers');
  assert.equal(payload.location, 'Room 2');
  assert.equal(payload.video_link, 'https://meet.example.com/room');
  assert.equal(payload.all_day, true);
  assert.equal(payload.repeat, 'weekly');
  assert.deepEqual(payload.reminders, [5, 10]);
  assert.equal(payload.visibility, 'private');
  assert.equal(payload.busy, false);
  assert.deepEqual(payload.metadata, buildCalendarEventMetadata({
    description: 'Discuss blockers',
    location: 'Room 2',
    videoLink: 'https://meet.example.com/room',
    allDay: true,
    calendarType: 'deadline',
    repeat: 'weekly',
    reminders: [5, 10],
    visibility: 'private',
    busy: false,
  }));
});
