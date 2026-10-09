// ===============================
// MOVIE SLIDER
// ===============================
const movieContainer = document.querySelector(".movie-container");
const leftBtn = document.querySelector(".slider-btn.left");
const rightBtn = document.querySelector(".slider-btn.right");

if (rightBtn && movieContainer) {
    rightBtn.addEventListener("click", () => {
        movieContainer.scrollBy({ left: 900, behavior: "smooth" });
    });
}

if (leftBtn && movieContainer) {
    leftBtn.addEventListener("click", () => {
        movieContainer.scrollBy({ left: -900, behavior: "smooth" });
    });
}

// ===============================
// AUTH UI (modal tabs)
// Login, sign-up, Google OAuth, logout and page protection live in auth.js
// ===============================
function switchAuthTab(tab) {
    const signinForm = document.getElementById("signinForm");
    const signupForm = document.getElementById("signupForm");
    const tabSignin = document.getElementById("tabSignin");
    const tabSignup = document.getElementById("tabSignup");

    if (!signinForm || !signupForm) return;

    if (tab === 'signin') {
        signinForm.style.display = "block";
        signupForm.style.display = "none";
        if (tabSignin) tabSignin.classList.add("active");
        if (tabSignup) tabSignup.classList.remove("active");
    } else {
        signinForm.style.display = "none";
        signupForm.style.display = "block";
        if (tabSignup) tabSignup.classList.add("active");
        if (tabSignin) tabSignin.classList.remove("active");
    }
}

function openAuthModal(mode = 'signin') {
    const modal = document.getElementById("authModal");
    if (modal) {
        modal.classList.add("show");
        switchAuthTab(mode);
    }
}

function closeAuthPopup() {
    const modal = document.getElementById("authModal");
    if (modal) modal.classList.remove("show");
}

// Intercept Hero Email CTA Form
document.addEventListener("submit", (e) => {
    if (e.target.classList.contains("email-cta-form")) {
        e.preventDefault();
        const emailInput = e.target.querySelector(".email-input");
        const emailPopup = document.getElementById("emailPopup");
        const emailPopupMessage = document.getElementById("emailPopupMessage");

        if (emailInput) {
            const email = emailInput.value.trim();
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (email.length === 0 || !emailPattern.test(email)) {
                if (emailPopupMessage) emailPopupMessage.textContent = "Please enter a valid email address.";
                if (emailPopup) emailPopup.classList.add("show");
                emailInput.focus();
                return;
            }

            openAuthModal('signup');
            const signupEmailField = document.getElementById("signupEmail");
            if (signupEmailField) signupEmailField.value = email;
        }
    }
});

// Popup Close Listeners
const emailPopup = document.getElementById("emailPopup");
const emailPopupBtn = document.getElementById("emailPopupBtn");
if (emailPopupBtn && emailPopup) {
    emailPopupBtn.addEventListener("click", () => emailPopup.classList.remove("show"));
}

const welcomePopup = document.getElementById("welcomePopup");
const continueBtn = document.getElementById("continueBtn");
if (continueBtn && welcomePopup) {
    continueBtn.addEventListener("click", () => {
        welcomePopup.classList.remove("show");
        window.location.href = "movies.html";
    });
}

// FAQ Accordion
document.querySelectorAll(".faq").forEach(faq => {
    faq.addEventListener("click", () => {
        document.querySelectorAll(".faq").forEach(item => {
            if (item !== faq) item.classList.remove("open");
        });
        faq.classList.toggle("open");
    });
});

