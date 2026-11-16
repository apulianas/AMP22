'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const heading = '### macOS installation and Gatekeeper';
const macNotice = `${heading}

AMP22 is not Apple Developer ID signed or notarized. New builds use free ad-hoc signing, which does **not** establish a trusted developer identity or bypass Gatekeeper. Previously published installers are unchanged.

Download the correct official AMP22 DMG (arm64 for Apple Silicon, x64 for Intel), open it, drag **AMP22** into **Applications**, and eject the disk image. If macOS blocks the app, **only if you trust this official AMP22 GitHub release**, open **Terminal** (Applications > Utilities, or search for Terminal with Spotlight), paste this exact command, and press Return:

\`\`\`sh
xattr -dr com.apple.quarantine /Applications/AMP22.app
\`\`\`

Then open AMP22 from Applications. This removes downloaded-app quarantine from **AMP22 only**, allowing it to bypass that Gatekeeper check; it does not notarize the app or make it Apple-trusted. Do not disable Gatekeeper globally or use this for an untrusted download. If Terminal reports an error, confirm AMP22 is in Applications and do not blindly add \`sudo\`.
`;

const windowsNotice = `### Windows installation and SmartScreen

Download the Windows x64 **AMP22.Setup.<version>.exe** installer from this official GitHub release. Quit AMP22 before updating, then run the installer and follow its prompts.

AMP22 does not have a trusted Windows code-signing certificate. Microsoft Defender SmartScreen may show **Windows protected your PC**, an unrecognized-app warning, or an **Unknown publisher**. **Only if you trust this official AMP22 GitHub download**, choose **More info -> Run anyway** if offered. This is an exception for this installer, not proof that it is Microsoft-trusted. If that option is unavailable or your organization's policy blocks installation, stop and contact your administrator. Do not disable SmartScreen, antivirus, or organizational security controls.
`;

const notice = `${macNotice}\n${windowsNotice}`;

function addNotice(body) {
  assert.equal(typeof body, 'string', 'Expected release description text');
  const missing = [];
  if (!/^#{1,6}[ \t]+macOS installation and Gatekeeper[ \t]*\r?$/m.test(body)) missing.push(macNotice);
  if (!/^#{1,6}[ \t]+Windows installation and SmartScreen[ \t]*\r?$/m.test(body)) missing.push(windowsNotice);
  return missing.length ? `${missing.join('\n')}\n${body}` : body;
}

if (require.main === module) {
  const input = process.argv[2];
  if (input === '--release-json') {
    const release = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(addNotice(release.body));
  } else if (input) {
    fs.writeFileSync(input, addNotice(fs.readFileSync(input, 'utf8')));
  } else {
    process.stdout.write(notice);
  }
}

module.exports = { notice, addNotice };
