'use strict';

const RELEASES_API = 'https://api.github.com/repos/apulianas/AMP22/releases/latest';
const RELEASES_PAGE = 'https://github.com/apulianas/AMP22/releases/tag/';

function versionParts(version) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`Invalid stable release version: ${version}`);
  return match.slice(1).map(BigInt);
}

function isNewer(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

class UpdateService {
  constructor({ version, packaged, fetch, store, openExternal }) {
    this.version = version;
    this.packaged = packaged;
    this.fetch = fetch;
    this.store = store;
    this.openExternal = openExternal;
    this.release = null;
    this.pending = null;
  }

  async check({ automatic = false } = {}) {
    if (automatic && !this.packaged) return { status: 'disabled', currentVersion: this.version };
    if (!this.pending) {
      this.pending = this.loadRelease().finally(() => { this.pending = null; });
    }
    const result = await this.pending;
    return {
      ...result,
      notify: result.status === 'available' && (!automatic || this.store.get().dismissedVersion !== result.release.version),
    };
  }

  async loadRelease() {
    try {
      const response = await this.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AMP22' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Please try again later.`);
      const release = await response.json();
      if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') {
        throw new Error('GitHub did not return a published stable release.');
      }
      const newer = isNewer(release.tag_name, this.version);
      this.release = newer ? {
        version: release.tag_name.replace(/^v/, ''),
        notes: typeof release.body === 'string' && release.body.trim()
          ? release.body.trim()
          : 'No release notes were provided. See the release page for details.',
        url: RELEASES_PAGE + encodeURIComponent(release.tag_name),
      } : null;
      return { status: newer ? 'available' : 'current', currentVersion: this.version, release: this.release };
    } catch (error) {
      console.error('Update check failed:', error);
      return { status: 'error', currentVersion: this.version, message: error.message };
    }
  }

  dismiss() {
    if (this.release) this.store.set({ ...this.store.get(), dismissedVersion: this.release.version });
  }

  async openDownload() {
    if (!this.release) throw new Error('Check for a newer release before opening its download page.');
    await this.openExternal(this.release.url);
    this.dismiss();
  }
}

module.exports = { UpdateService, isNewer };
