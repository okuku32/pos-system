// Demo traders inside the markets ("markets near me"): each market gets stalls that sell what that market is
// known for (vegetables at Wakulima, mitumba at Gikomba, fish at City Market, spices at Mackinnon, crafts at Kariokor…).
// Used by seedMarket.js. Logins: mkt-<market>-<n>@demo.kapu.test / demo1234

// what a stall sells: [category, sub, title, price, condition, attrs, description]
const width = { gender: 'Women' };
const match = { gender: 'Men' };
const STOCK = {
  veg: { label: 'Greens', kinds: ['mama-mboga', 'market-stall'], fresh: true, items: [
    ['fresh-produce', 'vegetables', 'Sukuma wiki, fresh kifungu', 10, '', { unit: 'Kifungu (bunch)', grown: 'Local farm' }, 'Fresh sukuma wiki picked this morning.'],
    ['fresh-produce', 'tomatoes-onions', 'Tomatoes, firm and ripe', 110, '', { unit: 'Kg', grown: 'Local farm' }, 'Firm red tomatoes for cooking and salads.'],
    ['fresh-produce', 'vegetables', 'Spinach, big kifungu', 10, '', { unit: 'Kifungu (bunch)' }, 'Tender spinach, washed and tied.'],
    ['fresh-produce', 'tomatoes-onions', 'Red onions', 100, '', { unit: 'Kg' }, 'Dry red onions that keep well.'],
    ['fresh-produce', 'vegetables', 'Managu (African nightshade)', 10, '', { unit: 'Kifungu (bunch)', grown: 'Organic' }, 'Traditional managu, freshly harvested.'],
    ['fresh-produce', 'potatoes-tubers', 'Potatoes (waru), Shangi', 80, '', { unit: 'Kg' }, 'Clean Shangi potatoes for chips and stews.'],
    ['fresh-produce', 'vegetables', 'Carrots, sweet', 90, '', { unit: 'Kg' }, 'Sweet crunchy carrots.'],
    ['fresh-produce', 'vegetables', 'Cabbage, big head', 60, '', { unit: 'Piece' }, 'Big firm cabbages.'],
  ] },
  fruit: { label: 'Fruits', kinds: ['mama-mboga', 'market-stall'], fresh: true, items: [
    ['fresh-produce', 'fruits', 'Sweet bananas, ripe', 120, '', { unit: 'Dozen' }, 'Sweet ripe bananas, sold by the dozen.'],
    ['fresh-produce', 'fruits', 'Hass avocados', 25, '', { unit: 'Piece', grown: 'Local farm' }, 'Creamy Hass avocados from Murang’a.'],
    ['fresh-produce', 'fruits', 'Apple mangoes', 40, '', { unit: 'Piece' }, 'Big sweet apple mangoes.'],
    ['fresh-produce', 'fruits', 'Oranges, juicy', 20, '', { unit: 'Piece' }, 'Juicy oranges for fresh juice.'],
    ['fresh-produce', 'fruits', 'Pawpaw, ripe', 80, '', { unit: 'Piece' }, 'Sweet ripe pawpaw.'],
    ['fresh-produce', 'fruits', 'Watermelon, big', 250, '', { unit: 'Piece' }, 'Big sweet watermelons.'],
    ['fresh-produce', 'fruits', 'Passion fruits', 200, '', { unit: 'Kg' }, 'Purple passion fruits for juice.'],
  ] },
  cereals: { label: 'Cereals', kinds: ['grocery', 'market-stall'], fresh: true, items: [
    ['fresh-produce', 'fresh-cereals', 'Rosecoco beans', 180, '', { unit: 'Kg' }, 'Clean rosecoco beans, sorted.'],
    ['fresh-produce', 'fresh-cereals', 'Dry maize', 70, '', { unit: 'Kg' }, 'Dry white maize for githeri or milling.'],
    ['fresh-produce', 'fresh-cereals', 'Green grams (ndengu)', 200, '', { unit: 'Kg' }, 'Clean ndengu from Machakos.'],
    ['fresh-produce', 'eggs-poultry', 'Eggs, tray of 30', 420, '', { unit: 'Tray' }, 'Fresh eggs, grade 1.'],
    ['fresh-produce', 'eggs-poultry', 'Kienyeji eggs, tray', 600, '', { unit: 'Tray', grown: 'Organic' }, 'Free-range kienyeji eggs.'],
    ['fresh-produce', 'fresh-cereals', 'Njahi (black beans)', 220, '', { unit: 'Kg' }, 'Njahi beans, great for mothers after birth.'],
  ] },
  fish: { label: 'Fish & Meat', kinds: ['mama-mboga', 'market-stall'], fresh: true, items: [
    ['samaki', 'fresh-victoria-fish', 'Fresh tilapia (ngege)', 450, '', { fish: 'Ngege (tilapia)', form: 'Whole', unit: 'Kg', from: 'Kisumu (Dunga, Kichinjio)' }, 'Fresh tilapia from Lake Victoria, cleaned on request.'],
    ['samaki', 'fresh-omena', 'Omena (dagaa), dry', 100, '', { form: 'Cleaned, no sand', unit: 'Fungu (heap)', from: 'Homa Bay' }, 'Clean dry omena, sand-free.'],
    ['fresh-produce', 'fish-meat', 'Beef, fresh', 750, '', { unit: 'Kg' }, 'Fresh beef, with or without bones.'],
    ['fresh-produce', 'fish-meat', 'Goat meat', 900, '', { unit: 'Kg' }, 'Fresh goat meat for nyama choma or stew.'],
    ['fresh-produce', 'eggs-poultry', 'Kienyeji chicken, whole', 1000, '', { unit: 'Piece', grown: 'Organic' }, 'Free-range kienyeji chicken, slaughtered and cleaned.'],
  ] },
  spices: { label: 'Spices', kinds: ['grocery', 'market-stall'], fresh: false, items: [
    ['cooking-products', 'spices', 'Pilau masala, freshly ground', 80, 'New', {}, 'Coast pilau masala, ground at the stall.'],
    ['cooking-products', 'spices', 'Turmeric (manjano) powder', 60, 'New', {}, 'Pure turmeric powder.'],
    ['cooking-products', 'spices', 'Whole black pepper', 120, 'New', {}, 'Whole black peppercorns.'],
    ['cooking-products', 'spices', 'Cinnamon sticks (mdalasini)', 100, 'New', {}, 'Cinnamon sticks for chai and pilau.'],
    ['cooking-products', 'spices', 'Cardamom (iliki)', 150, 'New', {}, 'Green cardamom for chai.'],
  ] },
  clothes: { label: 'Mitumba', kinds: ['boutique', 'market-stall'], wear: ['men', 'women'], fresh: false, items: [
    ['clothes-shoes', 'mens-clothes', 'Mtumba jeans, grade 1', 500, 'Used (mtumba)', { item: 'Jeans', size: 'L', ...match, colour: 'Blue' }, 'Grade 1 mtumba jeans, all sizes.'],
    ['clothes-shoes', 'womens-clothes', 'Mtumba dresses, assorted', 550, 'Used (mtumba)', { item: 'Dresses', size: 'M', ...width }, 'Fresh bale of dresses, many styles.'],
    ['clothes-shoes', 'mens-clothes', 'Mtumba jackets and coats', 900, 'Used (mtumba)', { item: 'Jackets & coats', size: 'XL', ...match }, 'Warm jackets for the cold season.'],
    ['clothes-shoes', 'womens-clothes', 'Mtumba blouses, grade 1', 300, 'Used (mtumba)', { item: 'Tops & blouses', size: 'M', ...width }, 'Clean grade 1 blouses.'],
    ['clothes-shoes', 'mens-clothes', 'Mtumba t-shirts', 200, 'Used (mtumba)', { item: 'T-shirts & polos', size: 'M', ...match }, 'T-shirts, 3 for KSh 500.'],
    ['clothes-shoes', 'mens-clothes', 'Mtumba sweaters', 450, 'Used (mtumba)', { item: 'Sweaters & hoodies', size: 'L', ...match }, 'Warm sweaters and cardigans.'],
  ] },
  shoes: { label: 'Shoes', kinds: ['boutique', 'market-stall'], wear: ['men', 'women'], fresh: false, items: [
    ['clothes-shoes', 'mens-shoes', 'Mtumba sneakers, Nike & Adidas', 1300, 'Used (mtumba)', { item: 'Sneakers', shoeSize: '42', ...match }, 'Clean original sneakers, washed.'],
    ['clothes-shoes', 'womens-shoes', 'Mtumba ladies heels', 800, 'Used (mtumba)', { item: 'Heels', shoeSize: '38', ...width }, 'Ladies heels in good condition.'],
    ['clothes-shoes', 'mens-shoes', 'Mtumba official shoes, leather', 1200, 'Used (mtumba)', { item: 'Official shoes', shoeSize: '43', ...match, colour: 'Black' }, 'Leather official shoes, polished.'],
    ['clothes-shoes', 'womens-shoes', 'Ladies sandals', 450, 'New', { item: 'Sandals & slippers', shoeSize: '39', ...width }, 'Comfortable sandals for everyday.'],
    ['clothes-shoes', 'mens-shoes', 'School shoes, black', 900, 'New', { item: 'Official shoes', shoeSize: '40', gender: 'Unisex', colour: 'Black' }, 'Strong school shoes, Bata style.'],
  ] },
  fabric: { label: 'Kitenge', kinds: ['boutique', 'market-stall'], wear: ['women'], fresh: false, items: [
    ['clothes-shoes', 'womens-clothes', 'Kitenge fabric, 6 yards', 1200, 'New', { item: 'Kitenge & ankara', ...width, colour: 'Multi-colour' }, 'Quality wax print, 6 yards.'],
    ['clothes-shoes', 'womens-clothes', 'Kitenge dress, made to measure', 2500, 'New', { item: 'Kitenge & ankara', size: 'M', ...width }, 'Tailored kitenge dresses, ready in 3 days.'],
    ['clothes-shoes', 'womens-clothes', 'Lesso (kanga), pair', 600, 'New', { item: 'Other', ...width, colour: 'Multi-colour' }, 'Pair of lessos with Swahili sayings.'],
    ['clothes-shoes', 'mens-clothes', 'Kitenge shirt, men', 1500, 'New', { item: 'Shirts', size: 'L', ...match, colour: 'Multi-colour' }, 'Smart kitenge shirts for Fridays and functions.'],
  ] },
  home: { label: 'Household', kinds: ['market-stall'], fresh: false, items: [
    ['utensils', 'cookware', 'Sufuria set, 5 pieces', 1500, 'New', { material: 'Aluminium', pieces: 5 }, 'Strong aluminium sufurias with lids.'],
    ['utensils', 'storage', 'Plastic basins, big', 350, 'New', { material: 'Plastic' }, 'Big basins for washing and storage.'],
    ['utensils', 'cups-mugs', 'Melamine cups, set of 6', 450, 'New', { material: 'Melamine' }, 'Unbreakable melamine cups.'],
    ['utensils', 'flasks', 'Vacuum flask, 2 litres', 900, 'New', {}, 'Keeps chai hot all day.'],
    ['utensils', 'cookware', 'Cooking pot (sufuria), 10 litres', 1100, 'New', { material: 'Aluminium' }, 'Big sufuria for ugali and githeri.'],
  ] },
  // African crafts (mostly at Kariokor)
  paintings: { label: 'Art Studio', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'paintings', 'Tinga Tinga painting: Big Five', 4500, 'New (handmade)', { craftType: 'Tinga Tinga', size: '60 × 60', frame: 'Stretched canvas', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Bright Tinga Tinga style painting of the Big Five, painted by hand.'],
    ['african-crafts', 'paintings', 'Maasai warriors canvas painting', 6500, 'New (handmade)', { craftType: 'Canvas painting', size: '90 × 60', frame: 'Framed', madeToOrder: 'Ready now', colour: 'Orange' }, 'Acrylic on canvas: Maasai warriors at sunset, framed and ready to hang.'],
    ['african-crafts', 'paintings', 'Batik wall hanging: village market', 2200, 'New (handmade)', { craftType: 'Batik', size: '100 × 70', frame: 'Rolled', madeToOrder: 'Ready now', colour: 'Brown' }, 'Hand-dyed batik on cotton, rolled for easy carrying.'],
    ['african-crafts', 'paintings', 'Portrait painting from your photo', 8000, 'New (handmade)', { craftType: 'Portrait', size: '50 × 70', frame: 'Framed', madeToOrder: 'Made to order', colour: 'Multi-colour' }, 'Send a photo and get a hand-painted portrait in 7 days.'],
    ['african-crafts', 'paintings', 'Sand art: elephants at Amboseli', 3500, 'New (handmade)', { craftType: 'Sand & mixed media', size: '40 × 50', frame: 'Framed', madeToOrder: 'Ready now', colour: 'Beige' }, 'Textured sand and acrylic art of elephants under Kilimanjaro.'],
  ] },
  carvings: { label: 'Wood Carvings', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'wood-carvings', 'Akamba giraffe carving, 1 metre', 5500, 'New (handmade)', { craftType: 'Animal figures', material: 'Mahogany', size: '100 cm tall', madeIn: 'Machakos', madeToOrder: 'Ready now' }, 'Tall hand-carved giraffe by Akamba carvers from Machakos.'],
    ['african-crafts', 'wood-carvings', 'Ebony elephant family, set of 3', 3800, 'New (handmade)', { craftType: 'Animal figures', material: 'Ebony / mpingo', size: '10–20 cm', madeToOrder: 'Ready now' }, 'Polished ebony elephants, a family of three.'],
    ['african-crafts', 'wood-carvings', 'African tribal mask, wall decor', 2500, 'New (handmade)', { craftType: 'Masks', material: 'Mahogany', size: '45 cm', madeToOrder: 'Ready now' }, 'Hand-carved and painted tribal mask for your wall.'],
    ['african-crafts', 'wood-carvings', 'Olive wood salad bowl & servers', 1800, 'New (handmade)', { craftType: 'Bowls & kitchenware', material: 'Olive wood', size: '30 cm', madeToOrder: 'Ready now' }, 'Smooth olive wood bowl with matching servers.'],
    ['african-crafts', 'wood-carvings', 'Lamu-style carved stool', 7500, 'New (handmade)', { craftType: 'Stools & furniture', material: 'Mango wood', size: '45 cm high', madeToOrder: 'Made to order' }, 'Solid carved stool, made to order in 10 days.'],
  ] },
  soapstone: { label: 'Kisii Soapstone', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'soapstone-carvings', 'Kisii soapstone chess set', 4200, 'New (handmade)', { craftType: 'Chess & games', size: '35 × 35 board', madeIn: 'Kisii (Tabaka)', madeToOrder: 'Ready now', colour: 'White' }, 'Full chess set carved from Kisii soapstone, with a carved board.'],
    ['african-crafts', 'soapstone-carvings', 'Soapstone hippos, set of 2', 1200, 'New (handmade)', { craftType: 'Animal figures', size: '8 cm', madeIn: 'Kisii (Tabaka)', madeToOrder: 'Ready now', colour: 'Pink' }, 'Pink soapstone hippos, hand-polished.'],
    ['african-crafts', 'soapstone-carvings', 'Soapstone candle holders, pair', 1500, 'New (handmade)', { craftType: 'Candle holders', size: '12 cm', madeIn: 'Kisii (Tabaka)', madeToOrder: 'Ready now', colour: 'Black' }, 'Carved and etched candle holders.'],
    ['african-crafts', 'soapstone-carvings', 'Soapstone serving bowl, etched', 1800, 'New (handmade)', { craftType: 'Bowls & dishes', size: '25 cm', madeIn: 'Kisii (Tabaka)', madeToOrder: 'Ready now', colour: 'White' }, 'Etched soapstone bowl for fruit or decor.'],
  ] },
  beadwork: { label: 'Beadwork', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'beadwork', 'Maasai beaded collar necklace', 1500, 'New (handmade)', { craftType: 'Necklaces & collars', madeIn: 'Kajiado', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Traditional flat beaded collar made by Maasai women.'],
    ['african-crafts', 'beadwork', 'Beaded bracelets, set of 5', 500, 'New (handmade)', { craftType: 'Bracelets & bangles', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Bright beaded bracelets in Kenya flag and Maasai colours.'],
    ['african-crafts', 'beadwork', 'Beaded leather belt', 1200, 'New (handmade)', { craftType: 'Belts', madeToOrder: 'Ready now', colour: 'Red' }, 'Leather belt with Maasai beadwork, all sizes.'],
    ['african-crafts', 'beadwork', 'Beaded earrings, Maasai', 400, 'New (handmade)', { craftType: 'Earrings', madeToOrder: 'Ready now', colour: 'Blue' }, 'Light beaded earrings, many colours.'],
  ] },
  weaving: { label: 'Kiondo & Baskets', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'hand-sewn', 'Kiondo sisal bag with leather straps', 1800, 'New (handmade)', { craftType: 'Kiondo (sisal bag)', material: 'Sisal', madeIn: 'Kitui', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Hand-woven kiondo with leather straps and trim.'],
    ['african-crafts', 'hand-sewn', 'Woven storage baskets, set of 3', 2400, 'New (handmade)', { craftType: 'Baskets', material: 'Banana fibre', madeToOrder: 'Ready now', colour: 'Beige' }, 'Banana fibre baskets in three sizes.'],
    ['african-crafts', 'hand-sewn', 'Hand-embroidered cushion covers, pair', 1600, 'New (handmade)', { craftType: 'Cushion covers', material: 'Cotton', madeToOrder: 'Ready now', colour: 'Cream' }, 'Hand-sewn embroidery with African patterns, 45 × 45 cm.'],
    ['african-crafts', 'hand-sewn', 'Kitenge patchwork quilt, queen size', 6500, 'New (handmade)', { craftType: 'Patchwork & quilts', material: 'Kitenge fabric', madeToOrder: 'Made to order', colour: 'Multi-colour' }, 'Hand-sewn kitenge patchwork quilt, made to order.'],
    ['african-crafts', 'hand-sewn', 'Woven table mats, set of 6', 1200, 'New (handmade)', { craftType: 'Table mats & runners', material: 'Palm / ukindu', madeIn: 'Lamu', madeToOrder: 'Ready now', colour: 'Beige' }, 'Ukindu palm table mats from the coast.'],
  ] },
  leather: { label: 'Leather Crafts', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'leather-crafts', 'Akala sandals (tyre sole)', 400, 'New (handmade)', { craftType: 'Sandals', madeIn: 'Kariokor', madeToOrder: 'Ready now', colour: 'Black' }, 'Tough akala sandals made at Kariokor from old tyres.'],
    ['african-crafts', 'leather-crafts', 'Maasai beaded leather sandals', 1200, 'New (handmade)', { craftType: 'Sandals', madeIn: 'Kariokor', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Handmade leather sandals with Maasai beads, all sizes.'],
    ['african-crafts', 'leather-crafts', 'Leather messenger bag, handmade', 4800, 'New (handmade)', { craftType: 'Bags', madeIn: 'Kariokor', madeToOrder: 'Ready now', colour: 'Brown' }, 'Genuine leather bag stitched by hand at Kariokor.'],
    ['african-crafts', 'leather-crafts', 'Leather journal with Maasai beads', 1500, 'New (handmade)', { craftType: 'Journals & book covers', madeToOrder: 'Ready now', colour: 'Brown' }, 'Refillable leather journal, a popular gift.'],
  ] },
  textiles: { label: 'African Fabrics', kinds: ['market-stall'], fresh: false, items: [
    ['african-crafts', 'african-textiles', 'Maasai shuka, red check', 900, 'New (handmade)', { craftType: 'Maasai shuka', size: '150 × 200 cm', madeToOrder: 'Ready now', colour: 'Red' }, 'Warm red Maasai shuka, a throw or blanket.'],
    ['african-crafts', 'african-textiles', 'Kikoi, cotton, striped', 1100, 'New (handmade)', { craftType: 'Kikoi', size: '100 × 170 cm', madeIn: 'Mombasa', madeToOrder: 'Ready now', colour: 'Blue' }, 'Soft cotton kikoi for the beach or home.'],
    ['african-crafts', 'african-textiles', 'Kanga pair with Swahili sayings', 700, 'New (handmade)', { craftType: 'Kanga / leso', madeToOrder: 'Ready now', colour: 'Multi-colour' }, 'Pair of kangas, each with a Swahili saying.'],
  ] },
};

// which stalls each market has
const MARKET_STALLS = {
  'gikomba-market': ['shoes', 'fabric', 'home'],
  'wakulima-market-marikiti': ['fruit', 'cereals', 'veg'],
  'muthurwa-market': ['veg', 'home', 'clothes'],
  'city-market': ['fish', 'fruit', 'carvings', 'beadwork'], // curio stalls
  'kenyatta-market': ['fish', 'veg', 'home'],
  'toi-market': ['clothes', 'shoes', 'veg'],
  'ngara-market': ['fabric', 'shoes', 'veg'],
  'kangemi-market': ['veg', 'fruit'],
  'kawangware-market': ['veg', 'clothes'],
  'burma-market': ['fish', 'veg'],
  'kariokor-market': ['paintings', 'carvings', 'soapstone', 'beadwork', 'weaving', 'leather', 'veg'], // Nairobi’s crafts hub
  'githurai-market': ['veg', 'cereals', 'clothes'],
  'kongowea-market': ['veg', 'cereals'],
  'mackinnon-market': ['spices', 'fruit', 'carvings', 'textiles'], // Old Town curios, kikois
  'wakulima-market-nakuru': ['veg', 'fruit'],
  'kibuye-market': ['fish', 'clothes', 'veg'],
  'eldoret-municipal-market': ['cereals', 'veg', 'clothes'],
  'madaraka-market-thika': ['veg', 'fruit'],
};

const PEOPLE = ['Mama Wanjiru', 'Otieno', 'Mama Achieng', 'Kamau', 'Mama Njoki', 'Barasa', 'Nekesa', 'Mwangi', 'Mama Atieno', 'Kiprop', 'Wairimu', 'Omondi', 'Mama Mumbua', 'Kariuki', 'Chebet', 'Mutiso', 'Mama Akinyi', 'Ndungu', 'Jeptoo', 'Odhiambo', 'Mama Wambui', 'Kibet', 'Nduta', 'Juma', 'Mama Zawadi', 'Rotich', 'Muthoni', 'Okoth', 'Mama Kerubo', 'Maina', 'Auma', 'Kiptoo', 'Mama Nyokabi', 'Wekesa', 'Halima', 'Ouma', 'Mama Wangari', 'Langat', 'Moraa', 'Gitau', 'Mama Adhiambo', 'Mutua', 'Wanjala', 'Mama Waceke', 'Salim'];
// Sunday first; markets open early
const HOURS = { always: false, days: [{ open: '08:00', close: '14:00' }, ...Array.from({ length: 6 }, () => ({ open: '06:00', close: '18:30' }))] };

async function addMarketTraders({ Customer, Market, helpers, now }) {
  const { slugOf, keywordsFor, weightFor } = helpers;
  const markets = new Map((await Market.find({ slug: { $in: Object.keys(MARKET_STALLS) } }).lean()).map((item) => [item.slug, item]));
  const docs = [];
  const traders = [];
  let number = 0;
  for (const [slug, stalls] of Object.entries(MARKET_STALLS)) {
    const market = markets.get(slug);
    if (!market) continue;
    const [mLng, mLat] = market.point.coordinates;
    for (const [key, kind] of stalls.entries()) {
      const st = STOCK[kind];
      const entryKey = number++;
      const person = PEOPLE[entryKey % PEOPLE.length];
      const email = `mkt-${slug}-${key + 1}@demo.kapu.test`;
      let customer = await Customer.findOne({ email });
      if (!customer) {
        let phone = `2547001${String(5000 + entryKey).padStart(5, '0')}`;
        while (await Customer.exists({ phone })) phone = `2547001${String(60000 + Math.floor(Math.random() * 30000)).slice(0, 5)}`;
        customer = await Customer.create({ name: `${person} (${market.name.split(' ')[0]})`, email, phone, password: 'demo1234' });
      }
      const jig = 0.00035 * ((entryKey % 5) - 2);
      customer.shopLocation = {
        name: `${person} ${st.label}`, address: `${market.name}, stall ${10 + ((entryKey * 7) % 90)}`, area: market.area, county: market.county,
        point: { type: 'Point', coordinates: [mLng + jig, mLat - jig] }, public: true, updatedAt: new Date(),
        kinds: st.kinds, wear: st.wear || [], hours: HOURS,
        walk: st.fresh ? { enabled: true, maxKm: 1.5, fee: 30, perItem: 10, maxFee: 80 } : { enabled: false },
        market: market._id, marketName: market.name, marketSlug: market.slug, stall: `Stall ${10 + ((entryKey * 7) % 90)}`,
      };
      customer.payDetails = { method: 'pochi', phone: customer.phone, name: customer.shopLocation.name };
      await customer.save();
      traders.push(customer);
      // 4 or 5 of the stall's goods (a different mix at each market)
      const pick = st.items.length <= 5 ? st.items : [0, 1, 2, 3, 4].map((item) => st.items[(item + entryKey) % st.items.length]);
      pick.forEach(([category, sub, title, price, condition, attrs, description], index) => {
        const date = {
          category, sub, title, price, county: market.county, area: market.area, condition, attrs: { ...attrs }, description: `${description} At ${market.name}.`,
          negotiable: !st.fresh, seller: customer._id, sellerName: customer.name, status: 'active', views: Math.floor(Math.random() * 200),
          buyNow: true, stock: st.fresh ? 150 : 8 + ((entryKey + index) % 20), delivery: { available: true, fee: st.fresh ? 100 : 200, pickup: true, days: 'Same day' },
          origin: /mtumba/i.test(condition) ? 'ex-uk' : 'local', geo: customer.shopLocation.point,
        };
        date.weightKg = weightFor(sub, title);
        date.slug = slugOf(title, market.area);
        date.keywords = keywordsFor(date);
        date.createdAt = new Date(now - (entryKey * 23 + index * 5 + 3) * 60 * 1000);
        date.updatedAt = date.createdAt;
        docs.push(date);
      });
    }
  }
  return { docs, traders };
}

module.exports = { addMarketTraders, MARKET_STALLS, STOCK };
