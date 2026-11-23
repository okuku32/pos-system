// Where an item comes from. Kenya relies a lot on imports, so buyers often look for "ex-UK", "from China", "ex-Japan"...
const ORIGINS = [
  { key: 'china', name: 'China', label: 'Chinese goods', flag: '🇨🇳', words: ['china', 'chinese', 'made in china'] },
  { key: 'ex-uk', name: 'Ex-UK', label: 'Ex-UK goods', flag: '🇬🇧', words: ['ex uk', 'exuk', 'uk', 'british', 'england', 'london'] },
  { key: 'europe', name: 'Europe', label: 'European goods', flag: '🇪🇺', words: ['europe', 'european', 'germany', 'german', 'italy', 'italian', 'france', 'french', 'turkey', 'turkish'] },
  { key: 'usa', name: 'USA', label: 'US goods', flag: '🇺🇸', words: ['usa', 'us', 'american', 'america', 'ex us', 'ex usa'] },
  { key: 'japan', name: 'Japan', label: 'Japanese goods', flag: '🇯🇵', words: ['japan', 'japanese', 'ex japan'] },
  { key: 'dubai', name: 'Dubai / UAE', label: 'Goods from Dubai', flag: '🇦🇪', words: ['dubai', 'uae', 'ex dubai', 'emirates'] },
  { key: 'local', name: 'Made in Kenya', label: 'Made in Kenya', flag: '🇰🇪', words: ['made in kenya', 'kenyan', 'local', 'locally made'] },
];
const IMPORTED = ORIGINS.filter((origin) => origin.key !== 'local').map((item) => item.key);
const byKey = new Map(ORIGINS.map((origin) => [origin.key, origin]));
const getOrigin = (key) => byKey.get(key) || null;
// not for land, houses or services
const hasOrigin = (category, sub) => category !== 'land-property' && sub !== 'services';

module.exports = { ORIGINS, IMPORTED, getOrigin, hasOrigin };
