// Marketplace categories: sub-categories, the details each kind of ad asks for (and buyers filter by),
// vehicle makes/models, and search synonyms ("gari" finds cars, "pikipiki" finds motorbikes...).
// The client downloads this once from GET /api/market/categories, so forms and filters stay in sync.

const VEHICLE_MAKES = {
  Toyota: ['Vitz', 'Axio', 'Fielder', 'Premio', 'Allion', 'Belta', 'Corolla', 'Camry', 'Mark X', 'Harrier', 'RAV4', 'Prado', 'Land Cruiser', 'Land Cruiser V8', 'Hilux', 'Probox', 'Succeed', 'Noah', 'Voxy', 'Sienta', 'Passo', 'Wish', 'Auris', 'Crown', 'IST', 'Ractis', 'Rush', 'Fortuner', 'C-HR', 'Hiace', 'Coaster'],
  Nissan: ['Note', 'March', 'Tiida', 'Sylphy', 'X-Trail', 'Juke', 'Dualis', 'Wingroad', 'AD Van', 'Navara', 'Patrol', 'Serena', 'Teana', 'Bluebird', 'NV350', 'Caravan', 'Civilian'],
  Mazda: ['Demio', 'Axela', 'Atenza', 'CX-3', 'CX-5', 'CX-7', 'Premacy', 'Verisa', 'BT-50'],
  Subaru: ['Impreza', 'Legacy', 'Forester', 'Outback', 'XV', 'WRX', 'Levorg', 'Exiga'],
  Honda: ['Fit', 'Vezel', 'CR-V', 'Civic', 'Accord', 'Insight', 'Freed', 'Stream', 'Airwave', 'Grace'],
  Mitsubishi: ['Pajero', 'Outlander', 'RVR', 'Lancer', 'Galant', 'L200', 'Canter', 'Fighter', 'Colt'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'S-Class', 'ML', 'GLC', 'GLE', 'Sprinter', 'Actros', 'Axor'],
  BMW: ['1 Series', '3 Series', '5 Series', 'X1', 'X3', 'X5', 'X6'],
  Volkswagen: ['Golf', 'Polo', 'Passat', 'Tiguan', 'Touareg', 'Amarok'],
  Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7'],
  Isuzu: ['D-Max', 'MU-X', 'NPR', 'NQR', 'FRR', 'FVZ', 'Giga', 'Elf'],
  Suzuki: ['Swift', 'Alto', 'Escudo', 'Every', 'Vitara', 'Jimny', 'Maruti'],
  'Land Rover': ['Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Discovery', 'Defender', 'Freelander'],
  Ford: ['Ranger', 'Everest', 'Focus', 'Fiesta', 'Escape', 'Kuga'],
  Hyundai: ['Tucson', 'Santa Fe', 'i10', 'i20', 'Elantra', 'Creta'],
  Kia: ['Sportage', 'Sorento', 'Picanto', 'Rio'],
  Peugeot: ['208', '308', '508', '2008', '3008', '5008'],
  Lexus: ['RX', 'LX', 'NX', 'IS'],
  Jeep: ['Wrangler', 'Grand Cherokee', 'Compass'],
  Daihatsu: ['Mira', 'Tanto', 'Terios', 'Hijet'],
  Volvo: ['XC60', 'XC90', 'FH', 'FM'],
  Hino: ['300 Series', '500 Series', '700 Series'],
  Scania: ['P-Series', 'G-Series', 'R-Series'],
  MAN: ['TGS', 'TGX'],
  'Sinotruk Howo': ['Tipper', 'Prime mover'],
  FAW: ['J5', 'J6'],
  Tata: ['Super Ace', 'LPT 1518', 'Prima'],
  Other: [],
};
const MOTORBIKE_MAKES = {
  Bajaj: ['Boxer BM 150', 'Boxer BM 100', 'Pulsar', 'Discover', 'RE Tuk-tuk'],
  TVS: ['HLX 125', 'HLX 150', 'Star', 'Apache', 'King Tuk-tuk'],
  Honda: ['Ace CB125', 'XR 150', 'CRF', 'CBR', 'Africa Twin'],
  Yamaha: ['YBR 125', 'Crux', 'FZ', 'MT-15', 'R15'],
  Haojue: ['HJ 125', 'DK 150'],
  Suzuki: ['GN 125', 'GSX'],
  Kawasaki: ['Ninja', 'KLX'],
  Skygo: [],
  Captain: [],
  'KTM': ['Duke', 'RC'],
  Other: [],
};
const TRACTOR_MAKES = {
  'Massey Ferguson': ['MF 290', 'MF 375', 'MF 385', 'MF 399'],
  'John Deere': [],
  'New Holland': [],
  Ford: [],
  Caterpillar: ['Excavator', 'Grader', 'Dozer', 'Wheel loader'],
  JCB: ['3CX Backhoe', 'Excavator'],
  Komatsu: [],
  Other: [],
};
const PHONE_BRANDS = {
  Apple: ['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone 15 Pro', 'iPhone 16', 'iPhone 16 Pro Max', 'iPhone XR', 'iPhone X'],
  Samsung: ['Galaxy A05', 'Galaxy A15', 'Galaxy A25', 'Galaxy A35', 'Galaxy A55', 'Galaxy S23', 'Galaxy S24', 'Galaxy S24 Ultra', 'Galaxy Z Flip', 'Galaxy Z Fold', 'Galaxy Note 20'],
  Tecno: ['Spark 20', 'Spark 30', 'Camon 20', 'Camon 30', 'Pova 6', 'Phantom X2'],
  Infinix: ['Hot 40', 'Hot 50', 'Note 40', 'Smart 8', 'Zero 30'],
  Xiaomi: ['Redmi 13C', 'Redmi Note 13', 'Redmi A3', 'Xiaomi 14', 'Poco X6'],
  Oppo: ['A18', 'A38', 'A58', 'Reno 11'],
  Vivo: ['Y03', 'Y17s', 'Y28', 'V30'],
  Huawei: ['Nova 11', 'P60', 'Y9'],
  Nokia: ['C32', 'G42', '105', '110'],
  Google: ['Pixel 6', 'Pixel 7', 'Pixel 8'],
  Itel: ['A70', 'S23', 'P55'],
  Realme: ['C53', 'C67', 'Note 50'],
  Other: [],
};
const LAPTOP_BRANDS = { HP: ['EliteBook', 'ProBook', 'Pavilion', 'Victus', 'Envy', 'Spectre'], Dell: ['Latitude', 'Inspiron', 'Vostro', 'XPS', 'Precision'], Lenovo: ['ThinkPad', 'IdeaPad', 'Legion', 'Yoga'], Apple: ['MacBook Air', 'MacBook Pro', 'iMac', 'Mac mini'], Asus: ['VivoBook', 'ZenBook', 'ROG', 'TUF'], Acer: ['Aspire', 'Swift', 'Nitro', 'Predator'], Microsoft: ['Surface Pro', 'Surface Laptop'], Toshiba: [], Samsung: [], Other: [] };
const TV_BRANDS = ['Samsung', 'LG', 'Sony', 'Hisense', 'TCL', 'Vitron', 'Skyworth', 'Syinix', 'Glaze', 'Royal', 'Other'];
const APPLIANCE_BRANDS = ['Ramtons', 'Von Hotpoint', 'Mika', 'Bruhm', 'Hisense', 'Samsung', 'LG', 'Armco', 'Nunix', 'Sayona', 'Philips', 'Beko', 'Kenwood', 'Sharp', 'Other'];

// Field kinds: select (with options), make (select whose value drives a dependent "model"), number, text, yesno
const year = { key: 'year', label: 'Year of manufacture', type: 'number', min: 1960, max: new Date().getFullYear() + 1, filter: 'range' };
const mileage = { key: 'mileage', label: 'Mileage (km)', type: 'number', min: 0, max: 2000000, filter: 'max' };
// colour: filterable everywhere it appears (multi-select swatches in the Filters panel)
const COLOURS = ['Black', 'White', 'Grey', 'Silver', 'Blue', 'Navy', 'Red', 'Maroon', 'Green', 'Brown', 'Beige', 'Cream', 'Gold', 'Orange', 'Yellow', 'Purple', 'Pink', 'Multi-colour', 'Other'];
const colour = { key: 'colour', label: 'Colour', type: 'select', options: COLOURS, filter: 'select', colour: true };
const brandText = { key: 'brand', label: 'Brand', type: 'text', filter: 'text' };
const make = (makes, label = 'Make') => ({ key: 'make', label, type: 'make', makes, filter: 'select', required: true });
const model = { key: 'model', label: 'Model', type: 'model', filter: 'select' };

// the kinds of motor vehicle spare parts (the Sell form's “Part type”, and what spare-parts importers say they bring in)
const SPARE_PART_TYPES = ['Engine & gearbox', 'Brakes', 'Suspension & steering', 'Body parts', 'Lights & electricals', 'Interior', 'Filters & service parts', 'Exhaust', 'Cooling', 'Other'];
const VEHICLE_CONDITION = ['Brand new', 'Foreign used', 'Locally used'];
// which years of the vehicle a spare part fits (buyers search "parts for my 2014 Vitz")
const THIS_YEAR = new Date().getFullYear() + 1;
const FITS_YEARS = [
  { key: 'yearFrom', label: 'Fits vehicles from year', type: 'number', min: 1960, max: THIS_YEAR },
  { key: 'yearTo', label: 'Fits vehicles up to year', type: 'number', min: 1960, max: THIS_YEAR },
];
const ITEM_CONDITION = ['New', 'Used', 'Refurbished'];
// older names for the same units (ads posted before the Kiswahili names): accepted and switched over
// Lake Victoria fish, by the names Kenyans use (older labels still accepted)
const VICTORIA_FISH = ['Mbuta (Nile perch)', 'Ngege (tilapia)', 'Obambo (dried / smoked)', 'Mumi (catfish)', 'Fulu', 'Kamongo (lungfish)', 'Other'];
const VICTORIA_ALIASES = {
  'Nile perch (mbuta)': 'Mbuta (Nile perch)', 'Tilapia (ngege / sato)': 'Ngege (tilapia)', 'Catfish (mumi)': 'Mumi (catfish)', 'Lungfish (kamongo)': 'Kamongo (lungfish)',
  Mbuta: 'Mbuta (Nile perch)', 'Nile perch': 'Mbuta (Nile perch)', Ngege: 'Ngege (tilapia)', Tilapia: 'Ngege (tilapia)', Sato: 'Ngege (tilapia)', Obambo: 'Obambo (dried / smoked)', Obambla: 'Obambo (dried / smoked)', Mumi: 'Mumi (catfish)', Catfish: 'Mumi (catfish)', Kamongo: 'Kamongo (lungfish)',
};
const victoriaFish = { key: 'fish', label: 'Fish', type: 'select', options: VICTORIA_FISH, filter: 'select', chips: true, required: true, aliases: VICTORIA_ALIASES };
const UNIT_ALIASES = { Bunch: 'Kifungu (bunch)', 'Heap (fungu)': 'Fungu (heap)', Heap: 'Fungu (heap)', Kifungu: 'Kifungu (bunch)', Fungu: 'Fungu (heap)' };