// ===============================
// HAMBURGER MENU (Subscriptions / Home / Profile / Sign Out)
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const hamburgerClose = document.getElementById("hamburgerClose");
    const hamburgerOverlay = document.getElementById("hamburgerOverlay");
    const hamburgerMenu = document.getElementById("hamburgerMenu");
    const hamburgerLogoutBtn = document.getElementById("hamburgerLogoutBtn");
    const hamburgerSubscriptionsBtn = document.getElementById("hamburgerSubscriptionsBtn");

    function openHamburgerMenu() {
        if (hamburgerMenu) hamburgerMenu.classList.add("show");
        if (hamburgerOverlay) hamburgerOverlay.classList.add("show");
    }

    function closeHamburgerMenu() {
        if (hamburgerMenu) hamburgerMenu.classList.remove("show");
        if (hamburgerOverlay) hamburgerOverlay.classList.remove("show");
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener("click", (e) => {
            e.preventDefault();
            openHamburgerMenu();
        });
    }

    if (hamburgerClose) {
        hamburgerClose.addEventListener("click", (e) => {
            e.preventDefault();
            closeHamburgerMenu();
        });
    }

    if (hamburgerOverlay) {
        hamburgerOverlay.addEventListener("click", closeHamburgerMenu);
    }

    if (hamburgerLogoutBtn) {
        hamburgerLogoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            handleLogout();
        });
    }

    if (hamburgerSubscriptionsBtn) {
        hamburgerSubscriptionsBtn.addEventListener("click", (e) => {
            e.preventDefault();
            closeHamburgerMenu();
            openSubscriptionModal();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeHamburgerMenu();
    });
});

// ===============================
// WATCHLIST + WATCH HISTORY
// The UI reads these synchronously from localStorage (fast, works on every
// page with no `await`). Every change is ALSO mirrored to Supabase
// (public.watchlist / public.viewing_history) in the background.
// `userid` is filled in by the database default (current_userid()).
// ===============================
let sfContentMap = null;

async function sfLoadContentMap() {
    if (sfContentMap) return sfContentMap;
    const { data, error } = await supabaseClient.from('content').select('contentid, title');
    if (error) {
        console.error('[StreamFlix] content lookup failed:', error.message);
        return {};
    }
    sfContentMap = {};
    data.forEach(row => { sfContentMap[(row.title || '').trim().toLowerCase()] = row.contentid; });
    return sfContentMap;
}

async function sfContentIdFor(title) {
    const map = await sfLoadContentMap();
    const id = map[(title || '').trim().toLowerCase()];
    if (!id) console.warn('[StreamFlix] "' + title + '" has no matching row in the content table, so it is not saved to Supabase.');
    return id || null;
}

// Run sync jobs one at a time so quick clicks can't collide.
let sfSyncQueue = Promise.resolve();

function sfEnqueue(job) {
    sfSyncQueue = sfSyncQueue.then(job).catch(e => console.error('[StreamFlix] sync error:', e));
    return sfSyncQueue;
}

async function sfSignedIn() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        return !!session;
    } catch (e) {
        return false;
    }
}

// Make public.watchlist match the given list.
async function sfSyncWatchlist(list) {
    if (!(await sfSignedIn())) return;
    const wanted = new Set();
    for (const item of list) {
        const id = await sfContentIdFor(item.title);
        if (id) wanted.add(id);
    }
    const { data: rows, error } = await supabaseClient.from('watchlist').select('contentid');
    if (error) { console.error('[StreamFlix] watchlist read failed:', error.message); return; }
    const have = new Set(rows.map(r => r.contentid));

    const toAdd = [...wanted].filter(id => !have.has(id));
    const toRemove = [...have].filter(id => !wanted.has(id));

    if (toAdd.length) {
        const { error: e1 } = await supabaseClient.from('watchlist').insert(toAdd.map(contentid => ({ contentid })));
        if (e1) console.error('[StreamFlix] watchlist insert failed:', e1.message);
    }
    if (toRemove.length) {
        const { error: e2 } = await supabaseClient.from('watchlist').delete().in('contentid', toRemove);
        if (e2) console.error('[StreamFlix] watchlist delete failed:', e2.message);
    }
}

// Make public.viewing_history match the given list. Unlike watchlist, this
// table has no database default for `userid` (it's part of the primary key),
// so it has to be supplied explicitly on every write.
async function sfSyncHistory(list) {
    if (!(await sfSignedIn())) return;
    const userid = await sfGetUserId();
    if (!userid) return;

    const wanted = new Map();
    for (const item of list) {
        const id = await sfContentIdFor(item.title);
        if (id) wanted.set(id, item);
    }
    const { data: rows, error } = await supabaseClient.from('viewing_history').select('contentid');
    if (error) { console.error('[StreamFlix] history read failed:', error.message); return; }
    const have = new Set(rows.map(r => r.contentid));

    for (const [contentid, item] of wanted) {
        const row = {
            userid,
            contentid,
            // "completed" isn't a real column here - in-progress vs finished is
            // inferred from progress (100 = finished), matching what player.html
            // already records for a fully-watched title.
            progress: item.progress !== undefined ? item.progress : 100,
            lastwatched: new Date().toISOString()
        };
        const { error: e1 } = await supabaseClient.from('viewing_history').upsert(row, { onConflict: 'userid,contentid' });
        if (e1) console.error('[StreamFlix] history upsert failed:', e1.message);
    }
    const toRemove = [...have].filter(id => !wanted.has(id));
    if (toRemove.length) {
        const { error: e3 } = await supabaseClient.from('viewing_history').delete().in('contentid', toRemove);
        if (e3) console.error('[StreamFlix] history delete failed:', e3.message);
    }
}

