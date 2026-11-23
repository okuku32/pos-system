// 🐟 Demo samaki ads (used by seedMarket.js and by demoSamaki.js for an existing database).
// [seller, category, sub, title, price, area, condition, attrs, description]
module.exports = [
  // deep-fried Victoria fish (the kibanda / hotel favourite)
  ['njeri', 'samaki', 'fried-victoria-fish', 'Deep-fried tilapia (ngege), large', 550, '', '', { fish: 'Ngege (tilapia)', style: 'Deep fried, whole', size: 'Large', unit: 'Piece', from: 'Kisumu (Dunga, Kichinjio)' }, 'Whole ngege from Dunga beach, deep fried crispy. Order with ugali and sukuma, or take away. Wet fry on request.'],
  ['njeri', 'samaki', 'fried-victoria-fish', 'Wet fry ngege with ugali and kachumbari', 650, '', '', { fish: 'Ngege (tilapia)', style: 'Wet fry (with soup)', size: 'Medium', unit: 'Plate (portion)', from: 'Homa Bay' }, 'Fried tilapia cooked in tomato and onion soup, served with ugali, sukuma and kachumbari. Ready in 15 minutes.'],
  ['njeri', 'samaki', 'fried-victoria-fish', 'Fried Nile perch (mbuta) fillets', 900, '', '', { fish: 'Mbuta (Nile perch)', style: 'Fried fillets (minofu)', unit: 'Kg', from: 'Kisumu (Dunga, Kichinjio)' }, 'Boneless mbuta fillets, fried golden. Great for families and parties.'],
  // fresh Victoria fish
  ['joyce', 'samaki', 'fresh-victoria-fish', 'Fresh tilapia (ngege), cleaned', 450, '', '', { fish: 'Ngege (tilapia)', form: 'Cleaned (gutted & scaled)', size: 'Medium', unit: 'Piece', from: 'Busia (Port Victoria)' }, 'Fresh Lake Victoria ngege, gutted and scaled for you. Arrives every morning from Port Victoria.'],
  ['joyce', 'samaki', 'fresh-victoria-fish', 'Nile perch (mbuta) fillets, fresh', 800, '', '', { fish: 'Mbuta (Nile perch)', form: 'Fillets (minofu)', unit: 'Kg', from: 'Mbita / Rusinga' }, 'Fresh boneless mbuta minofu, cut to order. Wholesale for hotels and restaurants.', { wholesale: { enabled: true, unit: 'kg', retail: true, tiers: [{ minQty: 10, price: 750 }, { minQty: 50, price: 700 }] } }],
  ['joyce', 'samaki', 'fresh-victoria-fish', 'Mgongo wazi (Nile perch frames)', 250, '', '', { fish: 'Mbuta (Nile perch)', form: 'Mgongo wazi (frames)', unit: 'Kg', from: 'Kisumu (Dunga, Kichinjio)' }, 'Meaty mbuta frames for a cheap, tasty stew. Sold per kg.'],
  ['joyce', 'samaki', 'fresh-victoria-fish', 'Obambo (dried Nile perch), whole', 700, '', '', { fish: 'Obambo (dried / smoked)', form: 'Sun-dried', size: 'Large', unit: 'Piece', from: 'Mbita / Rusinga' }, 'Sun-dried and smoked obambo from Rusinga. Soak overnight and cook with tomatoes and onions.'],
  ['joyce', 'samaki', 'fresh-victoria-fish', 'Mumi (catfish) from Lake Victoria', 550, '', '', { fish: 'Mumi (catfish)', form: 'Cleaned (gutted & scaled)', size: 'Large', unit: 'Kg', from: 'Siaya (Usenge, Uhanya)' }, 'Fresh mumi from Usenge, cleaned and cut. Great for fish stew.'],
  ['njeri', 'samaki', 'fried-victoria-fish', 'Fried mumi (catfish) pieces', 600, '', '', { fish: 'Mumi (catfish)', style: 'Dry fry', unit: 'Plate (portion)', from: 'Siaya (Usenge, Uhanya)' }, 'Dry-fried mumi pieces with ugali and greens.'],
  // fresh water lake fish
  ['joyce', 'samaki', 'lake-fish', 'Lake Naivasha tilapia, fresh', 400, '', '', { fish: 'Tilapia', lake: 'Lake Naivasha', form: 'Whole', unit: 'Piece' }, 'Fresh tilapia from Lake Naivasha, brought to Marikiti daily.'],
  ['joyce', 'samaki', 'lake-fish', 'Catfish (mumi), farm fresh', 500, '', '', { fish: 'Catfish (mumi)', lake: 'Fish farm / pond', form: 'Whole', unit: 'Kg' }, 'Farmed mumi from Kirinyaga ponds. Firm and meaty, great for stew.'],
  // sea foods (Mombasa)
  ['halima', 'samaki', 'seafood', 'Fresh prawns (kamba), large', 1200, '', '', { kind: 'Prawns (kamba)', form: 'Fresh', unit: 'Kg', from: 'Mombasa / Kilifi coast' }, 'Large fresh prawns from Kilifi fishermen. Cleaned on request.'],
  ['halima', 'samaki', 'seafood', 'Pweza (octopus), cleaned', 900, '', '', { kind: 'Octopus (pweza)', form: 'Cleaned & ready to cook', unit: 'Kg', from: 'Mombasa / Kilifi coast' }, 'Tender pweza, cleaned and tenderised. Perfect for pweza wa nazi.'],
  ['halima', 'samaki', 'seafood', 'Red snapper (changu), whole', 700, '', '', { kind: 'Fish (nguru, changu, tafi, jodari…)', form: 'Fresh', unit: 'Kg', from: 'Mombasa / Kilifi coast' }, 'Fresh changu landed this morning at Old Town. Ask for nguru (kingfish) and tafi too.'],
  // omena
  ['njeri', 'samaki', 'fried-omena', 'Deep-fried omena, crispy', 100, '', '', { style: 'Deep fried, crispy', unit: 'Plate (portion)', from: 'Homa Bay' }, 'Crispy fried omena, ready to eat with ugali. Fried with tomatoes and onions on request.'],
  ['joyce', 'samaki', 'fresh-omena', 'Omena (dagaa), sun-dried, clean', 150, '', '', { form: 'Cleaned, no sand', unit: 'Gorogoro', from: 'Siaya (Usenge, Uhanya)' }, 'Sun-dried omena from Usenge, washed and free of sand. By the gorogoro or the sack.', { wholesale: { enabled: true, unit: 'gorogoro', retail: true, tiers: [{ minQty: 10, price: 130 }, { minQty: 50, price: 120 }] } }],
  ['joyce', 'samaki', 'fresh-omena', 'Fresh omena (wet), from Homa Bay', 200, '', '', { form: 'Fresh (wet)', unit: 'Kopo (tin)', from: 'Homa Bay' }, 'Fresh omena that came in overnight from Homa Bay. Cook today.'],
];
