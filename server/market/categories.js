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
const colour = { key: 'colour', label: 'Colour', type: 'select', options: ['Black', 'White', 'Silver', 'Grey', 'Blue', 'Red', 'Green', 'Brown', 'Gold', 'Beige', 'Orange', 'Yellow', 'Purple', 'Pink', 'Multi-colour', 'Other'] };
const brandText = { key: 'brand', label: 'Brand', type: 'text', filter: 'text' };
const make = (makes, label = 'Make') => ({ key: 'make', label, type: 'make', makes, filter: 'select', required: true });
const model = { key: 'model', label: 'Model', type: 'model', filter: 'select' };

const VEHICLE_CONDITION = ['Brand new', 'Foreign used', 'Locally used'];
const ITEM_CONDITION = ['New', 'Used', 'Refurbished'];

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
      { slug: 'kids-furniture', name: 'Kids furniture', synonyms: ['baby cot', 'cot', 'kids bed', 'high chair'], fields: [] },
    ],
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
    slug: 'spare-parts', name: 'Spare parts', icon: '🔧', condition: ['New (genuine)', 'New (aftermarket)', 'Used (ex-Japan)', 'Used (local)'],
    blurb: 'Parts for cars, motorbikes, trucks, tractors, phones, laptops and appliances.',
    synonyms: ['spare', 'spares', 'spare part', 'parts', 'part', 'vipuri', 'accessories'],
    subs: [
      { slug: 'car-parts', name: 'Car parts', synonyms: ['car parts', 'engine', 'gearbox', 'suspension', 'shocks', 'brake pads', 'bumper', 'headlight', 'side mirror', 'radiator'],
        fields: [{ ...make(VEHICLE_MAKES, 'Fits make'), required: false }, { ...model, label: 'Fits model' }, { key: 'partType', label: 'Part type', type: 'select', options: ['Engine & gearbox', 'Brakes', 'Suspension & steering', 'Body parts', 'Lights & electricals', 'Interior', 'Filters & service parts', 'Exhaust', 'Cooling', 'Other'], filter: 'select' }, { key: 'partNo', label: 'Part number', type: 'text' }] },
      { slug: 'tyres-rims', name: 'Tyres & rims', synonyms: ['tyre', 'tire', 'tyres', 'rim', 'rims', 'wheel', 'alloy'], fields: [{ key: 'tyreSize', label: 'Size (e.g. 195/65 R15)', type: 'text', filter: 'text' }, brandText] },
      { slug: 'motorbike-parts', name: 'Motorbike parts', synonyms: ['boda parts', 'motorbike parts', 'chain', 'sprocket', 'clutch'], fields: [{ ...make(MOTORBIKE_MAKES, 'Fits make'), required: false }, { key: 'partNo', label: 'Part number', type: 'text' }] },
      { slug: 'truck-parts', name: 'Truck & bus parts', synonyms: ['truck parts', 'lorry parts', 'bus parts'], fields: [{ ...make(VEHICLE_MAKES, 'Fits make'), required: false }, { key: 'partNo', label: 'Part number', type: 'text' }] },
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
    commonFields: [brandText,
      { key: 'wheel', label: 'Wheel size', type: 'select', options: ['12"', '16"', '20"', '24"', '26"', '27.5"', '28"', '29"', '700c'], filter: 'select' },
      { key: 'gears', label: 'Gears', type: 'number', min: 1, max: 30 }],
  },
  {
    slug: 'kitchen-equipment', name: 'Kitchen equipment', icon: '🍳', condition: ITEM_CONDITION,
    blurb: 'Cookers, gas cylinders, fridges, microwaves, blenders and commercial kitchen equipment.',
    synonyms: ['kitchen', 'jikoni', 'appliance', 'catering equipment'],
    subs: [
      { slug: 'cookers-ovens', name: 'Cookers & ovens', synonyms: ['cooker', 'oven', 'stove', 'jiko', 'electric cooker', 'gas cooker', 'standing cooker'], fields: [{ key: 'burners', label: 'Burners', type: 'select', options: ['1', '2', '3', '4', '5', '6'], filter: 'select' }, { key: 'power', label: 'Power source', type: 'select', options: ['Gas', 'Electric', 'Gas & electric', 'Charcoal', 'Other'], filter: 'select' }] },
      { slug: 'gas', name: 'Gas cylinders & burners', synonyms: ['gas', 'cylinder', 'meko', 'k-gas', 'total gas', 'pro gas', 'burner', 'regulator'], fields: [{ key: 'kg', label: 'Cylinder size', type: 'select', options: ['3 kg', '6 kg', '13 kg', '22 kg', '50 kg'], filter: 'select' }] },
      { slug: 'fridges-freezers', name: 'Fridges & freezers', synonyms: ['fridge', 'freezer', 'refrigerator', 'deep freezer', 'friji'], fields: [{ key: 'litres', label: 'Capacity (litres)', type: 'number', min: 10, max: 2000, filter: 'range' }] },
      { slug: 'microwaves', name: 'Microwaves', synonyms: ['microwave', 'micro wave'], fields: [{ key: 'litres', label: 'Capacity (litres)', type: 'number', min: 10, max: 100 }] },
      { slug: 'blenders', name: 'Blenders, juicers & mixers', synonyms: ['blender', 'juicer', 'mixer', 'food processor'], fields: [] },
      { slug: 'kettles-toasters', name: 'Kettles, toasters & small appliances', synonyms: ['kettle', 'toaster', 'sandwich maker', 'air fryer', 'rice cooker', 'pressure cooker'], fields: [] },
      { slug: 'water-dispensers', name: 'Water dispensers & purifiers', synonyms: ['dispenser', 'water dispenser', 'purifier', 'filter'], fields: [] },
      { slug: 'commercial-kitchen', name: 'Commercial & hotel kitchen equipment', synonyms: ['deep fryer', 'chipper', 'chips machine', 'chapati machine', 'display', 'commercial', 'hotel', 'restaurant', 'bakery oven'], fields: [] },
    ],
    commonFields: [{ key: 'brand', label: 'Brand', type: 'select', options: APPLIANCE_BRANDS, filter: 'select' }],
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
    commonFields: [{ key: 'material', label: 'Material', type: 'select', options: ['Stainless steel', 'Aluminium', 'Non-stick', 'Cast iron', 'Ceramic', 'Glass', 'Melamine', 'Plastic', 'Wood', 'Other'], filter: 'select' }, { key: 'pieces', label: 'Pieces in set', type: 'number', min: 1, max: 500 }],
  },
  {
    slug: 'clothes-shoes', name: 'Clothes & shoes', icon: '👗', condition: ['New', 'Used (mtumba)'],
    blurb: 'Men’s, women’s and kids’ clothes and shoes, new and mtumba.',
    synonyms: ['clothes', 'clothing', 'nguo', 'fashion', 'mtumba', 'wear', 'outfit', 'shoes', 'viatu'],
    subs: [
      { slug: 'womens-clothes', name: 'Women’s clothes', synonyms: ['dress', 'dresses', 'skirt', 'blouse', 'top', 'leggings', 'gown', 'kitenge', 'ankara', 'lingerie', 'ladies'], fields: [] },
      { slug: 'mens-clothes', name: 'Men’s clothes', synonyms: ['shirt', 'shirts', 'trouser', 'trousers', 'jeans', 'suit', 'suits', 'tshirt', 't-shirt', 'hoodie', 'jacket', 'khaki', 'gents'], fields: [] },
      { slug: 'kids-clothes', name: 'Kids & baby clothes', synonyms: ['kids clothes', 'baby clothes', 'school uniform', 'uniform', 'romper'], fields: [] },
      { slug: 'womens-shoes', name: 'Women’s shoes', synonyms: ['heels', 'sandals', 'flats', 'ladies shoes', 'boots', 'sneakers'], fields: [{ key: 'shoeSize', label: 'Shoe size (EU)', type: 'select', options: ['35', '36', '37', '38', '39', '40', '41', '42', '43'], filter: 'select' }] },
      { slug: 'mens-shoes', name: 'Men’s shoes', synonyms: ['official shoes', 'sneakers', 'boots', 'loafers', 'sandals', 'gents shoes', 'rubber'], fields: [{ key: 'shoeSize', label: 'Shoe size (EU)', type: 'select', options: ['38', '39', '40', '41', '42', '43', '44', '45', '46', '47'], filter: 'select' }] },
      { slug: 'kids-shoes', name: 'Kids shoes', synonyms: ['school shoes', 'kids sneakers', 'baby shoes'], fields: [] },
      { slug: 'sportswear', name: 'Sportswear', synonyms: ['jersey', 'tracksuit', 'gym wear', 'football boots', 'running shoes'], fields: [] },
      { slug: 'watches-jewellery', name: 'Watches & jewellery', synonyms: ['watch', 'jewelry', 'jewellery', 'necklace', 'earrings', 'ring', 'bracelet', 'saa'], fields: [] },
    ],
    commonFields: [
      brandText,
      { key: 'size', label: 'Size', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL+', 'Kids', 'One size'], filter: 'select' },
      { key: 'gender', label: 'For', type: 'select', options: ['Women', 'Men', 'Unisex', 'Girls', 'Boys', 'Baby'], filter: 'select' },
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
  {
    slug: 'cooking-products', name: 'Cooking products', icon: '🫒', condition: null,
    blurb: 'Cooking oil, flour, rice, sugar, spices and other food ingredients, retail and wholesale.',
    synonyms: ['cooking', 'food', 'chakula', 'groceries', 'foodstuff', 'ingredients', 'wholesale food'],
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
    slug: 'other', name: 'Everything else', icon: '🛍️', condition: ITEM_CONDITION,
    blurb: 'Baby items, sports, tools, farming, services and anything else.',
    synonyms: ['other', 'misc', 'general'],
    subs: [
      { slug: 'baby-kids', name: 'Baby & kids', synonyms: ['baby', 'stroller', 'pram', 'toys', 'diapers'], fields: [] },
      { slug: 'sports', name: 'Sports & fitness', synonyms: ['gym', 'treadmill', 'dumbbell', 'football', 'fitness'], fields: [] },
      { slug: 'tools', name: 'Tools & building materials', synonyms: ['tools', 'drill', 'cement', 'iron sheets', 'mabati', 'hardware', 'building'], fields: [] },
      { slug: 'farming', name: 'Farming & animals', synonyms: ['farm', 'seeds', 'fertilizer', 'chicken', 'kuku', 'cow', 'ng\'ombe', 'goat', 'mbuzi', 'dairy cow', 'water tank'], fields: [] },
      { slug: 'services', name: 'Services', synonyms: ['service', 'repair', 'cleaning', 'moving', 'transport', 'fundi'], fields: [] },
      { slug: 'misc', name: 'Other items', synonyms: [], fields: [] },
    ],
  },
];

const COUNTIES = ['Nairobi', 'Mombasa', 'Kiambu', 'Nakuru', 'Kisumu', 'Machakos', 'Kajiado', 'Uasin Gishu', 'Kilifi', 'Kwale', 'Meru', 'Nyeri', 'Murang\'a', 'Kirinyaga', 'Embu', 'Kakamega', 'Bungoma', 'Kericho', 'Kisii', 'Nyamira', 'Laikipia', 'Nyandarua', 'Narok', 'Bomet', 'Kitui', 'Makueni', 'Tharaka-Nithi', 'Isiolo', 'Marsabit', 'Garissa', 'Wajir', 'Mandera', 'Lamu', 'Tana River', 'Taita-Taveta', 'Turkana', 'West Pokot', 'Samburu', 'Trans Nzoia', 'Elgeyo-Marakwet', 'Nandi', 'Baringo', 'Siaya', 'Homa Bay', 'Migori', 'Busia', 'Vihiga'];

// ----- lookups
const bySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));
const getCategory = (slug) => bySlug.get(slug) || null;
const getSub = (cat, sub) => getCategory(cat)?.subs.find((s) => s.slug === sub) || null;
// Every field an ad in this sub-category can have
const fieldsFor = (cat, sub) => {
  const c = getCategory(cat);
  const s = getSub(cat, sub);
  if (!c || !s) return [];
  return [...(s.fields || []), ...(c.commonFields || [])];
};

module.exports = { CATEGORIES, COUNTIES, getCategory, getSub, fieldsFor };
