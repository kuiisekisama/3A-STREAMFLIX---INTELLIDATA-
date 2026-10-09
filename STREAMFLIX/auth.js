// ===============================
// SUPABASE AUTH  (Google OAuth + email/password)
// Load order in every page:
//   1) supabase-js CDN   2) auth.js   3) app.js
// ===============================

// Paste these from Supabase Dashboard -> Project Settings -> API.
// The anon key is meant to be public. NEVER put the service_role key here.
const SUPABASE_URL = "https://gooctxmtcjiulgsheivi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gELB6vzPgy4-FN0PG-bXcg_8Fq8Cq-l";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Resolves the signed-in auth account to this app's internal bigint
// users.userid. watchlist/subscription fill this in automatically on the
// database side (default current_userid()), but review and viewing_history
// need it supplied explicitly on every insert/upsert.
let _sfUserIdCache = null;
async function sfGetUserId() {
    if (_sfUserIdCache) return _sfUserIdCache;
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabaseClient
        .from("users")
        .select("userid")
        .eq("auth_id", user.id)
        .maybeSingle();
    if (error || !data) return null;
    _sfUserIdCache = data.userid;
    return _sfUserIdCache;
}

// ---------- helpers ----------
function sfPath() {
    return window.location.pathname;
}

function sfIsProtectedPage() {
    const p = sfPath();
    return p.includes("movies.html") || p.includes("profile.html") || p.includes("player.html");
}

function sfIsIndexPage() {
    const p = sfPath();
    return p.includes("index.html") || p === "/" || p.endsWith("/");
}

// Where Google / email-confirmation links send the user back to.
// Resolves relative to the current page, so it works on localhost and in subfolders.
function sfMoviesUrl() {
    return new URL("movies.html", window.location.href).href;
}

function sfSetAuthError(message) {
    ["signinError", "signupError"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = message;
    });
}

function sfGoToMovies() {
    const popup = document.getElementById("welcomePopup");
    if (popup) {
        popup.classList.add("show");
        setTimeout(() => { window.location.href = "movies.html"; }, 1500);
    } else {
        window.location.href = "movies.html";
    }
}

// profile.html / movies.html read these localStorage keys, so keep them in sync
// with the signed-in Supabase user. Name comes from public.users (so edits stick
// and each account shows its own name); Google's name is only a fallback.
async function sfSyncProfileCache(user) {
    if (!user) return;
    localStorage.setItem("streamflix_user_email", user.email || "");

    // These caches belong to ONE account. If a different account signs in on this
    // browser, wipe them so it never shows (or uploads) the previous user's data.
    const owner = localStorage.getItem("streamflix_cache_owner");
    if (owner && owner !== user.id) {
        ["streamflix_username", "streamflix_avatar", "streamflix_watchlist",
            "streamflix_history", "streamflix_now_playing"
        ].forEach(k => localStorage.removeItem(k));
    }
    localStorage.setItem("streamflix_cache_owner", user.id);

    const meta = user.user_metadata || {};
    let name = meta.full_name || meta.name || "";
    try {
        const { data } = await supabaseClient
            .from("users")
            .select("firstname, lastname, profilename")
            .eq("auth_id", user.id)
            .maybeSingle();

        if (data && !data.firstname && !data.lastname && (meta.first_name || meta.last_name)) {
            // Covers email sign-ups that needed confirmation: the name was
            // saved on the auth user at sign-up time but the users-table
            // write couldn't run yet (no session). Fill it in now.
            await supabaseClient
                .from("users")
                .update({ firstname: meta.first_name || null, lastname: meta.last_name || null })
                .eq("auth_id", user.id);
            data.firstname = meta.first_name;
            data.lastname = meta.last_name;
        }

        if (data) {
            const dbName = [data.firstname, data.lastname].filter(Boolean).join(" ").trim();
            const profileName = (data.profilename || "").trim();
            // Profile name (display handle) wins; otherwise first + last name.
            if (profileName) name = profileName;
            else if (dbName) name = dbName;
        }
    } catch (e) {
        console.error("[StreamFlix] could not load profile name:", e);
    }
    if (!name) name = (user.email || "").split("@")[0];
    localStorage.setItem("streamflix_username", name);
}

// Shows the reactivate popup, and reveals the password field only for
// accounts that actually have a password (Google-only accounts have none to
// re-enter — their Google sign-in redirect already was the credential check).
async function sfShowReactivatePopup() {
    const popup = document.getElementById("reactivatePopup");
    if (!popup) return;
    const passGroup = document.getElementById("reactivatePasswordGroup");
    const passInput = document.getElementById("reactivatePassword");
    if (passInput) passInput.value = "";
    const errorEl = document.getElementById("reactivateError");
    if (errorEl) errorEl.textContent = "";

    if (passGroup) {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const providers = (user && user.app_metadata && user.app_metadata.providers) || [];
        passGroup.style.display = providers.includes("email") ? "block" : "none";
    }
    popup.classList.add("show");
}

// ---------- page protection ----------
// Hide protected pages until we know there is a session (avoids a flash of content).
if (sfIsProtectedPage()) {
    document.documentElement.style.visibility = "hidden";
}

// Other scripts/pages can `await window.sfProfileReady` to know the session and
// the cached profile name are ready.
window.sfProfileReady = new Promise(resolve => { window.__sfProfileResolve = resolve; });

