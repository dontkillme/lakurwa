// La Kurwa - storage / cookie notice. Shown before the game (or the editor) starts and before
// anything is written to the browser's storage. Only the consent key itself is read to remember the choice.
'use strict';

LK.CONSENT_KEY = 'lakurwa_consent';
LK.consent = {
  given() {
    try { return localStorage.getItem(LK.CONSENT_KEY) === 'yes'; } catch (e) { return false; }
  },
  store() {
    try { localStorage.setItem(LK.CONSENT_KEY, 'yes'); } catch (e) { /* storage blocked: the game still runs, saving just fails */ }
  },
  // run onAccept once the player agreed (now, or after clicking Accept)
  gate(onAccept) {
    // dev/screenshots: #consent=yes accepts without the dialog
    if (/consent=yes/.test(location.hash)) this.store();
    if (this.given()) { onAccept(); return; }
    const el = document.createElement('div');
    el.id = 'consent';
    el.className = 'overlay consent';
    document.body.appendChild(el);
    const ask = () => {
      el.innerHTML =
        '<div class="box">' +
        '<h2>' + LK.t('consent.title') + '</h2>' + LK.t('consent.html') +
        '<div class="row"><button id="consentYes">' + LK.t('consent.accept') + '</button><button id="consentNo">' + LK.t('consent.reject') + '</button></div>' +
        '</div>';
      el.querySelector('#consentYes').onclick = () => { this.store(); el.remove(); onAccept(); };
      el.querySelector('#consentNo').onclick = () => {
        el.innerHTML = '<div class="sad">' + LK.t('consent.sad') +
          '<button id="consentAgain">' + LK.t('consent.again') + '</button></div>';
        el.querySelector('#consentAgain').onclick = ask;
      };
    };
    ask();
    if (/consent=no/.test(location.hash)) el.querySelector('#consentNo').click();   // dev/screenshots: the rejected screen
  }
};
