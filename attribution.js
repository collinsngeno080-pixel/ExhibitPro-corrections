/**
 * Customer-journey attribution (vanilla JS port of the ExhibitPro lib).
 *
 * Captures how a lead found ExhibitPro (UTM params, ad click ids, referrer,
 * landing page), the device/session context, and a handle to the Microsoft
 * Clarity recording — then hands the whole bundle to the contact form so every
 * inbound support email shows the lead's origin.
 *
 * First-touch (how they originally arrived) is written once and never
 * overwritten. Last-touch is refreshed whenever a new campaign signal appears.
 */

import {
    setClarityTag,
    getClaritySession,
    getClarityRecordingsUrl,
} from "./clarity.js";

const KEY = {
    leadId: "ep_lead_id",
    first: "ep_attr_first",
    last: "ep_attr_last",
    firstSeen: "ep_first_seen",
    sessionStart: "ep_session_start", // sessionStorage
    pageViews: "ep_page_views", // sessionStorage
};

// ---- storage helpers (never throw — private mode / disabled storage) --------

function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch { /* ignore */ }
}
function ssGet(k) {
    try { return window.sessionStorage.getItem(k); } catch { return null; }
}
function ssSet(k, v) {
    try { window.sessionStorage.setItem(k, v); } catch { /* ignore */ }
}

function uuid() {
    try {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    } catch { /* fall through */ }
    return "lead-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---- capture ----------------------------------------------------------------

function readTouch() {
    const params = new URLSearchParams(window.location.search);
    const p = (k) => params.get(k)?.trim() || "";
    return {
        source: p("utm_source"),
        medium: p("utm_medium"),
        campaign: p("utm_campaign"),
        term: p("utm_term"),
        content: p("utm_content"),
        referrer: document.referrer || "",
        landingPage: window.location.href,
        fbclid: p("fbclid"),
        gclid: p("gclid"),
        msclkid: p("msclkid"),
        ttclid: p("ttclid"),
        timestamp: new Date().toISOString(),
    };
}

/** True if the touch carries any paid/campaign signal worth re-attributing to. */
function hasCampaignSignal(t) {
    return Boolean(
        t.source || t.medium || t.campaign || t.fbclid || t.gclid || t.msclkid || t.ttclid
    );
}

function getDeviceInfo() {
    const ua = navigator.userAgent || "";
    const isTablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua);
    const isMobile = !isTablet && /Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua);

    let browser = "Unknown";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";

    let os = "Unknown";
    if (/Windows/i.test(ua)) os = "Windows";
    else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Mac OS X/i.test(ua)) os = "macOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Linux/i.test(ua)) os = "Linux";

    let timezone = "";
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch { /* ignore */ }

    return {
        userAgent: ua,
        deviceType: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
        browser,
        os,
        screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        language: navigator.language || "",
        timezone,
    };
}

/**
 * Derives a human-friendly lead-source label from the campaign and referrer
 * signals — the headline answer to "where did this lead come from?".
 */
export function deriveLeadSource(first, last) {
    // Prefer the touch that actually carries a signal; first-touch wins ties.
    const t = hasCampaignSignal(first) ? first : hasCampaignSignal(last) ? last : first;
    const src = t.source.toLowerCase();
    const med = t.medium.toLowerCase();
    const isPaid = /cpc|ppc|paid|ads?|cpm/.test(med);

    if (t.fbclid || /facebook|meta|fb/.test(src)) return "Facebook / Meta Ad";
    if (/instagram|^ig$/.test(src)) return isPaid ? "Instagram Ad" : "Instagram";
    if (t.gclid || (/google/.test(src) && isPaid)) return "Google Ads";
    if (t.msclkid || (/bing|microsoft/.test(src) && isPaid)) return "Microsoft / Bing Ads";
    if (t.ttclid || /tiktok/.test(src)) return "TikTok";
    if (/linkedin/.test(src)) return isPaid ? "LinkedIn Ad" : "LinkedIn";
    if (/qr/.test(src) || /qr/.test(med)) return "QR Code";
    if (/email|newsletter|mailchimp|klaviyo/.test(src) || med === "email")
        return "Email Campaign";
    if (t.source) return med ? `${t.source} / ${t.medium}` : t.source;

    // No campaign signal — classify by referrer.
    const ref = (first.referrer || last.referrer || "").toLowerCase();
    if (!ref) return "Direct / Unknown";
    let host = ref;
    try {
        host = new URL(ref).hostname;
    } catch { /* keep raw */ }
    if (/google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\./.test(host)) return "Organic Search";
    if (/facebook\.|fb\.|instagram\./.test(host)) return "Facebook / Instagram (organic)";
    if (/t\.co|twitter\.|x\.com/.test(host)) return "X / Twitter";
    if (/linkedin\./.test(host)) return "LinkedIn (organic)";
    if (/youtube\.|youtu\.be/.test(host)) return "YouTube";
    if (/exhibitpro\.|collegeproduce\./.test(host)) return "Direct / Landing page";
    return `Referral (${host})`;
}

