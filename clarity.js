/**
 * Microsoft Clarity integration (vanilla JS port of the ExhibitPro lib).
 * Loads the Clarity tag once, captures the session/user ids, and exposes
 * helpers for tagging the session so the team can find the recording that
 * belongs to a given lead.
 */

/** Microsoft Clarity project for ExhibitPro (https://clarity.microsoft.com). */
export const CLARITY_PROJECT_ID = "w3u90gbagv";

const CLARITY_SCRIPT_SELECTOR = `script[data-clarity="${CLARITY_PROJECT_ID}"]`;

// Session identifiers, captured from the `metadata` callback once the recording
// starts. May stay empty if the tag version does not surface metadata — in that
// case the custom `leadId` tag (set via setClarityTag) is the fallback the team
// filters recordings by.
const session = {};

/**
 * Initializes Microsoft Clarity once. Safe to call on every page load — the
 * script is only injected once.
 */
export function initClarity() {
    if (typeof window === "undefined") return;

    if (!document.querySelector(CLARITY_SCRIPT_SELECTOR) && !window.clarity) {
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.setAttribute("data-clarity", CLARITY_PROJECT_ID);
        script.text = `
      (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
    `;
        document.head.appendChild(script);
    }

    // Capture the real Clarity session/user ids when the recording reports them.
    try {
        window.clarity?.("metadata", (data) => {
            if (data?.sessionId) session.sessionId = data.sessionId;
            if (data?.userId) session.userId = data.userId;
        });
    } catch {
        /* metadata callback unsupported on this tag version — ignore */
    }
}

/**
 * Sets a custom tag (dimension) on the current Clarity session. Filterable in
 * the Clarity dashboard, so tagging with a stable `leadId` (and later the
 * lead's email) lets the team find the exact recording.
 */
export function setClarityTag(key, value) {
    if (typeof window === "undefined" || !value) return;
    try {
        window.clarity?.("set", key, value);
    } catch {
        /* clarity not ready — calls before load are queued by the tag itself */
    }
}

/** Associates the current session with a user identifier (e.g. lead email). */
export function identifyClarity(userId) {
    if (typeof window === "undefined" || !userId) return;
    try {
        window.clarity?.("identify", userId);
    } catch {
        /* ignore */
    }
}

/** Clarity session ids captured so far (empty until the recording starts). */
export function getClaritySession() {
    return { ...session };
}

/** Link to the Clarity recordings dashboard for this project. */
export function getClarityRecordingsUrl() {
    return `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/impressions`;
}