// what kind of clothing it is (Shirts, Dresses, Watches…): every clothing ad has one, so buyers can browse by type
const ITEMS = {
  'womens-clothes': ['Dresses', 'Tops & blouses', 'Shirts', 'T-shirts', 'Skirts', 'Trousers & jeans', 'Suits & blazers', 'Kitenge & ankara', 'Jackets & coats', 'Sweaters & hoodies', 'Lingerie & sleepwear', 'Abayas & hijabs', 'Other'],
  'mens-clothes': ['Shirts', 'T-shirts & polos', 'Trousers & chinos', 'Jeans', 'Suits & blazers', 'Jackets & coats', 'Sweaters & hoodies', 'Shorts', 'Traditional wear', 'Underwear & socks', 'Other'],
  'womens-shoes': ['Heels', 'Flats & ballerinas', 'Sneakers', 'Sandals & slippers', 'Boots', 'Wedges', 'Other'],
  'mens-shoes': ['Official shoes', 'Sneakers', 'Boots', 'Sandals & slippers', 'Loafers', 'Sports shoes', 'Other'],
  sportswear: ['Jerseys', 'Tracksuits', 'Gym wear', 'Football boots', 'Running shoes', 'Other'],
  'watches-jewellery': ['Men’s watches', 'Women’s watches', 'Smart watches', 'Necklaces & chains', 'Earrings', 'Rings', 'Bracelets & bangles', 'Sunglasses', 'Belts, caps & ties', 'Other'],
};
const itemField = (options) => ({ key: 'item', label: 'Type', type: 'select', options, filter: 'select', required: true });

