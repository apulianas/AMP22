'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const macNotice = `### macOS installation

Download the AMP22 DMG for your Mac (**arm64** for Apple Silicon, **x64** for Intel), open it, drag **AMP22** into **Applications**, and eject the disk image. Quit AMP22 before replacing an older copy. AMP22 is signed with an Apple Developer ID and notarized by Apple, so it opens normally.
`;

const windowsNotice = `### Windows installation and SmartScreen

Download the Windows x64 **AMP22.Setup.<version>.exe** installer from this official GitHub release. Quit AMP22 before updating, then run the installer and follow its prompts.

AMP22 does not have a trusted Windows code-signing certificate. Microsoft Defender SmartScreen may show **Windows protected your PC**, an unrecognized-app warning, or an **Unknown publisher**. **Only if you trust this official AMP22 GitHub download**, choose **More info -> Run anyway** if offered. This is an exception for this installer, not proof that it is Microsoft-trusted. If that option is unavailable or your organization's policy blocks installation, stop and contact your administrator. Do not disable SmartScreen, antivirus, or organizational security controls.
`;

const notice = `${macNotice}\n${windowsNotice}`;

function addNotice(body) {
  assert.equal(typeof body, 'string', 'Expected release description text');
  const missing = [];
  if (!/^#{1,6}[ \t]+macOS installation(?: and Gatekeeper)?[ \t]*\r?$/m.test(body)) missing.push(macNotice);
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
