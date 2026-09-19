import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import { continueWithoutAccount } from "./authQrSignInScreen.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const AuthSignInScreen = {
  async mount() {
    this.container = document.getElementById("account");
    ScreenUtils.show(this.container);
    this.render();
  },

  render() {
    if (Platform.isBrowser()) {
      this.renderDesktopBrowser();
      return;
    }

    this.container.innerHTML = `
      <div class="auth-simple-shell">
        <div class="auth-simple-hero">
          <h2 class="auth-simple-title">${I18n.t("auth.signIn.title")}</h2>
          <p class="auth-simple-subtitle">${I18n.t("auth.signIn.description")}</p>
        </div>
        <div class="auth-simple-actions">
          <div class="auth-simple-card focusable" data-action="openQr">${I18n.t("auth.signIn.openQrLogin")}</div>
          <div class="auth-simple-card focusable" data-action="devLogin">${I18n.t("auth.signIn.devEmailLogin")}</div>
          <div class="auth-simple-card focusable" data-action="back">${I18n.t("auth.signIn.back")}</div>
        </div>
      </div>
      ${
        this.textDialog
          ? `
        <div class="settings-dialog-backdrop">
          <div class="settings-dialog settings-text-dialog">
            <div class="settings-dialog-title">${escapeHtml(this.textDialog.title || "")}</div>
            <input class="settings-text-dialog-field settings-text-dialog-input focusable"
                   data-action="textInput"
                   type="${this.textDialog.type === "password" ? "password" : "text"}"
                   autocomplete="off"
                   autocapitalize="none"
                   spellcheck="false"
                   value="${escapeHtml(this.textDialog.value || "")}" />
            <div class="settings-text-dialog-actions">
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="saveText">
                <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.save", {}, { fallback: "Save" }))}</span>
              </button>
              <button class="settings-dialog-option settings-text-dialog-button focusable" data-action="cancelText">
                <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.cancel", {}, { fallback: "Cancel" }))}</span>
              </button>
            </div>
          </div>
        </div>
      `
          : ""
      }
    `;

    ScreenUtils.indexFocusables(this.container);
    if (this.textDialog) {
      const input = this.container.querySelector("[data-action='textInput']");
      input?.focus?.();
      input?.classList?.add("focused");
    } else {
      ScreenUtils.setInitialFocus(this.container);
    }
  },

  renderDesktopBrowser() {
    const errorMessage = this.desktopError
      ? `<p class="desktop-auth-error" role="alert">${escapeHtml(this.desktopError)}</p>`
      : "";
    const submitting = Boolean(this.isDesktopSubmitting);

    this.container.innerHTML = `
      <main class="desktop-auth-shell">
        <aside class="desktop-auth-brand">
          <img src="assets/brand/app_logo_wordmark.png" alt="Nuvio" />
          <h2>Your Nuvio library,<br>in your browser.</h2>
          <p>Use your existing Nuvio account to access your addons, collections and watch progress.</p>
        </aside>
        <div class="desktop-auth-pane">
        <section class="desktop-auth-card" aria-labelledby="desktop-auth-title">
          <h1 id="desktop-auth-title" class="desktop-auth-title">Welcome back</h1>
          <p class="desktop-auth-subtitle">Sign in with your existing Nuvio account.</p>
          <form class="desktop-auth-form" aria-busy="${submitting}">
            <label class="desktop-auth-field" for="desktop-auth-email">
              <span>${escapeHtml(I18n.t("auth.signIn.emailPrompt"))}</span>
              <span class="desktop-auth-input-wrap">
              <span class="material-icons" aria-hidden="true">email</span>
              <input id="desktop-auth-email" class="desktop-auth-input" type="email" name="email"
                autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false"
                placeholder="Email address" required ${submitting ? "disabled" : ""} />
              </span>
            </label>
            <div class="desktop-auth-field">
              <label for="desktop-auth-password">${escapeHtml(I18n.t("auth.signIn.passwordPrompt"))}</label>
              <span class="desktop-auth-input-wrap">
              <span class="material-icons" aria-hidden="true">lock</span>
              <input id="desktop-auth-password" class="desktop-auth-input" type="${this.passwordVisible ? "text" : "password"}" name="password"
                autocomplete="current-password" placeholder="Password" required ${submitting ? "disabled" : ""} />
              <button class="desktop-auth-visibility" type="button" aria-label="${this.passwordVisible ? "Hide" : "Show"} password"
                aria-pressed="${Boolean(this.passwordVisible)}" ${submitting ? "disabled" : ""}>
                <span class="material-icons" aria-hidden="true">${this.passwordVisible ? "visibility_off" : "visibility"}</span>
              </button>
              </span>
            </div>
            ${errorMessage}
            <button class="desktop-auth-submit" type="submit" ${submitting ? "disabled" : ""}>
              ${submitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
          <div class="desktop-auth-divider"><span>or</span></div>
          <button class="desktop-auth-qr" type="button" data-action="openQr" ${
            submitting ? "disabled" : ""
          }><span class="material-icons" aria-hidden="true">qr_code_2</span>Link with another device</button>
          <button class="desktop-auth-guest" type="button" data-action="continueGuest" ${
            submitting ? "disabled" : ""
          }>Continue without an account</button>
        </section>
        </div>
      </main>
    `;

    const emailInput = this.container.querySelector("#desktop-auth-email");
    const passwordInput = this.container.querySelector("#desktop-auth-password");
    emailInput.value = this.desktopEmail || "";
    passwordInput.value = this.desktopPassword || "";
    emailInput.addEventListener("input", () => { this.desktopEmail = emailInput.value; });
    passwordInput.addEventListener("input", () => { this.desktopPassword = passwordInput.value; });
    this.container.querySelector(".desktop-auth-visibility")?.addEventListener("click", (event) => {
      this.passwordVisible = !this.passwordVisible;
      passwordInput.type = this.passwordVisible ? "text" : "password";
      event.currentTarget.setAttribute("aria-label", `${this.passwordVisible ? "Hide" : "Show"} password`);
      event.currentTarget.setAttribute("aria-pressed", String(this.passwordVisible));
      event.currentTarget.firstElementChild.textContent = this.passwordVisible ? "visibility_off" : "visibility";
    });
    this.container.querySelector(".desktop-auth-form")?.addEventListener("submit", (event) => {
      void this.submitDesktopBrowserSignIn(event);
    });
    this.container.querySelector("[data-action='openQr']")?.addEventListener("click", () => {
      Router.navigate("authQrSignIn");
    });
    this.container.querySelector("[data-action='continueGuest']")?.addEventListener("click", () => {
      continueWithoutAccount();
    });
  },

  async submitDesktopBrowserSignIn(event) {
    event.preventDefault();
    if (this.isDesktopSubmitting) {
      return;
    }

    const form = event.currentTarget;
    const email = String(form?.elements?.email?.value || "").trim();
    const password = String(form?.elements?.password?.value || "");
    this.desktopEmail = email;
    this.desktopPassword = password;
    if (!email || !password) {
      this.desktopError = "Enter your email address and password.";
      this.renderDesktopBrowser();
      return;
    }

    this.desktopError = "";
    this.isDesktopSubmitting = true;
    this.renderDesktopBrowser();
    try {
      // This is the same email/password authentication used by the existing TV dialog.
      // AuthManager's subscription continues the normal profile and sync startup flow.
      await AuthManager.signInWithEmail(email, password);
    } catch (error) {
      console.error("SignIn failed", error);
      this.desktopError = "Sign-in failed. Check your email and password.";
    } finally {
      this.isDesktopSubmitting = false;
      if (Router.getCurrent() === "authSignIn") {
        this.renderDesktopBrowser();
      }
    }
  },

  openEmailDialog() {
    this.textDialog = {
      step: "email",
      title: I18n.t("auth.signIn.emailPrompt"),
      value: this.pendingEmail || "",
      type: "text"
    };
    this.render();
  },

  openPasswordDialog(email) {
    this.pendingEmail = String(email || "").trim();
    this.textDialog = {
      step: "password",
      title: I18n.t("auth.signIn.passwordPrompt"),
      value: "",
      type: "password"
    };
    this.render();
  },

  async submitTextDialog() {
    const input = this.container.querySelector("[data-action='textInput']");
    const value = String(input?.value || "");
    if (this.textDialog?.step === "email") {
      if (value.trim()) {
        this.openPasswordDialog(value);
      }
      return;
    }
    if (this.textDialog?.step === "password") {
      const email = String(this.pendingEmail || "").trim();
      const password = value;
      this.textDialog = null;
      this.pendingEmail = "";
      this.render();
      if (email && password) {
        try {
          await AuthManager.signInWithEmail(email, password);
          Router.navigate("profileSelection");
        } catch (error) {
          console.error("SignIn failed", error);
        }
      }
    }
  },

  async onKeyDown(event) {
    if (Platform.isBrowser()) {
      return;
    }

    if (this.textDialog) {
      if (event.keyCode === 27) {
        this.textDialog = null;
        this.pendingEmail = "";
        this.render();
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      const action = current?.dataset?.action || "";
      if (action === "cancelText") {
        this.textDialog = null;
        this.pendingEmail = "";
        this.render();
        return;
      }
      if (action === "saveText" || action === "textInput") {
        await this.submitTextDialog();
      }
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (event.keyCode !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = current.dataset.action;
    if (action === "openQr") {
      Router.navigate("authQrSignIn");
      return;
    }
    if (action === "devLogin") {
      this.openEmailDialog();
      return;
    }
    if (action === "back") {
      Router.back();
    }
  },

  consumeBackRequest() {
    if (!this.textDialog) {
      return false;
    }
    this.textDialog = null;
    this.pendingEmail = "";
    this.render();
    return true;
  },

  cleanup() {
    this.textDialog = null;
    this.pendingEmail = "";
    this.desktopError = "";
    this.desktopEmail = "";
    this.desktopPassword = "";
    this.passwordVisible = false;
    this.isDesktopSubmitting = false;
    ScreenUtils.hide(this.container);
  }
};
