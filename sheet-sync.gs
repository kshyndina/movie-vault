/**
 * Movie Vault — Google Sheet sync endpoint.
 *
 * ONE-TIME SETUP (about 2 minutes, the only manual step in the whole project):
 *  1. Open the Google Sheet you want to use (or sheets.new) on kate.shyndina@gmail.com.
 *  2. Extensions > Apps Script. Delete any code, paste THIS file, Save.
 *  3. Deploy > New deployment > type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Deploy, authorize, and COPY the Web app URL (ends in /exec).
 *  4. In the Movie Vault site: "My data" > paste that URL into the sync box.
 *
 * After that, every Seen / Like / Dislike is appended to the "log" tab automatically,
 * and a deduped "library" tab shows your current verdict per film.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var log = ss.getSheetByName('log');
    if (!log) {
      log = ss.insertSheet('log');
      log.appendRow(['timestamp', 'imdb_id', 'title', 'year', 'action', 'seen', 'rating', 'why']);
    }
    log.appendRow([data.ts || new Date().toISOString(), data.id, data.title, data.year,
                   data.action, data.seen, data.rate, data.why]);

    // upsert into a deduped "library" view
    var lib = ss.getSheetByName('library');
    if (!lib) {
      lib = ss.insertSheet('library');
      lib.appendRow(['imdb_id', 'title', 'year', 'seen', 'rating', 'why', 'updated']);
    }
    var ids = lib.getRange(2, 1, Math.max(lib.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
    var row = ids.indexOf(data.id);
    var values = [data.id, data.title, data.year, data.seen, data.rate, data.why, data.ts || new Date().toISOString()];
    if (row === -1) lib.appendRow(values);
    else lib.getRange(row + 2, 1, 1, values.length).setValues([values]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('Movie Vault sync endpoint is live. POST actions here.');
}
