// npm run seed:market — demo sellers and ads so the marketplace isn't empty.
// Safe to run again: it only replaces the demo sellers' own ads (emails ending in @demo.kapu.test).
// Demo sellers can log in with password demo1234 (e.g. wanjiku@demo.kapu.test) to try the chat.
// Remove all demo sellers, their ads and chats:  npm run seed:market -- --remove
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const { canBuyNow } = require('../controllers/orderController');
const { keywordsFor, normalize } = require('../market/search');
const { fieldsFor } = require('../market/categories');

// where an item comes from, read from the item itself: "ex-UK", "from Dubai"… first, then the brand
// (Tecno, Hisense → China; Toyota → Japan…). Handmade / Kenyan things are local. Unknown → no origin, unless the
// seller is an importer (then null: the caller picks one that suits the category).
const SAYS = [
  ['ex-uk', /\b(ex[- ]?uk|from the uk|british|mitumba|mtumba)\b/i],
  ['japan', /\b(ex[- ]?japan|from japan|japanese)\b/i],
  ['dubai', /\b(ex[- ]?dubai|from dubai|dubai|uae|arabian|oud|abaya)\b/i],
  ['usa', /\b(ex[- ]?usa?|from the us|american)\b/i],
  ['europe', /\b(italian|german|turkish|european|from europe|french)\b/i],
  ['china', /\b(made in china|from china|chinese)\b/i],
];
const BRANDS = [
  ['china', /\b(tecno|infinix|itel|oraimo|xiaomi|redmi|huawei|oppo|vivo|realme|vitron|hisense|tcl|syinix|skyworth|nunix|lenovo|anker|haier|midea)\b/i],
  ['japan', /\b(toyota|nissan|mazda|subaru|honda|mitsubishi|isuzu|suzuki|panasonic)\b/i],
  ['usa', /\b(apple|iphone|ipad|macbook)\b/i],
];
const MADE_HERE = /\b(kitenge|kikoy|kiondo|maasai|handmade|hand[- ]made|made to order|tailored|locally made|made in kenya|kenyan|jua kali|sisal|beaded|beadwork|soapstone|carving|ankara)\b/i;
function originFor(date, importer) {
  const text = `${date.title} ${date.description || ''} ${Object.values(date.attrs || {}).join(' ')}`;
  if (MADE_HERE.test(text) || ['fresh-produce', 'samaki', 'african-crafts'].includes(date.category)) return 'local';
  for (const [key, rx] of SAYS) if (rx.test(text)) return key;
  for (const [key, rx] of BRANDS) if (rx.test(text)) return key;
  return importer ? null : '';
}