const CATEGORIES = [
  {
    slug: 'vehicles', name: 'Vehicles', icon: '🚗', condition: VEHICLE_CONDITION,
    blurb: 'Cars, motorbikes, trucks, buses, matatus and tractors from private sellers and dealers.',
    synonyms: ['car', 'cars', 'gari', 'magari', 'vehicle', 'motor', 'auto', 'automobile', 'ride'],
    subs: [
      { slug: 'cars', name: 'Cars', synonyms: ['car', 'saloon', 'suv', 'sedan', 'hatchback', 'station wagon', 'pickup', '4x4'],
        fields: [make(VEHICLE_MAKES), model, year, mileage,
          { key: 'transmission', label: 'Transmission', type: 'select', options: ['Automatic', 'Manual', 'CVT'], filter: 'select' },
          { key: 'fuel', label: 'Fuel', type: 'select', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'], filter: 'select' },
          { key: 'body', label: 'Body type', type: 'select', options: ['Saloon', 'Hatchback', 'SUV', 'Station wagon', 'Pickup', 'Van', 'Coupe', 'Convertible', 'Minivan'], filter: 'select' },
          { key: 'engine', label: 'Engine size (cc)', type: 'number', min: 600, max: 8000 }, colour] },
      { slug: 'motorbikes', name: 'Motorbikes & tuk-tuks', synonyms: ['motorbike', 'motorcycle', 'pikipiki', 'boda', 'bodaboda', 'boda boda', 'bike', 'scooter', 'tuktuk', 'tuk tuk', 'bajaji'],
        fields: [make(MOTORBIKE_MAKES), model, year, mileage, { key: 'engine', label: 'Engine size (cc)', type: 'number', min: 50, max: 2000 }, colour] },
      { slug: 'trucks', name: 'Trucks & lorries', synonyms: ['truck', 'lorry', 'lori', 'tipper', 'prime mover', 'trailer', 'canter'],
        fields: [make(VEHICLE_MAKES), model, year, mileage, { key: 'tonnage', label: 'Load capacity (tonnes)', type: 'number', min: 0, max: 60 }] },
      { slug: 'buses-vans', name: 'Buses, vans & matatus', synonyms: ['bus', 'van', 'matatu', 'mat', 'shuttle', 'minibus', 'nissan', 'hiace'],
        fields: [make(VEHICLE_MAKES), model, year, mileage, { key: 'seats', label: 'Seats', type: 'number', min: 2, max: 90, filter: 'range' }] },
      { slug: 'tractors-machinery', name: 'Tractors & heavy machinery', synonyms: ['tractor', 'excavator', 'backhoe', 'grader', 'machinery', 'plant', 'farm machine'],
        fields: [make(TRACTOR_MAKES), model, year, { key: 'hours', label: 'Hours used', type: 'number', min: 0, max: 100000 }] },
    ],
  },
  {
    slug: 'electronics', name: 'Electronics', icon: '📱', condition: ITEM_CONDITION,
    blurb: 'Phones, laptops, TVs, audio, cameras, gaming, solar and home appliances.',
    synonyms: ['electronic', 'gadget', 'gadgets', 'tech', 'device'],
    subs: [
      { slug: 'phones', name: 'Mobile phones', synonyms: ['phone', 'simu', 'smartphone', 'mobile', 'iphone', 'android'],
        fields: [make(PHONE_BRANDS, 'Brand'), model, { key: 'storage', label: 'Storage (GB)', type: 'select', options: ['16', '32', '64', '128', '256', '512', '1024'], filter: 'select' }, { key: 'ram', label: 'RAM (GB)', type: 'select', options: ['1', '2', '3', '4', '6', '8', '12', '16'] }, colour] },
      { slug: 'tablets', name: 'Tablets & iPads', synonyms: ['tablet', 'ipad', 'tab'], fields: [brandText, { key: 'storage', label: 'Storage (GB)', type: 'select', options: ['16', '32', '64', '128', '256', '512'], filter: 'select' }] },
      { slug: 'laptops', name: 'Laptops & computers', synonyms: ['laptop', 'computer', 'pc', 'notebook', 'macbook', 'desktop', 'kompyuta'],
        fields: [make(LAPTOP_BRANDS, 'Brand'), model,
          { key: 'processor', label: 'Processor', type: 'select', options: ['Intel Celeron', 'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9', 'Apple M1', 'Apple M2', 'Apple M3', 'Apple M4', 'Other'], filter: 'select' },
          { key: 'ram', label: 'RAM (GB)', type: 'select', options: ['2', '4', '8', '16', '32', '64'], filter: 'select' },
          { key: 'storage', label: 'Storage', type: 'select', options: ['128GB SSD', '256GB SSD', '512GB SSD', '1TB SSD', '500GB HDD', '1TB HDD', '2TB+'], filter: 'select' }] },
      { slug: 'tvs', name: 'TVs', synonyms: ['tv', 'television', 'smart tv', 'telly', 'runinga'],
        fields: [{ key: 'brand', label: 'Brand', type: 'select', options: TV_BRANDS, filter: 'select' }, { key: 'screen', label: 'Screen size (inches)', type: 'select', options: ['24', '32', '40', '43', '50', '55', '65', '75', '85'], filter: 'select' }, { key: 'tvtype', label: 'Type', type: 'select', options: ['Smart / Android', 'Digital', 'QLED', 'OLED', 'Other'], filter: 'select' }] },
      { slug: 'audio', name: 'Audio, speakers & headphones', synonyms: ['speaker', 'sound', 'subwoofer', 'woofer', 'home theatre', 'earphones', 'headphones', 'earbuds', 'airpods', 'music system'], fields: [brandText] },
      { slug: 'cameras', name: 'Cameras & photography', synonyms: ['camera', 'canon', 'nikon', 'lens', 'dslr', 'gopro'], fields: [brandText] },
      { slug: 'gaming', name: 'Video games & consoles', synonyms: ['playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'game', 'games', 'console'], fields: [brandText] },
      { slug: 'accessories', name: 'Computer & phone accessories', synonyms: ['charger', 'cable', 'mouse', 'keyboard', 'flash', 'memory card', 'power bank', 'cover', 'case', 'monitor'], fields: [brandText] },
      { slug: 'networking', name: 'Networking & WiFi', synonyms: ['router', 'wifi', 'modem', 'mifi', 'switch', 'network'], fields: [brandText] },
      { slug: 'printers', name: 'Printers & scanners', synonyms: ['printer', 'scanner', 'photocopier', 'toner'], fields: [brandText] },
      { slug: 'solar-power', name: 'Solar, inverters & power', synonyms: ['solar', 'solar panel', 'inverter', 'battery', 'ups', 'generator', 'stabilizer'], fields: [brandText, { key: 'watts', label: 'Power (watts)', type: 'number', min: 1, max: 100000 }] },
      { slug: 'home-appliances', name: 'Home appliances', synonyms: ['washing machine', 'iron box', 'fan', 'vacuum', 'heater', 'appliance', 'dryer'], fields: [{ key: 'brand', label: 'Brand', type: 'select', options: APPLIANCE_BRANDS, filter: 'select' }] },
      { slug: 'cctv-security', name: 'CCTV & security', synonyms: ['cctv', 'camera', 'security', 'alarm', 'dvr', 'intercom'], fields: [brandText] },
      { slug: 'smartwatches', name: 'Smart watches & wearables', synonyms: ['smartwatch', 'watch', 'apple watch', 'fitness band'], fields: [brandText] },
    ],
    commonFields: [colour],
  },
  {
    slug: 'land-property', name: 'Land & property', icon: '🏡', condition: null,
    blurb: 'Plots and parcels of land, farms, houses and commercial property across Kenya.',
    synonyms: ['property', 'real estate', 'mali'],
    subs: [
      { slug: 'land-for-sale', name: 'Land & plots for sale', synonyms: ['plot', 'plots', 'ploti', 'land', 'shamba', 'parcel', 'acre', 'acres', 'eighth', '50x100', 'farm', 'hectare'],
        fields: [
          { key: 'size', label: 'Size', type: 'number', min: 0, max: 100000, required: true },
          { key: 'unit', label: 'Size unit', type: 'select', options: ['Acres', '1/8 acre plots (50x100)', 'Hectares', 'Square feet'], required: true },
          { key: 'title', label: 'Ownership documents', type: 'select', options: ['Ready title deed', 'Title deed in process', 'Allotment letter', 'Share certificate'], filter: 'select' },
          { key: 'use', label: 'Land use', type: 'select', options: ['Residential', 'Agricultural', 'Commercial', 'Industrial', 'Mixed use'], filter: 'select' },
          { key: 'road', label: 'Road access', type: 'select', options: ['Tarmac', 'Murram', 'Not on a road'] },
          { key: 'utilities', label: 'Water & power', type: 'select', options: ['Water and electricity', 'Electricity only', 'Water only', 'None yet'] }] },
      { slug: 'land-for-lease', name: 'Land for lease', synonyms: ['lease', 'rent land', 'farm for lease'],
        fields: [{ key: 'size', label: 'Size', type: 'number', min: 0, max: 100000 }, { key: 'unit', label: 'Size unit', type: 'select', options: ['Acres', 'Hectares', '1/8 acre plots (50x100)'] }, { key: 'use', label: 'Land use', type: 'select', options: ['Agricultural', 'Commercial', 'Industrial', 'Mixed use'], filter: 'select' }] },
      { slug: 'houses-for-sale', name: 'Houses & apartments for sale', synonyms: ['house', 'apartment', 'maisonette', 'bungalow', 'home', 'nyumba', 'villa'],
        fields: [{ key: 'bedrooms', label: 'Bedrooms', type: 'number', min: 0, max: 20, filter: 'range' }, { key: 'bathrooms', label: 'Bathrooms', type: 'number', min: 0, max: 20 }, { key: 'title', label: 'Ownership documents', type: 'select', options: ['Ready title deed', 'Title deed in process', 'Share certificate', 'Sectional title'], filter: 'select' }] },
      { slug: 'houses-for-rent', name: 'Houses & apartments for rent', synonyms: ['rent', 'rental', 'bedsitter', 'single room', 'one bedroom', 'to let', 'kukodisha'],
        fields: [{ key: 'bedrooms', label: 'Bedrooms', type: 'number', min: 0, max: 20, filter: 'range' }, { key: 'furnished', label: 'Furnished', type: 'select', options: ['Furnished', 'Unfurnished', 'Semi-furnished'], filter: 'select' }] },
      { slug: 'commercial', name: 'Commercial property', synonyms: ['shop', 'office', 'warehouse', 'godown', 'commercial', 'stall'], fields: [{ key: 'size', label: 'Size (sq ft)', type: 'number', min: 0, max: 1000000 }] },
    ],
  },
  {
    slug: 'beddings', name: 'Beddings', icon: '🛏️', condition: ITEM_CONDITION,
    blurb: 'Mattresses, duvets, bed sheets, blankets, pillows, mosquito nets and towels.',
    synonyms: ['bedding', 'bed', 'bedroom'],
    subs: [
      { slug: 'mattresses', name: 'Mattresses', synonyms: ['mattress', 'godoro', 'foam', 'spring mattress'], fields: [{ key: 'size', label: 'Size', type: 'select', options: ['2.5x6', '3x6', '3.5x6', '4x6', '5x6', '6x6', '6x7'], filter: 'select' }, { key: 'thickness', label: 'Thickness (inches)', type: 'select', options: ['4', '5', '6', '8', '10', '12'], filter: 'select' }, brandText] },
      { slug: 'duvets', name: 'Duvets & comforters', synonyms: ['duvet', 'comforter', 'quilt'], fields: [{ key: 'size', label: 'Size', type: 'select', options: ['3x6', '4x6', '5x6', '6x6', '7x7'], filter: 'select' }, colour] },
      { slug: 'bed-sheets', name: 'Bed sheets & covers', synonyms: ['bedsheet', 'bedsheets', 'sheets', 'shuka', 'pillow case'], fields: [{ key: 'size', label: 'Size', type: 'select', options: ['3x6', '4x6', '5x6', '6x6', '7x7'], filter: 'select' }, { key: 'material', label: 'Material', type: 'select', options: ['Cotton', 'Polyester', 'Silk', 'Satin', 'Linen', 'Mixed'] }, colour] },
      { slug: 'blankets', name: 'Blankets', synonyms: ['blanket', 'fleece', 'throw', 'blanketi'], fields: [colour] },
      { slug: 'pillows', name: 'Pillows', synonyms: ['pillow', 'mto', 'cushion'], fields: [] },
      { slug: 'mosquito-nets', name: 'Mosquito nets', synonyms: ['net', 'mosquito', 'chandarua'], fields: [] },
      { slug: 'towels', name: 'Towels & bath', synonyms: ['towel', 'taulo', 'bathrobe'], fields: [colour] },
    ],
    commonFields: [colour],
  },
  {
    slug: 'furniture', name: 'Furniture', icon: '🛋️', condition: ITEM_CONDITION,
    blurb: 'Sofas, beds, dining sets, wardrobes, office and outdoor furniture.',
    synonyms: ['furniture', 'fanicha', 'samani', 'home'],
    subs: [
      { slug: 'sofas', name: 'Sofas & seats', synonyms: ['sofa', 'couch', 'seat', 'seats', 'l-shape', 'recliner', 'kiti'], fields: [{ key: 'seats', label: 'Number of seats', type: 'number', min: 1, max: 15, filter: 'range' }, { key: 'material', label: 'Material', type: 'select', options: ['Fabric', 'Leather', 'Leatherette', 'Velvet', 'Wood', 'Other'], filter: 'select' }, colour] },
      { slug: 'beds', name: 'Beds & bed frames', synonyms: ['bed', 'bed frame', 'kitanda', 'bunk bed', 'double decker'], fields: [{ key: 'size', label: 'Size', type: 'select', options: ['3x6', '4x6', '5x6', '6x6', '7x7'], filter: 'select' }, { key: 'material', label: 'Material', type: 'select', options: ['Mahogany', 'Mvule', 'Cypress', 'MDF', 'Metal', 'Other'], filter: 'select' }] },
      { slug: 'dining', name: 'Dining sets & tables', synonyms: ['dining', 'table', 'meza', 'dining table', 'coffee table'], fields: [{ key: 'seats', label: 'Seats', type: 'number', min: 1, max: 20 }, { key: 'material', label: 'Material', type: 'select', options: ['Wood', 'Glass', 'Metal', 'Marble', 'Other'], filter: 'select' }] },
      { slug: 'wardrobes', name: 'Wardrobes & storage', synonyms: ['wardrobe', 'closet', 'cabinet', 'drawers', 'kabati', 'shoe rack'], fields: [{ key: 'material', label: 'Material', type: 'select', options: ['Wood', 'MDF', 'Metal', 'Plastic', 'Other'] }] },
      { slug: 'office-furniture', name: 'Office furniture', synonyms: ['office chair', 'desk', 'office desk', 'filing cabinet', 'workstation'], fields: [] },
      { slug: 'tv-stands', name: 'TV stands & shelves', synonyms: ['tv stand', 'tv unit', 'shelf', 'shelves', 'bookshelf', 'wall unit'], fields: [] },
      { slug: 'outdoor-furniture', name: 'Outdoor & garden furniture', synonyms: ['outdoor', 'garden', 'patio', 'plastic chairs'], fields: [] },
    ],
    commonFields: [colour],
  },
  {
    slug: 'stationery', name: 'Stationery', icon: '✏️', condition: ITEM_CONDITION,
    blurb: 'Books, exercise books, pens, paper, files, school and office supplies.',
    synonyms: ['stationary', 'stationery', 'school', 'office supplies'],
    subs: [
      { slug: 'books', name: 'Books & textbooks', synonyms: ['book', 'textbook', 'novel', 'kitabu', 'vitabu', 'revision', 'cbc'], fields: [{ key: 'level', label: 'Level', type: 'select', options: ['Pre-primary', 'Primary / CBC', 'Junior secondary', 'Secondary', 'College / university', 'General reading'], filter: 'select' }] },
      { slug: 'exercise-books', name: 'Exercise books', synonyms: ['exercise book', 'counter book', 'notebook', 'daftari'], fields: [{ key: 'pages', label: 'Pages', type: 'select', options: ['48', '96', '120', '200', '400'] }, { key: 'pack', label: 'Pack size', type: 'number', min: 1, max: 1000 }] },
      { slug: 'pens-pencils', name: 'Pens, pencils & markers', synonyms: ['pen', 'pens', 'pencil', 'marker', 'highlighter', 'kalamu', 'biro'], fields: [brandText] },
      { slug: 'paper', name: 'Printing paper', synonyms: ['a4', 'ream', 'paper', 'photocopy paper', 'a3'], fields: [{ key: 'size', label: 'Paper size', type: 'select', options: ['A4', 'A3', 'A5', 'Letter', 'Other'], filter: 'select' }, brandText] },
      { slug: 'files-folders', name: 'Files & folders', synonyms: ['file', 'folder', 'box file', 'envelope'], fields: [] },
      { slug: 'school-supplies', name: 'School supplies', synonyms: ['school bag', 'mathematical set', 'geometry set', 'ruler', 'eraser', 'crayons', 'back to school'], fields: [] },
      { slug: 'office-supplies', name: 'Office supplies', synonyms: ['stapler', 'calculator', 'ink', 'toner', 'glue', 'whiteboard'], fields: [] },
      { slug: 'art-supplies', name: 'Art & craft supplies', synonyms: ['paint', 'canvas', 'brush', 'art'], fields: [] },
    ],
  },
  {
    slug: 'packaging', name: 'Packaging', icon: '📦', condition: ITEM_CONDITION,
    blurb: 'Cartons, paper bags, bottles, jars, containers, labels and takeaway packaging, often in bulk.',
    synonyms: ['packaging', 'packing', 'package', 'wholesale', 'bulk'],
    subs: [
      { slug: 'cartons-boxes', name: 'Cartons & boxes', synonyms: ['carton', 'box', 'boxes', 'pizza box', 'cake box'], fields: [{ key: 'material', label: 'Material', type: 'select', options: ['Corrugated', 'Duplex board', 'Kraft', 'Other'] }] },
      { slug: 'paper-bags', name: 'Paper & non-woven bags', synonyms: ['paper bag', 'khaki bag', 'non woven', 'shopping bag', 'carrier bag'], fields: [] },
      { slug: 'bottles-jars', name: 'Bottles & jars', synonyms: ['bottle', 'jar', 'pet bottle', 'glass jar', 'spray bottle'], fields: [{ key: 'capacity', label: 'Capacity', type: 'text' }, { key: 'material', label: 'Material', type: 'select', options: ['PET plastic', 'HDPE plastic', 'Glass', 'Aluminium'], filter: 'select' }] },
      { slug: 'food-packaging', name: 'Food & takeaway packaging', synonyms: ['takeaway', 'container', 'food container', 'cup', 'straw', 'foil', 'clingfilm'], fields: [] },
      { slug: 'labels-stickers', name: 'Labels & stickers', synonyms: ['label', 'sticker', 'barcode label', 'branding'], fields: [] },
      { slug: 'tape-wrap', name: 'Tape, wrap & bubble wrap', synonyms: ['tape', 'masking tape', 'stretch film', 'bubble wrap', 'wrap'], fields: [] },
      { slug: 'sacks-jerrycans', name: 'Sacks, gunny bags & jerrycans', synonyms: ['sack', 'gunia', 'gunny bag', 'jerrycan', 'drum', 'bucket'], fields: [] },
    ],
  },
  {
    slug: 'liquor', name: 'Liquor & drinks', icon: '🍷', condition: null, adult: true,
    blurb: 'Whisky, vodka, gin, wine, beer and spirits from licensed sellers. 18+ only.',
    synonyms: ['liquor', 'liqour', 'alcohol', 'pombe', 'booze', 'spirits', 'drinks', 'wines and spirits', 'mvinyo'],
    subs: [
      { slug: 'whisky', name: 'Whisky', synonyms: ['whiskey', 'scotch', 'bourbon', 'johnnie walker', 'jameson', 'jack daniels'], fields: [brandText] },
      { slug: 'vodka', name: 'Vodka', synonyms: ['smirnoff', 'absolut', 'ciroc'], fields: [brandText] },
      { slug: 'gin', name: 'Gin', synonyms: ['gilbeys', 'gordons', 'tanqueray', 'beefeater', 'kenya cane'], fields: [brandText] },
      { slug: 'wine', name: 'Wine', synonyms: ['red wine', 'white wine', 'rose', 'mvinyo', '4th street', 'caprice'], fields: [brandText, { key: 'wineType', label: 'Type', type: 'select', options: ['Red', 'White', 'Rosé', 'Sweet', 'Dry'], filter: 'select' }] },
      { slug: 'champagne', name: 'Champagne & sparkling', synonyms: ['champagne', 'sparkling', 'prosecco', 'moet'], fields: [brandText] },
      { slug: 'beer-cider', name: 'Beer & cider', synonyms: ['beer', 'tusker', 'guinness', 'cider', 'savanna', 'lager', 'crate'], fields: [brandText] },
      { slug: 'brandy-cognac', name: 'Brandy & cognac', synonyms: ['brandy', 'cognac', 'hennessy', 'viceroy'], fields: [brandText] },
      { slug: 'rum-tequila', name: 'Rum, tequila & liqueurs', synonyms: ['rum', 'tequila', 'liqueur', 'baileys', 'amarula', 'captain morgan'], fields: [brandText] },
    ],
    commonFields: [
      { key: 'volume', label: 'Bottle size', type: 'select', options: ['250 ml', '330 ml', '350 ml', '500 ml', '750 ml', '1 litre', '1.75 litres', 'Crate / case'], filter: 'select' },
    ],
  },
  {
    slug: 'spare-parts', name: 'Spare parts', icon: '🔧', condition: ['New (genuine)', 'New (aftermarket)', 'Used (ex-Japan)', 'Used (ex-UK)', 'Used (ex-Dubai)', 'Used (local)', 'Refurbished'],
    blurb: 'Parts for cars, motorbikes, trucks, tractors, phones, laptops and appliances.',
    synonyms: ['spare', 'spares', 'spare part', 'parts', 'part', 'vipuri', 'accessories'],
    subs: [
      { slug: 'car-parts', name: 'Motor vehicle spare parts', synonyms: ['car parts', 'motor vehicle parts', 'vehicle spares', 'car spares', 'engine', 'gearbox', 'suspension', 'shocks', 'brake pads', 'bumper', 'headlight', 'side mirror', 'radiator', 'ex japan parts'],
        fields: [{ ...make(VEHICLE_MAKES, 'Fits make'), required: true }, { ...model, label: 'Fits model' }, ...FITS_YEARS, { key: 'partType', label: 'Part type', type: 'select', options: SPARE_PART_TYPES, filter: 'select' }, { key: 'partNo', label: 'Part number', type: 'text' }] },
      { slug: 'tyres-rims', name: 'Tyres & rims', synonyms: ['tyre', 'tire', 'tyres', 'rim', 'rims', 'wheel', 'alloy'], fields: [{ key: 'tyreSize', label: 'Size (e.g. 195/65 R15)', type: 'text', filter: 'text' }, brandText] },
      { slug: 'motorbike-parts', name: 'Motorbike parts', synonyms: ['boda parts', 'motorbike parts', 'chain', 'sprocket', 'clutch'], fields: [{ ...make(MOTORBIKE_MAKES, 'Fits make'), required: false }, { ...model, label: 'Fits model' }, ...FITS_YEARS, { key: 'partNo', label: 'Part number', type: 'text' }] },
      { slug: 'truck-parts', name: 'Truck & bus parts', synonyms: ['truck parts', 'lorry parts', 'bus parts'], fields: [{ ...make(VEHICLE_MAKES, 'Fits make'), required: false }, { ...model, label: 'Fits model' }, ...FITS_YEARS, { key: 'partNo', label: 'Part number', type: 'text' }] },
      { slug: 'vehicle-batteries', name: 'Vehicle batteries', synonyms: ['car battery', 'battery', 'chloride exide'], fields: [brandText, { key: 'amps', label: 'Capacity (Ah)', type: 'number', min: 1, max: 400 }] },
      { slug: 'machinery-parts', name: 'Tractor & machinery parts', synonyms: ['tractor parts', 'machinery parts', 'pump parts'], fields: [brandText] },
      { slug: 'phone-laptop-parts', name: 'Phone & laptop parts', synonyms: ['screen', 'lcd', 'display', 'charging port', 'phone battery', 'laptop battery', 'keyboard'], fields: [brandText, { key: 'partNo', label: 'Fits model / part number', type: 'text' }] },
      { slug: 'appliance-parts', name: 'Appliance & electrical parts', synonyms: ['fridge parts', 'washing machine parts', 'tv parts', 'compressor'], fields: [brandText] },
    ],
  },
  {
    slug: 'bicycles', name: 'Bicycles', icon: '🚲', condition: ITEM_CONDITION,
    blurb: 'Mountain, road, kids, BMX and electric bikes, plus parts and accessories.',
    synonyms: ['bicycle', 'bike', 'baiskeli', 'cycle', 'cycling'],
    subs: [
      { slug: 'mountain-bikes', name: 'Mountain bikes', synonyms: ['mtb', 'mountain bike'], fields: [] },
      { slug: 'road-bikes', name: 'Road & racing bikes', synonyms: ['road bike', 'racing bike'], fields: [] },
      { slug: 'kids-bikes', name: 'Kids bikes', synonyms: ['kids bike', 'children bike', 'balance bike'], fields: [] },
      { slug: 'bmx', name: 'BMX', synonyms: ['bmx'], fields: [] },
      { slug: 'electric-bikes', name: 'Electric bikes & scooters', synonyms: ['ebike', 'e-bike', 'electric scooter'], fields: [] },
      { slug: 'city-bikes', name: 'City & utility bikes', synonyms: ['black mamba', 'roadmaster', 'utility bike', 'hybrid bike'], fields: [] },
      { slug: 'bicycle-accessories', name: 'Bicycle parts & accessories', synonyms: ['helmet', 'bike light', 'bike pump', 'bike parts'], fields: [] },
    ],
    commonFields: [colour, brandText,
      { key: 'wheel', label: 'Wheel size', type: 'select', options: ['12"', '16"', '20"', '24"', '26"', '27.5"', '28"', '29"', '700c'], filter: 'select' },
      { key: 'gears', label: 'Gears', type: 'number', min: 1, max: 30 }],
  },
  {
    slug: 'appliances', name: 'Appliances', icon: '🔌', condition: ITEM_CONDITION,
    blurb: 'Cookers, gas cylinders, fridges, microwaves, blenders, kettles, water dispensers and commercial appliances.',
    synonyms: ['appliance', 'appliances', 'home appliances', 'kitchen appliances', 'kitchen', 'kitchen equipment', 'jikoni', 'vifaa vya nyumbani', 'catering equipment'],
    subs: [
      { slug: 'cookers-ovens', name: 'Cookers & ovens', synonyms: ['cooker', 'oven', 'stove', 'jiko', 'electric cooker', 'gas cooker', 'standing cooker'], fields: [{ key: 'burners', label: 'Burners', type: 'select', options: ['1', '2', '3', '4', '5', '6'], filter: 'select' }, { key: 'power', label: 'Power source', type: 'select', options: ['Gas', 'Electric', 'Gas & electric', 'Charcoal', 'Other'], filter: 'select' }] },
      { slug: 'gas', name: 'Gas cylinders & burners', synonyms: ['gas', 'cylinder', 'meko', 'k-gas', 'total gas', 'pro gas', 'burner', 'regulator'], fields: [{ key: 'kg', label: 'Cylinder size', type: 'select', options: ['3 kg', '6 kg', '13 kg', '22 kg', '50 kg'], filter: 'select' }] },
      { slug: 'fridges-freezers', name: 'Fridges & freezers', synonyms: ['fridge', 'freezer', 'refrigerator', 'deep freezer', 'friji'], fields: [{ key: 'litres', label: 'Capacity (litres)', type: 'number', min: 10, max: 2000, filter: 'range' }] },
      { slug: 'microwaves', name: 'Microwaves', synonyms: ['microwave', 'micro wave'], fields: [{ key: 'litres', label: 'Capacity (litres)', type: 'number', min: 10, max: 100 }] },
      { slug: 'blenders', name: 'Blenders, juicers & mixers', synonyms: ['blender', 'juicer', 'mixer', 'food processor'], fields: [] },
      { slug: 'kettles-toasters', name: 'Kettles, toasters & small appliances', synonyms: ['kettle', 'toaster', 'sandwich maker', 'air fryer', 'rice cooker', 'pressure cooker'], fields: [] },
      { slug: 'water-dispensers', name: 'Water dispensers & purifiers', synonyms: ['dispenser', 'water dispenser', 'purifier', 'filter'], fields: [] },
      { slug: 'commercial-kitchen', name: 'Commercial & hotel appliances', synonyms: ['deep fryer', 'chipper', 'chips machine', 'chapati machine', 'display', 'commercial', 'hotel', 'restaurant', 'bakery oven'], fields: [] },
    ],
    commonFields: [colour, { key: 'brand', label: 'Brand', type: 'select', options: APPLIANCE_BRANDS, filter: 'select' }],
  },
  {
    slug: 'utensils', name: 'Utensils & cookware', icon: '🍽️', condition: ITEM_CONDITION,
    blurb: 'Sufurias, pans, plates, cups, cutlery, glassware, flasks and storage containers.',
    synonyms: ['utensil', 'utensils', 'vyombo', 'cookware', 'kitchenware', 'crockery'],
    subs: [
      { slug: 'cookware', name: 'Sufurias, pots & pans', synonyms: ['sufuria', 'pot', 'pan', 'frying pan', 'non stick', 'karai', 'pressure cooker'], fields: [] },
      { slug: 'plates-bowls', name: 'Plates & bowls', synonyms: ['plate', 'sahani', 'bowl', 'dinner set', 'dinner set'], fields: [] },
      { slug: 'cups-mugs', name: 'Cups & mugs', synonyms: ['cup', 'mug', 'kikombe', 'tea cup'], fields: [] },
      { slug: 'cutlery', name: 'Cutlery', synonyms: ['spoon', 'fork', 'knife', 'cutlery set', 'kijiko'], fields: [] },
      { slug: 'glassware', name: 'Glassware', synonyms: ['glass', 'glasses', 'wine glass', 'jug'], fields: [] },
      { slug: 'storage', name: 'Food storage & containers', synonyms: ['container', 'tupperware', 'lunch box', 'storage', 'canister'], fields: [] },
      { slug: 'flasks', name: 'Thermos & flasks', synonyms: ['thermos', 'flask', 'chupa', 'water bottle'], fields: [] },
      { slug: 'knives-boards', name: 'Knives & chopping boards', synonyms: ['knife', 'kisu', 'chopping board', 'grater', 'peeler'], fields: [] },
      { slug: 'catering', name: 'Hotel & catering utensils', synonyms: ['catering', 'chafing dish', 'tray', 'hotel', 'serving'], fields: [] },
    ],
    commonFields: [colour, { key: 'material', label: 'Material', type: 'select', options: ['Stainless steel', 'Aluminium', 'Non-stick', 'Cast iron', 'Ceramic', 'Glass', 'Melamine', 'Plastic', 'Wood', 'Other'], filter: 'select' }, { key: 'pieces', label: 'Pieces in set', type: 'number', min: 1, max: 500 }],
  },
  {
    slug: 'clothes-shoes', name: 'Clothes & shoes', icon: '👗', condition: ['New', 'Used (mtumba)'],
    blurb: 'Men’s, women’s and kids’ clothes and shoes, new and mtumba.',
    synonyms: ['clothes', 'clothing', 'nguo', 'fashion', 'mtumba', 'wear', 'outfit', 'shoes', 'viatu'],
    subs: [
      { slug: 'womens-clothes', name: 'Women’s clothes', synonyms: ['dress', 'dresses', 'skirt', 'skirts', 'blouse', 'top', 'tops', 'leggings', 'gown', 'kitenge', 'ankara', 'lingerie', 'ladies', 'abaya', 'ladies wear', 'women wear'], fields: [itemField(ITEMS['womens-clothes'])] },
      { slug: 'mens-clothes', name: 'Men’s clothes', synonyms: ['shirt', 'shirts', 'trouser', 'trousers', 'jeans', 'suit', 'suits', 'tshirt', 't-shirt', 'hoodie', 'jacket', 'khaki', 'gents', 'polo', 'chinos', 'mens wear', 'men wear'], fields: [itemField(ITEMS['mens-clothes'])] },
      { slug: 'womens-shoes', name: 'Women’s shoes', synonyms: ['heels', 'sandals', 'flats', 'ladies shoes', 'boots', 'sneakers', 'wedges'], fields: [itemField(ITEMS['womens-shoes']), { key: 'shoeSize', label: 'Shoe size (EU)', type: 'select', options: ['35', '36', '37', '38', '39', '40', '41', '42', '43'], filter: 'select' }] },
      { slug: 'mens-shoes', name: 'Men’s shoes', synonyms: ['official shoes', 'sneakers', 'boots', 'loafers', 'sandals', 'gents shoes', 'rubber'], fields: [itemField(ITEMS['mens-shoes']), { key: 'shoeSize', label: 'Shoe size (EU)', type: 'select', options: ['38', '39', '40', '41', '42', '43', '44', '45', '46', '47'], filter: 'select' }] },
      { slug: 'sportswear', name: 'Sportswear', synonyms: ['jersey', 'tracksuit', 'gym wear', 'football boots', 'running shoes'], fields: [itemField(ITEMS.sportswear)] },
      { slug: 'watches-jewellery', name: 'Watches, jewellery & accessories', synonyms: ['watch', 'watches', 'saa', 'jewelry', 'jewellery', 'necklace', 'earrings', 'ring', 'bracelet', 'sunglasses', 'shades', 'belt', 'cap', 'tie'], fields: [itemField(ITEMS['watches-jewellery'])] },
    ],
    commonFields: [
      brandText,
      { key: 'size', label: 'Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL+', 'One size'], filter: 'select' },
      { key: 'gender', label: 'For', type: 'select', options: ['Women', 'Men', 'Unisex'], filter: 'select' },
      colour,
    ],
  },
  {
    slug: 'bags', name: 'Bags', icon: '👜', condition: ['New', 'Used'],
    blurb: 'Handbags, backpacks, school bags, laptop bags, travel bags and wallets.',
    synonyms: ['bag', 'bags', 'mkoba', 'begi', 'purse'],
    subs: [
      { slug: 'handbags', name: 'Handbags & purses', synonyms: ['handbag', 'purse', 'clutch', 'tote', 'ladies bag', 'sling bag'], fields: [] },
      { slug: 'backpacks', name: 'Backpacks & school bags', synonyms: ['backpack', 'school bag', 'rucksack', 'bagpack'], fields: [] },
      { slug: 'laptop-bags', name: 'Laptop & office bags', synonyms: ['laptop bag', 'briefcase', 'office bag', 'messenger bag'], fields: [] },
      { slug: 'travel-bags', name: 'Travel bags & suitcases', synonyms: ['suitcase', 'luggage', 'trolley bag', 'duffel', 'travel bag'], fields: [] },
      { slug: 'wallets', name: 'Wallets & small leather goods', synonyms: ['wallet', 'card holder', 'belt'], fields: [] },
    ],
    commonFields: [brandText, { key: 'material', label: 'Material', type: 'select', options: ['Leather', 'Faux leather', 'Canvas', 'Fabric', 'Nylon', 'Plastic', 'Other'], filter: 'select' }, colour],
  },
  {
    slug: 'beauty', name: 'Beauty products', icon: '💄', condition: null,
    blurb: 'Skin care, hair care, make-up, perfumes, wigs and salon equipment.',
    synonyms: ['beauty', 'cosmetics', 'cosmetic', 'urembo', 'self care', 'salon'],
    subs: [
      { slug: 'skin-care', name: 'Skin care', synonyms: ['lotion', 'cream', 'moisturiser', 'moisturizer', 'sunscreen', 'serum', 'body oil', 'face wash', 'nivea', 'vaseline'], fields: [] },
      { slug: 'hair-care', name: 'Hair care & products', synonyms: ['shampoo', 'conditioner', 'hair oil', 'relaxer', 'hair food', 'braids', 'hair gel'], fields: [] },
      { slug: 'wigs-extensions', name: 'Wigs & hair extensions', synonyms: ['wig', 'weave', 'extensions', 'lace front', 'human hair', 'braids'], fields: [] },
      { slug: 'makeup', name: 'Make-up', synonyms: ['makeup', 'lipstick', 'foundation', 'powder', 'mascara', 'eyeliner', 'nail polish'], fields: [] },
      { slug: 'fragrances', name: 'Perfumes & fragrances', synonyms: ['perfume', 'cologne', 'body spray', 'deodorant', 'oud', 'manukato'], fields: [] },
      { slug: 'mens-grooming', name: 'Men’s grooming', synonyms: ['shaver', 'beard oil', 'aftershave', 'clippers', 'trimmer'], fields: [] },
      { slug: 'salon-equipment', name: 'Salon & spa equipment', synonyms: ['hair dryer', 'salon chair', 'blow dryer', 'straightener', 'flat iron'], fields: [] },
    ],
    commonFields: [brandText, { key: 'volume', label: 'Size (ml / g)', type: 'text' }],
  },
  {
    slug: 'detergents-cleaning', name: 'Detergents & cleaning', icon: '🧼', condition: null,
    blurb: 'Washing powder, bar soap, dish washing liquid, bleach, disinfectants and cleaning tools, retail and wholesale.',
    synonyms: ['detergent', 'detergents', 'cleaning', 'sabuni', 'soap', 'usafi', 'cleaner'],
    subs: [
      { slug: 'washing-powder', name: 'Washing powder & liquid', synonyms: ['omo', 'ariel', 'toss', 'sunlight', 'washing powder', 'laundry', 'powder soap'], fields: [] },
      { slug: 'bar-soap', name: 'Bar soap', synonyms: ['bar soap', 'jamaa', 'menengai', 'white star', 'kipande'], fields: [] },
      { slug: 'dishwashing', name: 'Dish washing', synonyms: ['dish washing', 'dishwashing liquid', 'msafi', 'sponge', 'steel wool'], fields: [] },
      { slug: 'bleach-disinfectant', name: 'Bleach & disinfectants', synonyms: ['jik', 'bleach', 'dettol', 'disinfectant', 'sanitizer', 'harpic', 'toilet cleaner'], fields: [] },
      { slug: 'cleaning-tools', name: 'Mops, brooms & cleaning tools', synonyms: ['mop', 'broom', 'fagio', 'bucket', 'squeegee', 'dustbin'], fields: [] },
      { slug: 'air-fresheners', name: 'Air fresheners & insecticides', synonyms: ['air freshener', 'doom', 'insecticide', 'mosquito spray', 'room spray'], fields: [] },
    ],
    commonFields: [brandText, { key: 'pack', label: 'Pack size (e.g. 1kg, 5L, carton of 24)', type: 'text' }],
  },
  // 🍽️ food, side by side: mama mboga, samaki, then cereals
  {
    slug: 'fresh-produce', name: 'Fresh produce (mama mboga)', icon: '🥬', condition: null,
    blurb: 'Sukuma wiki, tomatoes, onions, fruits, potatoes, eggs and fish from mama mbogas and market traders near you.',
    synonyms: ['mama mboga', 'mboga', 'vegetables', 'vegetable', 'veggies', 'greens', 'fresh produce', 'produce', 'sokoni', 'market', 'matunda', 'fresh food', 'grocer', 'greengrocer'],
    subs: [
      { slug: 'vegetables', name: 'Vegetables & greens', synonyms: ['kienyeji', 'mboga za kienyeji', 'traditional vegetables', 'kifungu', 'mrenda', 'mitoo', 'murenda', 'sukuma', 'sukuma wiki', 'kale', 'cabbage', 'kabichi', 'spinach', 'managu', 'terere', 'kunde', 'saga', 'broccoli', 'carrots', 'karoti', 'capsicum', 'pilipili hoho', 'french beans', 'cucumber', 'pumpkin'], fields: [] },
      { slug: 'tomatoes-onions', name: 'Tomatoes, onions & herbs', synonyms: ['tomato', 'tomatoes', 'nyanya', 'onion', 'onions', 'kitunguu', 'dhania', 'coriander', 'garlic', 'ginger', 'tangawizi', 'chilli', 'pilipili', 'lemon', 'dania'], fields: [] },
      { slug: 'fruits', name: 'Fruits', synonyms: ['fruit', 'fruits', 'matunda', 'banana', 'ndizi', 'mango', 'embe', 'orange', 'machungwa', 'pineapple', 'nanasi', 'watermelon', 'tikiti', 'avocado', 'parachichi', 'pawpaw', 'apple', 'passion'], fields: [] },
      { slug: 'potatoes-tubers', name: 'Potatoes, matoke & tubers', synonyms: ['potato', 'potatoes', 'viazi', 'waru', 'sweet potato', 'ngwaci', 'arrowroot', 'nduma', 'cassava', 'mihogo', 'matoke', 'yams'], fields: [] },
      { slug: 'eggs-poultry', name: 'Eggs & poultry', synonyms: ['egg', 'eggs', 'mayai', 'kienyeji', 'tray of eggs', 'chicken', 'kuku', 'broiler'], fields: [] },
      { slug: 'fish-meat', name: 'Meat (nyama)', synonyms: ['meat', 'nyama', 'beef', 'goat meat', 'mbuzi', 'mutton', 'pork', 'nguruwe', 'mutura', 'matumbo', 'liver', 'maini', 'butchery'], fields: [] },
      { slug: 'fresh-cereals', name: 'Green maize, peas & beans', synonyms: ['green maize', 'mahindi', 'maize', 'peas', 'minji', 'njahi', 'githeri', 'fresh beans', 'groundnuts', 'njugu'], fields: [] },
    ],
    commonFields: [
      // greens (sukuma, kienyeji, managu, dhania…) go by the kifungu (KSh 5, 10…); tomatoes & onions per kg, per piece or a fungu
      { key: 'unit', label: 'Sold per', type: 'select', options: ['Kifungu (bunch)', 'Kg', 'Piece', 'Fungu (heap)', 'Dozen', 'Tray', 'Crate', 'Bag / sack', 'Gorogoro', 'Litre'], filter: 'select', aliases: UNIT_ALIASES },
      { key: 'grown', label: 'Grown', type: 'select', options: ['Local farm', 'Organic', 'Greenhouse', 'Imported'], filter: 'select' },
      { ...brandText, label: 'Brand (imported produce)' }, // home-grown greens have none; imported apples, rice… do
    ],
  },
  // 🐟 Samaki, the way Kenyans buy fish: ngege (tilapia) and mbuta (Nile perch) from Lake Victoria, fried or fresh;
  // fish from other lakes and fish farms; coast seafood (pweza, ngisi, kamba…); and omena (dagaa), fried or fresh / dried.
  {
    slug: 'samaki', name: 'Samaki (fish & seafood)', icon: '🐟', condition: null,
    blurb: 'Fried and fresh Lake Victoria fish (ngege, mbuta), omena, fish from Naivasha, Turkana and fish farms, and seafood from the coast.',
    synonyms: ['samaki', 'fish', 'fishes', 'fish monger', 'fishmonger', 'fish vendor', 'fish market', 'fish shop', 'rech'],
    subs: [
      { slug: 'fried-victoria-fish', name: 'Deep-fried Victoria fish', synonyms: ['fried fish', 'samaki wa kukaanga', 'samaki fry', 'fish fry', 'deep fried fish', 'deep-fried fish', 'fried tilapia', 'fried ngege', 'fried mbuta', 'fried nile perch', 'wet fry', 'dry fry', 'fried sato', 'kisumu fish', 'dunga fish', 'fish and ugali'],
        fields: [
          victoriaFish,
          { key: 'style', label: 'How it’s made', type: 'select', options: ['Deep fried, whole', 'Wet fry (with soup)', 'Dry fry', 'Fried fillets (minofu)', 'Fried, ready to re-fry'], filter: 'select' },
          { key: 'size', label: 'Size', type: 'select', options: ['Small', 'Medium', 'Large', 'Jumbo / family size'], filter: 'select' },
        ] },
      { slug: 'fresh-victoria-fish', name: 'Fresh Victoria fish', synonyms: ['fresh fish', 'tilapia', 'ngege', 'sato', 'nile perch', 'mbuta', 'obambo', 'obambla', 'dried fish', 'smoked fish', 'mumi', 'catfish', 'lake victoria fish', 'victoria fish', 'fish fillet', 'minofu', 'mgongo wazi', 'fish frames', 'obambla', 'fulu', 'fish heads', 'vichwa vya samaki', 'raw fish'],
        fields: [
          victoriaFish,
          { key: 'form', label: 'Sold as', type: 'select', options: ['Whole', 'Cleaned (gutted & scaled)', 'Fillets (minofu)', 'Mgongo wazi (frames)', 'Fish heads', 'Sun-dried', 'Smoked', 'Frozen'], filter: 'select', aliases: { 'Obambla (sun-dried)': 'Sun-dried' } },
          { key: 'size', label: 'Size', type: 'select', options: ['Small', 'Medium', 'Large', 'Jumbo / family size'], filter: 'select' },
        ] },
      { slug: 'lake-fish', name: 'Fresh water lake fish', synonyms: ['lake fish', 'fresh water fish', 'freshwater fish', 'naivasha fish', 'turkana fish', 'baringo fish', 'black bass', 'catfish', 'mumi', 'kamongo', 'lungfish', 'ningu', 'trout', 'carp', 'farmed fish', 'fish farm', 'pond fish', 'dam fish', 'masinga fish'],
        fields: [
          { key: 'fish', label: 'Fish', type: 'select', options: ['Tilapia', 'Catfish (mumi)', 'Black bass', 'Lungfish (kamongo)', 'Trout', 'Ningu', 'Carp', 'Other'], filter: 'select', required: true },
          { key: 'lake', label: 'From', type: 'select', options: ['Lake Naivasha', 'Lake Turkana', 'Lake Baringo', 'Lake Jipe', 'Masinga / dams', 'Fish farm / pond', 'Other lake or river'], filter: 'select' },
          { key: 'form', label: 'Sold as', type: 'select', options: ['Whole', 'Cleaned (gutted & scaled)', 'Fillets', 'Smoked', 'Sun-dried', 'Frozen', 'Live (fingerlings)'], filter: 'select' },
        ] },
      { slug: 'seafood', name: 'Sea foods', synonyms: ['seafood', 'sea food', 'sea foods', 'coast fish', 'mombasa fish', 'lamu fish', 'prawns', 'shrimp', 'kamba', 'lobster', 'kamba mti', 'crab', 'kaa', 'octopus', 'pweza', 'squid', 'ngisi', 'calamari', 'kingfish', 'nguru', 'red snapper', 'changu', 'tuna', 'jodari', 'rabbitfish', 'tafi', 'kolekole', 'barracuda', 'mackerel', 'oysters'],
        fields: [
          { key: 'kind', label: 'What it is', type: 'select', options: ['Fish (nguru, changu, tafi, jodari…)', 'Prawns (kamba)', 'Lobster (kamba mti)', 'Crab (kaa)', 'Octopus (pweza)', 'Squid (ngisi)', 'Mixed seafood', 'Other'], filter: 'select', required: true },
          { key: 'form', label: 'Sold as', type: 'select', options: ['Fresh', 'Frozen', 'Cleaned & ready to cook', 'Cooked / fried', 'Dried'], filter: 'select' },
        ] },
      { slug: 'fried-omena', name: 'Deep-fried omena', synonyms: ['fried omena', 'omena fry', 'omena wa kukaanga', 'dagaa wa kukaanga', 'fried dagaa', 'crispy omena', 'ready omena', 'omena ready to eat', 'deep fried omena', 'deep-fried omena'],
        fields: [
          { key: 'style', label: 'How it’s made', type: 'select', options: ['Deep fried, crispy', 'Fried with tomatoes & onions', 'Wet fry'], filter: 'select' },
        ] },
      { slug: 'fresh-omena', name: 'Fresh omena', synonyms: ['omena', 'dagaa', 'fresh omena', 'fresh dagaa', 'dried omena', 'dry omena', 'sun-dried omena', 'mukene', 'lake victoria sardine', 'clean omena', 'omena without sand', 'omena gorogoro', 'omena kopo'],
        fields: [
          { key: 'form', label: 'Sold as', type: 'select', options: ['Fresh (wet)', 'Sun-dried', 'Cleaned, no sand', 'Fish-feed / animal-feed grade'], filter: 'select' },
        ] },
    ],
    commonFields: [
      { key: 'unit', label: 'Sold per', type: 'select', options: ['Piece', 'Kg', 'Plate (portion)', 'Gorogoro', 'Kopo (tin)', 'Fungu (heap)', 'Bucket (ndoo)', 'Debe', 'Sack', 'Crate / box', 'Carton (frozen)'], filter: 'select', aliases: UNIT_ALIASES },
      { key: 'from', label: 'Landed at / from', type: 'select', options: ['Kisumu (Dunga, Kichinjio)', 'Homa Bay', 'Mbita / Rusinga', 'Busia (Port Victoria)', 'Siaya (Usenge, Uhanya)', 'Migori (Muhuru Bay)', 'Lake Naivasha', 'Lake Turkana', 'Mombasa / Kilifi coast', 'Lamu', 'Fish farm', 'Imported', 'Other'], filter: 'select' },
      { ...brandText, label: 'Brand (imported fish)' },
    ],
  },
  {
    slug: 'cooking-products', name: 'Cereals & cooking products', icon: '🫒', condition: null,
    blurb: 'Cooking oil, flour, rice, sugar, spices and other food ingredients, retail and wholesale.',
    synonyms: ['cereals', 'cereal', 'nafaka', 'unga', 'flour', 'cooking', 'food', 'chakula', 'groceries', 'foodstuff', 'ingredients', 'wholesale food'],
    subs: [
      { slug: 'cooking-oil', name: 'Cooking oil & fats', synonyms: ['cooking oil', 'mafuta', 'fresh fri', 'elianto', 'rina', 'kimbo', 'cowboy', 'ghee', 'margarine'], fields: [] },
      { slug: 'flour', name: 'Flour (unga)', synonyms: ['flour', 'unga', 'maize flour', 'wheat flour', 'jogoo', 'pembe', 'exe', 'atta'], fields: [] },
      { slug: 'rice-cereals', name: 'Rice, cereals & pulses', synonyms: ['rice', 'mchele', 'pishori', 'beans', 'maharagwe', 'ndengu', 'lentils', 'maize', 'mahindi'], fields: [] },
      { slug: 'sugar-salt', name: 'Sugar & salt', synonyms: ['sugar', 'sukari', 'salt', 'chumvi'], fields: [] },
      { slug: 'spices', name: 'Spices & seasoning', synonyms: ['spice', 'masala', 'royco', 'curry', 'pilau masala', 'seasoning', 'tomato paste', 'sauce'], fields: [] },
      { slug: 'baking', name: 'Baking supplies', synonyms: ['baking powder', 'yeast', 'icing sugar', 'cake', 'baking'], fields: [] },
      { slug: 'gas-charcoal', name: 'Charcoal & cooking fuel', synonyms: ['charcoal', 'makaa', 'briquettes', 'firewood', 'kuni'], fields: [] },
    ],
    commonFields: [brandText, { key: 'pack', label: 'Pack size (e.g. 2kg, 20L, bale of 12)', type: 'text' }],
  },
  {
    slug: 'beverages', name: 'Beverages', icon: '🥤', condition: null,
    blurb: 'Soft drinks, juices, water, tea, coffee, energy drinks and milk, retail and wholesale.',
    synonyms: ['beverage', 'beverages', 'drink', 'drinks', 'vinywaji', 'soft drinks'],
    subs: [
      { slug: 'soft-drinks', name: 'Soft drinks & sodas', synonyms: ['soda', 'coke', 'coca cola', 'fanta', 'sprite', 'pepsi', 'krest', 'stoney', 'crate'], fields: [] },
      { slug: 'juices', name: 'Juices', synonyms: ['juice', 'minute maid', 'pick n peel', 'del monte', 'afia', 'quencher'], fields: [] },
      { slug: 'water', name: 'Drinking water', synonyms: ['water', 'maji', 'dasani', 'keringet', 'aquamist', 'refill', '20 litres'], fields: [] },
      { slug: 'tea-coffee', name: 'Tea & coffee', synonyms: ['tea', 'chai', 'majani', 'ketepa', 'coffee', 'kahawa', 'nescafe', 'dormans'], fields: [] },
      { slug: 'energy-drinks', name: 'Energy drinks', synonyms: ['energy drink', 'red bull', 'monster', 'predator', 'power play'], fields: [] },
      { slug: 'milk-dairy-drinks', name: 'Milk & dairy drinks', synonyms: ['milk', 'maziwa', 'yoghurt', 'mala', 'brookside', 'lala'], fields: [] },
      { slug: 'cocoa-drinks', name: 'Cocoa & drink powders', synonyms: ['drinking chocolate', 'milo', 'cocoa', 'tang'], fields: [] },
    ],
    commonFields: [brandText, { key: 'pack', label: 'Pack size (e.g. 500ml, crate of 24)', type: 'text' }],
  },
  {
    slug: 'baby-kids', name: 'Baby & kids', icon: '🧸', condition: ['New', 'Used'],
    blurb: 'Strollers, car seats, cots, feeding, diapers, toys and kids’ clothes and shoes.',
    synonyms: ['baby', 'babies', 'kids', 'kid', 'children', 'child', 'toddler', 'mtoto', 'watoto', 'infant', 'newborn'],
    subs: [
      { slug: 'baby-gear', name: 'Strollers, car seats & carriers', synonyms: ['stroller', 'pram', 'buggy', 'car seat', 'baby carrier', 'walker', 'baby walker', 'bouncer', 'rocker'], fields: [] },
      { slug: 'nursery', name: 'Cots, beds & nursery furniture', synonyms: ['cot', 'crib', 'baby cot', 'kids bed', 'bunk bed', 'baby bath', 'changing table', 'playpen', 'baby cot mattress'], fields: [] },
      { slug: 'feeding', name: 'Feeding & high chairs', synonyms: ['feeding bottle', 'bottle', 'sterilizer', 'breast pump', 'high chair', 'formula', 'nan', 'sippy cup', 'bib'], fields: [] },
      { slug: 'diapers-care', name: 'Diapers & baby care', synonyms: ['diapers', 'diaper', 'nappies', 'pampers', 'huggies', 'softcare', 'baby wipes', 'wipes', 'baby lotion', 'baby oil'], fields: [] },
      { slug: 'toys', name: 'Toys & games', synonyms: ['toy', 'toys', 'doll', 'lego', 'puzzle', 'ride on', 'toy car', 'bicycle for kids', 'teddy', 'board game', 'educational toys'], fields: [] },
      { slug: 'kids-clothes', name: 'Baby & kids clothes', synonyms: ['baby clothes', 'kids clothes', 'romper', 'onesie', 'school uniform', 'uniform', 'baby shawl', 'nguo za watoto'], fields: [{ key: 'size', label: 'Size', type: 'select', options: ['Newborn', '0-3 months', '3-6 months', '6-12 months', '1-2 years', '2-4 years', '4-6 years', '6-8 years', '8-10 years', '10-12 years', '12+ years'], filter: 'select' }] },
      { slug: 'kids-shoes', name: 'Kids shoes', synonyms: ['school shoes', 'kids sneakers', 'baby shoes', 'kids sandals'], fields: [{ key: 'shoeSize', label: 'Shoe size (EU)', type: 'select', options: ['18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37'], filter: 'select' }] },
      { slug: 'maternity', name: 'Maternity & mum', synonyms: ['maternity', 'maternity dress', 'nursing', 'pregnancy', 'baby shower'], fields: [] },
      { slug: 'school-items', name: 'School bags & items', synonyms: ['school bag', 'lunch box', 'water bottle', 'pencil case', 'back to school'], fields: [] },
    ],
    commonFields: [colour, 
      brandText,
      { key: 'gender', label: 'For', type: 'select', options: ['Girls', 'Boys', 'Unisex'], filter: 'select' },
      { key: 'age', label: 'Age group', type: 'select', options: ['0-12 months', '1-3 years', '3-5 years', '5-8 years', '8-12 years', '12+ years'], filter: 'select' },
    ],
  },
  {
    slug: 'pharmacy', name: 'Pharmacy & chemist', icon: '💊', condition: null, chemistOnly: true,
    blurb: 'Medicines, vitamins, first aid, medical devices and health products from licensed chemists, checked by our team.',
    synonyms: ['chemist', 'pharmacy', 'dawa', 'madawa', 'medicine', 'medicines', 'drugs', 'duka la dawa', 'health', 'afya'],
    subs: [
      { slug: 'otc-medicine', name: 'Pain, cold & flu', synonyms: ['panadol', 'painkiller', 'pain killer', 'cough syrup', 'cough', 'flu', 'cold', 'piriton', 'hedex', 'mara moja', 'paracetamol', 'ibuprofen', 'headache', 'fever'], fields: [] },
      { slug: 'prescription-medicine', name: 'Prescription medicines', synonyms: ['prescription', 'antibiotic', 'antibiotics', 'amoxil', 'blood pressure tablets', 'diabetes tablets', 'insulin'], fields: [] },
      { slug: 'vitamins', name: 'Vitamins & supplements', synonyms: ['vitamin', 'vitamins', 'supplement', 'multivitamin', 'vitamin c', 'zinc', 'omega 3', 'folic acid', 'iron tablets'], fields: [] },
      { slug: 'first-aid', name: 'First aid & wound care', synonyms: ['first aid', 'bandage', 'plaster', 'elastoplast', 'gauze', 'cotton wool', 'spirit', 'antiseptic', 'first aid kit'], fields: [] },
      { slug: 'medical-devices', name: 'Medical devices & tests', synonyms: ['bp machine', 'blood pressure machine', 'glucometer', 'sugar machine', 'thermometer', 'nebulizer', 'oximeter', 'test strips', 'wheelchair', 'crutches'], fields: [] },
      { slug: 'mother-baby-health', name: 'Mother & baby health', synonyms: ['baby formula', 'gripe water', 'teething', 'ors', 'zinc for baby', 'maternity pads'], fields: [] },
      { slug: 'sexual-health', name: 'Sexual & reproductive health', synonyms: ['condom', 'condoms', 'pregnancy test', 'family planning', 'p2', 'lubricant'], fields: [] },
      { slug: 'medicated-skin', name: 'Medicated skin & hygiene', synonyms: ['medicated soap', 'acne cream', 'antifungal', 'sanitary pads', 'mouthwash', 'dettol', 'sunscreen'], fields: [] },
    ],
    commonFields: [
      { key: 'rx', label: 'Medicine type', type: 'select', options: ['Over the counter', 'Prescription needed'], filter: 'select', required: true },
      brandText,
      { key: 'pack', label: 'Pack size (e.g. 100 tablets, 200ml)', type: 'text' },
    ],
  },
  {
    slug: 'african-crafts', name: 'African crafts', icon: '🎨', condition: ['New (handmade)', 'Vintage / antique', 'Used'],
    blurb: 'Handmade Kenyan art and crafts: paintings, wood and soapstone carvings, kiondos, beadwork, leather and fabrics. Many from Kariokor’s craft makers.',
    synonyms: ['craft', 'crafts', 'african craft', 'curio', 'curios', 'handmade', 'handicraft', 'art', 'artwork', 'sanaa', 'kazi za mikono', 'souvenir', 'kariokor', 'kariakor'],
    subs: [
      { slug: 'paintings', name: 'Paintings & wall art', synonyms: ['painting', 'tinga tinga', 'tingatinga', 'canvas', 'batik', 'art', 'wall art', 'portrait', 'picha'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Tinga Tinga","Canvas painting","Batik","Watercolour","Sand & mixed media","Portrait","Wall hanging"],"filter":"select","required":true}, { key: 'size', label: 'Size (cm, e.g. 60 × 90)', type: 'text' }, { key: 'frame', label: 'Frame', type: 'select', options: ['Framed', 'Unframed', 'Stretched canvas', 'Rolled'], filter: 'select' }] },
      { slug: 'wood-carvings', name: 'Wood carvings', synonyms: ['carving', 'wood carving', 'akamba', 'kamba carving', 'mask', 'masks', 'sculpture', 'ebony', 'mpingo', 'giraffe', 'elephant', 'kinyago', 'chonga'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Animal figures","Masks","Human figures","Bowls & kitchenware","Stools & furniture","Walking sticks","Decor & wall art"],"filter":"select","required":true}, { key: 'material', label: 'Wood', type: 'select', options: ['Mahogany', 'Ebony / mpingo', 'Olive wood', 'Jacaranda', 'Mango wood', 'Teak', 'Other wood'], filter: 'select' }, { key: 'size', label: 'Size (cm)', type: 'text' }] },
      { slug: 'soapstone-carvings', name: 'Soapstone carvings', synonyms: ['soapstone', 'kisii', 'kisii stone', 'stone carving', 'chess set', 'candle holder', 'jiwe'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Animal figures","Bowls & dishes","Chess & games","Candle holders","Vases","Sculptures & abstract"],"filter":"select","required":true}, { key: 'size', label: 'Size (cm)', type: 'text' }] },
      { slug: 'hand-sewn', name: 'Hand-sewn & woven', synonyms: ['kiondo', 'kiondos', 'basket', 'baskets', 'sisal', 'woven', 'weaving', 'embroidery', 'hand sewn', 'handsewn', 'table mat', 'cushion', 'kikapu', 'shona'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Kiondo (sisal bag)","Baskets","Embroidery","Table mats & runners","Cushion covers","Patchwork & quilts","Dolls & toys"],"filter":"select","required":true}, { key: 'material', label: 'Material', type: 'select', options: ['Sisal', 'Banana fibre', 'Palm / ukindu', 'Cotton', 'Wool', 'Kitenge fabric', 'Mixed'], filter: 'select' }] },
      { slug: 'beadwork', name: 'Beadwork & jewellery', synonyms: ['beads', 'beaded', 'beadwork', 'maasai beads', 'shanga', 'necklace', 'bracelet', 'earrings', 'choker', 'collar'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Necklaces & collars","Bracelets & bangles","Earrings","Belts","Key holders & decor","Bags & purses"],"filter":"select","required":true}] },
      { slug: 'leather-crafts', name: 'Leather crafts', synonyms: ['leather', 'leather sandals', 'akala', 'leather bag', 'leather belt', 'journal', 'ngozi'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Sandals","Bags","Belts","Wallets","Journals & book covers","Decor"],"filter":"select","required":true}] },
      { slug: 'african-textiles', name: 'Textiles & fabrics', synonyms: ['kikoi', 'shuka', 'maasai shuka', 'kanga', 'leso', 'kitenge fabric', 'batik fabric', 'throw', 'blanket'],
        fields: [{"key":"craftType","label":"Type","type":"select","options":["Kikoi","Maasai shuka","Kanga / leso","Kitenge fabric","Batik fabric","Throws & blankets"],"filter":"select","required":true}, { key: 'size', label: 'Size', type: 'text' }] },
    ],
    commonFields: [
      { key: 'artist', label: 'Artist / maker', type: 'text', filter: 'text' },
      { key: 'madeIn', label: 'Made in (e.g. Kisii, Machakos, Kariokor)', type: 'text' },
      { key: 'madeToOrder', label: 'Availability', type: 'select', options: ['Ready now', 'Made to order'], filter: 'select' },
      colour,
    ],
  },
  {
    slug: 'other', name: 'Other', icon: '🛍️', condition: ITEM_CONDITION,
    blurb: 'Can’t find the right category? Post it here: sports, tools, building materials, farming, services and anything else.',
    synonyms: ['other', 'others', 'misc', 'general', 'everything else', 'nyingine'],
    subs: [
      { slug: 'sports', name: 'Sports & fitness', synonyms: ['gym', 'treadmill', 'dumbbell', 'football', 'fitness'], fields: [] },
      { slug: 'tools', name: 'Tools & building materials', synonyms: ['tools', 'drill', 'cement', 'iron sheets', 'mabati', 'hardware', 'building'], fields: [] },
      { slug: 'farming', name: 'Farming & animals', synonyms: ['farm', 'seeds', 'fertilizer', 'chicken', 'kuku', 'cow', 'ng\'ombe', 'goat', 'mbuzi', 'dairy cow', 'water tank'], fields: [] },
      { slug: 'services', name: 'Services', synonyms: ['service', 'repair', 'cleaning', 'moving', 'transport', 'fundi'], fields: [] },
      { slug: 'misc', name: 'Other items', synonyms: [], fields: [] },
    ],
  },
];

const COUNTIES = ['Nairobi', 'Mombasa', 'Kiambu', 'Nakuru', 'Kisumu', 'Machakos', 'Kajiado', 'Uasin Gishu', 'Kilifi', 'Kwale', 'Meru', 'Nyeri', 'Murang\'a', 'Kirinyaga', 'Embu', 'Kakamega', 'Bungoma', 'Kericho', 'Kisii', 'Nyamira', 'Laikipia', 'Nyandarua', 'Narok', 'Bomet', 'Kitui', 'Makueni', 'Tharaka-Nithi', 'Isiolo', 'Marsabit', 'Garissa', 'Wajir', 'Mandera', 'Lamu', 'Tana River', 'Taita-Taveta', 'Turkana', 'West Pokot', 'Samburu', 'Trans Nzoia', 'Elgeyo-Marakwet', 'Nandi', 'Baringo', 'Siaya', 'Homa Bay', 'Migori', 'Busia', 'Vihiga'];

// "Other …" in every category, for items that don't fit any of its types (e.g. "Other electronics")
for (const category of CATEGORIES) {
  if (category.slug === 'other' || category.subs.some((sub) => sub.other)) continue;
  const short = category.slug === 'samaki' ? 'fish & seafood' : category.name.replace(/\s*\(.*\)\s*/g, ' ').trim();
  category.subs.push({ slug: `other-${category.slug}`, name: `Other ${/^(African|Samaki)/.test(short) ? short : short.charAt(0).toLowerCase() + short.slice(1)}`, synonyms: [], fields: [], other: true });
}
for (const sub of CATEGORIES.find((category) => category.slug === 'other').subs) if (sub.slug === 'misc') sub.other = true;

// ----- lookups
const bySlug = new Map(CATEGORIES.map((category) => [category.slug, category]));
const getCategory = (slug) => bySlug.get(slug) || null;
const getSub = (cat, sub) => getCategory(cat)?.subs.find((text) => text.slug === sub) || null;
// Every field an ad in this sub-category can have
const fieldsFor = (cat, sub) => {
  const category = getCategory(cat);
  const subcategory = getSub(cat, sub);
  if (!category || !subcategory) return [];
  const out = [];
  for (const item of [...(subcategory.fields || []), ...(category.commonFields || [])]) if (!out.some((element) => element.key === item.key)) out.push(item);
  return out;
};
// categories whose ads can have a colour (for the colour filter on category and search pages)
const hasColour = (cat) => (getCategory(cat)?.subs || []).some((sub) => fieldsFor(cat, sub.slug).some((item) => item.key === 'colour'));

const ITEM_WORDS = [
  ['Smart watches', /smart ?watch|apple watch|fitness band|smartband/],
  ['Women’s watches', /(ladies|lady|women|woman)\W.*watch|watch\W.*(ladies|lady|women)/],
  ['Men’s watches', /watch/],
  ['Football boots', /football boot|soccer boot|studs/],
  ['Running shoes', /running shoe/],
  ['T-shirts & polos', /t-?shirt|\btees?\b|polo/],
  ['T-shirts', /t-?shirt|\btees?\b/],
  ['Shirts', /shirt/],
  ['Dresses', /dress|gown/],
  ['Kitenge & ankara', /kitenge|ankara|kikoi/],
  ['Tops & blouses', /blouse|\btops?\b|crop/],
  ['Skirts', /skirt/],
  ['Jeans', /jean/],
  ['Trousers & jeans', /trouser|jean|pants|chino/],
  ['Trousers & chinos', /trouser|pants|chino/],
  ['Suits & blazers', /suit|blazer/],
  ['Jackets & coats', /jacket|coat/],
  ['Sweaters & hoodies', /sweater|hoodie|cardigan|pullover|sweatshirt/],
  ['Shorts', /short/],
  ['Lingerie & sleepwear', /lingerie|\bbras?\b|pyjama|pajama|nightdress|sleepwear|nightie/],
  ['Abayas & hijabs', /abaya|hijab|buibui/],
  ['Traditional wear', /kanzu|dashiki|traditional|kofia/],
  ['Underwear & socks', /boxer|sock|underwear|briefs|vest/],
  ['Jerseys', /jersey/],
  ['Tracksuits', /tracksuit/],
  ['Gym wear', /gym|legging|yoga/],
  ['Official shoes', /official|oxford|derby|brogue/],
  ['Sneakers', /sneaker|trainer|air ?force|jordan|canvas shoe/],
  ['Heels', /heel|stiletto|\bpumps?\b/],
  ['Wedges', /wedge/],
  ['Flats & ballerinas', /\bflats?\b|ballerina|doll shoe/],
  ['Boots', /boot/],
  ['Sandals & slippers', /sandal|slipper|flip ?flop|open shoe|crocs/],
  ['Loafers', /loafer|moccasin/],
  ['Sports shoes', /sport|running|gym/],
  ['Necklaces & chains', /necklace|chain|pendant/],
  ['Earrings', /earring/],
  ['Rings', /\brings?\b/],
  ['Bracelets & bangles', /bracelet|bangle/],
  ['Sunglasses', /sunglass|shades|spectacles/],
  ['Belts, caps & ties', /belt|\bcaps?\b|\bties?\b|\bhats?\b/],
];
// best "Type" for an ad from its title and description (or "Other")
function guessItem(sub, text = '') {
  const opts = ITEMS[sub];
  if (!opts) return null;
  const input = String(text).toLowerCase();
  for (const [opt, rx] of ITEM_WORDS) if (opts.includes(opt) && rx.test(input)) return opt;
  return 'Other';
}

module.exports = { VEHICLE_MAKES, SPARE_PART_TYPES, ITEMS, guessItem, CATEGORIES, COUNTIES, COLOURS, getCategory, getSub, fieldsFor, hasColour };
