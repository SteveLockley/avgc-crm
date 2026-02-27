/**
 * Google Business Profile Proxy for Alnmouth Village Golf Club
 *
 * Deploy as a Google Apps Script Web App to bypass GBP API quota restrictions.
 * The script runs under your Google account's auth, which has internal access
 * to the Business Profile API without needing external API quota.
 *
 * Setup:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this code into Code.gs
 * 3. Update LOCATION_ID and SECRET below
 * 4. Click the gear icon (Project Settings) > Show "appsscript.json" manifest
 * 5. Edit appsscript.json and add the oauthScopes (see appsscript.json file)
 * 6. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 7. Copy the Web App URL and set it as GOOGLE_APPS_SCRIPT_URL in Cloudflare
 * 8. Set GOOGLE_APPS_SCRIPT_SECRET in Cloudflare to match SECRET below
 */

// ---- CONFIGURATION ----
var SECRET = 'CHANGE_ME_TO_A_RANDOM_STRING';
var LOCATION_ID = 'locations/15092971616152238065';
// ---- END CONFIGURATION ----

var API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1/';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    switch (data.action) {
      case 'getProfile':
        return getProfile();
      case 'updateProfile':
        return updateProfile(data.payload);
      case 'updateHours':
        return updateHours(data.payload);
      case 'updateSpecialHours':
        return updateSpecialHours(data.payload);
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + data.action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) });
  }
}

function getProfile() {
  var url = API_BASE + LOCATION_ID + '?readMask=title,profile,phoneNumbers,websiteUri';
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return jsonResponse({ success: false, error: 'Google API error (' + response.getResponseCode() + '): ' + response.getContentText() });
  }

  var result = JSON.parse(response.getContentText());
  return jsonResponse({
    success: true,
    data: {
      title: result.title || '',
      description: (result.profile && result.profile.description) || '',
      primaryPhone: (result.phoneNumbers && result.phoneNumbers.primaryPhone) || '',
      websiteUri: result.websiteUri || ''
    }
  });
}

function updateProfile(payload) {
  var body = {};
  var masks = [];

  if (payload.description !== undefined) {
    body.profile = { description: payload.description };
    masks.push('profile.description');
  }
  if (payload.primaryPhone !== undefined) {
    body.phoneNumbers = { primaryPhone: payload.primaryPhone };
    masks.push('phoneNumbers.primaryPhone');
  }
  if (payload.websiteUri !== undefined) {
    body.websiteUri = payload.websiteUri;
    masks.push('websiteUri');
  }

  if (masks.length === 0) {
    return jsonResponse({ success: false, error: 'No fields to update' });
  }

  var url = API_BASE + LOCATION_ID + '?updateMask=' + masks.join(',');
  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return jsonResponse({ success: false, error: 'Google API error (' + response.getResponseCode() + '): ' + response.getContentText() });
  }

  return jsonResponse({ success: true });
}

function updateHours(payload) {
  var url = API_BASE + LOCATION_ID + '?updateMask=regularHours';
  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ regularHours: payload.regularHours }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return jsonResponse({ success: false, error: 'Google API error (' + response.getResponseCode() + '): ' + response.getContentText() });
  }

  return jsonResponse({ success: true });
}

function updateSpecialHours(payload) {
  var url = API_BASE + LOCATION_ID + '?updateMask=specialHours';
  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ specialHours: payload.specialHours }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return jsonResponse({ success: false, error: 'Google API error (' + response.getResponseCode() + '): ' + response.getContentText() });
  }

  return jsonResponse({ success: true });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Test function - run this manually in the script editor to verify it works
function testGetProfile() {
  var result = getProfile();
  Logger.log(result.getContent());
}
