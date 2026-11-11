// npm run seed:market — demo sellers and ads so the marketplace isn't empty.
// Safe to run again: it only replaces the demo sellers' own ads (emails ending in @demo.ordersasa.test).
// Demo sellers can log in with password demo1234 (e.g. wanjiku@demo.ordersasa.test) to try the chat.
// Remove all demo sellers, their ads and chats:  npm run seed:market -- --remove
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const { runAsTenant } = require('../tenancy/context');
const { bootstrapDefaultTenant, findTenant, DEFAULT_SLUG } = require('../tenancy/tenants');
const { keywordsFor, normalize } = require('../market/search');

const SELLERS = [
  ['Wanjiku Kamau', 'wanjiku', '254700100201'],
  ['Brian Otieno', 'brian', '254700100202'],
  ['Amina Hassan', 'amina', '254700100203'],
  ['Kevin Mwangi', 'kevin', '254700100204'],
  ['Faith Chebet', 'faith', '254700100205'],
  ['Moses Kiprono', 'moses', '254700100206'],
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

  ['kitchen-equipment', 'cookers-ovens', 'Von Hotpoint 4 burner standing cooker with oven', 38000, 'Nairobi', 'Thika Road', 'New', { burners: '4', power: 'Gas & electric', brand: 'Von Hotpoint' }, '3 gas + 1 electric with electric oven. Warranty included.', false],
  ['kitchen-equipment', 'gas', '13kg K-Gas cylinder with burner, full', 7200, 'Nairobi', 'Kahawa', 'New', { kg: '13 kg' }, 'Full 13kg cylinder with a 2-burner top and regulator. Delivery and refills available.', false],
  ['kitchen-equipment', 'fridges-freezers', 'Hisense 205L double door fridge', 34500, 'Kiambu', 'Kiambu Town', 'New', { litres: 205, brand: 'Hisense' }, 'Energy saving, freezer on top, 2 year warranty.', false],
  ['kitchen-equipment', 'commercial-kitchen', 'Commercial double deep fryer 12L', 26000, 'Nairobi', 'Kariokor', 'New', { brand: 'Other' }, 'Stainless steel, electric, perfect for chips businesses and hotels.', true],
  ['kitchen-equipment', 'blenders', 'Ramtons 1.5L blender', 4800, 'Nakuru', 'Nakuru Town', 'New', { brand: 'Ramtons' }, 'Powerful blender with grinder mill, 1 year warranty.', false],

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
  ['other', 'farming', 'Improved Kienyeji chicks, 1 month old', 350, 'Kakamega', 'Kakamega Town', 'New', {}, 'Vaccinated improved kienyeji chicks. Price per chick.', false],
  ['other', 'tools', 'Mabati iron sheets gauge 30', 850, 'Nairobi', 'Mlolongo', 'New', {}, 'Box profile iron sheets per metre. Delivery available.', false],
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await bootstrapDefaultTenant();
  const tenant = await findTenant(process.env.SEED_TENANT || DEFAULT_SLUG());
  if (!tenant) throw new Error('No such client');
  console.log('Marketplace demo data for client:', tenant.slug, `(${tenant.dbName})`);
  await runAsTenant(tenant, async () => {
    const sellers = [];
    for (const [name, user, phone] of SELLERS) {
      const email = `${user}@demo.ordersasa.test`;
      let c = await Customer.findOne({ email });
      if (!c) {
        if (await Customer.exists({ phone })) throw new Error(`Phone ${phone} is already used by another customer`);
        c = await Customer.create({ name, email, phone, password: 'demo1234' });
      }
      sellers.push(c);
    }
    const ids = sellers.map((s) => s._id);
    if (process.argv.includes('--remove')) {
      const ads = await Listing.find({ seller: { $in: ids } }).select('_id');
      const cs = await Conversation.find({ $or: [{ listing: { $in: ads.map((x) => x._id) } }, { buyer: { $in: ids } }] }).select('_id');
      await ChatMessage.deleteMany({ conversation: { $in: cs.map((c) => c._id) } });
      await Conversation.deleteMany({ _id: { $in: cs.map((c) => c._id) } });
      await Listing.deleteMany({ seller: { $in: ids } });
      await Customer.deleteMany({ _id: { $in: ids } });
      console.log(`Removed ${ads.length} demo ads and ${ids.length} demo sellers.`);
      return;
    }
    const old = await Listing.find({ seller: { $in: ids } }).select('_id');
    const convs = await Conversation.find({ listing: { $in: old.map((o) => o._id) } }).select('_id');
    await ChatMessage.deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
    await Conversation.deleteMany({ _id: { $in: convs.map((c) => c._id) } });
    await Listing.deleteMany({ seller: { $in: ids } });

    const now = Date.now();
    const docs = ADS.map(([category, sub, title, price, county, area, condition, attrs, description, negotiable], i) => {
      const s = sellers[i % sellers.length];
      const d = { category, sub, title, price, county, area, condition, attrs, description, negotiable, seller: s._id, sellerName: s.name, status: 'active', views: Math.floor(Math.random() * 400) };
      d.slug = `${normalize(`${title} ${area}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}-${crypto.randomBytes(3).toString('hex')}`;
      d.keywords = keywordsFor(d);
      d.createdAt = new Date(now - i * 47 * 60 * 1000); // spread over the last few days
      d.updatedAt = d.createdAt;
      return d;
    });
    await Listing.insertMany(docs, { timestamps: false });
    await Listing.syncIndexes();
    console.log(`Added ${docs.length} demo ads from ${sellers.length} demo sellers.`);
    console.log('Demo seller logins (password demo1234):', SELLERS.map(([, u]) => `${u}@demo.ordersasa.test`).join(', '));
  });
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
