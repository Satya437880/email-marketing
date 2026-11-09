import { describe, expect, it } from "vitest";
import { loginAuthorizationUrl, loginRedirectUri, profileFromIdToken, signState, verifyState } from "./oauth";

const CLIENT = "client-123.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const goodGoogle = { iss: "https://accounts.google.com", aud: CLIENT, exp: NOW / 1000 + 3600, sub: "1098765", email: "Jane.Doe@Gmail.com", email_verified: true, name: "Jane Doe" };
const goodMicrosoft = { iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", aud: "ms-client", exp: NOW / 1000 + 3600, sub: "AAAA", preferred_username: "Sam@Contoso.com", name: "Sam Lee" };

describe("profileFromIdToken", () => {
  it("accepts a valid Google token and normalises the email", () => {
    expect(profileFromIdToken("google", goodGoogle, CLIENT, NOW)).toEqual({ provider: "google", sub: "1098765", email: "jane.doe@gmail.com", emailVerified: true, name: "Jane Doe" });
  });

  it("only trusts email_verified from Google, never from Microsoft", () => {
    expect(profileFromIdToken("google", { ...goodGoogle, email_verified: false }, CLIENT, NOW).emailVerified).toBe(false);
    expect(profileFromIdToken("google", { ...goodGoogle, email_verified: "true" }, CLIENT, NOW).emailVerified).toBe(true);
    const ms = profileFromIdToken("microsoft", { ...goodMicrosoft, email_verified: true, email: "sam@contoso.com" }, "ms-client", NOW);
    expect(ms.emailVerified).toBe(false);
    expect(ms.email).toBe("sam@contoso.com");
  });

  it("falls back to preferred_username for Microsoft accounts without an email claim", () => {
    expect(profileFromIdToken("microsoft", goodMicrosoft, "ms-client", NOW).email).toBe("sam@contoso.com");
  });

  it("rejects tokens for another app, from another issuer, or expired", () => {
    expect(() => profileFromIdToken("google", { ...goodGoogle, aud: "someone-else" }, CLIENT, NOW)).toThrow(/different app/);
    expect(() => profileFromIdToken("google", { ...goodGoogle, iss: "https://evil.example.com" }, CLIENT, NOW)).toThrow(/issuer/);
    expect(() => profileFromIdToken("microsoft", { ...goodMicrosoft, iss: "https://accounts.google.com" }, "ms-client", NOW)).toThrow(/issuer/);
    expect(() => profileFromIdToken("google", { ...goodGoogle, exp: NOW / 1000 - 1 }, CLIENT, NOW)).toThrow(/expired/);
  });

  it("rejects tokens with no usable email or account id", () => {
    expect(() => profileFromIdToken("google", { ...goodGoogle, email: "not-an-email" }, CLIENT, NOW)).toThrow(/email/);
    expect(() => profileFromIdToken("google", { ...goodGoogle, sub: undefined }, CLIENT, NOW)).toThrow(/account ID/);
  });
});

describe("login redirect and state", () => {
  process.env.SESSION_SECRET = "unit-test-secret";
  process.env.PUBLIC_URL = "https://app.example.com/";

  it("builds the provider URL with the login callback, identity-only scopes and the account chooser", () => {
    const u = new URL(loginAuthorizationUrl("google", "st", { clientId: CLIENT, clientSecret: "s" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example.com/v1/auth/oauth/google/callback");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    const m = new URL(loginAuthorizationUrl("microsoft", "st", { clientId: "ms", clientSecret: "s", tenant: "contoso.onmicrosoft.com" }));
    expect(m.pathname).toBe("/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    expect(loginRedirectUri("microsoft")).toBe("https://app.example.com/v1/auth/oauth/microsoft/callback");
  });

  it("signs state with its purpose and rejects tampering", () => {
    const st = signState({ purpose: "login", ws: "", userId: "", provider: "google", timezone: "UTC" });
    expect(verifyState(st)?.purpose).toBe("login");
    expect(verifyState(`${st}x`)).toBeNull();
    expect(verifyState(`${st.split(".")[0]}.AAAA`)).toBeNull();
  });
});
