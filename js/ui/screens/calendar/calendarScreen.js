import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { getSidebarProfileState } from "../../components/sidebarNavigation.js";
import { bindDesktopNavigationEvents, renderDesktopNavigation } from "../../components/desktopNavigation.js";
import { libraryRepository } from "../../../data/repository/libraryRepository.js";
import { metaRepository } from "../../../data/repository/metaRepository.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { mapWithConcurrency } from "../../../core/network/mapWithConcurrency.js";
import { buildReleaseEvents, localDateKey, monthDays } from "./releaseCalendar.js";

const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const fullWeekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const imageUrl = value => /^https?:\/\//i.test(String(value || "")) ? escapeHtml(value) : "";
const dayDate = key => new Date(`${key}T12:00:00`);

export const CalendarScreen = {
  async mount(_params = {}, context = {}) {
    const generation = this.loadGeneration = (this.loadGeneration || 0) + 1;
    this.container = document.getElementById("calendar");
    ScreenUtils.show(this.container);
    this.profileId = ProfileManager.getActiveProfileId();
    this.sessionGeneration = AuthManager.getSessionGeneration();
    this.selectedDate = context.restoredState?.selectedDate || localDateKey();
    this.month = dayDate(this.selectedDate);
    this.month.setDate(1);
    this.metas = [];
    this.events = [];
    this.loading = true;
    this.error = "";
    this.failed = 0;
    this.checked = 0;
    this.total = 0;
    const profile = await getSidebarProfileState().catch(() => null);
    if (generation !== this.loadGeneration) return;
    this.container.innerHTML = `
      <div class="calendar-screen">
        ${renderDesktopNavigation({ selectedRoute: "calendar", profile })}
        <main class="calendar-main">
          <header class="calendar-heading"><div><h1>Calendar</h1><p>Release dates for titles in your Library.</p></div>
            <button type="button" class="calendar-button" data-calendar-action="refresh" aria-label="Refresh calendar" title="Refresh calendar"><span class="material-icons" aria-hidden="true">refresh</span></button>
          </header>
          <div class="calendar-toolbar">
            <div class="calendar-month-controls">
              <button type="button" class="calendar-button" data-calendar-action="previous" aria-label="Previous month"><span class="material-icons" aria-hidden="true">chevron_left</span></button>
              <h2 id="calendarMonth"></h2>
              <button type="button" class="calendar-button" data-calendar-action="next" aria-label="Next month"><span class="material-icons" aria-hidden="true">chevron_right</span></button>
            </div>
            <button type="button" class="calendar-button" data-calendar-action="today">Today</button>
          </div>
          <p class="calendar-status" role="status" aria-live="polite"></p>
          <div class="calendar-layout">
            <section class="calendar-board" aria-labelledby="calendarMonth">
              <div class="calendar-weekdays" aria-hidden="true">${Array.from({ length: 7 }, (_, index) => {
                const day = new Date(2026, 0, 5 + index);
                return `<abbr title="${escapeHtml(fullWeekdayFormat.format(day))}">${escapeHtml(weekdayFormat.format(day))}</abbr>`;
              }).join("")}</div>
              <div class="calendar-grid" role="group" aria-label="Release dates"></div>
            </section>
            <section class="calendar-agenda" aria-labelledby="calendarDay"></section>
          </div>
        </main>
      </div>`;
    bindDesktopNavigationEvents(this.container);
    this.container.onclick = event => this.onClick(event);
    this.container.onkeydown = event => this.onCalendarKeyDown(event);
    this.container.addEventListener("error", this.onImageError, true);
    this.renderContent();
    void this.loadLibrary();
  },

  getRouteStateKey() { return "calendar"; },
  captureRouteState() { return { selectedDate: this.selectedDate }; },
  onImageError(event) { if (event.target.matches?.(".calendar-main img")) event.target.remove(); },

  async loadLibrary(refresh = false) {
    const generation = this.loadGeneration = (this.loadGeneration || 0) + 1;
    const current = () => generation === this.loadGeneration
      && this.profileId === ProfileManager.getActiveProfileId()
      && this.sessionGeneration === AuthManager.getSessionGeneration();
    this.loading = true;
    this.error = "";
    this.checked = 0;
    this.failed = 0;
    this.renderContent();
    try {
      const items = await libraryRepository.getItems({ hydrate: false });
      if (!current()) return;
      const unique = new Map(items.filter(item => item.id && !["tv", "channel"].includes(item.type)).map(item => [`${item.type}:${item.id}`, item]));
      const seeds = [...unique.values()];
      this.total = seeds.length;
      this.metas = [];
      this.events = [];
      this.renderContent();
      await mapWithConcurrency(seeds, 4, async item => {
        if (!current()) return;
        if (refresh) metaRepository.invalidateDetailCache(item.id);
        let meta = null;
        try {
          const result = await metaRepository.getMetaFromAllAddons(item.type, item.id);
          if (result.status === "success") meta = { ...item, ...result.data, id: item.id, type: item.type };
        } catch (_) {}
        if (!current()) return;
        if (meta) this.metas.push(meta);
        else this.failed += 1;
        this.checked += 1;
        // Publish results without repainting the controls or refetching on month changes.
        if (this.checked === 1 || this.checked % 4 === 0 || this.checked === this.total) {
          this.events = buildReleaseEvents(this.metas);
          this.renderContent();
        }
      });
    } catch (_) {
      if (current()) this.error = "Couldn't load your library. Use Refresh to try again.";
    } finally {
      if (current()) {
        this.loading = false;
        this.renderContent();
      }
    }
  },

  renderContent() {
    if (!this.container?.querySelector(".calendar-grid")) return;
    const active = document.activeElement;
    const focusDate = active?.dataset?.calendarDate;
    const focusRelease = active?.dataset?.calendarRelease;
    const today = localDateKey();
    const prefix = localDateKey(this.month).slice(0, 7);
    const monthEvents = this.events.filter(event => event.date.startsWith(prefix));
    const grouped = new Map();
    monthEvents.forEach(event => grouped.set(event.date, [...(grouped.get(event.date) || []), event]));
    this.container.querySelector("#calendarMonth").textContent = monthFormat.format(this.month);
    this.container.querySelector(".calendar-status").textContent = this.error || (this.loading
      ? this.total ? `Checking ${this.checked} of ${this.total} titles…` : "Loading your library…"
      : !this.total ? "Add movies or series to your Library to see their releases here."
      : this.failed ? `${this.failed} ${this.failed === 1 ? "title couldn't" : "titles couldn't"} be checked. Use Refresh to retry.`
      : `${monthEvents.length} ${monthEvents.length === 1 ? "release" : "releases"} this month`);
    this.container.querySelector('[data-calendar-action="refresh"]').disabled = this.loading;
    this.container.querySelector(".calendar-grid").innerHTML = monthDays(this.month.getFullYear(), this.month.getMonth()).map(date => {
      if (!date) return '<div class="calendar-day-empty" aria-hidden="true"></div>';
      const entries = grouped.get(date) || [];
      const posters = [...new Set(entries.map(entry => entry.meta.poster).filter(Boolean))].slice(0, 2);
      return `<button type="button" class="calendar-day${date === this.selectedDate ? " is-selected" : ""}${date === today ? " is-today" : ""}"
        data-calendar-date="${date}" aria-pressed="${date === this.selectedDate}" tabindex="${date === this.selectedDate ? "0" : "-1"}"
        aria-label="${escapeHtml(dayFormat.format(dayDate(date)))}${entries.length ? `, ${entries.length} ${entries.length === 1 ? "release" : "releases"}` : ""}">
        <span class="calendar-day-number">${dayDate(date).getDate()}</span>
        ${entries.length ? `<span class="calendar-count" aria-hidden="true">${entries.length}</span>` : ""}
        <span class="calendar-thumbnails" aria-hidden="true">${posters.filter(imageUrl).map(poster => `<img src="${imageUrl(poster)}" alt="" loading="lazy" />`).join("")}</span>
      </button>`;
    }).join("");
    const selected = grouped.get(this.selectedDate) || [];
    this.container.querySelector(".calendar-agenda").innerHTML = `<h2 id="calendarDay">${escapeHtml(dayFormat.format(dayDate(this.selectedDate)))}</h2>
      ${selected.length ? `<div class="calendar-releases">${selected.map(entry => {
        const video = entry.video;
        const episode = video ? [video.season != null ? `S${video.season}` : "", video.episode != null ? `E${video.episode}` : ""].join("") : "Movie release";
        return `<button type="button" class="calendar-release" data-calendar-release="${escapeHtml(entry.key)}">
          <span class="calendar-release-artwork" aria-hidden="true">${imageUrl(entry.meta.poster) ? `<img src="${imageUrl(entry.meta.poster)}" alt="" loading="lazy" />` : '<span class="material-icons">movie</span>'}</span>
          <span class="calendar-release-copy"><strong>${escapeHtml(entry.meta.name)}</strong><span>${escapeHtml(episode || "Episode")}</span>${video?.title || video?.name ? `<span>${escapeHtml(video.title || video.name)}</span>` : ""}</span>
          <span class="material-icons" aria-hidden="true">chevron_right</span>
        </button>`;
      }).join("")}</div>` : `<p class="calendar-empty">${this.loading ? "Checking release dates…" : "No releases on this day."}</p>`}`;
    if (focusDate) this.container.querySelector(`[data-calendar-date="${focusDate}"]`)?.focus({ preventScroll: true });
    if (focusRelease) Array.from(this.container.querySelectorAll("[data-calendar-release]")).find(el => el.dataset.calendarRelease === focusRelease)?.focus({ preventScroll: true });
  },

  selectDay(date, focus = false) {
    this.selectedDate = localDateKey(date);
    this.month = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    this.renderContent();
    if (focus) this.container.querySelector(`[data-calendar-date="${this.selectedDate}"]`)?.focus({ preventScroll: true });
  },

  changeMonth(delta, focus = false) {
    const target = new Date(this.month.getFullYear(), this.month.getMonth() + delta, 1, 12);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(dayDate(this.selectedDate).getDate(), last));
    this.selectDay(target, focus);
  },

  onClick(event) {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.calendarDate) this.selectDay(dayDate(target.dataset.calendarDate));
    const action = target.dataset.calendarAction;
    if (action === "previous") this.changeMonth(-1);
    if (action === "next") this.changeMonth(1);
    if (action === "today") this.selectDay(new Date());
    if (action === "refresh") void this.loadLibrary(true);
    if (target.dataset.calendarRelease) {
      const entry = this.events.find(item => item.key === target.dataset.calendarRelease);
      if (entry) void Router.navigate("detail", {
        itemId: entry.meta.id, itemType: entry.meta.type, itemName: entry.meta.name,
        itemPoster: entry.meta.poster, preferredSeason: entry.video?.season
      });
    }
  },

  onCalendarKeyDown(event) {
    const date = event.target.dataset?.calendarDate;
    if (!date) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in offsets) {
      event.preventDefault();
      event.stopPropagation();
      const next = dayDate(date);
      next.setDate(next.getDate() + offsets[event.key]);
      this.selectDay(next, true);
    } else if (["PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.changeMonth(event.key === "PageUp" ? -1 : 1, true);
    }
  },

  onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); void Router.back(); }
  },

  cleanup() {
    this.loadGeneration = (this.loadGeneration || 0) + 1;
    this.container.onclick = null;
    this.container.onkeydown = null;
    this.container.removeEventListener("error", this.onImageError, true);
    this.metas = [];
    this.events = [];
    ScreenUtils.hide(this.container);
  }
};