// ---------- WATCHLIST ----------
function getWatchlist() {
    try {
        return JSON.parse(localStorage.getItem("streamflix_watchlist")) || [];
    } catch (e) {
        return [];
    }
}

function saveWatchlist(list) {
    localStorage.setItem("streamflix_watchlist", JSON.stringify(list));
    sfEnqueue(() => sfSyncWatchlist(list));
}

function isInWatchlist(title) {
    return getWatchlist().some(item => item.title === title);
}

function addToWatchlist(movie) {
    const list = getWatchlist();
    if (!list.some(item => item.title === movie.title)) {
        list.push(movie);
        saveWatchlist(list);
    }
    return list;
}

function removeFromWatchlistByTitle(title) {
    const list = getWatchlist().filter(item => item.title !== title);
    saveWatchlist(list);
    return list;
}

// ---------- WATCH HISTORY ----------
function getHistory() {
    try {
        return JSON.parse(localStorage.getItem("streamflix_history")) || [];
    } catch (e) {
        return [];
    }
}

function saveHistory(list) {
    localStorage.setItem("streamflix_history", JSON.stringify(list));
    sfEnqueue(() => sfSyncHistory(list));
}

function addToHistory(movie) {
    // Move re-watched titles to the top instead of listing them twice.
    let list = getHistory().filter(item => item.title !== movie.title);
    list.unshift({
        ...movie,
        watchedAt: new Date().toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        }),
        completed: movie.completed !== undefined ? movie.completed : true,
        progress: movie.progress !== undefined ? movie.progress : 100
    });
    if (list.length > 50) list = list.slice(0, 50);
    saveHistory(list);
    return list;
}

function removeFromHistoryByTitle(title) {
    const list = getHistory().filter(item => item.title !== title);
    saveHistory(list);
    return list;
}

// Titles stopped before finishing - powers the "Continue Watching" row.
function getContinueWatching(limit = 12) {
    return getHistory().filter(item => item.completed === false).slice(0, limit);
}

// On every page load, push whatever is in localStorage up to Supabase so
// existing data (and anything added while signed out) gets stored too.
document.addEventListener("DOMContentLoaded", async() => {
    if (typeof supabaseClient === "undefined") return;
    // Wait until auth.js has confirmed which account is signed in (and cleared
    // any previous account's cached lists) before uploading anything.
    if (window.sfProfileReady) await window.sfProfileReady;
    sfEnqueue(() => sfSyncWatchlist(getWatchlist()));
    sfEnqueue(() => sfSyncHistory(getHistory()));
});

// ===============================
// SUBSCRIPTION & PAYMENT MANAGEMENT
// ===============================
function openSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    if (modal) {
        modal.style.display = 'flex';
        const tierStep = document.getElementById('tierSelectionStep');
        const paymentStep = document.getElementById('paymentMethodStep');
        if (tierStep) tierStep.style.display = 'block';
        if (paymentStep) paymentStep.style.display = 'none';
    }
}

function closeSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    if (modal) modal.style.display = 'none';
}

let selectedPlanData = { name: '', price: 0, discount: 0 };

