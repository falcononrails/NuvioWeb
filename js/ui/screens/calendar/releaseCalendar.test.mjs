import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseEvents, releaseDateKey, monthDays, localDateKey } from './releaseCalendar.js';

test('release dates preserve date-only values and convert timestamped releases to the local day', () => {
  assert.equal(releaseDateKey('2024-02-29'),'2024-02-29');
  for (const value of ['2025-02-29','2026-02-30','2026-02-30T12:00:00Z','2026','',null]) assert.equal(releaseDateKey(value),null);
  const value='2026-09-19T23:30:00-05:00';
  assert.equal(releaseDateKey(value),localDateKey(new Date(value)));
  assert.equal(monthDays(2024,1).filter(Boolean).length,29);
  assert.equal(monthDays(2026,8)[0],null); // September starts on Tuesday, with Monday first.
  assert.equal(monthDays(2026,8)[1],'2026-09-01');
  assert.equal(monthDays(2026,11).length % 7,0);
});

test('calendar deduplicates library entries and shows exact movie/episode dates without inventing year-only releases', () => {
  const series={id:'show',type:'series',name:'Show',videos:[null,{id:'show:1:2',season:1,episode:2,released:'2026-09-20'},{id:'show:1:1',season:1,episode:1,air_date:'2026-09-19'},{id:'unknown',released:'2026'}]};
  const events=buildReleaseEvents([series,series,{id:'film',type:'movie',name:'Film',released:'2026-09-19'}, {id:'year-only',type:'movie',releaseInfo:'2026'}]);
  assert.equal(events.length,3);
  assert.deepEqual(events.filter(item=>item.video).map(item=>item.video.episode),[1,2]);
  assert.equal(events[0].meta.id,'film');
});
