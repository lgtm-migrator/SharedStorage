import {JsonStorage} from './json-storage.js';
import {i18n} from './i18n.js';
import {getMaximumRemainingStorage} from './getMaximumRemainingStorage.js';
import {SharedStorageTemplate} from './templates/SharedStorage.js';

(async () => { // eslint-disable-line padded-blocks

const _ = await i18n({
  availableLocales: { // Could get this from server
    defaultLocale: 'en-US',
    otherLocales: []
  }
});

/*
if (new URL(location).protocol !== 'https:') {
  alert(_('require_https_access'));
  return;
}
*/

const js = new JsonStorage({appNamespace: 'shared-storage'});

const boolPreferences = ['ignoreNonHTTPSGet', 'ignoreNonHTTPSSet'];

const namespaceKeyPreferences = [
  'noOrigin'
];
const originKeyPreferences = [
  'origins',
  'namespacesWithOrigins'
];
const originKeySignallingExistencePreferences = [
  'originsGet',
  'originsSet'
];
const objectPreferences = [
  ...originKeyPreferences,
  ...namespaceKeyPreferences,
  ...originKeySignallingExistencePreferences
];
const prefs = {};
await Promise.all([
  ...objectPreferences,
  ...boolPreferences
].map(async (pref) => {
  prefs[pref] = await js.get(pref);
}));

objectPreferences.forEach((objectPref) => {
  if (!prefs[objectPref]) {
    prefs[objectPref] = {};
  }
});

SharedStorageTemplate({
  _, prefs,
  boolPreferences,
  originKeySignallingExistencePreferences,
  originKeyPreferences,
  namespaceKeyPreferences
});

function isSafeProtocol (protocol) {
  return ['https:', 'file:'].includes(protocol);
}

window.addEventListener('message', async function (e) {
  const {origin, source, data} = e;
  let namespacing, namespace, getMaxRemaining, isSharedStorage;
  try {
    ({namespacing, namespace, getMaxRemaining, isSharedStorage} = data);
  } catch (err) {
    return;
  }
  if (!isSharedStorage) {
    return;
  }
  const postToOrigin = (msgObj) => {
    source.postMessage(msgObj, origin);
  };

  if (!data || typeof data !== 'object') {
    return;
  }

  if (!origin) {
    // Origin ought to be set by the browser; if there is a problem,
    //  the security of the origin-based data would be in jeopardy.
    throw new Error('No origin');
  }

  const payload = data.data;
  const {protocol} = new URL(origin);

  let attempt, maxRemaining;
  try {
    const maxRemaining = await getMaximumRemainingStorage();
    // Probably not a privacy concern to know the amount left, so we
    //   don't require confirmation here for now, nor checks on protocol
    if (getMaxRemaining) {
      attempt = 'getMaxRemaining';
      postToOrigin({
        status: 'success',
        attempt,
        maxRemaining
      });
      return;
    }

    const safeProtocol = isSafeProtocol(protocol);
    // Do this as opposed to checking truthiness since user might
    //   wish to set a falsey value
    if (!data.hasOwnProperty('data')) {
      attempt = 'get';
      if (!safeProtocol && !prefs.ignoreNonHTTPSGet) {
        const prmpt = prompt(_('warn_insecure_protocol_get', {origin})).toLowerCase();
        if (prmpt === 'a') {
          prefs.ignoreNonHTTPSGet = true;
          await js.set('ignoreNonHTTPSGet', prefs.ignoreNonHTTPSGet);
        } else if (prmpt !== 'y') {
          postToOrigin({
            status: 'refused',
            attempt,
            reason: 'insecure'
          });
          return;
        }
      }
      if (!prefs.originsGet[origin]) {
        const prmpt = prompt(_('warn_protocol_get', {
          protocolSafetyLevel: safeProtocol
            ? _('protocolSafetyLevel_origin')
            : _('protocolSafetyLevel_supposedOrigin'),
          origin, namespace, namespacing,
          location: location.href
        })).toLowerCase();

        // 0. Remember? one for each site doing retrieving, one for each site doing setting
        if (prmpt === 't') {
          prefs.originsGet[origin] = {};
          await js.set('originsGet', prefs.originsGet);
        } else if (prmpt !== 'y') {
          postToOrigin({
            status: 'refused',
            attempt
          });
          return;
        }
      }
      let data;
      switch (namespacing) {
      case 'origin-top':
        data = prefs.origins[origin][namespace];
        break;
      case 'origin-children':
        data = prefs.namespacesWithOrigins[namespace][origin];
        break;
      default: // false, etc.
        data = prefs.noOrigin[namespace];
        break;
      }
      postToOrigin({
        status: 'success',
        attempt,
        data,
        maxRemaining // Easy enough to add here for convenience as well
      });
      return;
    }

    attempt = 'set';
    if (!isSafeProtocol(protocol) && !prefs.ignoreNonHTTPSSet) {
      const prmpt = prompt(_('warn_insecure_protocol_set', {
        origin,
        keyedToOrigin: namespacing ? _('keyedToOrigin') : '',
        locationReservedSite: namespacing ? _('locationReservedSite') : ''
      })).toLowerCase();
      if (prmpt === 'a') {
        prefs.ignoreNonHTTPSSet = true;
        await js.set('ignoreNonHTTPSSet', prefs.ignoreNonHTTPSSet);
      } else if (prmpt !== 'y') {
        postToOrigin({
          status: 'refused',
          attempt,
          reason: 'insecure'
        });
        return;
      }
    }

    if (!prefs.originsSet[origin]) {
      const prmpt = prompt(_('warn_protocol_set', {
        origin, namespace, namespacing, payload,
        location: location.href,
        protocolSafetyLevel: safeProtocol
          ? _('protocolSafetyLevel_origin')
          : _('protocolSafetyLevel_supposedOrigin')
      })).toLowerCase();
      if (prmpt === 't') {
        prefs.originsSet[origin] = {};
        await js.set('originsSet', prefs.originsSet);
      } else if (prmpt !== 'y') {
        postToOrigin({
          status: 'refused',
          attempt
        });
        return;
      }
    }

    switch (namespacing) {
    // 1. Settable by origin and then namespace
    case 'origin-top':
      if (!prefs.origins[origin]) {
        prefs.origins[origin] = {};
      }
      prefs.origins[origin][namespace] = payload;
      await js.set('origins', prefs.origins);
      break;
    // 2. Settable by namespace and then origin (Namespace created by
    //    anyone, but children settable only by site though with arbitrary
    //    children retrievable by anyone)
    case 'origin-children':
      if (!prefs.namespacesWithOrigins[namespace]) {
        prefs.namespacesWithOrigins[namespace] = {};
      }
      prefs.namespacesWithOrigins[namespace][origin] = payload;
      await js.set('namespacesWithOrigins', prefs.namespacesWithOrigins);
      break;
    // 3. Retrievable and settable by anyone
    default: // false, etc.
      prefs.noOrigin[namespace] = payload;
      await js.set('noOrigin', prefs.noOrigin);
      break;
    }
    postToOrigin({
      status: 'success',
      attempt
      // We don't provide maxRemaining here since it may have changed with the new addition
      // Todo: return "amountSet: payload.length"?
    });
  } catch (err) {
    const {name, message, fileName, lineNumber} = err;
    postToOrigin({
      status: 'error',
      attempt,
      maxRemaining, // Provide for convenience
      name, // 'NS_ERROR_DOM_QUOTA_REACHED' for storage limit
      // code: err.code, // 1014 for storage limit (not sending since deprecated)

      // Not necessarily uniform across browsers
      error: err.toString(),
      message,
      // Not standard, but useful for debugging
      fileName,
      lineNumber
    });
  }
});
})();