function selectPlan(planName, basePrice, discountRate) {
    selectedPlanData = {
        name: planName,
        price: basePrice,
        discount: discountRate
    };

    const finalPrice = basePrice * (1 - discountRate);

    const summaryName = document.getElementById('summaryPlanName');
    const summaryOriginal = document.getElementById('summaryOriginalPrice');
    const summaryDiscount = document.getElementById('summaryDiscountText');
    const summaryFinal = document.getElementById('summaryFinalPrice');

    if (summaryName) summaryName.textContent = `Selected Plan: ${planName}`;
    if (summaryOriginal) summaryOriginal.textContent = `₱${basePrice}`;
    if (summaryDiscount) summaryDiscount.textContent = `${discountRate * 100}% off applied for new users`;
    if (summaryFinal) summaryFinal.textContent = `₱${finalPrice.toFixed(2)}`;

    const tierStep = document.getElementById('tierSelectionStep');
    const paymentStep = document.getElementById('paymentMethodStep');
    if (tierStep) tierStep.style.display = 'none';
    if (paymentStep) paymentStep.style.display = 'block';
}

function backToPlans() {
    const tierStep = document.getElementById('tierSelectionStep');
    const paymentStep = document.getElementById('paymentMethodStep');
    if (tierStep) tierStep.style.display = 'block';
    if (paymentStep) paymentStep.style.display = 'none';
}

function togglePaymentDetails(type) {
    const debitFields = document.getElementById('debitDetails');
    const ewalletFields = document.getElementById('ewalletDetails');

    if (type === 'debit') {
        if (debitFields) debitFields.style.display = 'block';
        if (ewalletFields) ewalletFields.style.display = 'none';
    } else if (type === 'ewallet') {
        if (debitFields) debitFields.style.display = 'none';
        if (ewalletFields) ewalletFields.style.display = 'block';
    }
}

// Confirms payment, then saves the plan to public.users.plan_tier and also
// records a row in public.subscription. Requires `supabaseClient` (auth.js).
async function processPayment() {
    const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked');
    if (!selectedMethod) {
        alert("Please select a payment method (Debit Card or E-Wallet) to proceed.");
        return;
    }

    if (selectedMethod.value === 'E-Wallet') {
        const selectedWallet = document.querySelector('input[name="ewalletProvider"]:checked');
        if (!selectedWallet) {
            alert("Please choose your specific E-Wallet provider (GCash, Maya, or PayPal).");
            return;
        }
    }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            alert("You must be signed in to subscribe.");
            return;
        }

        const { data: updatedRows, error } = await supabaseClient
            .from('users')
            .update({ plan_tier: selectedPlanData.name })
            .eq('auth_id', user.id)
            .select();

        if (error) {
            console.error('[StreamFlix] Failed to save subscription:', error.message, error);
            alert("Something went wrong saving your subscription: " + error.message);
            return;
        }

        if (!updatedRows || updatedRows.length === 0) {
            console.error('[StreamFlix] Update matched 0 rows. user.id was:', user.id);
            alert("Subscription update didn't match your account row (0 rows updated). This is likely a permissions or auth_id mismatch issue.");
            return;
        }

        // Record the subscription in its own table.
        const { data: plan, error: planError } = await supabaseClient
            .from('plan')
            .select('planid')
            .eq('planname', selectedPlanData.name.trim().toLowerCase())
            .maybeSingle();

        if (planError || !plan) {
            console.error('[StreamFlix] Plan lookup failed:', planError ? planError.message : 'no match for ' + selectedPlanData.name);
            alert("Plan saved, but the subscription record failed: could not find the plan '" + selectedPlanData.name + "' in the plan table.");
        } else {
            const start = new Date();
            const end = new Date();
            end.setDate(end.getDate() + 30);

            const { error: subError } = await supabaseClient.from('subscription').insert({
                planid: plan.planid,
                startdate: start.toISOString(),
                expirationdate: end.toISOString(),
                status: 'active'
            });

            if (subError) {
                console.error('[StreamFlix] subscription insert failed:', subError.message, subError);
                alert("Plan saved, but the subscription record failed: " + subError.message);
            }
        }

        // Reflect the new plan immediately on the profile page, if present.
        const display = document.getElementById('planTierDisplay');
        if (display) display.textContent = selectedPlanData.name;

        alert(`Success! Your subscription to the ${selectedPlanData.name} plan has been activated. Welcome to StreamFlix!`);
        closeSubscriptionModal();
    } catch (e) {
        console.error('[StreamFlix] processPayment error:', e);
        alert("Something went wrong saving your subscription. Please try again.");
    }
}