/**
 * Runs on load. Establishes the lead id, persists first/last touch, counts the
 * session, and pushes the key signals into Clarity as filterable custom tags.
 * Never throws.
 */
export function captureAttribution() {
    if (typeof window === "undefined") return;
    try {
        // Stable per-visitor id, also pushed to Clarity so recordings are findable.
        let leadId = lsGet(KEY.leadId);
        if (!leadId) {
            leadId = uuid();
            lsSet(KEY.leadId, leadId);
        }
        setClarityTag("leadId", leadId);

        const nowIso = new Date().toISOString();
        if (!lsGet(KEY.firstSeen)) lsSet(KEY.firstSeen, nowIso);
        if (!ssGet(KEY.sessionStart)) ssSet(KEY.sessionStart, nowIso);

        const views = Number(ssGet(KEY.pageViews) || "0") + 1;
        ssSet(KEY.pageViews, String(views));

        const touch = readTouch();

        // First touch is write-once.
        if (!lsGet(KEY.first)) lsSet(KEY.first, JSON.stringify(touch));

        // Last touch refreshes on a new campaign signal, or if never set.
        if (hasCampaignSignal(touch) || !lsGet(KEY.last)) {
            lsSet(KEY.last, JSON.stringify(touch));
        }

        // Make the session filterable in Clarity by its source.
        const first = readStoredTouch(KEY.first) || touch;
        const last = readStoredTouch(KEY.last) || touch;
        setClarityTag("lead_source", deriveLeadSource(first, last));
        if (touch.source) setClarityTag("utm_source", touch.source);
        if (touch.campaign) setClarityTag("utm_campaign", touch.campaign);
    } catch {
        /* attribution must never break the page */
    }
}

function readStoredTouch(key) {
    const raw = lsGet(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

const EMPTY_TOUCH = {
    source: "",
    medium: "",
    campaign: "",
    term: "",
    content: "",
    referrer: "",
    landingPage: "",
    fbclid: "",
    gclid: "",
    msclkid: "",
    ttclid: "",
    timestamp: "",
};

/**
 * Assembles the full attribution payload to attach to a form submission.
 * Tags the Clarity session with the lead's email and returns everything the
 * backend needs to render the "Lead Source" block. Never throws.
 */
export function getAttribution(email) {
    const safe = (fn, fallback) => {
        try { return fn(); } catch { return fallback; }
    };

    const leadId = lsGet(KEY.leadId) || "";
    const first = readStoredTouch(KEY.first) || { ...EMPTY_TOUCH };
    const last = readStoredTouch(KEY.last) || first;

    if (email) setClarityTag("lead_email", email);

    const sessionStart = ssGet(KEY.sessionStart) || lsGet(KEY.firstSeen) || new Date().toISOString();
    const secondsOnSite = safe(
        () => Math.max(0, Math.round((Date.now() - new Date(sessionStart).getTime()) / 1000)),
        0
    );

    const claritySession = getClaritySession();

    return {
        leadId,
        leadSource: safe(() => deriveLeadSource(first, last), "Unknown"),
        firstTouch: first,
        lastTouch: last,
        device: safe(getDeviceInfo, {
            userAgent: "",
            deviceType: "desktop",
            browser: "Unknown",
            os: "Unknown",
            screen: "",
            viewport: "",
            language: "",
            timezone: "",
        }),
        session: {
            firstSeen: lsGet(KEY.firstSeen) || sessionStart,
            sessionStart,
            secondsOnSite,
            pageViews: Number(ssGet(KEY.pageViews) || "1"),
            currentPage: window.location.pathname,
        },
        clarity: {
            leadIdTag: leadId,
            userId: claritySession.userId,
            sessionId: claritySession.sessionId,
            recordingsUrl: getClarityRecordingsUrl(),
        },
    };
}
