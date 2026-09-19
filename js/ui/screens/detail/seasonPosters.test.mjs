import assert from 'node:assert/strict';
import test from 'node:test';
import { getSeasonPosters } from './seasonPosters.js';

test('season artwork follows Desktop addon formats, Specials and per-episode precedence', () => {
  const episodes = [{season:0},{season:2},{season:5,seasonPoster:'https://example.org/explicit.jpg'}];
  assert.deepEqual([...getSeasonPosters({app_extras:{seasonPosters:['/s2.jpg','/s5.jpg']}},episodes)], [
    [2,'https://image.tmdb.org/t/p/w342/s2.jpg'],[5,'https://example.org/explicit.jpg']
  ]);
  assert.deepEqual([...getSeasonPosters({app_extras:{seasonPosters:['/special.jpg','/s2.jpg','/s5.jpg']}},episodes)].map(([season])=>season),[0,2,5]);
  assert.deepEqual([...getSeasonPosters({app_extras:{seasonPosters:[null,'/s2.jpg','/s5.jpg']}},episodes)].map(([season])=>season),[2,5]);
  assert.equal(getSeasonPosters({seasons:[null,{season_number:1,poster_path:'/s1.jpg'}]},[{season:1}]).get(1),'https://image.tmdb.org/t/p/w342/s1.jpg');
  assert.equal(getSeasonPosters({seasonPosters:{1:'javascript:alert(1)',2:'data:text/html,test'}},[]).size,0);
  assert.equal(getSeasonPosters(null,[null,{season:1,seasonPoster:'invalid'},{season:1,seasonPoster:'https://example.org/good.jpg'}]).get(1),'https://example.org/good.jpg');
});
