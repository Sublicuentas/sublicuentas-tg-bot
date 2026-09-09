(function (root, factory) {
  'use strict';
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.SublichatTVPlatforms = value;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const platforms = [
    { id: 'disney', name: 'Disney+', logo: 'disney.jpg',
      login: 'https://www.disneyplus.com/identity/login',
      activation: 'https://www.disneyplus.com/es-419/identity/begin?cid=DSS-OFFDEVICE-LP',
      domains: ['disneyplus.com', 'mydisneyaccount.com'], codeLength: 8, numeric: true,
      aliases: ['disney', 'disneyp', 'disneys', 'disneypremium', 'disneystandard', 'disneypremiumsin ESPN'] },
    { id: 'netflix', name: 'Netflix', logo: 'netflix.jpg',
      login: 'https://www.netflix.com/hn/login', activation: 'https://www.netflix.com/tv2',
      domains: ['netflix.com'], codeLength: 8, numeric: true,
      aliases: ['netflix', 'netflixpremium', 'netflixvip', 'vipnetflix', 'vip', 'netflixpremiumvip'] },
    { id: 'hbo', name: 'HBO Max', logo: 'hbo.jpg',
      login: 'https://auth.hbomax.com/login', activation: 'https://auth.hbomax.com/link',
      domains: ['hbomax.com', 'max.com'], codeLength: 6, numeric: true,
      aliases: ['hbo', 'hbomax', 'max'] },
    { id: 'prime', name: 'Prime Video', logo: 'prime.jpg',
      // Amazon genera una redirección de acceso nueva desde Prime Video.
      login: 'https://www.primevideo.com/', activation: 'https://www.primevideo.com/mytv',
      domains: ['primevideo.com', 'amazon.com'], codeLength: 0, numeric: false,
      aliases: ['prime', 'primevideo', 'amazonprime', 'amazonprimevideo'] },
    { id: 'crunchyroll', name: 'Crunchyroll', logo: 'crunchyroll.jpg',
      login: 'https://www.crunchyroll.com/login', activation: 'https://www.crunchyroll.com/activate',
      domains: ['crunchyroll.com'], codeLength: 6, numeric: false,
      aliases: ['crunchyroll', 'crunchy'] },
    { id: 'paramount', name: 'Paramount+', logo: 'paramount.jpg',
      login: 'https://www.paramountplus.com/hn/account/signin', activation: 'https://www.paramountplus.com/activate',
      domains: ['paramountplus.com'], codeLength: 0, numeric: false,
      aliases: ['paramount', 'paramountp', 'paramountplus'] }
  ];
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const userName = value => String(value || '').trim().toLowerCase();
  const allowedUsers = ['sublicuentas', 'naara', 'geisell', 'geissel', 'relojes', 'libni'];
  const get = id => platforms.find(p => p.id === id);
  function match(value) {
    const key = normalize(value);
    return platforms.find(p => p.aliases.some(a => normalize(a) === key)) || null;
  }
  function code(value, platform) {
    const text = String(value || '').replace(/[\s-]/g, '').toUpperCase();
    if (!platform || !/^[A-Z0-9]{4,12}$/.test(text) ||
        (platform.codeLength && text.length !== platform.codeLength) || (platform.numeric && !/^\d+$/.test(text))) return '';
    return text;
  }
  function allowsNavigation(url, platform) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443') &&
        platform.domains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
    } catch (_) { return false; }
  }
  return { platforms, get, match, code, allowsNavigation, allowedUsers, canUse: name => allowedUsers.includes(userName(name)) };
});
