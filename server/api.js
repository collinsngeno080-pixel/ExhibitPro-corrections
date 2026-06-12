import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(compression());
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;

// Escape user/referrer-controlled strings before embedding them in email HTML.
export function esc(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Resolve approximate geo + client IP from common proxy headers (Vercel,
// Cloudflare). No external lookup — falls back to the client-reported timezone.
export function getClientGeo(req) {
    const h = req.headers || {};
    const fwd = (h['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || h['x-real-ip'] || req.socket?.remoteAddress || '';
    const dec = (v) => {
        try { return v ? decodeURIComponent(v) : ''; } catch { return v || ''; }
    };
    return {
        ip,
        city: dec(h['x-vercel-ip-city']),
        region: dec(h['x-vercel-ip-country-region']),
        country: h['x-vercel-ip-country'] || h['cf-ipcountry'] || '',
        timezone: h['x-vercel-ip-timezone'] || '',
    };
}

export function fmtDuration(seconds) {
    const s = Number(seconds) || 0;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// Renders the "Lead Source & Journey" block for the internal notification email.
// Returns '' when no attribution was sent (older clients / direct API calls).
export function renderLeadSource(attribution, geo, contact = {}) {
    if (!attribution || typeof attribution !== 'object') return '';

    const a = attribution;
    const ft = a.firstTouch || {};
    const lt = a.lastTouch || {};
    const dev = a.device || {};
    const sess = a.session || {};
    const clarity = a.clarity || {};

    const row = (label, value) =>
        value
            ? `<tr><td style="padding:3px 12px 3px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:3px 0;color:#222;">${esc(value)}</td></tr>`
            : '';

    const touchRows = (t) => {
        const campaign = [t.source, t.medium, t.campaign].filter(Boolean).join(' / ');
        return [
            row('Campaign', campaign),
            row('Term / Content', [t.term, t.content].filter(Boolean).join(' / ')),
            row('Referrer', t.referrer),
            row('Landing page', t.landingPage),
            row('When', t.timestamp),
        ].join('');
    };

    // Ad click ids — strong signal of which paid channel the lead came through.
    const clickIds = [
        ft.fbclid || lt.fbclid ? 'Facebook / Meta (fbclid present)' : '',
        ft.gclid || lt.gclid ? 'Google Ads (gclid present)' : '',
        ft.msclkid || lt.msclkid ? 'Microsoft / Bing Ads (msclkid present)' : '',
        ft.ttclid || lt.ttclid ? 'TikTok (ttclid present)' : '',
    ].filter(Boolean).join('<br/>');

    // Last touch is only worth showing if it differs from first touch.
    const lastTouchDiffers =
        lt.timestamp && lt.timestamp !== ft.timestamp &&
        [lt.source, lt.medium, lt.campaign, lt.referrer].join('|') !==
            [ft.source, ft.medium, ft.campaign, ft.referrer].join('|');

    const geoStr = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');

    const clarityLink = clarity.recordingsUrl
        ? `<p style="margin:6px 0 0;font-size:13px;">
                <a href="${esc(clarity.recordingsUrl)}" style="color:#185FA5;">Open Clarity recordings</a>
                — filter by custom tag <strong>leadId = ${esc(clarity.leadIdTag)}</strong> to watch this lead's session.
           </p>`
        : '';

    // Deep link that opens the Journey Audit tool pre-filled with what we know
    // about this lead — source, entry touchpoints, identity, Clarity handle.
    // Standalone Journey Audit tool URL (its own Vercel project) — generic
    // *.vercel.app domain; override via TOOLS_PUBLIC_URL once Vercel assigns it.
    const toolBase = (process.env.TOOLS_PUBLIC_URL || 'https://exhibitpro-journey-audit.vercel.app').replace(/\/+$/, '');
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
    const auditParams = new URLSearchParams();
    if (name) auditParams.set('name', name);
    if (contact.email) auditParams.set('email', contact.email);
    if (a.leadSource) auditParams.set('src', a.leadSource);
    const ftCampaign = [ft.source, ft.medium, ft.campaign].filter(Boolean).join(' / ');
    if (ftCampaign) auditParams.set('campaign', ftCampaign);
    const deviceStr = [dev.deviceType, dev.os, dev.browser].filter(Boolean).join(' · ');
    if (deviceStr) auditParams.set('device', deviceStr);
    if (ft.timestamp) auditParams.set('ts', ft.timestamp);
    if (clarity.leadIdTag) auditParams.set('leadId', clarity.leadIdTag);
    if (clarity.recordingsUrl) auditParams.set('clarity', clarity.recordingsUrl);
    const auditUrl = `${toolBase}/?${auditParams.toString()}`;

    const auditButton = `
        <p style="margin:10px 0 2px;">
            <a href="${esc(auditUrl)}" style="display:inline-block;background:#1a7f2c;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;">Audit this lead's journey</a>
        </p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;">Opens the Journey Audit tool pre-filled with this lead's source &amp; entry touchpoints. Add what happened next, then Analyze.</p>`;

    return `
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
        <h3 style="margin:0 0 4px;">Lead Source &amp; Journey</h3>
        <p style="margin:0 0 8px;font-size:18px;">
            <strong style="color:#1a7f2c;">${esc(a.leadSource || 'Unknown')}</strong>
        </p>
        ${auditButton}

        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">First touch — how they originally arrived</p>
        <table style="font-size:13px;border-collapse:collapse;">${touchRows(ft) || '<tr><td style="color:#999;">No campaign data captured</td></tr>'}</table>

        ${lastTouchDiffers ? `
        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Last touch — most recent visit before contacting</p>
        <table style="font-size:13px;border-collapse:collapse;">${touchRows(lt)}</table>` : ''}

        ${clickIds ? `
        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Ad click IDs</p>
        <p style="margin:0;font-size:13px;color:#222;">${clickIds}</p>` : ''}

        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Session &amp; device</p>
        <table style="font-size:13px;border-collapse:collapse;">
            ${row('Device', [dev.deviceType, dev.os, dev.browser].filter(Boolean).join(' · '))}
            ${row('Screen', dev.screen)}
            ${row('Language', dev.language)}
            ${row('Timezone', dev.timezone || geo.timezone)}
            ${row('Pages viewed', sess.pageViews)}
            ${row('Time on site', sess.secondsOnSite !== undefined ? fmtDuration(sess.secondsOnSite) : '')}
            ${row('First seen', sess.firstSeen)}
            ${row('Submitted from', sess.currentPage)}
            ${row('Location', geoStr)}
            ${row('IP', geo.ip)}
        </table>

        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Microsoft Clarity</p>
        <table style="font-size:13px;border-collapse:collapse;">
            ${row('Lead ID', clarity.leadIdTag)}
            ${row('Clarity session', clarity.sessionId)}
        </table>
        ${clarityLink}
    `;
}

app.post('/api/send-email', async (req, res) => {
    const { firstName, lastName, email, phone, message, attribution } = req.body;

    try {
        // Validate required fields
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // 1. Get Access Token from Azure AD
        const tokenResponse = await axios.post(
            `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: process.env.AZURE_CLIENT_ID,
                client_secret: process.env.AZURE_CLIENT_SECRET,
                scope: 'https://graph.microsoft.com/.default',
                grant_type: 'client_credentials',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const accessToken = tokenResponse.data.access_token;

        // The mailbox the inquiry + lead-intel emails are delivered to. Override
        // via CONTACT_TO_EMAIL; defaults to the ExhibitPro support inbox.
        const TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'info@collegeproduce.com';

        // Customer-journey attribution (source, device, Clarity session) + geo.
        const geo = getClientGeo(req);
        const leadSourceSection = renderLeadSource(attribution, geo, { firstName, lastName, email });

        // 2. Construct Email Data — the staff inbox gets TWO separate emails so
        // internal tracking can never leak to the customer:
        //  (a) customerThreadContent — clean body (no journey/Clarity data) with
        //      Reply-To set to the customer. This is the email staff REPLY to;
        //      because the body has nothing internal, the quoted reply is safe.
        //  (b) intelContent — the lead-source/Clarity/device data, Reply-To kept
        //      on the support inbox so replies stay internal even if someone hits Reply.
        const customerThreadContent = `
            <h2>New inquiry from ${esc(firstName)} ${esc(lastName)}</h2>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <h3>Customer Information</h3>
            <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)}</p>
            <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            <p><strong>Phone:</strong> ${esc(phone) || 'Not provided'}</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <h3>Message</h3>
            <p>${message ? esc(message).replace(/\n/g, '<br/>') : 'No message provided.'}</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
                <strong>Reply</strong> to this email to respond directly to ${esc(firstName)}
                (<a href="mailto:${esc(email)}">${esc(email)}</a>) — their address is the reply recipient and this
                email carries no internal tracking, so nothing internal is quoted to them. Lead-source &amp; session
                details are in the separate internal "Lead intel" email. A thank-you has also been sent to the
                customer automatically; their replies to it arrive in the ${esc(TO_EMAIL)} inbox.
            </p>
        `;

        const intelContent = `
            <h2>Lead intel - ${esc(firstName)} ${esc(lastName)}</h2>
            <p style="color:#b00020;font-size:12px;margin:0 0 8px;">
                <strong>Internal only.</strong> Do not reply to the customer from this email — replies stay internal
                (${esc(TO_EMAIL)}). To respond to ${esc(firstName)}, use the
                "New inquiry from ${esc(firstName)} ${esc(lastName)}" email instead.
            </p>
            <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)} &middot;
               <strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            ${leadSourceSection}
        `;

        const thankyouEmailContent = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; color: #333; line-height: 1.6;">
                <h2 style="color: #1a7f2c;">Thank You for Contacting ExhibitPro</h2>
                <p>Hi ${esc(firstName)},</p>
                <p>Thank you for reaching out to ExhibitPro. We have received your inquiry and appreciate the opportunity to assist you.</p>
                <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #1a7f2c; margin: 20px 0;">
                    <p><strong>What happens next:</strong></p>
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li>Our support team will review your message</li>
                        <li>We'll get back to you shortly with a response or next steps</li>
                        <li>Feel free to reply to this email with any additional details</li>
                    </ul>
                </div>
                <p>If you have any urgent concerns or additional information to share, simply reply to this email and it will go directly to our team at <strong>${esc(TO_EMAIL)}</strong>.</p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                <p>Best regards,<br/><strong>ExhibitPro Support Team</strong></p>
                <p style="color: #999; font-size: 12px; margin-top: 20px;">
                    ExhibitPro | Fort Myers, FL 33901<br/>
                    Phone: 239-332-3369<br/>
                    Email: ${esc(TO_EMAIL)}
                </p>
            </div>
        `;

        // Send inquiry to company emails, and thank you to user.
        // Each send is labeled so a per-mailbox failure can be identified
        // (Graph's ErrorMailboxConfiguration doesn't say which mailbox is at fault).
        const graphHeaders = {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        };
        const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${process.env.GRAPH_FROM_EMAIL}/sendMail`;
        // NOTE: always send AS GRAPH_FROM_EMAIL — Graph requires a real licensed
        // mailbox as the sending principal; a receive-only alias must not be used.
        const emailPromises = [
            // (a) Clean customer-thread email -> support inbox. Reply-To is the customer
            // and the body has NO journey/Clarity data, so replying in Outlook
            // reaches the customer without quoting any internal tracking.
            { label: `customer-thread to ${TO_EMAIL} (as ${process.env.GRAPH_FROM_EMAIL})`, send: axios.post(
                sendMailUrl,
                {
                    message: {
                        subject: `Your inquiry to ExhibitPro - ${firstName} ${lastName}`,
                        body: { contentType: 'HTML', content: customerThreadContent },
                        toRecipients: [{ emailAddress: { address: TO_EMAIL } }],
                        replyTo: [{ emailAddress: { address: email, name: `${firstName} ${lastName}` } }],
                    },
                    saveToSentItems: false,
                },
                graphHeaders
            ) },
            // (b) Internal lead-intel email -> support inbox. Reply-To stays internal so the
            // journey/Clarity data can never be quoted to the customer, even if
            // someone hits Reply by mistake.
            { label: `lead-intel to ${TO_EMAIL} (as ${process.env.GRAPH_FROM_EMAIL})`, send: axios.post(
                sendMailUrl,
                {
                    message: {
                        subject: `[Internal] Lead intel - ${firstName} ${lastName}`,
                        body: { contentType: 'HTML', content: intelContent },
                        toRecipients: [{ emailAddress: { address: TO_EMAIL } }],
                        replyTo: [{ emailAddress: { address: TO_EMAIL, name: 'CP Info' } }],
                    },
                    saveToSentItems: false,
                },
                graphHeaders
            ) },
            // (c) Thank-you to the customer. Reply-To is the support inbox so customer replies
            // land in the support inbox.
            { label: `thank-you to customer (as ${process.env.GRAPH_FROM_EMAIL})`, send: axios.post(
                sendMailUrl,
                {
                    message: {
                        subject: `We've Received Your Inquiry - ExhibitPro Support`,
                        body: { contentType: 'HTML', content: thankyouEmailContent },
                        toRecipients: [{ emailAddress: { address: email } }],
                        replyTo: [{ emailAddress: { address: TO_EMAIL, name: 'ExhibitPro Support' } }],
                    },
                    saveToSentItems: true,
                },
                graphHeaders
            ) }
        ];

        // Use allSettled so one misconfigured mailbox doesn't hide the others.
        const results = await Promise.allSettled(emailPromises.map((e) => e.send));

        const failures = results
            .map((result, i) => ({ label: emailPromises[i].label, result }))
            .filter((r) => r.result.status === 'rejected');

        if (failures.length > 0) {
            failures.forEach(({ label, result }) => {
                console.error(
                    `Email send failed [${label}]:`,
                    result.reason?.response?.data || result.reason?.message
                );
            });
            return res.status(500).json({
                success: false,
                error: 'Failed to send one or more emails',
                failed: failures.map((f) => f.label),
                details: process.env.NODE_ENV === 'development'
                    ? failures.map((f) => f.result.reason?.response?.data || f.result.reason?.message)
                    : undefined,
            });
        }

        res.status(200).json({ success: true, message: 'Inquiry received and thank you email sent successfully' });

    } catch (error) {
        console.error('Error sending email:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to send email',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Serve the static site.
app.use(express.static(path.join(__dirname, '../'), { maxAge: '1h' }));

// Fallback - serve index.html for any non-API route.
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, '../index.html'), (err) => {
            if (err) {
                console.error('Error serving index.html:', err.message);
                res.status(404).json({ error: 'Not found', details: err.message });
            }
        });
    }
});

// Only start listening when run directly (`node server/api.js`), not when this
// module is imported (e.g. by tests of the render helpers above).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    app.listen(PORT, () => {
        console.log(`Contact-form API running on http://localhost:${PORT}`);
    });
}

export default app;
