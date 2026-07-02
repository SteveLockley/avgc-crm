import type { APIRoute } from 'astro';
import { ensureSession } from '../../lib/touchoffice';

const BASE_URL = 'https://www.touchoffice.net';
const HOME_URL = BASE_URL + '/';
const EDIT_URL = BASE_URL + '/apps/editcustomers';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    const db = env?.DB;
    if (!db) return json({ error: 'No database' }, 500);

    const body = await request.json();
    const action = body.action || 'fetch';
    const customerNum = String(body.customer_num || '72');

    const { session } = await ensureSession(db, env);
    const cookie = `icrtouch_connect_login_id=${session}`;

    if (action === 'fetch') {
      // Try the editcustomerdetails endpoint directly with num=customerNum
      const detailsRes = await fetch(`${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`, {
        method: 'GET',
        headers: { 'Cookie': cookie },
      });
      const detailsHtml = await detailsRes.text();

      if (detailsHtml.includes('name="submit-login"')) {
        return json({ error: 'Session expired' }, 500);
      }

      // Full custgroup select (untruncated)
      const custgroupMatch = detailsHtml.match(new RegExp(`<select[^>]+name="customer_${customerNum}_custgroup"[^>]*>[\\s\\S]*?<\\/select>`, 'i'));
      // All inputs with values (including hidden)
      const allInputs = [...detailsHtml.matchAll(/<input[^>]+>/gi)].map(m => m[0]);
      const hiddenInputs = allInputs.filter(i => /type="hidden"/i.test(i));

      return json({
        status: detailsRes.status,
        url: detailsRes.url,
        htmlLength: detailsHtml.length,
        custgroupFull: custgroupMatch ? custgroupMatch[0] : null,
        hiddenInputs,
        allInputs,
        forms: [...detailsHtml.matchAll(/<form[^>]+>/gi)].map(m => m[0]),
        submitButtons: [...detailsHtml.matchAll(/<(input|button)[^>]+submit[^>]*>/gi)].map(m => m[0]),
      });
    }

    if (action === 'readwrite') {
      // Read all current form values, then POST them back with modifications
      const getRes = await fetch(`${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`, {
        method: 'GET',
        headers: { 'Cookie': cookie },
      });
      const html = await getRes.text();
      if (html.includes('name="submit-login"')) return json({ error: 'Session expired' }, 500);

      // Extract all input values from the editcustomerdetails form (id="top")
      const params = new URLSearchParams();

      // Parse all text/hidden inputs with name + value
      for (const match of html.matchAll(/<input[^>]+>/gi)) {
        const tag = match[0];
        const nameM = tag.match(/name="([^"]+)"/i);
        const valueM = tag.match(/value="([^"]*)"/i);
        const typeM = tag.match(/type="([^"]+)"/i);
        if (!nameM) continue;
        const type = typeM?.[1]?.toLowerCase() ?? 'text';
        if (type === 'submit' || type === 'button' || type === 'image') continue;
        params.set(nameM[1], valueM?.[1] ?? '');
      }

      // Parse select current values
      for (const match of html.matchAll(/<select[^>]+name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
        const selectName = match[1];
        const selectedM = match[2].match(/<option[^>]+selected[^>]*value="([^"]*)"/i);
        if (selectedM) params.set(selectName, selectedM[1]);
      }

      // Apply requested overrides
      if (body.firstname !== undefined) params.set(`customer_${customerNum}_firstname`, body.firstname);
      if (body.lastname !== undefined) params.set(`customer_${customerNum}_lastname`, body.lastname);
      if (body.longname !== undefined) params.set(`customer_${customerNum}_longname`, body.longname);
      if (body.accountnumber !== undefined) params.set(`customer_${customerNum}_accountnumber`, body.accountnumber);
      if (body.custgroup !== undefined) params.set(`customer_${customerNum}_custgroup`, String(body.custgroup));
      if (body.flag !== undefined) params.set(`customer_${customerNum}_flag`, String(body.flag));
      if (body.extra) {
        for (const [k, v] of Object.entries(body.extra as Record<string, string>)) params.set(k, v);
      }
      params.set('submit-savecustomer', 'Save Customer');

      // Log what we're sending for debugging
      const paramsDump = Object.fromEntries(params.entries());

      const writeRes = await fetch(`${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`, {
        method: 'POST',
        headers: {
          'Cookie': cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`,
        },
        body: params.toString(),
      });
      const writeHtml = await writeRes.text();
      const isLoginPage = writeHtml.includes('name="submit-login"');
      const errors = [...writeHtml.matchAll(/class="[^"]*error[^"]*"[^>]*>([\s\S]*?)<\//gi)].map(m => m[1].trim()).filter(Boolean);
      return json({ status: writeRes.status, url: writeRes.url, isLoginPage, errors, paramsDump, htmlSample: writeHtml.substring(0, 1000) });
    }

    if (action === 'write') {
      // Real format: field[{num}][{fieldname}] — only send fields being changed
      const params = new URLSearchParams();
      if (body.firstname !== undefined) params.set(`field[${customerNum}][firstname]`, body.firstname);
      if (body.lastname !== undefined) params.set(`field[${customerNum}][lastname]`, body.lastname);
      if (body.longname !== undefined) params.set(`field[${customerNum}][longname]`, body.longname);
      if (body.accountnumber !== undefined) params.set(`field[${customerNum}][accountnumber]`, body.accountnumber);
      if (body.custgroup !== undefined) params.set(`field[${customerNum}][custgroup]`, String(body.custgroup));
      if (body.flag !== undefined) params.set(`field[${customerNum}][flag]`, String(body.flag));
      params.set('submit-savecustomer', '');

      const writeRes = await fetch(`${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`, {
        method: 'POST',
        headers: {
          'Cookie': cookie,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/apps/editcustomerdetails?num=${encodeURIComponent(customerNum)}`,
        },
        body: params.toString(),
      });
      const writeHtml = await writeRes.text();
      const isLoginPage = writeHtml.includes('name="submit-login"');
      const errors = [...writeHtml.matchAll(/class="[^"]*error[^"]*"[^>]*>([\s\S]*?)<\//gi)].map(m => m[1].trim()).filter(Boolean);
      return json({ status: writeRes.status, url: writeRes.url, isLoginPage, errors, htmlSample: writeHtml.substring(0, 500) });
    }

    if (action === 'search') {
      // Search for a customer by name/account number to find their internal num
      const searchTerm = body.search_term || customerNum;
      const searchRes = await fetch(`${BASE_URL}/apps/jsoncustomers?search=${encodeURIComponent(searchTerm)}&limit=10`, {
        method: 'GET',
        headers: { 'Cookie': cookie },
      });
      const searchText = await searchRes.text();
      return json({ status: searchRes.status, url: searchRes.url, body: searchText.substring(0, 2000) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
