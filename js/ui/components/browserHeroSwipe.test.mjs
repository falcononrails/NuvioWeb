import test from "node:test";
import assert from "node:assert/strict";
import { heroSwipeDirection } from "./browserHeroSwipe.js";

test("phone hero accepts deliberate swipes without capturing taps or vertical scrolling", () => {
  assert.equal(heroSwipeDirection(-80, 5, 800, 390), 1);
  assert.equal(heroSwipeDirection(30, 2, 60, 390), -1);
  assert.equal(heroSwipeDirection(30, 2, 800, 390), 0);
  assert.equal(heroSwipeDirection(5, 1, 5, 390), 0);
  assert.equal(heroSwipeDirection(-90, 160, 100, 390), 0);
});