async function sfInitAuthGuard() {
    try {
        // getSession() also finishes processing the #access_token that Google's
        // redirect leaves in the URL, so it is safe to call right on page load.
        const { data: { session } } = await supabaseClient.auth.getSession();
        const user = session ? session.user : null;

        if (user) {
            // Deactivated accounts don't get kicked out instantly — we keep their
            // session just long enough for index.html to offer "Reactivate" or
            // "Sign out", instead of locking them out with no way back in.
            const { data: row } = await supabaseClient
                .from("users")
                .select("is_active")
                .eq("auth_id", user.id)
                .maybeSingle();

            if (row && row.is_active === false) {
                sessionStorage.setItem("streamflix_needs_reactivation", "1");
                if (sfIsProtectedPage()) {
                    window.location.href = "index.html";
                    return;
                }
                // Already on index.html (e.g. a direct load/refresh while
                // deactivated): skip the normal "signed in -> go to movies.html"
                // redirect and show the prompt ourselves, in case index.html's
                // own DOMContentLoaded check ran before this async check finished.
                await sfShowReactivatePopup();
                document.documentElement.style.visibility = "visible";
                return;
            }
        }

        if (sfIsProtectedPage() && !user) {
            window.location.href = "index.html";
            return;
        }

        if (sfIsIndexPage() && user) {
            window.location.href = "movies.html";
            return;
        }

        if (user) {
            await sfSyncProfileCache(user);
            const userDisplay = document.getElementById("userEmailDisplay");
            if (userDisplay) userDisplay.textContent = user.email;
        }

        document.documentElement.style.visibility = "visible";
    } finally {
        window.__sfProfileResolve();
    }
}

document.addEventListener("DOMContentLoaded", sfInitAuthGuard);

// Signed out in another tab (or the session expired) -> leave protected pages.
supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && sfIsProtectedPage()) {
        window.location.href = "index.html";
    }
});

// ---------- handlers used by index.html (names unchanged) ----------
async function handleGoogleSignIn() {
    sfSetAuthError("");
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: sfMoviesUrl() }
    });
    if (error) sfSetAuthError(error.message);
    // On success the browser is sent to Google, then back to movies.html.
}

async function handleSignUp(event) {
    event.preventDefault();
    const firstName = document.getElementById("signupFirstName").value.trim();
    const lastName = document.getElementById("signupLastName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const errorEl = document.getElementById("signupError");
    errorEl.textContent = "";

    if (!firstName || !lastName) {
        errorEl.textContent = "Please enter your first and last name.";
        return;
    }

    if (password.length < 6) {
        errorEl.textContent = "Password must be at least 6 characters long.";
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: sfMoviesUrl(),
            // Stored on the auth user too, so the name survives even if the
            // users-table write below can't run yet (e.g. email confirmation
            // is required and there's no session until they click the link).
            data: { first_name: firstName, last_name: lastName }
        }
    });

    if (error) {
        errorEl.textContent = error.message;
        return;
    }

    // If "Confirm email" is ON in Supabase, there is no session until they click the link.
    if (!data.session) {
        errorEl.textContent = "Check your email and click the confirmation link, then sign in.";
        return;
    }

    // Save the name into public.users right away. If a row doesn't exist
    // yet for this account, this creates one; otherwise it fills the names in.
    const { error: profileError } = await supabaseClient
        .from("users")
        .upsert({ auth_id: data.user.id, email, firstname: firstName, lastname: lastName }, { onConflict: "auth_id" });
    if (profileError) {
        console.error("[StreamFlix] could not save name to users table:", profileError);
    }

    closeAuthPopup();
    sfGoToMovies();
}

async function handleSignIn(event) {
    event.preventDefault();
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPassword").value;
    const errorEl = document.getElementById("signinError");
    errorEl.textContent = "";

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        errorEl.textContent = "Invalid email or password.";
        return;
    }

    closeAuthPopup();
    sfGoToMovies();
}

// Called from the "Reactivate My Account" button that index.html shows when
// a deactivated account signs back in. Re-checks the account's password first
// (when it has one) as a lightweight security confirmation before unlocking it.
async function reactivateAccount() {
    const errorEl = document.getElementById("reactivateError");
    if (errorEl) errorEl.textContent = "";

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
        window.location.href = "index.html";
        return;
    }

    const passGroup = document.getElementById("reactivatePasswordGroup");
    const needsPassword = passGroup && passGroup.style.display !== "none";

    if (needsPassword) {
        const password = (document.getElementById("reactivatePassword") || {}).value || "";
        if (!password) {
            if (errorEl) errorEl.textContent = "Please enter your password to confirm.";
            return;
        }
        // Re-authenticating with email+password is the standard way to confirm
        // "this is really you" without a separate password-check endpoint.
        const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
            email: user.email,
            password
        });
        if (verifyError) {
            if (errorEl) errorEl.textContent = "Incorrect password.";
            return;
        }
    }

    const { error } = await supabaseClient
        .from("users")
        .update({ is_active: true, deactivated_at: null })
        .eq("auth_id", user.id);

    if (error) {
        if (errorEl) errorEl.textContent = "Could not reactivate your account: " + error.message;
        return;
    }

    sessionStorage.removeItem("streamflix_needs_reactivation");
    window.location.href = "movies.html";
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    localStorage.removeItem("streamflix_user_email");
    sessionStorage.removeItem("streamflix_needs_reactivation");
    window.location.href = "index.html";
}