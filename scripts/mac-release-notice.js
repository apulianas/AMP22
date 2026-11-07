'use strict';

const fs = require('node:fs');

const heading = '### macOS installation and Gatekeeper';
const notice = `${heading}

AMP22 is not Apple Developer ID signed or notarized. New builds use free ad-hoc signing, which does **not** establish a trusted developer identity or bypass Gatekeeper. Previously published installers are unchanged.

Download the correct official AMP22 DMG (arm64 for Apple Silicon, x64 for Intel), open it, drag **AMP22** into **Applications**, and eject the disk image. If macOS blocks the app, **only if you trust this official AMP22 GitHub release**, open **Terminal**, paste this exact command, and press Return:

\`\`\`sh
xattr -dr com.apple.quarantine /Applications/AMP22.app
\`\`\`

Then open AMP22 from Applications. This removes downloaded-app quarantine from **AMP22 only**, allowing it to bypass that Gatekeeper check; it does not notarize the app or make it Apple-trusted. Do not disable Gatekeeper globally or use this for an untrusted download. If Terminal reports an error, confirm AMP22 is in Applications and do not blindly add \`sudo\`.
`;

function addNotice(body) {
  if (body.includes(heading)) return body;
  return `${notice}\n${body}`;
}

if (require.main === module) {
  const file = process.argv[2];
  if (file) {
    fs.writeFileSync(file, addNotice(fs.readFileSync(file, 'utf8')));
  } else {
    process.stdout.write(notice);
  }
}

module.exports = { notice, addNotice };
