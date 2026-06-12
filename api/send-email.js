import axios from 'axios';

function esc(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getClientGeo(req) {
    const h = req.headers || {};
    const fwd = (h['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || h['x-real-ip'] || '';
    const dec = (v) => { try { return v ? decodeURIComponent(v) : ''; } catch { return v || ''; } };
    return {
        ip,
        city: dec(h['x-vercel-ip-city']),
        region: dec(h['x-vercel-ip-country-region']),
        country: h['x-vercel-ip-country'] || h['cf-ipcountry'] || '',
        timezone: h['x-vercel-ip-timezone'] || '',
    };
}

function fmtDuration(seconds) {
    const s = Number(seconds) || 0;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function renderLeadSource(attribution, geo, contact = {}) {
    if (!attribution || typeof attribution !== 'object') return '';
    const a = attribution;
    const ft = a.firstTouch || {};
    const lt = a.lastTouch || {};
    const dev = a.device || {};
    const sess = a.session || {};
    const clarity = a.clarity || {};
    const row = (label, value) =>
        value ? `<tr><td style="padding:3px 12px 3px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:3px 0;color:#222;">${esc(value)}</td></tr>` : '';
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
    const clickIds = [
        ft.fbclid || lt.fbclid ? 'Facebook / Meta (fbclid present)' : '',
        ft.gclid || lt.gclid ? 'Google Ads (gclid present)' : '',
        ft.msclkid || lt.msclkid ? 'Microsoft / Bing Ads (msclkid present)' : '',
        ft.ttclid || lt.ttclid ? 'TikTok (ttclid present)' : '',
    ].filter(Boolean).join('<br/>');
    const lastTouchDiffers =
        lt.timestamp && lt.timestamp !== ft.timestamp &&
        [lt.source, lt.medium, lt.campaign, lt.referrer].join('|') !==
            [ft.source, ft.medium, ft.campaign, ft.referrer].join('|');
    const geoStr = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
    const clarityLink = clarity.recordingsUrl
        ? `<p style="margin:6px 0 0;font-size:13px;"><a href="${esc(clarity.recordingsUrl)}" style="color:#185FA5;">Open Clarity recordings</a></p>` : '';
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
    const auditButton = `<p style="margin:10px 0 2px;"><a href="${esc(auditUrl)}" style="display:inline-block;background:#1a7f2c;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;">Audit this lead's journey</a></p>`;
    return `
        <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
        <h3 style="margin:0 0 4px;">Lead Source &amp; Journey</h3>
        <p style="margin:0 0 8px;font-size:18px;"><strong style="color:#1a7f2c;">${esc(a.leadSource || 'Unknown')}</strong></p>
        ${auditButton}
        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">First touch</p>
        <table style="font-size:13px;border-collapse:collapse;">${touchRows(ft) || '<tr><td style="color:#999;">No campaign data</td></tr>'}</table>
        ${lastTouchDiffers ? `<p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Last touch</p><table style="font-size:13px;border-collapse:collapse;">${touchRows(lt)}</table>` : ''}
        ${clickIds ? `<p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Ad click IDs</p><p style="margin:0;font-size:13px;">${clickIds}</p>` : ''}
        <p style="margin:14px 0 4px;font-weight:600;font-size:13px;color:#444;">Session &amp; device</p>
        <table style="font-size:13px;border-collapse:collapse;">
            ${row('Device', [dev.deviceType, dev.os, dev.browser].filter(Boolean).join(' · '))}
            ${row('Screen', dev.screen)}
            ${row('Language', dev.language)}
            ${row('Timezone', dev.timezone || geo.timezone)}
            ${row('Pages viewed', sess.pageViews)}
            ${row('Time on site', sess.secondsOnSite !== undefined ? fmtDuration(sess.secondsOnSite) : '')}
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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { firstName, lastName, email, phone, message, attribution } = req.body;

    try {
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

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
        const TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'info@collegeproduce.com';
        const geo = getClientGeo(req);
        const leadSourceSection = renderLeadSource(attribution, geo, { firstName, lastName, email });

        const customerThreadContent = `
            <h2>New inquiry from ${esc(firstName)} ${esc(lastName)}</h2>
            <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
            <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)}</p>
            <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            <p><strong>Phone:</strong> ${esc(phone) || 'Not provided'}</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
            <h3>Message</h3>
            <p>${message ? esc(message).replace(/\n/g, '<br/>') : 'No message provided.'}</p>
        `;

        const intelContent = `
            <h2>Lead intel - ${esc(firstName)} ${esc(lastName)}</h2>
            <p style="color:#b00020;font-size:12px;"><strong>Internal only.</strong></p>
            <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)} &middot; <strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            ${leadSourceSection}
        `;

        const thankyouEmailContent = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;line-height:1.6;">
                <h2 style="color:#f35a05;">Thank You for Contacting ExhibitPro</h2>
                <p>Hi ${esc(firstName)},</p>
                <p>Thank you for reaching out. We have received your inquiry and our support team will get back to you shortly.</p>
                <hr style="margin:30px 0;border:none;border-top:1px solid #ddd;">
                <p>Best regards,<br/><strong>ExhibitPro Support Team</strong></p>
                <p style="color:#999;font-size:12px;">ExhibitPro | Email: ${esc(TO_EMAIL)}</p>
            </div>
        `;

        const graphHeaders = {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        };
        const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${process.env.GRAPH_FROM_EMAIL}/sendMail`;

        await Promise.all([
            axios.post(sendMailUrl, {
                message: {
                    subject: `New inquiry from ${firstName} ${lastName}`,
                    body: { contentType: 'HTML', content: customerThreadContent },
                    toRecipients: [{ emailAddress: { address: TO_EMAIL } }],
                    replyTo: [{ emailAddress: { address: email, name: `${firstName} ${lastName}` } }],
                },
                saveToSentItems: false,
            }, graphHeaders),
            axios.post(sendMailUrl, {
                message: {
                    subject: `[Internal] Lead intel - ${firstName} ${lastName}`,
                    body: { contentType: 'HTML', content: intelContent },
                    toRecipients: [{ emailAddress: { address: TO_EMAIL } }],
                    replyTo: [{ emailAddress: { address: TO_EMAIL } }],
                },
                saveToSentItems: false,
            }, graphHeaders),
            axios.post(sendMailUrl, {
                message: {
                    subject: `We've Received Your Inquiry - ExhibitPro Support`,
                    body: { contentType: 'HTML', content: thankyouEmailContent },
                    toRecipients: [{ emailAddress: { address: email } }],
                    replyTo: [{ emailAddress: { address: TO_EMAIL, name: 'ExhibitPro Support' } }],
                },
                saveToSentItems: true,
            }, graphHeaders),
        ]);

        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Error sending email:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to send email' });
    }
}
