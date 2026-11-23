// Where an importer brings goods in from (asked when a seller joins as an importer). Stored as ISO 3166 codes.
// `origin` ties each country to the ad origins (market/origins.js) the Importers page filters by:
// an importer from Germany shows under "Europe", from the UAE under "Dubai / UAE"… (null: no origin chip yet).
const COUNTRIES = [
  ['CN', 'China', '🇨🇳', 'china'],
  ['AE', 'United Arab Emirates (Dubai)', '🇦🇪', 'dubai'],
  ['GB', 'United Kingdom', '🇬🇧', 'ex-uk'],
  ['JP', 'Japan', '🇯🇵', 'japan'],
  ['US', 'United States', '🇺🇸', 'usa'],
  ['IN', 'India', '🇮🇳', null],
  ['TR', 'Turkey', '🇹🇷', 'europe'],
  ['DE', 'Germany', '🇩🇪', 'europe'],
  ['IT', 'Italy', '🇮🇹', 'europe'],
  ['FR', 'France', '🇫🇷', 'europe'],
  ['NL', 'Netherlands', '🇳🇱', 'europe'],
  ['BE', 'Belgium', '🇧🇪', 'europe'],
  ['ES', 'Spain', '🇪🇸', 'europe'],
  ['PL', 'Poland', '🇵🇱', 'europe'],
  ['KR', 'South Korea', '🇰🇷', null],
  ['TH', 'Thailand', '🇹🇭', null],
  ['MY', 'Malaysia', '🇲🇾', null],
  ['ID', 'Indonesia', '🇮🇩', null],
  ['VN', 'Vietnam', '🇻🇳', null],
  ['PK', 'Pakistan', '🇵🇰', null],
  ['SA', 'Saudi Arabia', '🇸🇦', null],
  ['EG', 'Egypt', '🇪🇬', null],
  ['ZA', 'South Africa', '🇿🇦', null],
  ['TZ', 'Tanzania', '🇹🇿', null],
  ['UG', 'Uganda', '🇺🇬', null],
  ['ET', 'Ethiopia', '🇪🇹', null],
  ['BR', 'Brazil', '🇧🇷', null],
  ['CA', 'Canada', '🇨🇦', null],
  ['AU', 'Australia', '🇦🇺', null],
].map(([code, name, flag, origin]) => ({ code, name, flag, origin }));

const byCode = new Map(COUNTRIES.map((country) => [country.code, country]));
const getCountry = (code) => byCode.get(String(code || '').toUpperCase()) || null;
// the codes of the countries that fall under one ad origin ("europe" → DE, IT, FR…)
const codesOfOrigin = (origin) => COUNTRIES.filter((country) => country.origin === origin).map((country) => country.code);
const publicCountries = () => COUNTRIES.map(({ code, name, flag, origin }) => ({ code, name, flag, origin })); // origin: the ad origin it falls under (for the Sell form)

module.exports = { COUNTRIES, getCountry, codesOfOrigin, publicCountries };
