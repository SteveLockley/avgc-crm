// Email telling members a document (usually minutes) has been published.
// Kept plain with a single link: BT and similar providers mark button-heavy
// bulk mail as spam.

const MINUTES_PAGE_URL = 'https://www.alnmouthvillage.golf/members/documents/minutes';

export interface NoticeDocument {
  title: string;
  category: string;
  document_url: string;
  document_date: string;
}

function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

function formatLongDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
  return `${weekday} ${formatShortDate(dateStr)}`;
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });
}

export function generateDocumentNoticeSubject(doc: NoticeDocument): string {
  if (doc.category === 'Committee') return `AVGC Committee minutes — ${formatShortDate(doc.document_date)}`;
  if (doc.category === 'AGM') return `AVGC AGM minutes — ${formatShortDate(doc.document_date)}`;
  return `AVGC — ${doc.title}`;
}

export function generateDocumentNoticeEmail(doc: NoticeDocument): string {
  const link = escapeHtml(doc.document_url);
  const intro = doc.category === 'Committee'
    ? `The minutes of the committee meeting held on ${formatLongDate(doc.document_date)} are now available.`
    : doc.category === 'AGM'
      ? `The minutes of the AGM held on ${formatLongDate(doc.document_date)} are now available.`
      : `${escapeHtml(doc.title)} is now available.`;
  const linkText = doc.category === 'General' ? 'View the document' : 'Read the minutes';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(generateDocumentNoticeSubject(doc))}</title></head>
<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;">
<p>Dear Member,</p>
<p>${intro}</p>
<p><a href="${link}">${linkText}</a></p>
<p>All committee and AGM minutes are kept in the Members' area of the website under Documents &gt; Meeting Minutes: <a href="${MINUTES_PAGE_URL}">${MINUTES_PAGE_URL}</a></p>
<p>Kind regards,<br>Alnmouth Village Golf Club Committee</p>
</body></html>`;
}