// demo shop pins (real places): [name, address, area, county, lat, lng]
const SHOPS = {
  wanjiku: ['Wanjiku Fashion & Beauty', 'Gikomba Market, off Landhies Road', 'Gikomba', 'Nairobi', -1.2836, 36.8339, { kinds: ['boutique', 'shop'], wear: ['women', 'men'] }],
  brian: ['Brian Electronics', 'Luthuli Avenue, Nairobi CBD', 'CBD', 'Nairobi', -1.2833, 36.8275, { kinds: ['electronics', 'shop'], hours: { always: false, days: [{ closed: true }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '09:00', close: '17:00' }] } }],
  amina: ['Amina Beauty & Bags', 'Biashara Street, Mombasa Island', 'Mombasa Island', 'Mombasa', -4.0606, 39.6694, { kinds: ['boutique', 'shop'], wear: ['women'] }],
  kevin: ['Kevin Motors & Spares', 'Kirinyaga Road, Nairobi', 'Kirinyaga Road', 'Nairobi', -1.2808, 36.8236, { kinds: ['spares', 'importer', 'shop'], hours: { always: false, days: [{ closed: true }, { open: '07:30', close: '18:00' }, { open: '07:30', close: '18:00' }, { open: '07:30', close: '18:00' }, { open: '07:30', close: '18:00' }, { open: '07:30', close: '18:00' }, { open: '08:00', close: '14:00' }] } }],
  faith: ['Faith Furniture Kahawa', 'Kahawa West, near Kamiti Road', 'Kahawa West', 'Nairobi', -1.1866, 36.9095],
  moses: ['Moses Wholesalers', 'Imara Daima, Mombasa Road', 'Imara Daima', 'Nairobi', -1.3315, 36.8863, { kinds: ['wholesaler', 'grocery', 'shop'], hours: { always: false, days: [{ open: '09:00', close: '15:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }] }, walk: { enabled: true, maxKm: 2, fee: 100, perItem: 30, maxFee: 300, freeOver: 10000 } }],
  grace: ['Grace Ladies Boutique', 'Imara Daima, along Mombasa Road', 'Imara Daima', 'Nairobi', -1.3298, 36.8885, { kinds: ['boutique'], wear: ['women'], walk: { enabled: true, maxKm: 2, fee: 50, perItem: 20, maxFee: 150, freeOver: 3000 } }],
  dennis: ['Dennis Men’s Wear', 'Tom Mboya Street, Nairobi CBD', 'CBD', 'Nairobi', -1.2832, 36.8262, { kinds: ['boutique'], wear: ['men'], walk: { enabled: true, maxKm: 1.5, afterSale: true, note: 'Free walking delivery in town: our after-sale service' } }],
  peter: ['Gitau Mitumba Grade 1', 'Gikomba Market, clothes section', 'Gikomba', 'Nairobi', -1.2851, 36.8392, { kinds: ['market-stall', 'boutique'], wear: ['men', 'women'], market: 'gikomba-market', stall: 'Lane 3, stall 18' }],
  joyce: ['Mama Joyce Fresh Greens', 'Wakulima Market (Marikiti), vegetable section', 'CBD', 'Nairobi', -1.2874, 36.8306, { kinds: ['mama-mboga', 'market-stall'], market: 'wakulima-market-marikiti', stall: 'Stall 112', walk: { enabled: true, maxKm: 1, fee: 30, perItem: 10, maxFee: 80 } }],
  njeri: ['Mama Njeri Mboga', 'Imara Daima, near the matatu stage', 'Imara Daima', 'Nairobi', -1.3326, 36.8846, { kinds: ['mama-mboga'], walk: { enabled: true, maxKm: 1.5, fee: 20, perItem: 10, maxFee: 60, freeOver: 1000 } }],
  lucy: ['Imara Chemist', 'Imara Daima, next to the stage', 'Imara Daima', 'Nairobi', -1.3302, 36.8868, { kinds: ['chemist'], chemist: { status: 'verified', licenceNo: 'DEMO-PREM-0001', premises: 'Imara Chemist (demo)', pharmacist: 'Lucy Njoroge (demo)' }, hours: { always: false, days: [{ open: '10:00', close: '18:00' }, { open: '08:00', close: '21:00' }, { open: '08:00', close: '21:00' }, { open: '08:00', close: '21:00' }, { open: '08:00', close: '21:00' }, { open: '08:00', close: '21:00' }, { open: '08:00', close: '21:00' }] }, walk: { enabled: true, maxKm: 1.5, fee: 50, perItem: 0, maxFee: 0, freeOver: 1500 } }],
  samuel: ['Kahawa 24hr Pharmacy', 'Kahawa West, Kamiti Road', 'Kahawa West', 'Nairobi', -1.1872, 36.9102, { kinds: ['chemist'], chemist: { status: 'verified', licenceNo: 'DEMO-PREM-0002', premises: 'Kahawa 24hr Pharmacy (demo)', pharmacist: 'Samuel Otieno (demo)' }, hours: { always: true } }],
  wambua: ['Wambua Cash & Carry', 'Imara Daima, opposite the railway station', 'Imara Daima', 'Nairobi', -1.3284, 36.8903, { kinds: ['wholesaler', 'grocery', 'shop'], hours: { always: false, days: [{ open: '09:00', close: '16:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }, { open: '07:00', close: '20:00' }] }, walk: { enabled: true, maxKm: 2, fee: 100, perItem: 20, maxFee: 300, freeOver: 15000 } }],
  zawadi: ['Zawadi Electronics Imara', 'Imara Daima, Mombasa Road, shop 12', 'Imara Daima', 'Nairobi', -1.3311, 36.8893, { kinds: ['electronics', 'importer', 'shop'], hours: { always: false, days: [{ closed: true }, { open: '08:30', close: '19:30' }, { open: '08:30', close: '19:30' }, { open: '08:30', close: '19:30' }, { open: '08:30', close: '19:30' }, { open: '08:30', close: '19:30' }, { open: '09:00', close: '18:00' }] } }],
  baraka: ['Baraka Ex-UK Imports', 'Imara Daima, Kwa Reuben road', 'Imara Daima', 'Nairobi', -1.3322, 36.8869, { kinds: ['importer', 'wholesaler', 'shop'], hours: { always: false, days: [{ closed: true }, { open: '08:00', close: '18:30' }, { open: '08:00', close: '18:30' }, { open: '08:00', close: '18:30' }, { open: '08:00', close: '18:30' }, { open: '08:00', close: '18:30' }, { open: '08:00', close: '16:00' }] } }],
  // wholesalers by trade
  guangzhou: ['Guangzhou Link Imports', 'Luthuli Avenue, Nairobi CBD, Ambank House 1st floor', 'CBD', 'Nairobi', -1.2836, 36.8279, { kinds: ['importer', 'electronics', 'wholesaler', 'shop'] }],
  eastleigh: ['Eastleigh Dubai Traders', 'First Avenue Eastleigh, Garissa Lodge mall', 'Eastleigh', 'Nairobi', -1.2741, 36.8466, { kinds: ['importer', 'electronics', 'shop'] }],
  kilindini: ['Kilindini Ex-Japan Autos', 'Kilindini Road, near the port', 'Kilindini', 'Mombasa', -4.0657, 39.6589, { kinds: ['importer', 'spares', 'shop'] }],
  nyali: ['Nyali Ex-UK Furniture', 'Links Road, Nyali', 'Nyali', 'Mombasa', -4.0302, 39.7149, { kinds: ['importer', 'shop'] }],
  hassan: ['Hassan Electronics Wholesale', 'Luthuli Avenue, Nairobi CBD, 2nd floor', 'CBD', 'Nairobi', -1.2836, 36.8279, { kinds: ['wholesaler', 'electronics', 'importer', 'shop'], hours: { always: false, days: [{ closed: true }, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' }))] } }],
  mumbi: ['Mumbi Bales & Clothes Wholesale', 'Gikomba, bales section', 'Gikomba', 'Nairobi', -1.2846, 36.8401, { kinds: ['wholesaler', 'boutique', 'importer'], wear: ['men', 'women'], hours: { always: false, days: [{ closed: true }, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' }))] } }],
  kamau: ['Kamukunji Malimali Wholesalers', 'Kamukunji, Kirinyaga Road', 'Kamukunji', 'Nairobi', -1.2817, 36.8327, { kinds: ['wholesaler', 'shop'], hours: { always: false, days: [{ closed: true }, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' }))] } }],
  akinyi: ['Imara Stationery Wholesale', 'Imara Daima, next to Imara Mall', 'Imara Daima', 'Nairobi', -1.3307, 36.8880, { kinds: ['wholesaler', 'shop'], hours: { always: false, days: [{ closed: true }, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' }))] } }],
  omar: ['Industrial Area Packaging Supplies', 'Lunga Lunga Road, Industrial Area', 'Industrial Area', 'Nairobi', -1.3063, 36.8571, { kinds: ['wholesaler', 'shop'], hours: { always: false, days: [{ closed: true }, ...Array.from({ length: 6 }, () => ({ open: '08:00', close: '18:00' }))] } }],
  halima: ['Halima Fruits & Vegetables', 'Kongowea Market, fruit section', 'Kongowea', 'Mombasa', -4.0276, 39.6931, { kinds: ['mama-mboga', 'market-stall'], market: 'kongowea-market', stall: 'Stall 45' }],
};

// demo M-Pesa details for paying on delivery (demo numbers)
const PAYS = {
  wanjiku: { method: 'pochi' }, brian: { method: 'till', till: '445566' }, amina: { method: 'pochi' }, kevin: { method: 'till', till: '334455' },
  faith: { method: 'paybill', paybill: '600100', account: 'FAITHFURN' }, moses: { method: 'till', till: '778899' }, grace: { method: 'pochi' },
  dennis: { method: 'till', till: '556677' }, peter: { method: 'phone' }, joyce: { method: 'pochi' }, njeri: { method: 'pochi' }, halima: { method: 'phone' },
  lucy: { method: 'till', till: '667788' }, samuel: { method: 'paybill', paybill: '600200', account: 'KAHAWA24' }, wambua: { method: 'till', till: '512345' }, hassan: { method: 'till', till: '523456' }, mumbi: { method: 'pochi' }, kamau: { method: 'till', till: '534567' },
  akinyi: { method: 'paybill', paybill: '600500', account: 'STATIONERY' }, omar: { method: 'till', till: '545678' },
  guangzhou: { method: 'paybill', paybill: '600600', account: 'GZLINK' }, eastleigh: { method: 'till', till: '556600' }, kilindini: { method: 'paybill', paybill: '600700', account: 'KILINDINI' }, nyali: { method: 'till', till: '556611' },
  zawadi: { method: 'paybill', paybill: '600300', account: 'ZAWADI' }, baraka: { method: 'till', till: '889900' },
};
// which trade an ad belongs to, and who sells it: the named dealer in Nairobi (or Mombasa), otherwise a demo
// dealer of that trade in the ad's county (made below)
const TRADES = {
  motors: { cats: ['vehicles', 'spare-parts', 'bicycles'], name: 'Motors & Spares', kinds: ['spares', 'shop'], at: { Nairobi: 'kevin' } },
  electronics: { cats: ['electronics', 'appliances'], name: 'Electronics', kinds: ['electronics', 'shop'], at: { Nairobi: 'brian' } },
  home: { cats: ['furniture', 'beddings', 'utensils'], name: 'Furniture & Home', kinds: ['shop'], at: { Nairobi: 'faith' } },
  fashion: { cats: ['clothes-shoes', 'bags', 'beauty'], name: 'Fashion & Beauty', kinds: ['boutique', 'shop'], at: { Nairobi: 'wanjiku', Mombasa: 'amina' } },
  grocery: { cats: ['cooking-products', 'beverages', 'detergents-cleaning'], name: 'Wholesalers', kinds: ['wholesaler', 'grocery', 'shop'], at: { Nairobi: 'moses' } },
  supplies: { cats: ['stationery', 'packaging'], name: 'Stationery & Packaging', kinds: ['wholesaler', 'shop'], at: {} },
  liquor: { cats: ['liquor'], name: 'Wines & Spirits', kinds: ['shop'], at: {} },
  property: { cats: ['land-property'], name: 'Properties', kinds: ['shop'], at: {} },
  baby: { cats: ['baby-kids'], name: 'Baby Shop', kinds: ['baby-shop', 'shop'], at: {} },
  general: { cats: [], name: 'General Store', kinds: ['shop'], at: {} },
};
const tradeOf = (category) => Object.keys(TRADES).find((key) => TRADES[key].cats.includes(category)) || 'general';
// where demo dealers' shops are (main town of each county; a few Nairobi areas)
const PLACES = {
  Nairobi: [-1.2833, 36.8219], Kiambu: [-1.0333, 37.0693], Mombasa: [-4.0435, 39.6682], Nakuru: [-0.3031, 36.08], Kisumu: [-0.0917, 34.768],
  Machakos: [-1.5177, 37.2634], 'Uasin Gishu': [0.5143, 35.2698], Kajiado: [-1.4742, 36.9614], Kwale: [-4.2796, 39.5949], Kirinyaga: [-0.4989, 37.2803],
  Nyeri: [-0.4201, 36.9476], Kakamega: [0.2827, 34.7519],
  'Nairobi/Westlands': [-1.2676, 36.8108], 'Nairobi/Kilimani': [-1.2921, 36.7856], 'Nairobi/Embakasi': [-1.3236, 36.9], 'Nairobi/Kasarani': [-1.2219, 36.898],
  'Nairobi/Karen': [-1.3197, 36.7073], 'Nairobi/South B': [-1.3087, 36.8358], 'Nairobi/Kileleshwa': [-1.2833, 36.7833], 'Nairobi/Ngara': [-1.2732, 36.8264],
};
const DEALER_NAMES = ['Otieno', 'Wairimu', 'Kiptoo', 'Achieng', 'Mutua', 'Njoroge', 'Chebet', 'Omondi', 'Wanjiru', 'Kamau', 'Nekesa', 'Barasa', 'Muthoni', 'Rotich', 'Atieno', 'Kariuki', 'Jeptoo', 'Odhiambo', 'Nduta', 'Kibet'];

const SELLERS = [
  ['Wanjiku Kamau', 'wanjiku', '254700100201'],
  ['Brian Otieno', 'brian', '254700100202'],
  ['Amina Hassan', 'amina', '254700100203'],
  ['Kevin Mwangi', 'kevin', '254700100204'],
  ['Faith Chebet', 'faith', '254700100205'],
  ['Moses Kiprono', 'moses', '254700100206'],
];
// sellers whose ads are listed below by name (not shared out like the ones above)
const SHOP_SELLERS = [
  ['Grace Achieng', 'grace', '254700100207'],
  ['Dennis Kariuki', 'dennis', '254700100208'],
  ['Peter Gitau', 'peter', '254700100209'],
  ['Joyce Wambui', 'joyce', '254700100210'],
  ['Njeri Mwangi', 'njeri', '254700100211'],
  ['Halima Omar', 'halima', '254700100212'],
  ['Lucy Njoroge', 'lucy', '254700100213'],
  ['Samuel Otieno', 'samuel', '254700100214'],
  ['Peter Wambua', 'wambua', '254700100215'],
  ['Zawadi Achieng', 'zawadi', '254700100216'],
  ['Baraka Mutua', 'baraka', '254700100217'],
  ['Hassan Ali', 'hassan', '254700100218'],
  ['Mumbi Wanjiru', 'mumbi', '254700100219'],
  ['Kamau Njoroge', 'kamau', '254700100220'],
  ['Akinyi Odera', 'akinyi', '254700100221'],
  ['Omar Salim', 'omar', '254700100222'],
  ['Li Wei & Njoroge', 'guangzhou', '254700100223'],
  ['Abdi Hassan', 'eastleigh', '254700100224'],
  ['Salim Mwamba', 'kilindini', '254700100225'],
  ['Fatma Said', 'nyali', '254700100226'],
];
// [seller, category, sub, title, price, area, condition, attrs, description]
const width = { gender: 'Women' };
const match = { gender: 'Men' };
// about how heavy one item is, for the demo (a weight in the title wins: "25kg bag", "12 × 2kg")
const WEIGHTS = { 'womens-clothes': 0.3, 'mens-clothes': 0.4, sportswear: 0.3, 'womens-shoes': 0.8, 'mens-shoes': 1, 'watches-jewellery': 0.2, handbags: 0.7, 'travel-bags': 2.5,
  phones: 0.4, accessories: 0.2, audio: 1.5, tvs: 10, laptops: 2.2, 'kettles-toasters': 1.5, microwaves: 12, cookware: 3, 'car-parts': 4,
  fruits: 1, vegetables: 1, 'tomatoes-onions': 1, 'potatoes-tubers': 2, 'eggs-poultry': 2, 'fish-meat': 1,
  'fried-victoria-fish': 0.6, 'fresh-victoria-fish': 1, 'lake-fish': 1, seafood: 1, 'fried-omena': 0.3, 'fresh-omena': 1,
  'cooking-oil': 5, flour: 2, 'rice-cereals': 5, 'sugar-salt': 2, beverages: 0.5, 'soft-drinks': 1, 'washing-powder': 1,
  'otc-medicine': 0.1, vitamins: 0.2, 'first-aid': 0.3, 'medical-devices': 0.5, 'sexual-health': 0.1, 'prescription-medicine': 0.1 };
function weightFor(sub, title) {
  const found = /(?:(\d+)\s*×\s*)?(\d+(?:\.\d+)?)\s*kg\b/i.exec(title);
  if (found) return Math.round(Number(found[2]) * (found[1] ? Number(found[1]) : 1) * 10) / 10;
  const hit = /(\d+(?:\.\d+)?)\s*litre/i.exec(title);
  if (hit && ['cooking-oil', 'beverages', 'soft-drinks'].includes(sub)) return Math.round(Number(hit[1]) * 0.92 * 10) / 10; // a liquid, not a microwave's size
  return WEIGHTS[sub] ?? null;
}

const SHOP_ADS = [
  ['grace', 'clothes-shoes', 'womens-clothes', 'Floral midi dress, flowy chiffon', 2200, 'Imara Daima', 'New', { item: 'Dresses', size: 'M', ...width, colour: 'Pink' }, 'Light chiffon midi dress for church, office or a day out. Sizes S to XL in stock.'],
  ['grace', 'clothes-shoes', 'womens-clothes', 'Satin office blouse, long sleeve', 1500, 'Imara Daima', 'New', { item: 'Tops & blouses', size: 'L', ...width, colour: 'White' }, 'Smooth satin blouse that does not crease. White, black, wine and emerald.'],
  ['grace', 'clothes-shoes', 'womens-clothes', 'Pleated A-line skirt, knee length', 1600, 'Imara Daima', 'New', { item: 'Skirts', size: 'M', ...width, colour: 'Navy' }, 'Classic pleated skirt with an elastic waist at the back. Fits sizes 8 to 16.'],
  ['grace', 'clothes-shoes', 'womens-clothes', 'High-waist mom jeans', 1900, 'Imara Daima', 'New', { item: 'Trousers & jeans', size: 'M', ...width, colour: 'Blue' }, 'Comfortable stretch denim, high waist, sizes 26 to 36.'],
  ['grace', 'clothes-shoes', 'womens-clothes', 'Kitenge two-piece set, made to order', 3800, 'Imara Daima', 'New', { item: 'Kitenge & ankara', size: 'M', ...width, colour: 'Multi-colour' }, 'Top and skirt in quality wax print, tailored to your measurements in 3 days.'],
  ['grace', 'clothes-shoes', 'womens-shoes', 'Block heels, comfortable 3 inch', 2800, 'Imara Daima', 'New', { item: 'Heels', shoeSize: '38', ...width, colour: 'Black' }, 'Easy to walk in all day. Sizes 36 to 41, black and nude.'],
  ['grace', 'clothes-shoes', 'watches-jewellery', 'Ladies rose gold watch and bracelet set', 2500, 'Imara Daima', 'New', { item: 'Women’s watches', ...width, colour: 'Gold' }, 'Rose gold watch with a matching bracelet, in a gift box. Water resistant.'],
  ['grace', 'clothes-shoes', 'watches-jewellery', 'Gold plated necklace and earrings set', 1200, 'Imara Daima', 'New', { item: 'Necklaces & chains', ...width, colour: 'Gold' }, 'Does not fade or turn skin green. A lovely gift.'],
  ['grace', 'bags', 'handbags', 'Ladies tote handbag, faux leather', 3500, 'Imara Daima', 'New', { material: 'Faux leather', colour: 'Brown' }, 'Roomy tote with a zip pocket, fits an A4 file and a small laptop.'],
  ['dennis', 'clothes-shoes', 'mens-clothes', 'Slim fit cotton shirts, long sleeve', 1500, 'CBD', 'New', { item: 'Shirts', size: 'M', ...match, colour: 'White' }, 'Pure cotton office shirts in white, sky blue and pink. Sizes S to 3XL.'],
  ['dennis', 'clothes-shoes', 'mens-clothes', 'Polo t-shirts, pack of 3', 2400, 'CBD', 'New', { item: 'T-shirts & polos', size: 'L', ...match, colour: 'Navy' }, 'Three quality pique polo shirts. Choose your colours.'],
  ['dennis', 'clothes-shoes', 'mens-clothes', 'Stretch chinos, khaki and navy', 2000, 'CBD', 'New', { item: 'Trousers & chinos', size: 'L', ...match, colour: 'Beige' }, 'Smart casual chinos with a little stretch. Waist 30 to 40.'],
  ['dennis', 'clothes-shoes', 'mens-clothes', 'Denim jeans, straight cut', 2300, 'CBD', 'New', { item: 'Jeans', size: 'L', ...match, colour: 'Blue' }, 'Strong denim jeans that keep their colour. Waist 28 to 42.'],
  ['dennis', 'clothes-shoes', 'mens-clothes', 'Two piece slim fit suit', 9500, 'CBD', 'New', { item: 'Suits & blazers', size: 'L', ...match, colour: 'Grey' }, 'Jacket and trousers, free fitting and adjustments in the shop.'],
  ['dennis', 'clothes-shoes', 'mens-shoes', 'Leather sneakers, white', 3500, 'CBD', 'New', { item: 'Sneakers', shoeSize: '42', ...match, colour: 'White' }, 'Clean white leather sneakers that go with jeans or chinos. Sizes 39 to 46.'],
  ['dennis', 'clothes-shoes', 'watches-jewellery', 'Men’s stainless steel chronograph watch', 4500, 'CBD', 'New', { item: 'Men’s watches', ...match, colour: 'Silver' }, 'Working chronograph, date window and a steel strap. 6 months warranty.'],
  ['dennis', 'clothes-shoes', 'watches-jewellery', 'Smart watch with calls and heart rate', 3900, 'CBD', 'New', { item: 'Smart watches', gender: 'Unisex', colour: 'Black' }, 'Answer calls, count steps and check your heart rate. Works with Android and iPhone.'],
  ['dennis', 'clothes-shoes', 'watches-jewellery', 'Polarized sunglasses for men', 1200, 'CBD', 'New', { item: 'Sunglasses', ...match, colour: 'Black' }, 'UV400 polarized lenses, strong frame, with a case.'],
  ['peter', 'clothes-shoes', 'mens-clothes', 'Mtumba official shirts, grade 1', 400, 'Gikomba', 'Used (mtumba)', { item: 'Shirts', size: 'L', ...match }, 'Clean grade 1 mtumba official shirts, ironed and ready to wear.'],
  ['peter', 'clothes-shoes', 'womens-clothes', 'Mtumba dresses, grade 1', 600, 'Gikomba', 'Used (mtumba)', { item: 'Dresses', size: 'M', ...width }, 'Fresh bale opened every Tuesday and Friday. Many styles and sizes.'],
  ['peter', 'clothes-shoes', 'mens-clothes', 'Mtumba hoodies and sweaters', 700, 'Gikomba', 'Used (mtumba)', { item: 'Sweaters & hoodies', size: 'XL', ...match }, 'Warm hoodies and sweaters for the cold season, grade 1.'],
  ['peter', 'clothes-shoes', 'sportswear', 'Football jerseys, latest season', 1200, 'Gikomba', 'New', { item: 'Jerseys', size: 'L', gender: 'Unisex' }, 'Arsenal, Man U, Chelsea, Liverpool and Harambee Stars. Name and number printing available.'],
  ['peter', 'clothes-shoes', 'mens-shoes', 'Mtumba official shoes, leather', 1500, 'Gikomba', 'Used (mtumba)', { item: 'Official shoes', shoeSize: '43', ...match, colour: 'Black' }, 'Genuine leather mtumba official shoes, polished and repaired where needed.'],
  ['joyce', 'fresh-produce', 'vegetables', 'Sukuma wiki, fresh kifungu', 10, 'Wakulima Market', '', { unit: 'Kifungu (bunch)', grown: 'Local farm' }, 'Fresh sukuma wiki from Kiambu farms, delivered to the market every morning.'],
  ['joyce', 'fresh-produce', 'tomatoes-onions', 'Tomatoes, firm and ripe', 120, 'Wakulima Market', '', { unit: 'Kg', grown: 'Local farm' }, 'Firm red tomatoes for cooking and salads. Wholesale crates also available.'],
  ['joyce', 'fresh-produce', 'tomatoes-onions', 'Red onions', 100, 'Wakulima Market', '', { unit: 'Kg' }, 'Dry red onions that keep well. Sold per kg or by the net bag.'],
  ['joyce', 'fresh-produce', 'vegetables', 'Cabbages, big heads', 60, 'Wakulima Market', '', { unit: 'Piece', grown: 'Local farm' }, 'Big firm cabbages from Nyandarua.'],
  ['joyce', 'fresh-produce', 'fruits', 'Sweet bananas, ripe', 120, 'Wakulima Market', '', { unit: 'Dozen' }, 'Sweet ripe bananas, sold by the dozen.'],
  ['njeri', 'fresh-produce', 'vegetables', 'Managu and terere, fresh traditional greens', 10, 'Imara Daima', '', { unit: 'Kifungu (bunch)', grown: 'Organic' }, 'Fresh kienyeji vegetables, picked this morning. KSh 10 a kifungu, sorted and ready to cook.'],
  ['njeri', 'fresh-produce', 'vegetables', 'Kienyeji mix: kunde, saga & mrenda', 10, 'Imara Daima', '', { unit: 'Kifungu (bunch)', grown: 'Organic' }, 'Mboga za kienyeji: kunde, saga (spider plant) and mrenda, tied in vifungu of KSh 10.'],
  ['njeri', 'fresh-produce', 'tomatoes-onions', 'Onions, per piece', 10, 'Imara Daima', '', { unit: 'Piece' }, 'Big red onions, KSh 10 each. Per kg also available.'],
  ['njeri', 'fresh-produce', 'tomatoes-onions', 'Tomatoes fungu', 50, 'Imara Daima', '', { unit: 'Fungu (heap)' }, 'A fungu of ripe tomatoes for the day’s cooking.'],
  ['njeri', 'fresh-produce', 'potatoes-tubers', 'Waru (Irish potatoes)', 80, 'Imara Daima', '', { unit: 'Kg' }, 'Clean Shangi potatoes, good for chips and stew.'],
  ['njeri', 'fresh-produce', 'eggs-poultry', 'Kienyeji eggs, tray of 30', 600, 'Imara Daima', '', { unit: 'Tray' }, 'Real kienyeji eggs from free-range chicken. Fresh every week.'],
  ['njeri', 'fresh-produce', 'fruits', 'Hass avocados', 20, 'Imara Daima', '', { unit: 'Piece' }, 'Creamy Hass avocados, ready to eat in a day or two.'],
  ['njeri', 'fresh-produce', 'tomatoes-onions', 'Dhania (coriander), kifungu', 5, 'Imara Daima', '', { unit: 'Kifungu (bunch)' }, 'Fresh dhania, KSh 5 a kifungu. Garlic and ginger available too.'],
  ['wambua', 'cooking-products', 'rice-cereals', 'Pishori rice, 25kg bag', 4200, 'Imara Daima', '', { brand: 'Mwea Pishori', pack: '25kg' }, 'Aromatic Mwea pishori rice. Single bags, or cheaper by 5 and 20 bags for hotels and shops.', { wholesale: { enabled: true, unit: 'bag', retail: true, tiers: [{ minQty: 5, price: 4000 }, { minQty: 20, price: 3800 }] }, stock: 400 }],
  ['wambua', 'cooking-products', 'sugar-salt', 'Sugar, 50kg bag', 7800, 'Imara Daima', '', { brand: 'Mumias', pack: '50kg' }, 'White sugar in 50kg bags. Bulk prices from 5 bags.', { wholesale: { enabled: true, unit: 'bag', retail: true, tiers: [{ minQty: 5, price: 7500 }, { minQty: 10, price: 7300 }] }, stock: 400 }],
  ['wambua', 'cooking-products', 'cooking-oil', 'Cooking oil, 20 litre jerrycan', 5400, 'Imara Daima', '', { brand: 'Fresh Fri', pack: '20L' }, 'Vegetable cooking oil in 20L jerrycans for homes, kibandas and hotels.', { wholesale: { enabled: true, unit: 'jerrycan', retail: true, tiers: [{ minQty: 4, price: 5200 }, { minQty: 10, price: 5000 }] }, stock: 400 }],
  ['wambua', 'cooking-products', 'flour', 'Maize flour bale, 12 × 2kg', 1850, 'Imara Daima', '', { brand: 'Jogoo', pack: '12 × 2kg' }, 'A bale of twelve 2kg packets of maize flour. Wholesale only: from 5 bales.', { wholesale: { enabled: true, unit: 'bale', retail: false, tiers: [{ minQty: 5, price: 1750 }, { minQty: 20, price: 1680 }] }, stock: 400 }],
  ['wambua', 'detergents-cleaning', 'washing-powder', 'Omo washing powder carton, 24 × 500g', 2900, 'Imara Daima', '', { brand: 'Omo', pack: 'carton of 24' }, 'Carton of 24 packets of Omo 500g. Great for shops and laundries.', { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{ minQty: 3, price: 2800 }, { minQty: 10, price: 2700 }] }, stock: 400 }],
  ['wambua', 'beverages', 'soft-drinks', 'Soda crate, 24 × 300ml', 1200, 'Imara Daima', '', { brand: 'Coca-Cola', pack: 'crate of 24' }, 'Assorted sodas in returnable glass bottles. Deposit for the crate charged separately.', { wholesale: { enabled: true, unit: 'crate', retail: true, tiers: [{ minQty: 5, price: 1150 }, { minQty: 20, price: 1100 }] }, stock: 400 }],
  ['zawadi', 'electronics', 'phones', 'Tecno Spark 20, 128GB, new', 15999, 'Imara Daima', 'New', { make: 'Tecno', model: 'Spark 20', storage: '128', ram: '8', colour: 'Black' }, 'Brand new Tecno Spark 20 with a 1 year warranty and a free cover.', { stock: 12, origin: 'china' }],
  ['zawadi', 'electronics', 'tvs', 'Samsung 43 inch smart TV, ex-Dubai', 32000, 'Imara Daima', 'New', { brand: 'Samsung', screen: '43', tvtype: 'Smart / Android' }, 'Samsung 43" 4K smart TV imported from Dubai, with a wall bracket.', { stock: 4, origin: 'dubai' }],
  ['zawadi', 'electronics', 'accessories', 'Power bank 20000mAh, fast charging', 2500, 'Imara Daima', 'New', { brand: 'Oraimo' }, 'Oraimo 20,000mAh power bank, charges a phone about 4 times.', { stock: 30, origin: 'china' }],
  ['zawadi', 'electronics', 'audio', 'Wireless earbuds with charging case', 1800, 'Imara Daima', 'New', { brand: 'Oraimo' }, 'Bluetooth earbuds with up to 24 hours of play with the case.', { stock: 25, origin: 'china' }],
  ['zawadi', 'electronics', 'accessories', 'Phone covers, wholesale (mixed models)', 150, 'Imara Daima', 'New', { brand: 'Assorted' }, 'Silicone phone covers for popular Tecno, Infinix, Samsung and iPhone models. Cheaper by the dozen.', { wholesale: { enabled: true, unit: 'piece', retail: true, tiers: [{ minQty: 12, price: 110 }, { minQty: 50, price: 90 }] }, stock: 400 }],
  ['baraka', 'appliances', 'microwaves', 'Ex-UK microwave, 20 litres', 6500, 'Imara Daima', 'Used', { litres: 20, brand: 'Samsung' }, 'Clean ex-UK microwave, tested and working, with a 1 month warranty.', { stock: 6, origin: 'ex-uk' }],
  ['baraka', 'appliances', 'kettles-toasters', 'Ex-UK electric kettle, 1.7L', 1500, 'Imara Daima', 'Used', { brand: 'Russell Hobbs' }, 'Ex-UK cordless kettle, descaled and tested.', { stock: 10, origin: 'ex-uk' }],
  ['baraka', 'utensils', 'cookware', 'Ex-UK non-stick pots set, 5 pieces', 4800, 'Imara Daima', 'Used', { pieces: 5, material: 'Non-stick' }, 'Five-piece non-stick cookware set from the UK, gently used.', { stock: 5, origin: 'ex-uk' }],
  ['baraka', 'appliances', 'kettles-toasters', 'Ex-Japan rice cooker, 1.8L', 3200, 'Imara Daima', 'Used', { brand: 'Panasonic' }, 'Japanese rice cooker with keep-warm, 220V converted and tested.', { stock: 4, origin: 'japan' }],
  ['baraka', 'bags', 'travel-bags', 'Ex-UK suitcases, assorted (wholesale)', 2800, 'Imara Daima', 'Used', { material: 'Fabric' }, 'Grade A ex-UK suitcases, assorted sizes. Cheaper for traders buying 5 or more.', { wholesale: { enabled: true, unit: 'piece', retail: true, tiers: [{ minQty: 5, price: 2500 }, { minQty: 10, price: 2300 }] }, stock: 400 }],
  ['kevin', 'spare-parts', 'car-parts', 'Toyota Vitz front brake pads (genuine)', 3500, 'Kirinyaga Road', 'New (genuine)', { make: 'Toyota', model: 'Vitz', yearFrom: 2010, yearTo: 2019, partType: 'Brakes', partNo: '04465-52260' }, 'Genuine Toyota brake pads for Vitz 2010–2019 (KSP130/NSP130). Fitting available at the shop.'],
  ['kevin', 'spare-parts', 'car-parts', 'Toyota Vitz headlight, right side, ex-Japan', 6500, 'Kirinyaga Road', 'Used (ex-Japan)', { make: 'Toyota', model: 'Vitz', yearFrom: 2005, yearTo: 2010, partType: 'Lights & electricals' }, 'Clean ex-Japan headlight for the older Vitz (2005–2010). No cracks, clear lens.'],
  ['kevin', 'spare-parts', 'car-parts', 'Toyota Fielder gearbox, ex-UK, tested', 85000, 'Kirinyaga Road', 'Used (ex-UK)', { make: 'Toyota', model: 'Fielder', yearFrom: 2012, yearTo: 2018, partType: 'Engine & gearbox' }, 'Automatic CVT gearbox for Fielder 2012–2018, tested and with a 1 month warranty.'],
  ['kevin', 'spare-parts', 'car-parts', 'Mazda Demio side mirror, aftermarket', 4200, 'Kirinyaga Road', 'New (aftermarket)', { make: 'Mazda', model: 'Demio', yearFrom: 2014, yearTo: 2019, partType: 'Body parts' }, 'New aftermarket side mirror with indicator for Demio 2014–2019.'],
  ['kevin', 'spare-parts', 'car-parts', 'Nissan Note shock absorbers, ex-Dubai, pair', 7800, 'Kirinyaga Road', 'Used (ex-Dubai)', { make: 'Nissan', model: 'Note', yearFrom: 2012, yearTo: 2020, partType: 'Suspension & steering' }, 'Front shock absorbers for Nissan Note E12, ex-Dubai, tested.'],
  ['lucy', 'pharmacy', 'otc-medicine', 'Panadol Extra, 24 tablets', 180, 'Imara Daima', '', { rx: 'Over the counter', brand: 'Panadol', pack: '24 tablets' }, 'For headaches, fever and body pains. Read the leaflet; ask our pharmacist if you take other medicines.'],
  ['lucy', 'pharmacy', 'vitamins', 'Vitamin C 1000mg effervescent, 20 tablets', 650, 'Imara Daima', '', { rx: 'Over the counter', pack: '20 tablets' }, 'Daily immune support. Dissolve one tablet in a glass of water.'],
  ['lucy', 'pharmacy', 'medical-devices', 'Digital blood pressure machine (upper arm)', 4200, 'Imara Daima', '', { rx: 'Over the counter', brand: 'Omron' }, 'Easy one-button reading with memory. We show you how to use it at the chemist.'],
  ['lucy', 'pharmacy', 'prescription-medicine', 'Amoxicillin 500mg capsules', 350, 'Imara Daima', '', { rx: 'Prescription needed', pack: '21 capsules' }, 'Prescription needed: bring your doctor’s prescription to the chemist. Chat with us to check it’s in stock.'],
  ['lucy', 'pharmacy', 'first-aid', 'Home first aid kit', 1500, 'Imara Daima', '', { rx: 'Over the counter' }, 'Bandages, plasters, gauze, antiseptic, gloves and scissors in a carry box.'],
  ['samuel', 'pharmacy', 'otc-medicine', 'Cough syrup for dry cough, 100ml', 450, 'Kahawa West', '', { rx: 'Over the counter', pack: '100ml' }, 'Soothes dry, tickly coughs. Open 24 hours: call or come anytime.'],
  ['samuel', 'pharmacy', 'medical-devices', 'Glucometer with 50 test strips', 3500, 'Kahawa West', '', { rx: 'Over the counter' }, 'Check your blood sugar at home. Comes with lancets and a carry case.'],
  ['samuel', 'pharmacy', 'sexual-health', 'Pregnancy test strips, pack of 2', 200, 'Kahawa West', '', { rx: 'Over the counter', pack: '2 tests' }, 'Accurate early pregnancy tests. Discreet packaging.'],
  // wholesalers by trade (electronics, clothes, malimali, stationery, packaging)
  ['hassan', 'electronics', 'accessories', "Phone chargers, fast charging, carton of 50", 4500, 'CBD', 'New', {}, "Type-C and micro-USB fast chargers for phone shops. Carton of 50.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 4200},{minQty: 20,price: 3900}] }, stock: 500, origin: 'china' }],
  ['hassan', 'electronics', 'audio', "Earphones with mic, box of 100", 6000, 'CBD', 'New', {}, "Wired earphones with mic, assorted colours. Box of 100 pieces.", { wholesale: { enabled: true, unit: 'box', retail: true, tiers: [{minQty: 5,price: 5600},{minQty: 20,price: 5200}] }, stock: 500, origin: 'china' }],
  ['hassan', 'electronics', 'tvs', "Smart TV 32 inch, wholesale", 13500, 'CBD', 'New', { brand: 'Vitron' }, "32 inch smart TVs for electronics shops. Better prices from 5 pieces.", { wholesale: { enabled: true, unit: 'piece', retail: true, tiers: [{minQty: 5,price: 12800},{minQty: 10,price: 12300}] }, stock: 500, origin: 'china' }],
  ['hassan', 'electronics', 'solar-power', "Solar lamps with phone charging, carton of 20", 9000, 'CBD', 'New', {}, "Solar lamps that charge phones, for rural shops. Carton of 20.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 8500}] }, stock: 500, origin: 'china' }],
  ['mumbi', 'clothes-shoes', 'mens-clothes', "Mitumba bale: men’s t-shirts, 45 kg", 16000, 'Gikomba', 'Used (mtumba)', { item: 'T-shirts & polos', gender: 'Men' }, "Grade 1 ex-UK t-shirts bale, about 45 kg. Opened on Tuesdays and Fridays.", { wholesale: { enabled: true, unit: 'bale', retail: false, tiers: [{minQty: 1,price: 16000},{minQty: 3,price: 15200}] }, stock: 40, origin: 'ex-uk' }],
  ['mumbi', 'clothes-shoes', 'womens-clothes', "Mitumba bale: ladies’ dresses, 45 kg", 22000, 'Gikomba', 'Used (mtumba)', { item: 'Dresses', gender: 'Women' }, "Grade 1 ladies’ dresses bale from the UK.", { wholesale: { enabled: true, unit: 'bale', retail: false, tiers: [{minQty: 1,price: 22000},{minQty: 3,price: 21000}] }, stock: 40, origin: 'ex-uk' }],
  ['mumbi', 'clothes-shoes', 'mens-shoes', "Mitumba bale: sports shoes, 25 kg", 25000, 'Gikomba', 'Used (mtumba)', { item: 'Sneakers', gender: 'Unisex' }, "Ex-UK sneakers and sports shoes bale, about 60 pairs.", { wholesale: { enabled: true, unit: 'bale', retail: false, tiers: [{minQty: 1,price: 25000},{minQty: 3,price: 24000}] }, stock: 40, origin: 'ex-uk' }],
  ['mumbi', 'clothes-shoes', 'mens-clothes', "New plain t-shirts, dozen", 2400, 'Gikomba', 'New', { item: 'T-shirts & polos', size: 'L', gender: 'Unisex' }, "Plain cotton t-shirts for printing and branding, by the dozen.", { wholesale: { enabled: true, unit: 'dozen', retail: true, tiers: [{minQty: 10,price: 2200},{minQty: 50,price: 2000}] }, stock: 500, origin: 'china' }],
  ['kamau', 'utensils', 'cookware', "Sufurias (set of 7), carton of 6 sets", 9000, 'Kamukunji', 'New', { material: 'Aluminium' }, "Aluminium sufuria sets for shops. Carton of 6 sets.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 8500}] }, stock: 500 }],
  ['kamau', 'utensils', 'storage', "Plastic basins, assorted, dozen", 2400, 'Kamukunji', 'New', { material: 'Plastic' }, "Assorted plastic basins and buckets by the dozen.", { wholesale: { enabled: true, unit: 'dozen', retail: true, tiers: [{minQty: 10,price: 2200}] }, stock: 500 }],
  ['kamau', 'beauty', 'skin-care', "Petroleum jelly 250ml, carton of 24", 2900, 'Kamukunji', 'New', {}, "Petroleum jelly for shops and kiosks. Carton of 24.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 10,price: 2750}] }, stock: 500 }],
  ['kamau', 'baby-kids', 'toys', "Assorted kids toys, carton", 3500, 'Kamukunji', 'New', {}, "Balls, cars and dolls for toy sellers. Mixed carton.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 3200}] }, stock: 500 }],
  ['kamau', 'detergents-cleaning', 'bar-soap', "Bar soap, carton of 25", 3000, 'Kamukunji', 'New', {}, "Washing bar soap, 1 kg bars. Carton of 25.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 10,price: 2850}] }, stock: 500 }],
  ['akinyi', 'stationery', 'exercise-books', "Exercise books 96 pages, carton of 100", 4200, 'Imara Daima', 'New', {}, "A5 96-page exercise books for schools and bookshops.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 4000},{minQty: 20,price: 3800}] }, stock: 500 }],
  ['akinyi', 'stationery', 'pens-pencils', "Ball pens, box of 50", 600, 'Imara Daima', 'New', {}, "Blue, black and red ball pens. Box of 50.", { wholesale: { enabled: true, unit: 'box', retail: true, tiers: [{minQty: 10,price: 550},{minQty: 50,price: 500}] }, stock: 500 }],
  ['akinyi', 'stationery', 'paper', "Printing paper A4, ream", 650, 'Imara Daima', 'New', {}, "80gsm A4 printing paper for offices and cyber cafés.", { wholesale: { enabled: true, unit: 'ream', retail: true, tiers: [{minQty: 10,price: 610},{minQty: 50,price: 580}] }, stock: 500 }],
  ['akinyi', 'stationery', 'school-supplies', "Mathematical sets, box of 24", 3100, 'Imara Daima', 'New', {}, "Complete maths sets for back to school.", { wholesale: { enabled: true, unit: 'box', retail: true, tiers: [{minQty: 5,price: 2900}] }, stock: 500 }],
  ['omar', 'packaging', 'food-packaging', "Takeaway containers, pack of 500", 3600, 'Industrial Area', 'New', {}, "Food takeaway containers for hotels and kibandas.", { wholesale: { enabled: true, unit: 'pack', retail: true, tiers: [{minQty: 5,price: 3400},{minQty: 20,price: 3200}] }, stock: 500 }],
  ['omar', 'packaging', 'paper-bags', "Khaki paper bags, pack of 1000", 2800, 'Industrial Area', 'New', {}, "Eco-friendly khaki paper bags in 3 sizes.", { wholesale: { enabled: true, unit: 'pack', retail: true, tiers: [{minQty: 5,price: 2600}] }, stock: 500 }],
  ['omar', 'packaging', 'cartons-boxes', "Shipping cartons, bundle of 25", 1500, 'Industrial Area', 'New', {}, "Strong brown cartons for moving and shipping.", { wholesale: { enabled: true, unit: 'bundle', retail: true, tiers: [{minQty: 10,price: 1350}] }, stock: 500 }],
  ['omar', 'packaging', 'tape-wrap', "Cling film and packing tape, carton", 4200, 'Industrial Area', 'New', {}, "Industrial cling film and brown packing tape.", { wholesale: { enabled: true, unit: 'carton', retail: true, tiers: [{minQty: 5,price: 3900}] }, stock: 500 }],
  ['halima', 'fresh-produce', 'fruits', 'Ngowe mangoes', 30, 'Kongowea', '', { unit: 'Piece' }, 'Sweet coast ngowe mangoes, in season now.'],
  ['halima', 'fresh-produce', 'fruits', 'Sweet pineapples', 100, 'Kongowea', '', { unit: 'Piece' }, 'Juicy sweet pineapples, big size.'],
  ['halima', 'fresh-produce', 'fish-meat', 'Fresh fish from the coast', 450, 'Kongowea', '', { unit: 'Kg' }, 'Fresh fish brought in from the coast every morning, cleaned for you on request.'],
  ['halima', 'fresh-produce', 'vegetables', 'Mchicha (spinach), kifungu', 10, 'Kongowea', '', { unit: 'Kifungu (bunch)' }, 'Fresh mchicha, washed and tied in bunches.'],
  // ---- importers: fresh containers (ageMin = minutes since it arrived)
  ['guangzhou', 'electronics', 'phones', 'Infinix Hot 40 Pro 256GB, new from China', 21500, 'CBD', 'New', { make: 'Infinix', model: 'Hot 40 Pro', storage: '256', ram: '8', colour: 'Black' }, 'Brand new Infinix Hot 40 Pro straight from our latest China shipment. 1 year warranty. Better prices for phone shops from 5 pieces.', { stock: 60, origin: 'china', ageMin: 18, wholesale: { enabled: true, unit: 'piece', retail: true, tiers: [{ minQty: 5, price: 20800 }, { minQty: 20, price: 20200 }] } }],
  ['guangzhou', 'electronics', 'phones', 'Xiaomi Redmi Note 13, 128GB', 24000, 'CBD', 'New', { make: 'Xiaomi', model: 'Redmi Note 13', storage: '128', ram: '6', colour: 'Blue' }, 'New Redmi Note 13, just arrived from Guangzhou. Sealed box, global version.', { stock: 40, origin: 'china', ageMin: 55 }],
  ['guangzhou', 'electronics', 'smartwatches', 'Smart watch with calls, carton of 20', 18000, 'CBD', 'New', { brand: 'Oraimo' }, 'Bluetooth calling smart watches for resellers, assorted colours. New stock this week.', { stock: 30, origin: 'china', ageMin: 120, wholesale: { enabled: true, unit: 'carton', retail: false, tiers: [{ minQty: 1, price: 18000 }, { minQty: 5, price: 17000 }] } }],
  ['guangzhou', 'electronics', 'solar-power', 'Solar panel 200W monocrystalline', 9800, 'CBD', 'New', { brand: 'Other' }, '200 watt solar panels from China with a 10 year output warranty. Fresh container.', { stock: 80, origin: 'china', ageMin: 260 }],
  ['guangzhou', 'appliances', 'kettles-toasters', 'Air fryer 5 litres, digital', 6500, 'CBD', 'New', { brand: 'Midea' }, 'Digital 5L air fryer, oil-free cooking. Imported from China, 6 month warranty.', { stock: 50, origin: 'china', ageMin: 410 }],
  ['guangzhou', 'utensils', 'cookware', 'Non-stick cookware set, 12 pieces (China)', 5200, 'CBD', 'New', { pieces: 12, material: 'Non-stick' }, 'Granite-coated cookware set made in China, for homes and gift shops.', { stock: 70, origin: 'china', ageMin: 900 }],
  ['eastleigh', 'electronics', 'phones', 'Samsung Galaxy A55 5G, ex-Dubai', 46000, 'Eastleigh', 'New', { make: 'Samsung', model: 'Galaxy A55', storage: '256', ram: '8', colour: 'Navy' }, 'New Galaxy A55 from Dubai, dual SIM, with receipt. Arrived this week.', { stock: 15, origin: 'dubai', ageMin: 35 }],
  ['eastleigh', 'electronics', 'phones', 'iPhone 14 Pro 128GB, ex-Dubai', 98000, 'Eastleigh', 'Ex-UK / refurbished', { make: 'Apple', model: 'iPhone 14 Pro', storage: '128', colour: 'Purple' }, 'Clean iPhone 14 Pro from Dubai, 90% battery health, face ID working.', { stock: 6, origin: 'dubai', ageMin: 180 }],
  ['eastleigh', 'appliances', 'fridges-freezers', 'LG 260L fridge, ex-Dubai', 52000, 'Eastleigh', 'New', { litres: 260, brand: 'LG' }, 'Double door LG fridge imported from Dubai, inverter compressor.', { stock: 5, origin: 'dubai', ageMin: 640 }],
  ['eastleigh', 'beauty', 'fragrances', 'Arabian oud perfume gift set, from Dubai', 4500, 'Eastleigh', 'New', { volume: '100 ml' }, 'Original oud and musk set straight from Dubai. Long lasting.', { stock: 40, origin: 'dubai', ageMin: 1500 }],
  ['kilindini', 'vehicles', 'cars', 'Toyota Vitz 2018, ex-Japan, just landed', 1050000, 'Kilindini', 'Foreign used', { make: 'Toyota', model: 'Vitz', year: 2018, mileage: 41000, transmission: 'Automatic', fuel: 'Petrol', body: 'Hatchback', engine: 1000, colour: 'Pearl White' }, 'Fresh ex-Japan import, cleared at Mombasa port this week. Auction sheet available. We help with registration.', { origin: 'japan', ageMin: 70 }],
  ['kilindini', 'vehicles', 'cars', 'Nissan Note 2018 e-Power, ex-Japan', 1180000, 'Kilindini', 'Foreign used', { make: 'Nissan', model: 'Note', year: 2018, mileage: 52000, transmission: 'Automatic', fuel: 'Hybrid', body: 'Hatchback', engine: 1200, colour: 'Blue' }, 'Ex-Japan Note e-Power, very low fuel use. On the latest ship.', { origin: 'japan', ageMin: 300 }],
  ['kilindini', 'vehicles', 'cars', 'Mazda Demio 2017, ex-Japan', 980000, 'Kilindini', 'Foreign used', { make: 'Mazda', model: 'Demio', year: 2017, mileage: 63000, transmission: 'Automatic', fuel: 'Petrol', body: 'Hatchback', engine: 1300, colour: 'Red' }, 'Clean ex-Japan Demio with auction sheet. Ready for registration.', { origin: 'japan', ageMin: 1100 }],
  ['kilindini', 'spare-parts', 'car-parts', 'Ex-Japan engine 1NZ-FE, tested', 85000, 'Kilindini', 'Used', { make: 'Toyota' }, 'Ex-Japan 1NZ engine for Vitz, Fielder and Probox, tested with warranty.', { stock: 4, origin: 'japan', ageMin: 2200 }],
  ['nyali', 'furniture', 'sofas', 'Ex-UK leather sofa, 3 seater', 65000, 'Nyali', 'Used', { material: 'Leather', seats: 3, colour: 'Brown' }, 'Genuine leather 3 seater from the UK, very clean. New container just opened.', { stock: 2, origin: 'ex-uk', ageMin: 95 }],
  ['nyali', 'furniture', 'dining', 'Ex-UK oak dining table with 6 chairs', 78000, 'Nyali', 'Used', { material: 'Hardwood', seats: 6 }, 'Solid oak dining set imported from the UK, ready for delivery in Mombasa.', { stock: 1, origin: 'ex-uk', ageMin: 480 }],
  ['nyali', 'furniture', 'wardrobes', 'Ex-UK 3 door wardrobe with mirror', 42000, 'Nyali', 'Used', { material: 'Hardwood' }, 'Ex-UK wardrobe, solid wood, mirror on the middle door.', { stock: 2, origin: 'ex-uk', ageMin: 1700 }],
];

// [category, sub, title, price, county, area, condition, attrs, description, negotiable]
const ADS = [
  ['vehicles', 'cars', 'Toyota Vitz 2015, 1000cc, very clean', 865000, 'Nairobi', 'Kilimani', 'Foreign used', { make: 'Toyota', model: 'Vitz', year: 2015, mileage: 68000, transmission: 'Automatic', fuel: 'Petrol', body: 'Hatchback', engine: 1000, colour: 'Silver' }, 'Fresh import, KDR registration. Very fuel efficient, ideal for town driving and ride-hailing. Push start, reverse camera, alloy rims. Accident free with all import documents.', true],
  ['vehicles', 'cars', 'Toyota Axio 2016 hybrid, low mileage', 1350000, 'Nairobi', 'Westlands', 'Foreign used', { make: 'Toyota', model: 'Axio', year: 2016, mileage: 54000, transmission: 'Automatic', fuel: 'Hybrid', body: 'Saloon', engine: 1500, colour: 'White' }, 'Clean Axio hybrid, about 22 km per litre. Leather-look seats, navigation, cruise control. Serviced at Toyota, books available.', true],
  ['vehicles', 'cars', 'Mazda Demio 2014 locally used, first owner', 640000, 'Kiambu', 'Ruiru', 'Locally used', { make: 'Mazda', model: 'Demio', year: 2014, mileage: 112000, transmission: 'Automatic', fuel: 'Petrol', body: 'Hatchback', engine: 1300, colour: 'Red' }, 'One owner since import, never in an accident. New tyres and battery. Logbook in my name, ready for transfer.', true],
  ['vehicles', 'cars', 'Subaru Forester 2017 XT turbo', 2650000, 'Nairobi', 'Karen', 'Foreign used', { make: 'Subaru', model: 'Forester', year: 2017, mileage: 61000, transmission: 'Automatic', fuel: 'Petrol', body: 'SUV', engine: 2000, colour: 'Black' }, 'Powerful 2.0 turbo, symmetrical AWD, sunroof, power seats, EyeSight safety. Perfect for upcountry trips.', false],
  ['vehicles', 'cars', 'Toyota Land Cruiser Prado TX 2018 diesel', 6900000, 'Mombasa', 'Nyali', 'Foreign used', { make: 'Toyota', model: 'Prado', year: 2018, mileage: 47000, transmission: 'Automatic', fuel: 'Diesel', body: 'SUV', engine: 2800, colour: 'White' }, '7 seater, leather interior, sunroof, 4WD with diff lock. Pristine condition, cleared at Mombasa port.', true],
  ['vehicles', 'cars', 'Toyota Probox 2014 for business', 720000, 'Nakuru', 'Nakuru Town', 'Locally used', { make: 'Toyota', model: 'Probox', year: 2014, mileage: 158000, transmission: 'Automatic', fuel: 'Petrol', body: 'Station wagon', engine: 1500, colour: 'White' }, 'Reliable business car, very economical. Recently serviced, suspension done. Selling to upgrade.', true],
  ['vehicles', 'cars', 'Honda Fit 2015 hybrid', 980000, 'Kisumu', 'Milimani', 'Foreign used', { make: 'Honda', model: 'Fit', year: 2015, mileage: 72000, transmission: 'Automatic', fuel: 'Hybrid', body: 'Hatchback', engine: 1500, colour: 'Blue' }, 'Spacious hatchback with magic seats, very economical hybrid system. Clean inside and out.', true],
  ['vehicles', 'cars', 'Nissan Note 2016 e-Power', 890000, 'Nairobi', 'Kasarani', 'Foreign used', { make: 'Nissan', model: 'Note', year: 2016, mileage: 66000, transmission: 'Automatic', fuel: 'Petrol', body: 'Hatchback', engine: 1200, colour: 'Grey' }, 'Smooth and quiet, keyless entry, push start, fog lights. Ideal first car.', true],
  ['vehicles', 'motorbikes', 'Bajaj Boxer BM 150 2023, boda ready', 118000, 'Nairobi', 'Githurai', 'Locally used', { make: 'Bajaj', model: 'Boxer BM 150', year: 2023, mileage: 14000, engine: 150, colour: 'Black' }, 'Strong boda boda bike, well maintained, logbook ready. Comes with carrier and crash guards.', true],
  ['vehicles', 'motorbikes', 'TVS HLX 125 brand new, 2024', 128000, 'Machakos', 'Machakos Town', 'Brand new', { make: 'TVS', model: 'HLX 125', year: 2024, mileage: 0, engine: 125, colour: 'Red' }, 'Brand new from the dealer with warranty. Very fuel efficient, perfect for business. Registration on request.', false],
  ['vehicles', 'trucks', 'Isuzu FRR 2017 with high body', 4300000, 'Nairobi', 'Industrial Area', 'Locally used', { make: 'Isuzu', model: 'FRR', year: 2017, mileage: 210000, tonnage: 10 }, 'Working truck, engine and gearbox in excellent shape. Good tyres. Ideal for transport business.', true],
  ['vehicles', 'buses-vans', 'Toyota Hiace 2015 matatu, 14 seater', 2450000, 'Nairobi', 'Eastleigh', 'Locally used', { make: 'Toyota', model: 'Hiace', year: 2015, mileage: 280000, seats: 14 }, 'Route ready with NTSA inspection, speed governor and good interior. Earning daily.', true],
  ['vehicles', 'tractors-machinery', 'Massey Ferguson MF 385 tractor with plough', 3200000, 'Uasin Gishu', 'Eldoret', 'Locally used', { make: 'Massey Ferguson', model: 'MF 385', year: 2012, hours: 6400 }, 'Strong 85hp tractor, comes with a 3-disc plough and trailer. Ready for the planting season.', true],

  ['electronics', 'phones', 'iPhone 13 128GB, 89% battery', 58000, 'Nairobi', 'CBD', 'Used', { make: 'Apple', model: 'iPhone 13', storage: '128', ram: '4', colour: 'Blue' }, 'Clean iPhone 13, no scratches, Face ID working, battery health 89%. Comes with case and charger.', true],
  ['electronics', 'phones', 'Samsung Galaxy S24 Ultra 256GB brand new', 145000, 'Nairobi', 'Moi Avenue', 'New', { make: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256', ram: '12', colour: 'Black' }, 'Sealed in box with 1 year warranty. S Pen included. Delivery within Nairobi.', false],
  ['electronics', 'phones', 'Tecno Camon 20 256GB', 21500, 'Kiambu', 'Thika', 'Used', { make: 'Tecno', model: 'Camon 20', storage: '256', ram: '8', colour: 'Green' }, 'Used for 6 months, perfect condition, great camera. Selling because I got a work phone.', true],
  ['electronics', 'phones', 'Infinix Hot 40 128GB new', 16500, 'Mombasa', 'Mombasa CBD', 'New', { make: 'Infinix', model: 'Hot 40', storage: '128', ram: '8', colour: 'Black' }, 'Brand new, sealed. Big battery, fast charging. Free screen protector.', false],
  ['electronics', 'laptops', 'HP EliteBook 840 G5 Core i5 8GB 256SSD', 38000, 'Nairobi', 'Luthuli Avenue', 'Refurbished', { make: 'HP', model: 'EliteBook', processor: 'Intel Core i5', ram: '8', storage: '256GB SSD' }, 'Ex-UK refurbished, very fast with SSD, backlit keyboard, 3 month warranty. Windows 11 Pro installed.', true],
  ['electronics', 'laptops', 'MacBook Air M1 2020, 8GB 256GB', 85000, 'Nairobi', 'Westlands', 'Used', { make: 'Apple', model: 'MacBook Air', processor: 'Apple M1', ram: '8', storage: '256GB SSD' }, 'Clean M1 MacBook Air, battery cycle count 210. Silent, fast and lasts all day.', true],
  ['electronics', 'tvs', 'Samsung 55" Crystal UHD 4K smart TV', 52000, 'Nairobi', 'Ngong Road', 'New', { brand: 'Samsung', screen: '55', tvtype: 'Smart / Android' }, 'Brand new with 2 year warranty. Netflix, YouTube, screen mirroring. Free delivery in Nairobi.', false],
  ['electronics', 'tvs', 'Hisense 43" smart TV, used 1 year', 22000, 'Nakuru', 'Section 58', 'Used', { brand: 'Hisense', screen: '43', tvtype: 'Smart / Android' }, 'Works perfectly, comes with remote and wall bracket. Relocating sale.', true],
  ['electronics', 'audio', 'JBL PartyBox 110 speaker', 39000, 'Nairobi', 'Kileleshwa', 'Used', { brand: 'JBL' }, 'Loud and clear with lights, battery lasts 12 hours. Great for events.', true],
  ['electronics', 'gaming', 'PlayStation 5 disc edition with 2 pads', 72000, 'Nairobi', 'South B', 'Used', { brand: 'Sony' }, 'PS5 in great condition, 2 controllers, FIFA 24 and GTA V included.', true],
  ['electronics', 'solar-power', '300W solar panel with 200Ah battery and inverter', 68000, 'Kajiado', 'Kitengela', 'New', { brand: 'Sunking', watts: 300 }, 'Complete solar kit for a home: panel, deep cycle battery, 1500W inverter and controller. Installation available.', true],

  ['land-property', 'land-for-sale', '1/8 acre plot in Kitengela, ready title', 650000, 'Kajiado', 'Kitengela', '', { size: 1, unit: '1/8 acre plots (50x100)', title: 'Ready title deed', use: 'Residential', road: 'Murram', utilities: 'Water and electricity' }, 'Prime 50x100 plot 2 km from Namanga Road. Water and electricity on site, ready title deed, quiet neighbourhood. Site visits every day.', true],
  ['land-property', 'land-for-sale', '5 acres in Kangundo Road, ready title', 9500000, 'Machakos', 'Kangundo Road', '', { size: 5, unit: 'Acres', title: 'Ready title deed', use: 'Agricultural', road: 'Tarmac', utilities: 'Electricity only' }, 'Fertile 5 acres, 500 m off the tarmac, suitable for farming or subdivision. Clean title, no encumbrances.', true],
  ['land-property', 'land-for-sale', 'Beach plot 1/4 acre in Diani', 4800000, 'Kwale', 'Diani', '', { size: 2, unit: '1/8 acre plots (50x100)', title: 'Ready title deed', use: 'Mixed use', road: 'Murram', utilities: 'Water and electricity' }, '300 m from the beach, ideal for a holiday home or Airbnb. Freehold with ready title.', false],
  ['land-property', 'land-for-sale', '2 acres in Juja Farm', 3600000, 'Kiambu', 'Juja Farm', '', { size: 2, unit: 'Acres', title: 'Share certificate', use: 'Agricultural', road: 'Murram', utilities: 'None yet' }, 'Two acres of flat, red soil land, perfect for farming. Share certificate, title processing ongoing.', true],
  ['land-property', 'houses-for-rent', '2 bedroom apartment to let in Kilimani', 65000, 'Nairobi', 'Kilimani', '', { bedrooms: 2, furnished: 'Unfurnished' }, 'Modern 2 bedroom with master en-suite, lift, backup generator, borehole and gym. Close to Yaya Centre.', false],
  ['land-property', 'houses-for-sale', '4 bedroom maisonette in Syokimau', 14500000, 'Machakos', 'Syokimau', '', { bedrooms: 4, bathrooms: 3, title: 'Ready title deed' }, 'Gated community, DSQ, ample parking, 5 minutes from the SGR terminus. Ready title.', true],

  ['beddings', 'mattresses', 'Vitafoam 5x6 high density mattress, 8 inch', 14500, 'Nairobi', 'Kariobangi', 'New', { size: '5x6', thickness: '8', brand: 'Vitafoam' }, 'Brand new orthopaedic high density mattress with quilted cover. Free delivery in Nairobi.', false],
  ['beddings', 'duvets', 'Heavy duvet 6x6 with 2 pillow cases', 3800, 'Nairobi', 'Gikomba', 'New', { size: '6x6', colour: 'Grey' }, 'Warm and soft duvet set, machine washable. Many colours available.', false],
  ['beddings', 'bed-sheets', 'Pure cotton bed sheets set 6x6', 2400, 'Mombasa', 'Mwembe Tayari', 'New', { size: '6x6', material: 'Cotton', colour: 'White' }, 'Hotel quality cotton sheets: 1 flat, 1 fitted and 2 pillow cases.', false],
  ['beddings', 'mosquito-nets', 'Rectangular mosquito net, king size', 1200, 'Kisumu', 'Kondele', 'New', {}, 'Treated mosquito net for 6x6 beds, with hanging hooks.', false],

  ['furniture', 'sofas', '7 seater L-shaped sofa, grey fabric', 68000, 'Nairobi', 'Ngara', 'New', { seats: 7, material: 'Fabric', colour: 'Grey' }, 'Made to order with high density foam and hardwood frame. Delivery within 7 days.', true],
  ['furniture', 'beds', 'Mahogany 5x6 bed with drawers', 42000, 'Nairobi', 'Kawangware', 'New', { size: '5x6', material: 'Mahogany' }, 'Solid mahogany bed with 4 storage drawers. Built to last.', true],
  ['furniture', 'dining', '6 seater glass dining table', 35000, 'Nakuru', 'Lanet', 'Used', { seats: 6, material: 'Glass' }, 'Tempered glass top with cushioned chairs, used for 1 year, still very clean.', true],
  ['furniture', 'office-furniture', 'Ergonomic office chair with headrest', 12500, 'Nairobi', 'Upper Hill', 'New', {}, 'Mesh back, lumbar support, adjustable arms and height. Bulk discounts for offices.', false],
  ['furniture', 'wardrobes', '3 door wardrobe with mirror', 28000, 'Kiambu', 'Kikuyu', 'New', { material: 'MDF' }, 'Spacious wardrobe with hanging space, shelves and full length mirror.', true],

  ['stationery', 'exercise-books', 'A4 exercise books 96 pages, pack of 24', 1100, 'Nairobi', 'River Road', 'New', { pages: '96', pack: 24 }, 'Quality ruled exercise books for schools. Wholesale prices for bulk orders.', false],
  ['stationery', 'paper', 'A4 printing paper ream, 80gsm', 650, 'Nairobi', 'Industrial Area', 'New', { size: 'A4', brand: 'Double A' }, 'Bright white 80gsm, 500 sheets. Box of 5 reams at KSh 3,100.', false],
  ['stationery', 'books', 'Grade 7 CBC textbooks full set', 7800, 'Nairobi', 'Kenyatta Avenue', 'New', { level: 'Junior secondary' }, 'All approved Grade 7 textbooks. Free delivery for orders above KSh 5,000.', false],
  ['stationery', 'pens-pencils', 'Bic ballpoint pens, box of 50', 500, 'Mombasa', 'Biashara Street', 'New', { brand: 'Bic' }, 'Blue, black and red available. Wholesale and retail.', false],

  ['packaging', 'cartons-boxes', 'Corrugated cartons, all sizes, wholesale', 45, 'Nairobi', 'Industrial Area', 'New', { material: 'Corrugated' }, 'Strong 3 and 5 ply cartons for moving, e-commerce and exports. Price per piece, minimum 100.', false],
  ['packaging', 'paper-bags', 'Branded khaki paper bags', 25, 'Nairobi', 'Kariokor', 'New', {}, 'Custom printed paper bags with your logo. Price per bag, minimum order 500.', false],
  ['packaging', 'bottles-jars', '500ml PET bottles with caps, per 100', 1800, 'Kiambu', 'Ruiru', 'New', { capacity: '500 ml', material: 'PET plastic' }, 'Clear bottles for juice, water and yoghurt businesses.', false],
  ['packaging', 'food-packaging', 'Takeaway containers 1000ml, pack of 50', 1250, 'Nairobi', 'Gikomba', 'New', {}, 'Microwave-safe containers with lids for hotels and food delivery.', false],

  ['liquor', 'whisky', 'Johnnie Walker Black Label 750ml', 4200, 'Nairobi', 'Westlands', '', { brand: 'Johnnie Walker', volume: '750 ml' }, 'Original Johnnie Walker Black Label from a licensed wines and spirits shop. Delivery within Nairobi, ID required.', false],
  ['liquor', 'wine', '4th Street sweet red wine 750ml, case of 12', 9600, 'Nairobi', 'Kilimani', '', { brand: '4th Street', wineType: 'Sweet', volume: 'Crate / case' }, 'Licensed wines and spirits distributor. Case price, delivery same day. 18+ only.', false],
  ['liquor', 'beer-cider', 'Tusker Lager 500ml crate of 25', 5200, 'Nakuru', 'Nakuru Town', '', { brand: 'Tusker', volume: 'Crate / case' }, 'Wholesale crate price for bars and events. Licensed seller.', false],
  ['liquor', 'gin', 'Gilbey\'s Gin 750ml', 1650, 'Mombasa', 'Nyali', '', { brand: 'Gilbey\'s', volume: '750 ml' }, 'Genuine Gilbey\'s gin, licensed shop. Delivery available.', false],

  ['spare-parts', 'car-parts', 'Toyota Axio/Fielder front shocks pair', 9500, 'Nairobi', 'Kirinyaga Road', 'New (aftermarket)', { make: 'Toyota', model: 'Axio', partType: 'Suspension & steering' }, 'Quality aftermarket shocks for Axio and Fielder 2012–2018. Fitting available at our garage.', true],
  ['spare-parts', 'car-parts', 'Subaru Forester EJ20 engine, ex-Japan', 185000, 'Nairobi', 'Kirinyaga Road', 'Used (ex-Japan)', { make: 'Subaru', model: 'Forester', partType: 'Engine & gearbox', partNo: 'EJ20' }, 'Low mileage ex-Japan engine, tested and guaranteed. Can arrange fitting.', true],
  ['spare-parts', 'tyres-rims', 'Bridgestone 195/65 R15 tyres, set of 4', 32000, 'Nairobi', 'Ngong Road', 'New (genuine)', { tyreSize: '195/65 R15', brand: 'Bridgestone' }, 'Brand new tyres, free fitting and balancing.', false],
  ['spare-parts', 'motorbike-parts', 'Boxer BM 150 chain and sprocket kit', 2800, 'Kiambu', 'Thika', 'New (aftermarket)', { make: 'Bajaj' }, 'Strong chain and sprocket set for Boxer 150, lasts long.', false],
  ['spare-parts', 'phone-laptop-parts', 'iPhone 11 replacement screen with fitting', 6500, 'Nairobi', 'Moi Avenue', 'New (aftermarket)', { brand: 'Apple', partNo: 'iPhone 11' }, 'High quality screen replacement done in 30 minutes, 3 month warranty.', false],

  ['bicycles', 'mountain-bikes', 'Mountain bike 26", 21 speed, front suspension', 18500, 'Nairobi', 'Kileleshwa', 'New', { brand: 'Phoenix', wheel: '26"', gears: 21 }, 'Aluminium frame, disc brakes, Shimano gears. Great for trails and town.', true],
  ['bicycles', 'kids-bikes', 'Kids bicycle 16" with training wheels', 7500, 'Mombasa', 'Bamburi', 'New', { wheel: '16"' }, 'For ages 4–7. Bell, basket and training wheels included.', false],
  ['bicycles', 'city-bikes', 'Black Mamba roadmaster bicycle', 11500, 'Kisumu', 'Kisumu CBD', 'New', { brand: 'Roadmaster', wheel: '28"', gears: 1 }, 'Strong classic bicycle for business and carrying loads.', false],

  ['appliances', 'cookers-ovens', 'Von Hotpoint 4 burner standing cooker with oven', 38000, 'Nairobi', 'Thika Road', 'New', { burners: '4', power: 'Gas & electric', brand: 'Von Hotpoint' }, '3 gas + 1 electric with electric oven. Warranty included.', false],
  ['appliances', 'gas', '13kg K-Gas cylinder with burner, full', 7200, 'Nairobi', 'Kahawa', 'New', { kg: '13 kg' }, 'Full 13kg cylinder with a 2-burner top and regulator. Delivery and refills available.', false],
  ['appliances', 'fridges-freezers', 'Hisense 205L double door fridge', 34500, 'Kiambu', 'Kiambu Town', 'New', { litres: 205, brand: 'Hisense' }, 'Energy saving, freezer on top, 2 year warranty.', false],
  ['appliances', 'commercial-kitchen', 'Commercial double deep fryer 12L', 26000, 'Nairobi', 'Kariokor', 'New', { brand: 'Other' }, 'Stainless steel, electric, perfect for chips businesses and hotels.', true],
  ['appliances', 'blenders', 'Ramtons 1.5L blender', 4800, 'Nakuru', 'Nakuru Town', 'New', { brand: 'Ramtons' }, 'Powerful blender with grinder mill, 1 year warranty.', false],

  ['utensils', 'cookware', 'Non-stick sufuria set, 5 pieces', 4500, 'Nairobi', 'Gikomba', 'New', { material: 'Non-stick', pieces: 5 }, 'Durable non-stick sufurias with glass lids, sizes 16–24 cm.', false],
  ['utensils', 'plates-bowls', '24 piece dinner set, ceramic', 6800, 'Mombasa', 'Mombasa CBD', 'New', { material: 'Ceramic', pieces: 24 }, 'Elegant white dinner set: plates, bowls and side plates for 6.', false],
  ['utensils', 'flasks', 'Thermos flask 2.5L', 1600, 'Kisumu', 'Kondele', 'New', { material: 'Stainless steel' }, 'Keeps tea hot for 12 hours. Many colours.', false],
  ['utensils', 'catering', 'Chafing dishes for catering, set of 4', 22000, 'Nairobi', 'Industrial Area', 'New', { material: 'Stainless steel', pieces: 4 }, 'Hotel grade chafing dishes for weddings and events. Also for hire.', true],

  ['clothes-shoes', 'mens-clothes', 'Men’s slim fit official suit, 3 piece', 8500, 'Nairobi', 'Moi Avenue', 'New', { size: 'L', gender: 'Men', colour: 'Blue' }, 'Turkish fabric suit with jacket, trousers and waistcoat. All sizes available.', false],
  ['clothes-shoes', 'womens-clothes', 'Ankara maxi dresses, made to measure', 3500, 'Nairobi', 'Kenyatta Market', 'New', { size: 'M', gender: 'Women', colour: 'Multi-colour' }, 'Beautiful kitenge dresses tailored to your size within 3 days.', false],
  ['clothes-shoes', 'mens-shoes', 'Men’s leather official shoes', 4500, 'Nairobi', 'Ngara', 'New', { shoeSize: '42', gender: 'Men', colour: 'Brown' }, 'Genuine leather, comfortable for work. Sizes 39–46.', false],
  ['clothes-shoes', 'womens-shoes', 'Mtumba sneakers, grade 1', 1800, 'Nairobi', 'Gikomba', 'Used (mtumba)', { shoeSize: '38', gender: 'Women' }, 'Clean grade 1 mtumba sneakers, many brands and sizes.', true],
  ['bags', 'handbags', 'Ladies leather handbag', 3200, 'Nairobi', 'Westlands', 'New', { material: 'Faux leather', colour: 'Black' }, 'Stylish handbag with shoulder strap and 3 compartments.', false],
  ['bags', 'backpacks', 'Laptop backpack, water resistant', 2800, 'Kiambu', 'Thika', 'New', { material: 'Nylon', colour: 'Grey' }, 'Fits 15.6" laptops, USB charging port, anti-theft pocket.', false],
  ['bags', 'travel-bags', 'Hard shell suitcase set of 3', 12500, 'Mombasa', 'Nyali', 'New', { material: 'Plastic', colour: 'Blue' }, '20", 24" and 28" trolley suitcases with TSA locks.', true],
  ['beauty', 'hair-care', 'Natural hair growth oil 100ml', 950, 'Nairobi', 'CBD', 'New', { brand: 'Other', volume: '100 ml' }, 'Rosemary and castor oil blend for strong, healthy hair.', false],
  ['beauty', 'wigs-extensions', 'Human hair lace front wig 18"', 14500, 'Nairobi', 'Kilimani', 'New', {}, 'Brazilian human hair, natural look, can be dyed and styled.', true],
  ['beauty', 'fragrances', 'Arabian oud perfume 100ml', 2500, 'Mombasa', 'Old Town', 'New', { volume: '100 ml' }, 'Long-lasting original oud perfume for men and women.', false],
  ['beauty', 'skin-care', 'Shea butter body lotion 400ml', 850, 'Kisumu', 'Kisumu CBD', 'New', { brand: 'Nivea', volume: '400 ml' }, 'Deep moisture for dry skin. Wholesale available.', false],
  ['detergents-cleaning', 'washing-powder', 'Omo washing powder 5kg', 1350, 'Nairobi', 'Eastleigh', 'New', { brand: 'Omo', pack: '5kg' }, 'Original Omo multi-active. Wholesale prices for shops.', false],
  ['detergents-cleaning', 'bar-soap', 'Jamaa bar soap, carton of 20', 2900, 'Nakuru', 'Nakuru Town', 'New', { brand: 'Jamaa', pack: 'carton of 20 x 800g' }, 'Laundry bar soap, wholesale carton.', false],
  ['detergents-cleaning', 'bleach-disinfectant', 'Jik bleach 5 litres', 980, 'Nairobi', 'Kawangware', 'New', { brand: 'Jik', pack: '5L' }, 'Regular Jik for whitening and disinfecting.', false],
  ['detergents-cleaning', 'cleaning-tools', 'Spin mop with bucket', 2400, 'Kiambu', 'Ruiru', 'New', {}, '360° spin mop with 2 extra heads.', false],
  ['cooking-products', 'cooking-oil', 'Fresh Fri cooking oil 20 litres', 6900, 'Nairobi', 'Industrial Area', 'New', { brand: 'Fresh Fri', pack: '20L' }, 'Jerrycan of Fresh Fri vegetable oil. Wholesale for hotels and shops.', false],
  ['cooking-products', 'flour', 'Jogoo maize flour 2kg, bale of 12', 2350, 'Nairobi', 'Kariobangi', 'New', { brand: 'Jogoo', pack: 'bale of 12 x 2kg' }, 'Bale price for retailers, delivery in Nairobi.', false],
  ['cooking-products', 'rice-cereals', 'Pishori rice 25kg', 4800, 'Kirinyaga', 'Mwea', 'New', { brand: 'Mwea Pishori', pack: '25kg' }, 'Aromatic pishori rice direct from Mwea farmers.', true],
  ['cooking-products', 'spices', 'Pilau masala 1kg', 650, 'Mombasa', 'Biashara Street', 'New', { pack: '1kg' }, 'Freshly ground Mombasa pilau masala.', false],
  ['beverages', 'soft-drinks', 'Coca-Cola 500ml crate of 24', 1650, 'Nairobi', 'Kasarani', 'New', { brand: 'Coca-Cola', pack: 'crate of 24' }, 'Wholesale crate price for shops and events.', false],
  ['beverages', 'water', 'Drinking water 20L refills, delivered', 250, 'Nairobi', 'Ruaka', 'New', { pack: '20L' }, 'Purified drinking water refills delivered to your door.', false],
  ['beverages', 'tea-coffee', 'Kenya AA coffee beans 1kg', 2200, 'Nyeri', 'Nyeri Town', 'New', { brand: 'Other', pack: '1kg' }, 'Freshly roasted AA beans from Nyeri farms. Whole bean or ground.', false],
  ['beverages', 'juices', 'Pick N Peel mango juice 1L, carton of 12', 2900, 'Kiambu', 'Kiambu Town', 'New', { brand: 'Pick N Peel', pack: 'carton of 12' }, 'Carton price for retailers.', false],
  ['baby-kids', 'baby-gear', 'Chicco stroller with car seat, travel system', 18500, 'Nairobi', 'South C', 'Used', { brand: 'Chicco', gender: 'Unisex', age: '0-12 months' }, 'Lightweight travel system: stroller plus infant car seat. Folds easily, all straps and the rain cover included. Used for one baby only.', true],
  ['baby-kids', 'nursery', 'Wooden baby cot with mattress', 12500, 'Kiambu', 'Ruaka', 'New', { gender: 'Unisex', age: '0-12 months' }, 'Solid wood cot with adjustable base, teething rails and a breathable foam mattress. Converts to a toddler bed.', false],
  ['baby-kids', 'diapers-care', 'Pampers Baby-Dry size 3, jumbo pack of 82', 2650, 'Nairobi', 'Westlands', 'New', { brand: 'Pampers', age: '0-12 months' }, 'Original Pampers Baby-Dry, up to 12 hours dryness. Wholesale prices for 3 packs and above.', false],
  ['baby-kids', 'toys', 'Kids ride-on electric car, rechargeable', 16500, 'Mombasa', 'Nyali', 'New', { gender: 'Unisex', age: '3-5 years' }, 'Battery-powered ride-on car with remote control for parents, music and lights. Ages 2-6.', true],
  ['baby-kids', 'kids-clothes', 'Baby clothes bundle 0-6 months, 12 pieces', 2200, 'Nairobi', 'Gikomba', 'New', { size: '3-6 months', gender: 'Unisex' }, 'Soft cotton rompers, vests and socks: everything for a newborn in one bundle. Great baby-shower gift.', false],
  ['baby-kids', 'feeding', 'Baby high chair, foldable', 5800, 'Nakuru', 'Milimani', 'New', { gender: 'Unisex', age: '0-12 months' }, 'Adjustable height, removable tray and 5-point harness. Folds flat for storage.', false],
  ['other', 'farming', 'Improved Kienyeji chicks, 1 month old', 350, 'Kakamega', 'Kakamega Town', 'New', {}, 'Vaccinated improved kienyeji chicks. Price per chick.', false],
  ['other', 'tools', 'Mabati iron sheets gauge 30', 850, 'Nairobi', 'Mlolongo', 'New', {}, 'Box profile iron sheets per metre. Delivery available.', false],
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Marketplace demo data in database:', mongoose.connection.name);
  await (async () => {
    const sellers = [];
    const Market = require('../models/Market');
    await require('../market/markets').ensureMarkets(Market);
    const byUser = {};
    for (const [name, user, phone] of [...SELLERS, ...SHOP_SELLERS]) {
      const email = `${user}@demo.kapu.test`;
      let customer = await Customer.findOne({ email });
      if (!customer) {
        if (await Customer.exists({ phone })) throw new Error(`Phone ${phone} is already used by another customer`);
        customer = await Customer.create({ name, email, phone, password: 'demo1234' });
      }
      const sh = SHOPS[user];
      if (sh) {
        const order = sh[6] || {};
        const market = order.market ? await Market.findOne({ slug: order.market }).lean() : null;
        customer.shopLocation = {
          name: sh[0], address: sh[1], area: sh[2], county: sh[3], point: { type: 'Point', coordinates: [sh[5], sh[4]] }, public: true, updatedAt: new Date(),
          kinds: order.kinds || ['shop'], wear: order.wear || [], walk: order.walk || { enabled: false }, ...(order.hours ? { hours: order.hours } : {}),
          ...(market ? { market: market._id, marketName: market.name, marketSlug: market.slug, stall: order.stall || '' } : {}),
        };
        if (order.chemist) customer.chemist = { ...order.chemist, at: new Date(), verifiedAt: new Date() };
        if (PAYS[user]) customer.payDetails = { ...PAYS[user], ...(['pochi', 'phone'].includes(PAYS[user].method) ? { phone } : {}), name: sh[0] };
        await customer.save();
      }
      byUser[user] = customer;
      if (SELLERS.some((seller) => seller[1] === user)) sellers.push(customer);
    }
    // every demo account (the named sellers and the demo dealers made below)
    const ids = [...new Set([...Object.values(byUser).map((value) => String(value._id)), ...(await Customer.find({ email: /@demo\.kapu\.test$/ }).distinct('_id')).map(String)])];
    if (process.argv.includes('--remove')) {
      const ads = await Listing.find({ seller: { $in: ids } }).select('_id');
      const cs = await Conversation.find({ $or: [{ listing: { $in: ads.map((ad) => ad._id) } }, { buyer: { $in: ids } }] }).select('_id');
      await ChatMessage.deleteMany({ conversation: { $in: cs.map((item) => item._id) } });
      await Conversation.deleteMany({ _id: { $in: cs.map((item) => item._id) } });
      await Listing.deleteMany({ seller: { $in: ids } });
      await Customer.deleteMany({ _id: { $in: ids } });
      console.log(`Removed ${ads.length} demo ads and ${ids.length} demo sellers.`);
      return;
    }
    const old = await Listing.find({ seller: { $in: ids } }).select('_id');
    const convs = await Conversation.find({ listing: { $in: old.map((item) => item._id) } }).select('_id');
    await ChatMessage.deleteMany({ conversation: { $in: convs.map((conv) => conv._id) } });
    await Conversation.deleteMany({ _id: { $in: convs.map((conv) => conv._id) } });
    await Listing.deleteMany({ seller: { $in: ids } });

    // a dealer for each trade in each county (the named Nairobi / Mombasa shops, or a demo dealer there)
    const dealers = {};
    let nDealer = 0;
    for (const [category, , , , county, area] of ADS) {
      const tradeOfResult = tradeOf(category);
      const key = `${tradeOfResult}|${county}`;
      if (dealers[key]) continue;
      if (TRADES[tradeOfResult].at[county]) {
        dealers[key] = byUser[TRADES[tradeOfResult].at[county]];
        continue;
      }
      const slug = `${tradeOfResult}-${normalize(county).replace(/[^a-z0-9]+/g, '-')}`;
      const email = `${slug}@demo.kapu.test`;
      const number = nDealer++;
      const person = DEALER_NAMES[number % DEALER_NAMES.length];
      let customer = await Customer.findOne({ email });
      if (!customer) {
        let phone = `2547001003${String(10 + number).padStart(2, '0')}`;
        while (await Customer.exists({ phone })) phone = `2547001004${String(Math.floor(Math.random() * 90) + 10)}`;
        customer = await Customer.create({ name: `${person} ${TRADES[tradeOfResult].name.split(' ')[0]}`, email, phone, password: 'demo1234' });
      }
      const [lat, lng] = PLACES[`${county}/${area}`] || PLACES[county] || PLACES.Nairobi;
      const jig = ((number % 7) - 3) * 0.0012; // dealers in the same town aren't on top of each other
      customer.shopLocation = {
        name: `${area} ${TRADES[tradeOfResult].name}`, address: `${area}, ${county}`, area, county, point: { type: 'Point', coordinates: [lng + jig, lat - jig] }, public: true, updatedAt: new Date(),
        kinds: TRADES[tradeOfResult].kinds, wear: tradeOfResult === 'fashion' ? ['women', 'men'] : [], walk: { enabled: false },
      };
      customer.payDetails = { method: 'till', till: String(700000 + number * 137), name: customer.shopLocation.name };
      await customer.save();
      byUser[slug] = customer;
      dealers[key] = customer;
    }

    const now = Date.now();
    const docs = ADS.map(([category, sub, title, price, county, area, condition, attrs, description, negotiable], index) => {
      const dealer = dealers[`${tradeOf(category)}|${county}`];
      // the ad is where the dealer's shop is
      county = dealer.shopLocation.county;
      area = dealer.shopLocation.area;
      const listing = { category, sub, title, price, county, area, condition, attrs, description, negotiable, seller: dealer._id, sellerName: dealer.name, status: 'active', views: Math.floor(Math.random() * 400) };
      listing.slug = `${normalize(`${title} ${area}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(3).toString('hex')}`;
      // new, everyday items can be bought online ("Buy now"); vehicles, land and big used items stay contact-only
      if (canBuyNow(category, sub) && (!condition || /^new/i.test(condition)) && price > 0 && price < 200000 && index % 5 !== 4) {
        listing.buyNow = true;
        listing.stock = 3 + ((index * 7) % 40);
        listing.delivery = { available: true, fee: [0, 150, 200, 300][index % 4], pickup: true, days: index % 2 ? '1-2 days' : 'Same day in town' };
      }
      // bulk-friendly stock gets wholesale prices (bei ya jumla)
      if (listing.buyNow && ['packaging', 'cooking-products', 'beverages', 'detergents-cleaning', 'stationery'].includes(category)) {
        const unit = /crate/i.test(title) ? 'crate' : /carton/i.test(title) ? 'carton' : /bale/i.test(title) ? 'bale' : /pack|box/i.test(title) ? 'pack' : 'unit';
        const result = (number) => Math.max(1, Math.round(number / 5) * 5);
        listing.stock = 300 + index * 7;
        listing.wholesale = { enabled: true, unit, retail: index % 3 !== 0, tiers: [{ minQty: 10, price: result(price * 0.9) }, { minQty: 50, price: result(price * 0.82) }, { minQty: 200, price: result(price * 0.75) }] };
      }
      // where it comes from
      const ORIGIN_BY_CAT = { vehicles: ['japan', 'japan', 'dubai', 'ex-uk'], electronics: ['china', 'usa', 'ex-uk', 'china', 'dubai'], furniture: ['local', 'china', 'local', 'europe'], beddings: ['local', 'china'], 'spare-parts': ['japan', 'dubai', 'china'], 'clothes-shoes': ['ex-uk', 'china', 'local', 'europe'], bags: ['china', 'europe', 'local'], beauty: ['dubai', 'europe', 'usa', 'local'], 'appliances': ['china', 'europe'], utensils: ['china', 'local'], 'baby-kids': ['china', 'ex-uk', 'usa'], bicycles: ['china', 'ex-uk'], liquor: ['europe', 'local', 'usa'] };
      const choices = ORIGIN_BY_CAT[category];
      const originForResult = originFor(listing, (dealer.shopLocation?.kinds || []).includes('importer'));
      listing.origin = originForResult === null ? (choices ? choices[index % choices.length] : '') : originForResult;
      // Lipa Pole Pole on bigger electronics and furniture sold online
      if (listing.buyNow && ((category === 'electronics' && ['phones', 'laptops', 'tvs', 'audio', 'gaming'].includes(sub)) || category === 'furniture') && price >= 5000) {
        listing.layaway = { enabled: true, minDepositPercent: category === 'furniture' ? 20 : 30, maxWeeks: category === 'furniture' ? 8 : 4 };
      }
      // a colour for items that have one (so the colour filter has something to show)
      if (fieldsFor(category, sub).some((item) => item.key === 'colour') && !listing.attrs.colour) listing.attrs = { ...listing.attrs, colour: ['Black', 'White', 'Grey', 'Blue', 'Red', 'Brown', 'Beige', 'Green', 'Pink', 'Silver', 'Navy', 'Cream'][index % 12] };
      const pin = require('../market/geo').pinFor(dealer, county);
      if (pin) listing.geo = pin;
      listing.keywords = keywordsFor(listing);
      listing.createdAt = new Date(now - index * 47 * 60 * 1000); // spread over the last few days
      listing.updatedAt = listing.createdAt;
      return listing;
    });
    const { ITEMS, guessItem } = require('../market/categories');
    for (const doc of docs) if (ITEMS[doc.sub] && !doc.attrs.item) doc.attrs = { ...doc.attrs, item: guessItem(doc.sub, `${doc.title} ${doc.description}`) };
    [...SHOP_ADS, ...require('./demoFishAds')].forEach(([user, category, sub, title, price, area, condition, attrs, description, extra], index) => {
      const customer = byUser[user];
      const county = customer.shopLocation.county;
      area = customer.shopLocation.area; // the ad is where the shop is
      const fresh = category === 'fresh-produce' || category === 'samaki'; // sold by the kg / piece / plate, same day
      const date = {
        category, sub, title, price, county, area, condition, attrs, description, negotiable: !fresh, seller: customer._id, sellerName: customer.name, status: 'active', views: Math.floor(Math.random() * 300),
        buyNow: attrs.rx !== 'Prescription needed', stock: attrs.rx === 'Prescription needed' ? 0 : fresh ? 200 : 6 + (index % 15), delivery: { available: true, fee: fresh ? 100 : 200, pickup: true, days: 'Same day' },
      };
      const byCondition = /ex-Japan/i.test(condition) ? 'japan' : /ex-UK|mtumba/i.test(condition) ? 'ex-uk' : /ex-Dubai/i.test(condition) ? 'dubai' : '';
      const originForResult = originFor(date, (customer.shopLocation?.kinds || []).includes('importer'));
      date.origin = fresh ? 'local' : originForResult || byCondition;
      const { ageMin, ...rest } = extra || {};
      Object.assign(date, rest); // bulk prices, stock, origin
      date.weightKg = date.weightKg ?? weightFor(sub, title); // about how heavy one item is (agents deliver light parcels free nearby)
      date.slug = `${normalize(`${title} ${area}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(3).toString('hex')}`;
      const pin = require('../market/geo').pinFor(customer, county);
      if (pin) date.geo = pin;
      date.keywords = keywordsFor(date);
      date.createdAt = new Date(now - (ageMin ?? index * 31 + 5) * 60 * 1000);
      date.updatedAt = date.createdAt;
      docs.push(date);
    });
    // traders inside the markets (markets near me), selling what each market is known for
    const slugOf = (title, area) => `${normalize(`${title} ${area}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(3).toString('hex')}`;
    // demo riders & shopping agents (approved but "not taking jobs": they never get real job alerts)
    {
      const FIELD = [
        ['rider', 'Kevin Odhiambo', 'Motorbike', 'KMFB 211C', 'Imara Daima stage', -1.3299, 36.8871],
        ['rider', 'Brian Kiprotich', 'Motorbike', 'KMEZ 870A', 'Nairobi CBD, Ronald Ngala', -1.2840, 36.8290],
        ['rider', 'Peter Mwangi', 'Tuk-tuk', 'KTWB 455D', 'Githurai 45 stage', -1.2045, 36.9131],
        ['rider', 'Salim Juma', 'Motorbike', 'KMDX 334B', 'Mombasa, Kongowea', -4.0279, 39.6928],
        ['rider', 'Faith Atieno', 'Bicycle', '', 'Kisumu, Kibuye', -0.0904, 34.7638],
        ['agent', 'Mercy Wanjiru', '', '', 'Kariokor Market', -1.2758, 36.8352],
        ['agent', 'Joseph Mutua', '', '', 'Gikomba Market', -1.2849, 36.8396],
        ['agent', 'Amina Hassan', '', '', 'Imara Daima', -1.3305, 36.8875],
        ['agent', 'Grace Chebet', '', '', 'Eldoret town', 0.5185, 35.273],
      ];
      for (const [key, [role, name, vehicle, plate, baseArea, lat, lng]] of FIELD.entries()) {
        const email = `${role === 'rider' ? 'rider' : 'agent'}-${key + 1}@demo.kapu.test`;
        let customer = await Customer.findOne({ email });
        if (!customer) {
          let phone = `2547001006${String(10 + key).padStart(2, '0')}`;
          while (await Customer.exists({ phone })) phone = `2547001007${String(Math.floor(Math.random() * 90) + 10)}`;
          customer = await Customer.create({ name, email, phone, password: 'demo1234' });
        }
        customer.worker = {
          role, status: 'approved', idNumber: String(30000000 + key * 1111), vehicle: vehicle || undefined, plate: plate || undefined,
          base: { type: 'Point', coordinates: [lng, lat] }, baseArea, radiusKm: role === 'rider' ? 6 : 4, available: false,
          mpesaPhone: customer.phone, appliedAt: new Date(now - (40 - key) * 86400000), approvedAt: new Date(now - (38 - key) * 86400000),
        };
        await customer.save();
        byUser[email.split('@')[0]] = customer;
      }
    }
    const stalls = await require('./seedMarketTraders').addMarketTraders({ Customer, Market, helpers: { slugOf, keywordsFor, weightFor }, now });
    stalls.traders.forEach((trader) => { byUser[trader.email.split('@')[0]] = trader; });
    docs.push(...stalls.docs);
    const inserted = await Listing.insertMany(docs, { timestamps: false });
    await Listing.syncIndexes();
    // demo paid promotions (sellers boosting ads) over the last ~90 days, so Admin → Promotions has data
    {
      const Boost = require('../models/Boost');
      await Boost.deleteMany({ seller: { $in: ids } });
      const PLANS = [['week', 7, 100], ['twoweeks', 14, 150], ['month', 30, 250]];
      const pick = inserted.filter((listing, index) => listing.buyNow && index % 3 === 0);
      const boosts = [];
      let item = 7;
      const rnd = () => ((item = (item * 9301 + 49297) % 233280) / 233280); // repeatable
      for (let day = 89; day >= 0; day--) {
        const sum = Math.floor(rnd() * (day < 30 ? 5 : 3)); // busier lately
        for (let key = 0; key < sum; key++) {
          const listing = pick[Math.floor(rnd() * pick.length)];
          const [plan, days, amount] = PLANS[rnd() < 0.5 ? 1 : rnd() < 0.6 ? 0 : 2];
          const paidAt = new Date(now - day * 86400000 - Math.floor(rnd() * 12 * 3600000));
          boosts.push({ listing: listing._id, listingTitle: listing.title, seller: listing.seller, plan, days, amount, status: 'paid', phone: '254700000000', receipt: `DEMO${crypto.randomBytes(3).toString('hex').toUpperCase()}`, paidAt, startsAt: paidAt, endsAt: new Date(paidAt.getTime() + days * 86400000), createdAt: paidAt, updatedAt: paidAt });
        }
      }
      if (boosts.length) {
        await Boost.insertMany(boosts, { timestamps: false });
        // ads still featured today
        for (const element of boosts.filter((boost) => boost.endsAt > new Date())) await Listing.updateOne({ _id: element.listing, boostedUntil: { $not: { $gte: element.endsAt } } }, { $set: { boostedUntil: element.endsAt } });
      }
      console.log(`Added ${boosts.length} demo paid promotions (KSh ${boosts.reduce((total, boost) => total + boost.amount, 0).toLocaleString('en-KE')}).`);
    }
    console.log(`Added ${docs.length} demo ads from ${Object.keys(byUser).length} demo sellers (${stalls.traders.length} market traders).`);
    // the people tables (buyers, retailers, wholesalers, importers, riders, shopping agents)
    for (const value of Object.values(require('../models/Directory'))) await value.syncIndexes();
    const people = await require('../market/directory').rebuild();
    console.log('People tables:', Object.entries(people).map(([key, value]) => `${value} ${key}`).join(', '));
    console.log('Demo seller logins (password demo1234):', [...SELLERS, ...SHOP_SELLERS].map(([, value]) => `${value}@demo.kapu.test`).join(', '));
  })();
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
